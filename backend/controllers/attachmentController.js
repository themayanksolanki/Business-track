import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { cloudinary } from '../middleware/upload.js';
import { canAccessProject } from './projectController.js';

const UPLOADED_BY_SELECT = { id: true, username: true, email: true, role: true };
const ACCESS_INCLUDE = { members: { select: { userId: true } } };

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

    const attachment = await prisma.attachment.create({
      data: {
        taskId: task.id,
        fileName: req.file.originalname,
        url: req.file.path, // Cloudinary secure URL
        publicId: req.file.filename, // Cloudinary public_id
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

// The file now lives on Cloudinary, so "download" is just handing back the
// direct URL instead of piping bytes through this server.
export const downloadAttachment = async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({ where: { id: Number(req.params.attachmentId) } });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    const task = await prisma.task.findUnique({ where: { id: attachment.taskId } });
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user))) return next(new AppError('Access denied', 403));

    res.redirect(attachment.url);
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

    const attachment = await prisma.attachment.create({
      data: {
        projectItemId: item.id,
        fileName: req.file.originalname,
        url: req.file.path,
        publicId: req.file.filename,
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

    res.redirect(attachment.url);
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

    if (attachment.publicId) {
      await cloudinary.uploader.destroy(attachment.publicId).catch(() => {
        // best-effort: continue even if the blob is already gone
      });
    }
    await prisma.attachment.delete({ where: { id: attachment.id } });

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

    res.redirect(attachment.url);
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

    if (attachment.publicId) {
      await cloudinary.uploader.destroy(attachment.publicId).catch(() => {
        // best-effort: continue even if the blob is already gone
      });
    }
    await prisma.attachment.delete({ where: { id: attachment.id } });

    res.status(200).json({ message: 'Attachment deleted' });
  } catch (err) {
    next(err);
  }
};
