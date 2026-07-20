import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { canAccessProject } from './projectController.js';

const ACCESS_INCLUDE = { members: { select: { userId: true } } };
const AUTHOR_SELECT = { id: true, username: true, email: true, role: true };

export const getComments = async (req, res, next) => {
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

    const comments = await prisma.comment.findMany({
      where: { projectItemId: item.id },
      include: { author: { select: AUTHOR_SELECT } },
      orderBy: { createdAt: 'asc' },
    });

    res.status(200).json(comments);
  } catch (err) {
    next(err);
  }
};

export const createComment = async (req, res, next) => {
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

    const comment = await prisma.comment.create({
      data: {
        projectItemId: item.id,
        authorId: req.user.id,
        body: req.body.body.trim(),
      },
      include: { author: { select: AUTHOR_SELECT } },
    });

    res.status(201).json({ message: 'Comment added', comment });
  } catch (err) {
    next(err);
  }
};

export const deleteComment = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const comment = await prisma.comment.findFirst({
      where: { id: Number(req.params.commentId), projectItemId: Number(req.params.itemId) },
    });
    if (!comment) return next(new AppError('Comment not found', 404));

    if (comment.authorId !== req.user.id)
      return next(new AppError('You can only delete your own comments', 403));

    await prisma.comment.delete({ where: { id: comment.id } });
    res.status(200).json({ message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
};
