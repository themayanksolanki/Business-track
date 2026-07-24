import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';

// Flat list, no pagination — same shape as tagController.getTags, since this
// only ever backs a <select>/color-picker in the event dialog, not its own
// management page.
export const getCalendarCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.calendarCategory.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { name: 'asc' },
    });
    res.status(200).json(categories);
  } catch (err) {
    next(err);
  }
};

export const createCalendarCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, color } = req.body;
    const trimmedName = name.trim();

    const existing = await prisma.calendarCategory.findFirst({
      where: {
        organizationId: req.user!.organizationId,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });
    if (existing) return next(new AppError('A category with this name already exists', 409));

    const category = await prisma.calendarCategory.create({
      data: {
        name: trimmedName,
        color: color || undefined,
        organizationId: req.user!.organizationId,
        createdById: req.user!.id,
      },
    });

    res.status(201).json({ message: 'Category created', category });
  } catch (err: any) {
    if (err.code === 'P2002') return next(new AppError('A category with this name already exists', 409));
    next(err);
  }
};

export const updateCalendarCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await prisma.calendarCategory.findUnique({ where: { id: Number(req.params.id) } });
    if (!category || category.organizationId !== req.user!.organizationId)
      return next(new AppError('Category not found', 404));

    const { name, color } = req.body;
    const data: Prisma.CalendarCategoryUncheckedUpdateInput = { updatedById: req.user!.id };

    if (name !== undefined) {
      const trimmedName = name.trim();
      const existing = await prisma.calendarCategory.findFirst({
        where: {
          organizationId: req.user!.organizationId,
          name: { equals: trimmedName, mode: 'insensitive' },
          id: { not: category.id },
        },
      });
      if (existing) return next(new AppError('A category with this name already exists', 409));
      data.name = trimmedName;
    }
    if (color !== undefined) data.color = color;

    const updated = await prisma.calendarCategory.update({ where: { id: category.id }, data });
    res.status(200).json({ message: 'Category updated', category: updated });
  } catch (err: any) {
    if (err.code === 'P2002') return next(new AppError('A category with this name already exists', 409));
    next(err);
  }
};

export const deleteCalendarCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await prisma.calendarCategory.findUnique({ where: { id: Number(req.params.id) } });
    if (!category || category.organizationId !== req.user!.organizationId)
      return next(new AppError('Category not found', 404));

    // CalendarEvent.categoryId has no onDelete override (nullable, default
    // SET NULL behavior isn't declared in schema) — matches Tag's "detach
    // everywhere" approach, events just lose their category rather than the
    // delete being blocked.
    await prisma.calendarCategory.delete({ where: { id: category.id } });
    res.status(200).json({ message: 'Category deleted' });
  } catch (err) {
    next(err);
  }
};
