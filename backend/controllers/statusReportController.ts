import type { Request, Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { canAccessProject, canManageStatusReport } from './projectController.js';
import { FORM_INCLUDE } from './statusFormController.js';
import { sendStatusReportEmail } from '../utils/mailer.js';

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };

type AuthUser = { id: number; role: string; organizationId: number | null };

// Same lightweight "just enough for canAccessProject/canManageStatusReport"
// load every handler below starts from — mirrors projectController.ts's own
// ACCESS_INCLUDE (not exported from there, so duplicated here rather than
// widening that file's exports for one shared shape).
const loadProjectForAccess = (projectId: number) =>
  prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { select: { userId: true } } },
  });

export interface AnswerInput {
  questionId: number;
  label: string;
  type: string;
  value: unknown;
}

// Answers are free-text typed by whoever filled out the report — never
// interpolate one into the HTML email/preview unescaped, or a value like
// `<img src=x onerror=...>` gets embedded as live markup for every recipient.
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Renders an answer's value for the email/preview body — mirrors how the
// frontend's own read-only renderer displays each question type (see
// project-status-report.component.ts), so the emailed HTML and the on-page
// preview never show materially different content for the same answer.
const formatAnswerValue = (a: AnswerInput): string => {
  if (a.value == null || a.value === '') return '<span style="color:#94a3b8;">—</span>';
  if (a.type === 'multiSelect' && Array.isArray(a.value)) return escapeHtml(a.value.join(', '));
  if (a.type === 'attachment') {
    const href = escapeHtml(String(a.value));
    return `<a href="${href}" target="_blank" rel="noopener">${href}</a>`;
  }
  return escapeHtml(String(a.value)).replace(/\n/g, '<br>');
};

const buildStatusReportHtml = (opts: {
  projectName: string;
  formTitle: string;
  subject: string;
  answers: AnswerInput[];
  preparedByName: string;
  preparedByEmail: string;
  submittedAt: Date;
}): string => {
  const rows = opts.answers
    .map(
      (a) => `
        <div style="margin-bottom:16px;">
          <div style="font-size:0.8rem;font-weight:700;color:#334155;">${escapeHtml(a.label)}</div>
          <div style="font-size:0.9rem;color:#0f172a;margin-top:2px;">${formatAnswerValue(a)}</div>
        </div>`
    )
    .join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
      <h2 style="color:#0f172a;margin-bottom:4px;">${escapeHtml(opts.subject)}</h2>
      <p style="color:#64748b;font-size:0.8rem;margin-top:0;">
        ${escapeHtml(opts.projectName)} &middot; ${escapeHtml(opts.formTitle)} &middot; ${opts.submittedAt.toLocaleString()}
      </p>
      <p style="color:#64748b;font-size:0.8rem;">Prepared by ${escapeHtml(opts.preparedByName)} (${escapeHtml(opts.preparedByEmail)})</p>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-top:16px;">
        ${rows}
      </div>
    </div>
  `;
};

// Everyone with canAccessProject can view the history — read-only, same
// split as the tab itself (see canManageStatusReport for who can add to it).
export const getStatusReportSubmissions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = Number(req.params.projectId);
    const project = await loadProjectForAccess(projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user! as AuthUser, project)))
      return next(new AppError('You do not have access to this project', 403));

    const submissions = await prisma.statusFormSubmission.findMany({
      where: { projectId },
      orderBy: { submittedAt: 'desc' },
      include: { submittedBy: { select: USER_SELECT } },
    });

    res.status(200).json(submissions);
  } catch (err) {
    next(err);
  }
};

export const selectStatusReportTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = Number(req.params.projectId);
    const project = await loadProjectForAccess(projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user! as AuthUser, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageStatusReport(req.user! as AuthUser, project))
      return next(new AppError('Only the project owner or an Admin can change the Status Report template', 403));

    const { statusFormId } = req.body;
    if (statusFormId !== null) {
      const form = await prisma.statusForm.findUnique({ where: { id: Number(statusFormId) } });
      if (!form || form.organizationId !== req.user!.organizationId)
        return next(new AppError('Status form not found', 404));
    }

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { activeStatusFormId: statusFormId },
      include: { activeStatusForm: { include: FORM_INCLUDE } },
    });

    res.status(200).json({
      message: statusFormId ? 'Template selected' : 'Template cleared',
      activeStatusFormId: updated.activeStatusFormId,
      activeStatusForm: updated.activeStatusForm,
    });
  } catch (err) {
    next(err);
  }
};

export const updateStatusReportRecipients = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = Number(req.params.projectId);
    const project = await loadProjectForAccess(projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user! as AuthUser, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageStatusReport(req.user! as AuthUser, project))
      return next(new AppError('Only the project owner or an Admin can manage default recipients', 403));

    // Dedupe/normalize — validateStatusReportRecipients already confirmed
    // every entry is a well-formed email.
    const recipients = [...new Set((req.body.recipients as string[]).map((e) => e.trim().toLowerCase()))];

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { statusReportRecipients: recipients },
    });

    res.status(200).json({ message: 'Default recipients updated', statusReportRecipients: updated.statusReportRecipients });
  } catch (err) {
    next(err);
  }
};

export const createStatusReportSubmission = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = Number(req.params.projectId);
    const project = await loadProjectForAccess(projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user! as AuthUser, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageStatusReport(req.user! as AuthUser, project))
      return next(new AppError('Only the project owner or an Admin can save a Status Report', 403));

    const { statusFormId, subject, answers, send, recipients } = req.body as {
      statusFormId: number;
      subject?: string;
      answers: AnswerInput[];
      send?: boolean;
      recipients?: string[];
    };

    // Server re-derives the title rather than trusting the client's copy —
    // it's what gets permanently snapshotted onto the submission.
    const form = await prisma.statusForm.findUnique({ where: { id: Number(statusFormId) } });
    if (!form || form.organizationId !== req.user!.organizationId)
      return next(new AppError('Status form not found', 404));

    const finalSubject = subject?.trim() || `${project.name} Status Report`;

    // Save always succeeds independent of email — Send is a best-effort
    // follow-up (see the try/catch below), never something that can make an
    // otherwise-valid Save disappear just because a mail transport hiccups.
    let submission = await prisma.statusFormSubmission.create({
      data: {
        projectId: project.id,
        formId: form.id,
        formTitle: form.title,
        subject: finalSubject,
        answers: answers as unknown as Prisma.InputJsonValue,
        submittedById: req.user!.id,
      },
      include: { submittedBy: { select: USER_SELECT } },
    });

    let emailError: string | null = null;
    if (send) {
      const normalizedRecipients = [...new Set((recipients ?? []).map((e) => e.trim().toLowerCase()))];
      try {
        const html = buildStatusReportHtml({
          projectName: project.name,
          formTitle: form.title,
          subject: finalSubject,
          answers,
          preparedByName: req.user!.username,
          preparedByEmail: req.user!.email,
          submittedAt: submission.submittedAt,
        });
        await sendStatusReportEmail(normalizedRecipients, finalSubject, html, req.user!.email);
        submission = await prisma.statusFormSubmission.update({
          where: { id: submission.id },
          data: { sent: true, sentAt: new Date(), recipients: normalizedRecipients },
          include: { submittedBy: { select: USER_SELECT } },
        });
      } catch {
        emailError = 'The report was saved, but the email could not be sent.';
      }
    }

    res.status(201).json({ message: 'Status report saved', submission, emailError });
  } catch (err) {
    next(err);
  }
};
