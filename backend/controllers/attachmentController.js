import Task from '../models/Task.js';
import User from '../models/User.js';
import Attachment from '../models/Attachment.js';
import ProjectItem from '../models/ProjectItem.js';
import AppError from '../utils/AppError.js';
import { uploadBufferToGridFS, openDownloadStream, deleteFile } from '../utils/gridfs.js';

const getTeamMemberIds = async (teamLeadId) => {
  const members = await User.find({ teamLeadId, role: 'Employee' }).select('_id');
  return members.map((m) => m._id);
};

const canAccessTask = async (task, user) => {
  if (user.role === 'Manager') return true;

  if (user.role === 'Team Lead') {
    const memberIds = await getTeamMemberIds(user._id);
    const allowed = [String(user._id), ...memberIds.map(String)];
    return allowed.includes(String(task.assignedTo));
  }

  return (
    String(task.assignedTo) === String(user._id) ||
    String(task.createdBy) === String(user._id)
  );
};

export const getAttachments = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user)))
      return next(new AppError('Access denied', 403));

    const attachments = await Attachment.find({ task: task._id })
      .populate('uploadedBy', 'username email role')
      .sort({ createdAt: -1 });

    res.status(200).json(attachments);
  } catch (err) {
    next(err);
  }
};

export const uploadAttachment = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user)))
      return next(new AppError('Access denied', 403));

    if (!req.file) return next(new AppError('No file uploaded', 400));

    const gridFsId = await uploadBufferToGridFS(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    const attachment = await Attachment.create({
      task: task._id,
      fileName: req.file.originalname,
      gridFsId,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user._id,
    });

    const populated = await attachment.populate('uploadedBy', 'username email role');

    res.status(201).json({ message: 'File uploaded', attachment: populated });
  } catch (err) {
    next(err);
  }
};

export const downloadAttachment = async (req, res, next) => {
  try {
    const attachment = await Attachment.findById(req.params.attachmentId);
    if (!attachment) return next(new AppError('Attachment not found', 404));

    const task = await Task.findById(attachment.task);
    if (!task) return next(new AppError('Task not found', 404));

    if (!(await canAccessTask(task, req.user)))
      return next(new AppError('Access denied', 403));

    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      'Content-Length': attachment.size,
    });

    const stream = openDownloadStream(attachment.gridFsId);
    stream.on('error', () => next(new AppError('File not found in storage', 404)));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
};

export const getItemAttachments = async (req, res, next) => {
  try {
    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: req.params.projectId });
    if (!item) return next(new AppError('Item not found', 404));

    const attachments = await Attachment.find({ projectItem: item._id })
      .populate('uploadedBy', 'username email role')
      .sort({ createdAt: -1 });

    res.status(200).json(attachments);
  } catch (err) {
    next(err);
  }
};

export const uploadItemAttachment = async (req, res, next) => {
  try {
    const item = await ProjectItem.findOne({ _id: req.params.itemId, project: req.params.projectId });
    if (!item) return next(new AppError('Item not found', 404));

    if (!req.file) return next(new AppError('No file uploaded', 400));

    const gridFsId = await uploadBufferToGridFS(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    const attachment = await Attachment.create({
      projectItem: item._id,
      fileName: req.file.originalname,
      gridFsId,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user._id,
    });

    const populated = await attachment.populate('uploadedBy', 'username email role');

    res.status(201).json({ message: 'File uploaded', attachment: populated });
  } catch (err) {
    next(err);
  }
};

export const downloadItemAttachment = async (req, res, next) => {
  try {
    const attachment = await Attachment.findOne({
      _id: req.params.attachmentId,
      projectItem: req.params.itemId,
    });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      'Content-Length': attachment.size,
    });

    const stream = openDownloadStream(attachment.gridFsId);
    stream.on('error', () => next(new AppError('File not found in storage', 404)));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
};

export const deleteItemAttachment = async (req, res, next) => {
  try {
    const attachment = await Attachment.findOne({
      _id: req.params.attachmentId,
      projectItem: req.params.itemId,
    });
    if (!attachment) return next(new AppError('Attachment not found', 404));

    try {
      await deleteFile(attachment.gridFsId);
    } catch {
      // best-effort: continue even if the blob is already gone
    }
    await Attachment.findByIdAndDelete(attachment._id);

    res.status(200).json({ message: 'Attachment deleted' });
  } catch (err) {
    next(err);
  }
};
