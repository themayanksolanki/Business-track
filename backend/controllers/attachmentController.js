import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { destroyBlob, cloudinaryDownloadUrl } from '../utils/blobStorage.js';
import { getS3DownloadUrl } from '../lib/s3.js';
import { canAccessProject } from './projectController.js';

// Relaying the file through this server (fetch from the provider, then
// re-stream to the client) was timing out on real-world PDFs — a slow
// connection or an intermediary (Cloudflare/Render) killing a long-lived
// proxied transfer mid-stream. Handing back a URL the browser fetches
// directly (a presigned S3 URL, or Cloudinary's already-public one) means
// this server only ever serves a small JSON response, never the file bytes.
//
// Preview (`viewUrl`) and forced download (`downloadUrl`) need different
// Content-Disposition, so both are returned rather than toggling one URL —
// presigning twice is cheap (local HMAC, no extra AWS round-trip). The view
// URL gets a longer expiry since it's now embedded directly as an <img>/
// <video>/<iframe> src and may stay in active use well past 5 minutes
// (video seeking, a long-open PDF); the download URL is consumed immediately
// via a single navigation, so it stays short-lived.
const getAttachmentDownloadInfo = async (attachment) => {
  if (attachment.storage === 's3') {
    const [viewUrl, downloadUrl] = await Promise.all([
      getS3DownloadUrl({
        key: attachment.publicId,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
        disposition: 'inline',
        expiresIn: 3600,
      }),
      getS3DownloadUrl({
        key: attachment.publicId,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
        disposition: 'attachment',
        expiresIn: 300,
      }),
    ]);
    return { viewUrl, downloadUrl, mimeType: attachment.mimeType, fileName: attachment.fileName };
  }

  return {
    viewUrl: attachment.url,
    downloadUrl: cloudinaryDownloadUrl(attachment.url),
    mimeType: attachment.mimeType,
    fileName: attachment.fileName,
  };
};

const UPLOADED_BY_SELECT = { id: true, username: true, email: true, role: true };
const ACCESS_INCLUDE = { members: { select: { userId: true } } };

export const PENDING_DELETE_MS = 10_000;

// Delete is the concurrency guard: whichever caller (the interval sweep, or a
// request-triggered sweep) wins the race actually removes the row and gets to
// destroy the blob and decrement the count; the loser's delete throws P2025
// (already gone) and just returns, so a task's attachmentCount never gets
// double-decremented for the same attachment.
export const permanentlyDeleteAttachment = async (attachment) => {
  try {
    await prisma.attachment.delete({ where: { id: attachment.id } });
  } catch (err) {
    if (err.code === 'P2025') return;
    throw err;
  }

  await destroyBlob(attachment);

  if (attachment.taskId) {
    await prisma.task
      .update({ where: { id: attachment.taskId }, data: { attachmentCount: { decrement: 1 } } })
      .catch(() => {});
  }
};

export const purgeExpiredAttachments = async () => {
  const expired = await prisma.attachment.findMany({ where: { pendingDeleteAt: { lte: new Date() } } });
  for (const attachment of expired) {
    await permanentlyDeleteAttachment(attachment);
  }
};

const purgeExpiredForTask = async (taskId) => {
  const expired = await prisma.attachment.findMany({
    where: { taskId, pendingDeleteAt: { lte: new Date() } },
  });
  for (const attachment of expired) {
    await permanentlyDeleteAttachment(attachment);
  }
};

const getTeamMemberIds = async (teamLeadId) => {
  const members = await prisma.user.findMany({ where: { teamLeadId, role: 'User' }, select: { id: true } });
  return members.map((m) => m.id);
};

const canAccessTask = async (task, user) => {
  if (task.organizationId !== user.organizationId) return false;
  if (user.role === 'Admin' || user.role === 'Manager') return true;

  if (user.role === 'Team Lead') {
    const memberIds = await getTeamMemberIds(user.id);
    const allowed = [user.id, ...memberIds];
    return allowed.includes(task.assignedToId);
  }

  return task.assignedToId === user.id || task.createdById === user.id;
};

export const getAttachments = async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user))) return next(new AppError('Access denied', 403));

    // Catch up any attachment whose countdown expired while nobody was
    // looking (page closed, sweep hasn't ticked yet) before returning the list.
    await purgeExpiredForTask(task.id);

    const attachments = await prisma.attachment.findMany({
      where: { taskId: task.id },
      include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(attachments);
  } catch (err) {
    next(err);
  }
};

export const uploadAttachment = async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user))) return next(new AppError('Access denied', 403));

    if (!req.file) return next(new AppError('No file uploaded', 400));

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          taskId: task.id,
          fileName: req.file.originalname,
          url: req.file.path,
          publicId: req.file.filename, // S3 object key
          storage: 's3',
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadedById: req.user.id,
        },
        include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
      });
      await tx.task.update({ where: { id: task.id }, data: { attachmentCount: { increment: 1 } } });
      return created;
    });

    res.status(201).json({ message: 'File uploaded', attachment });
  } catch (err) {
    next(err);
  }
};

