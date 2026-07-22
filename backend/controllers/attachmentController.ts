import type { Request, Response, NextFunction } from 'express';
import type { Attachment } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { destroyBlob, cloudinaryDownloadUrl } from '../utils/blobStorage.js';
import { getS3DownloadUrl } from '../lib/s3.js';
import { canAccessProject, canEditProject } from './projectController.js';
import { getTaskAccessLevel } from '../utils/access.js';

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
const getAttachmentDownloadInfo = async (attachment: Attachment) => {
  // A pasted link has nothing to sign or proxy — it already points at
  // wherever the user's browser can reach it, so view/download are the
  // same URL untouched.
  if (attachment.kind === 'link') {
    return {
      viewUrl: attachment.url,
      downloadUrl: attachment.url,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
    };
  }

  if (attachment.storage === 's3') {
    const [viewUrl, downloadUrl] = await Promise.all([
      getS3DownloadUrl({
        key: attachment.publicId!,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
        disposition: 'inline',
        expiresIn: 3600,
      }),
      getS3DownloadUrl({
        key: attachment.publicId!,
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
const ACCESS_INCLUDE_WITH_ROLE = {
  members: { select: { userId: true, role: { select: { canEdit: true } } } },
};

const LINK_EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
};

// Guessing from the extension lets a pasted PDF/image/video link reuse the
// exact same preview branch (image/video/pdf) that an uploaded file gets in
// the attachment viewer, instead of a link needing its own bespoke UI. A
// generic page link (no recognized extension) falls back to 'text/html',
// which the viewer treats as a best-effort iframe embed.
const guessMimeTypeFromUrl = (url: string): string => {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    return (ext && LINK_EXTENSION_MIME_TYPES[ext]) || 'text/html';
  } catch {
    return 'text/html';
  }
};

export const PENDING_DELETE_MS = 10_000;

// Delete is the concurrency guard: whichever caller (the interval sweep, or a
// request-triggered sweep) wins the race actually removes the row and gets to
// destroy the blob and decrement the count; the loser's delete throws P2025
// (already gone) and just returns, so a task's attachmentCount never gets
// double-decremented for the same attachment.
export const permanentlyDeleteAttachment = async (attachment: Attachment) => {
  try {
    await prisma.attachment.delete({ where: { id: attachment.id } });
  } catch (err: any) {
    if (err.code === 'P2025') return;
    throw err;
  }

  await destroyBlob(attachment);

  if (attachment.taskId) {
    await prisma.task
      .update({ where: { id: attachment.taskId }, data: { attachmentCount: { decrement: 1 } } })
      .catch(() => {});
  } else if (attachment.projectItemId) {
    await prisma.projectItem
      .update({ where: { id: attachment.projectItemId }, data: { attachmentCount: { decrement: 1 } } })
      .catch(() => {});
  }
};

export const purgeExpiredAttachments = async () => {
  const expired = await prisma.attachment.findMany({ where: { pendingDeleteAt: { lte: new Date() } } });
  for (const attachment of expired) {
    await permanentlyDeleteAttachment(attachment);
  }
};

const purgeExpiredForTask = async (taskId: number) => {
  const expired = await prisma.attachment.findMany({
    where: { taskId, pendingDeleteAt: { lte: new Date() } },
  });
  for (const attachment of expired) {
    await permanentlyDeleteAttachment(attachment);
  }
};

const purgeExpiredForItem = async (projectItemId: number) => {
  const expired = await prisma.attachment.findMany({
    where: { projectItemId, pendingDeleteAt: { lte: new Date() } },
  });
  for (const attachment of expired) {
    await permanentlyDeleteAttachment(attachment);
  }
};

type AuthUser = { id: number; role: string; organizationId: number | null };
type AccessTask = { organizationId: number | null; assignedToId: number; createdById: number };

const canAccessTask = async (task: AccessTask, user: AuthUser) => (await getTaskAccessLevel(task, user)) === 'edit';

export const getAttachments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user!))) return next(new AppError('Access denied', 403));

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

export const uploadAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user!))) return next(new AppError('Access denied', 403));

    if (!req.file) return next(new AppError('No file uploaded', 400));

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          taskId: task.id,
          fileName: req.file!.originalname,
          url: req.file!.path,
          publicId: req.file!.filename, // S3 object key
          storage: 's3',
          mimeType: req.file!.mimetype,
          size: req.file!.size,
          uploadedById: req.user!.id,
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

export const deleteAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user!))) return next(new AppError('Access denied', 403));

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

export const undoDeleteAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user!))) return next(new AppError('Access denied', 403));

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

export const downloadAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attachment = await prisma.attachment.findUnique({ where: { id: Number(req.params.attachmentId) } });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    const task = await prisma.task.findUnique({ where: { id: attachment.taskId! } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user!))) return next(new AppError('Access denied', 403));

    res.status(200).json(await getAttachmentDownloadInfo(attachment));
  } catch (err) {
    next(err);
  }
};

export const getItemAttachments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
      return next(new AppError('You do not have access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) return next(new AppError('Item not found', 404));
    if (item.type === 'group') return next(new AppError('Groups do not support attachments', 400));

    // Catch up any attachment whose countdown expired while nobody was
    // looking (page closed, sweep hasn't ticked yet) before returning the list.
    await purgeExpiredForItem(item.id);

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

export const uploadItemAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE_WITH_ROLE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canEditProject(req.user!, project))
      return next(new AppError('You have view-only access to this project', 403));

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
          fileName: req.file!.originalname,
          url: req.file!.path,
          publicId: req.file!.filename,
          storage: 's3',
          mimeType: req.file!.mimetype,
          size: req.file!.size,
          uploadedById: req.user!.id,
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

export const addItemAttachmentLink = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE_WITH_ROLE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canEditProject(req.user!, project))
      return next(new AppError('You have view-only access to this project', 403));

    const item = await prisma.projectItem.findFirst({
      where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) return next(new AppError('Item not found', 404));
    if (item.type === 'group') return next(new AppError('Groups do not support attachments', 400));

    const url = req.body.url.trim();
    const fileName = (req.body.fileName || '').trim() || url;

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          projectItemId: item.id,
          fileName,
          url,
          publicId: null,
          storage: 's3',
          kind: 'link',
          mimeType: guessMimeTypeFromUrl(url),
          size: 0,
          uploadedById: req.user!.id,
        },
        include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
      });
      await tx.projectItem.update({ where: { id: item.id }, data: { attachmentCount: { increment: 1 } } });
      return created;
    });

    res.status(201).json({ message: 'Link added', attachment });
  } catch (err) {
    next(err);
  }
};

export const downloadItemAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
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

export const deleteItemAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE_WITH_ROLE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canEditProject(req.user!, project))
      return next(new AppError('You have view-only access to this project', 403));

    const attachment = await prisma.attachment.findFirst({
      where: { id: Number(req.params.attachmentId), projectItemId: Number(req.params.itemId) },
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

export const undoItemAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE_WITH_ROLE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canEditProject(req.user!, project))
      return next(new AppError('You have view-only access to this project', 403));

    const attachment = await prisma.attachment.findFirst({
      where: { id: Number(req.params.attachmentId), projectItemId: Number(req.params.itemId) },
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

export const getProjectAttachments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
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

export const uploadProjectAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
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
        uploadedById: req.user!.id,
      },
      include: { uploadedBy: { select: UPLOADED_BY_SELECT } },
    });

    res.status(201).json({ message: 'File uploaded', attachment });
  } catch (err) {
    next(err);
  }
};

export const downloadProjectAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
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

export const deleteProjectAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
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
