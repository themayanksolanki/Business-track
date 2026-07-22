import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { canAccessProject, canEditProject } from './projectController.js';
import { notifyUsers } from '../utils/notifications.js';
import { filterValidMentions } from '../utils/mentions.js';

const ACCESS_INCLUDE = { members: { select: { userId: true } } };
const ACCESS_INCLUDE_WITH_ROLE = {
  members: { select: { userId: true, role: { select: { canEdit: true } } } },
};
const AUTHOR_SELECT = { id: true, username: true, email: true, role: true };

export const getComments = async (req: Request, res: Response, next: NextFunction) => {
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

export const createComment = async (req: Request, res: Response, next: NextFunction) => {
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

    const memberIds = new Set(project.members.map((m) => m.userId));
    const mentions = filterValidMentions(req.body.mentions, memberIds);

    const comment = await prisma.comment.create({
      data: {
        projectItemId: item.id,
        authorId: req.user!.id,
        body: req.body.body.trim(),
        mentions: mentions as unknown as Prisma.InputJsonValue,
      },
      include: { author: { select: AUTHOR_SELECT } },
    });

    await notifyUsers([item.assignedToId, item.createdById].filter((id): id is number => Boolean(id)), req.user!.id, {
      type: 'taskCommentAdded',
      title: 'New comment',
      message: `${req.user!.username} commented on "${item.title}"`,
      projectId: project.id,
      projectItemId: item.id,
      commentId: comment.id,
    });

    await notifyUsers(mentions.map((m) => m.userId), req.user!.id, {
      type: 'mentioned',
      title: 'You were mentioned',
      message: `${req.user!.username} mentioned you in a comment on "${item.title}"`,
      projectId: project.id,
      projectItemId: item.id,
      commentId: comment.id,
    });

    res.status(201).json({ message: 'Comment added', comment });
  } catch (err) {
    next(err);
  }
};

export const updateComment = async (req: Request, res: Response, next: NextFunction) => {
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

    const existing = await prisma.comment.findFirst({
      where: { id: Number(req.params.commentId), projectItemId: item.id },
    });
    if (!existing) return next(new AppError('Comment not found', 404));

    if (existing.authorId !== req.user!.id)
      return next(new AppError('You can only edit your own comments', 403));

    const memberIds = new Set(project.members.map((m) => m.userId));
    const mentions = filterValidMentions(req.body.mentions, memberIds);

    const comment = await prisma.comment.update({
      where: { id: existing.id },
      data: { body: req.body.body.trim(), mentions: mentions as unknown as Prisma.InputJsonValue },
      include: { author: { select: AUTHOR_SELECT } },
    });

    const oldMentionIds = new Set(
      Array.isArray(existing.mentions) ? (existing.mentions as any[]).map((m) => m.userId) : []
    );
    const newlyMentioned = mentions.filter((m) => !oldMentionIds.has(m.userId));

    await notifyUsers(newlyMentioned.map((m) => m.userId), req.user!.id, {
      type: 'mentioned',
      title: 'You were mentioned',
      message: `${req.user!.username} mentioned you in a comment on "${item.title}"`,
      projectId: project.id,
      projectItemId: item.id,
      commentId: comment.id,
    });

    res.status(200).json({ message: 'Comment updated', comment });
  } catch (err) {
    next(err);
  }
};

export const deleteComment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user!, project)))
      return next(new AppError('You do not have access to this project', 403));

    const comment = await prisma.comment.findFirst({
      where: { id: Number(req.params.commentId), projectItemId: Number(req.params.itemId) },
    });
    if (!comment) return next(new AppError('Comment not found', 404));

    if (comment.authorId !== req.user!.id)
      return next(new AppError('You can only delete your own comments', 403));

    await prisma.comment.delete({ where: { id: comment.id } });
    res.status(200).json({ message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
};
