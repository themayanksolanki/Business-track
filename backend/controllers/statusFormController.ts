import type { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';

const QUESTION_SELECT = { id: true, type: true, label: true, options: true, required: true, order: true };
const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };

const FORM_INCLUDE = {
  questions: { select: QUESTION_SELECT, orderBy: { order: 'asc' as const } },
  createdBy: { select: USER_SELECT },
  updatedBy: { select: USER_SELECT },
};

// Shape of a question in the request body — same for create and update,
// since the builder always resubmits the full question list rather than a
// partial diff (see updateStatusForm's delete-then-recreate below).
interface StatusFormQuestionInput {
  type: string;
  label: string;
  options?: string[];
  required?: boolean;
}

const toQuestionCreateData = (questions: StatusFormQuestionInput[]) =>
  questions.map((q, index) => ({
    type: q.type as any,
    label: q.label.trim(),
    options: Array.isArray(q.options) ? q.options.map((o) => o.trim()).filter(Boolean) : [],
    required: !!q.required,
    order: index,
  }));

export const getStatusForms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const forms = await prisma.statusForm.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      include: FORM_INCLUDE,
    });

    res.status(200).json(forms);
  } catch (err) {
    next(err);
  }
};

export const createStatusForm = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, questions } = req.body;

    const form = await prisma.statusForm.create({
      data: {
        title: title.trim(),
        description: description?.trim() || '',
        organizationId: req.user!.organizationId,
        createdById: req.user!.id,
        questions: { create: toQuestionCreateData(questions) },
      },
      include: FORM_INCLUDE,
    });

    res.status(201).json({ message: 'Status form created', statusForm: form });
  } catch (err) {
    next(err);
  }
};

export const updateStatusForm = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.statusForm.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing || existing.organizationId !== req.user!.organizationId)
      return next(new AppError('Status form not found', 404));

    const { title, description, questions } = req.body;

    // No answers reference a question yet (the Status Report answering tab
    // isn't built), so a full delete-then-recreate is safe and keeps the
    // builder's "always resubmit everything" shape identical to create.
    const form = await prisma.$transaction(async (tx) => {
      await tx.statusFormQuestion.deleteMany({ where: { formId: existing.id } });
      return tx.statusForm.update({
        where: { id: existing.id },
        data: {
          title: title.trim(),
          description: description?.trim() || '',
          updatedById: req.user!.id,
          questions: { create: toQuestionCreateData(questions) },
        },
        include: FORM_INCLUDE,
      });
    });

    res.status(200).json({ message: 'Status form updated', statusForm: form });
  } catch (err) {
    next(err);
  }
};

export const deleteStatusForm = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.statusForm.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing || existing.organizationId !== req.user!.organizationId)
      return next(new AppError('Status form not found', 404));

    await prisma.statusForm.delete({ where: { id: existing.id } });

    res.status(200).json({ message: 'Status form deleted' });
  } catch (err) {
    next(err);
  }
};