export const deleteAttachment = async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user))) return next(new AppError('Access denied', 403));

    const attachment = await prisma.attachment.findFirst({
      where: { id: Number(req.params.attachmentId), taskId: task.id },
    });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    // Already counting down — return its current state rather than resetting
    // the clock, so a double-click doesn't grant extra time.
    if (attachment.pendingDeleteAt && attachment.pendingDeleteAt > new Date()) {
      return res.status(200).json({ message: 'Attachment already pending deletion', attachment });
    }

    const updated = await prisma.attachment.update({
      where: { id: attachment.id },
      data: { pendingDeleteAt: new Date(Date.now() + PENDING_DELETE_MS) },
      include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
    });

    res.status(200).json({ message: 'Attachment scheduled for deletion', attachment: updated });
  } catch (err) {
    next(err);
  }
};

export const undoDeleteAttachment = async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user))) return next(new AppError('Access denied', 403));

    const attachment = await prisma.attachment.findFirst({
      where: { id: Number(req.params.attachmentId), taskId: task.id },
    });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    if (!attachment.pendingDeleteAt || attachment.pendingDeleteAt <= new Date())
      return next(new AppError('Attachment is not pending deletion', 400));

    const updated = await prisma.attachment.update({
      where: { id: attachment.id },
      data: { pendingDeleteAt: null },
      include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
    });

    res.status(200).json({ message: 'Deletion undone', attachment: updated });
  } catch (err) {
    next(err);
  }
};

export const downloadAttachment = async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({ where: { id: Number(req.params.attachmentId) } });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    const task = await prisma.task.findUnique({ where: { id: attachment.taskId } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user))) return next(new AppError('Access denied', 403));

    res.status(200).json(await getAttachmentDownloadInfo(attachment));
  } catch (err) {
    next(err);
  }
};

export const getItemAttachments = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) return next(new AppError('Item not found', 404));
    if (item.type === 'group') return next(new AppError('Groups do not support attachments', 400));

    const attachments = await prisma.attachment.findMany({
      where: { projectItemId: item.id },
      include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(attachments);
  } catch (err) {
    next(err);
  }
};

export const uploadItemAttachment = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) return next(new AppError('Item not found', 404));
    if (item.type === 'group') return next(new AppError('Groups do not support attachments', 400));

    if (!req.file) return next(new AppError('No file uploaded', 400));

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          projectItemId: item.id,
          fileName: req.file.originalname,
          url: req.file.path,
          publicId: req.file.filename,
          storage: 's3',
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadedById: req.user.id,
        },
        include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
      });
      await tx.projectItem.update({ where: { id: item.id }, data: { attachmentCount: { increment: 1 } } });
      return created;
    });

    res.status(201).json({ message: 'File uploaded', attachment });
  } catch (err) {
    next(err);
  }
};

export const downloadItemAttachment = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const attachment = await prisma.attachment.findFirst({
      where: { id: Number(req.params.attachmentId), projectItemId: Number(req.params.itemId) },
    });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    res.status(200).json(await getAttachmentDownloadInfo(attachment));
  } catch (err) {
    next(err);
  }
};

export const deleteItemAttachment = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const attachment = await prisma.attachment.findFirst({
      where: { id: Number(req.params.attachmentId), projectItemId: Number(req.params.itemId) },
    });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    await destroyBlob(attachment);
    await prisma.$transaction([
      prisma.attachment.delete({ where: { id: attachment.id } }),
      prisma.projectItem.update({
        where: { id: attachment.projectItemId },
        data: { attachmentCount: { decrement: 1 } },
      }),
    ]);

    res.status(200).json({ message: 'Attachment deleted' });
  } catch (err) {
    next(err);
  }
};

export const getProjectAttachments = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const attachments = await prisma.attachment.findMany({
      where: { projectId: project.id },
      include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(attachments);
  } catch (err) {
    next(err);
  }
};

export const uploadProjectAttachment = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    if (!req.file) return next(new AppError('No file uploaded', 400));

    const attachment = await prisma.attachment.create({
      data: {
        projectId: project.id,
        fileName: req.file.originalname,
        url: req.file.path,
        publicId: req.file.filename,
        storage: 's3',
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedById: req.user.id,
      },
      include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
    });

    res.status(201).json({ message: 'File uploaded', attachment });
  } catch (err) {
    next(err);
  }
};

export const downloadProjectAttachment = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const attachment = await prisma.attachment.findFirst({
      where: { id: Number(req.params.attachmentId), projectId: project.id },
    });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    res.status(200).json(await getAttachmentDownloadInfo(attachment));
  } catch (err) {
    next(err);
  }
};

export const deleteProjectAttachment = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const attachment = await prisma.attachment.findFirst({
      where: { id: Number(req.params.attachmentId), projectId: project.id },
    });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    await destroyBlob(attachment);
    await prisma.attachment.delete({ where: { id: attachment.id } });

    res.status(200).json({ message: 'Attachment deleted' });
  } catch (err) {
    next(err);
  }
};
