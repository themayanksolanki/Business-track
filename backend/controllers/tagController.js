import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';

export const getTags = async (req, res, next) => {
  try {
    const tags = await prisma.tag.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { projects: true, tasks: true, projectItems: true } } },
    });

    const withCounts = tags.map((t) => {
      const { _count, ...rest } = t;
      return {
        ...rest,
        projectCount: _count.projects,
        taskCount: _count.tasks + _count.projectItems,
      };
    });

    res.status(200).json(withCounts);
  } catch (err) {
    next(err);
  }
};

export const createTag = async (req, res, next) => {
  try {
    const { name, textColor, backgroundColor } = req.body;
    const trimmedName = name.trim();

    // Case-insensitive duplicate check (the old Mongo index used a
    // collation-strength-2, i.e. case-insensitive, unique index).
    const existing = await prisma.tag.findFirst({
      where: {
        organizationId: req.user.organizationId,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });
    if (existing) return next(new AppError('A tag with this name already exists', 409));

    const tag = await prisma.tag.create({
      data: {
        name: trimmedName,
        textColor,
        backgroundColor,
        organizationId: req.user.organizationId,
        createdById: req.user.id,
      },
    });

    res.status(201).json({ message: 'Tag created', tag });
  } catch (err) {
    if (err.code === 'P2002') return next(new AppError('A tag with this name already exists', 409));
    next(err);
  }
};

export const updateTag = async (req, res, next) => {
  try {
    const tag = await prisma.tag.findUnique({ where: { id: Number(req.params.id) } });
    if (!tag || tag.organizationId !== req.user.organizationId)
      return next(new AppError('Tag not found', 404));

    const { name, textColor, backgroundColor } = req.body;
    const data = { updatedById: req.user.id };

    if (name !== undefined) {
      const trimmedName = name.trim();
      const existing = await prisma.tag.findFirst({
        where: {
          organizationId: req.user.organizationId,
          name: { equals: trimmedName, mode: 'insensitive' },
          id: { not: tag.id },
        },
      });
      if (existing) return next(new AppError('A tag with this name already exists', 409));
      data.name = trimmedName;
    }
    if (textColor !== undefined) data.textColor = textColor;
    if (backgroundColor !== undefined) data.backgroundColor = backgroundColor;

    const updated = await prisma.tag.update({ where: { id: tag.id }, data });
    res.status(200).json({ message: 'Tag updated', tag: updated });
  } catch (err) {
    if (err.code === 'P2002') return next(new AppError('A tag with this name already exists', 409));
    next(err);
  }
};

export const deleteTag = async (req, res, next) => {
  try {
    const tag = await prisma.tag.findUnique({ where: { id: Number(req.params.id) } });
    if (!tag || tag.organizationId !== req.user.organizationId)
      return next(new AppError('Tag not found', 404));

    // Project/Task/ProjectItem tag associations are implicit m2m relations —
    // Prisma manages that join table with ON DELETE CASCADE, so deleting the
    // tag automatically detaches it everywhere, no manual $pull needed.
    await prisma.tag.delete({ where: { id: tag.id } });

    res.status(200).json({ message: 'Tag deleted' });
  } catch (err) {
    next(err);
  }
};
