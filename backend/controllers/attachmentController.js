import { randomUUID } from 'crypto';
import Task from '../models/Task.js';
import User from '../models/User.js';
import Attachment from '../models/Attachment.js';
import AppError from '../utils/AppError.js';
import { uploadBufferToS3, getAttachmentDownloadUrl } from '../utils/s3.js';

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

    const key = `tasks/${task._id}/${randomUUID()}-${req.file.originalname}`;
    await uploadBufferToS3(req.file.buffer, key, req.file.mimetype);

    const attachment = await Attachment.create({
      task: task._id,
      fileName: req.file.originalname,
      s3Key: key,
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

    const url = await getAttachmentDownloadUrl(attachment.s3Key, attachment.fileName);

    res.status(200).json({ url });
  } catch (err) {
    next(err);
  }
};
