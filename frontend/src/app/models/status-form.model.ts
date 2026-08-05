import { User } from './user.model';

export type StatusFormQuestionType = 'shortText' | 'longText' | 'richText' | 'singleSelect' | 'multiSelect' | 'attachment';

export interface StatusFormQuestion {
  id?: number;
  type: StatusFormQuestionType;
  label: string;
  options: string[];
  required: boolean;
  order?: number;
}

export interface StatusForm {
  id: number;
  title: string;
  description: string;
  questions: StatusFormQuestion[];
  createdBy: User;
  updatedBy?: User | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStatusFormQuestionPayload {
  type: StatusFormQuestionType;
  label: string;
  options?: string[];
  required?: boolean;
}

export interface CreateStatusFormPayload {
  title: string;
  description?: string;
  questions: CreateStatusFormQuestionPayload[];
}

// Same full-replace shape as create — the builder always resubmits every
// question rather than a partial diff (see backend's updateStatusForm).
export type UpdateStatusFormPayload = CreateStatusFormPayload;

// A single answer within a StatusFormSubmission — a full snapshot (label/
// type copied alongside the value) rather than a live reference to
// StatusFormQuestion, so a submission stays meaningful even after its
// template's questions are edited or the template itself is deleted (see
// StatusFormSubmission.formTitle/form below for the same reasoning at the
// form level).
export interface StatusReportAnswer {
  questionId: number;
  label: string;
  type: StatusFormQuestionType;
  // string for shortText/longText/richText/attachment(link), string[] for
  // multiSelect, string | null for singleSelect.
  value: string | string[] | null;
}

// One Save/Save-and-Send on a Project's Status Report tab — every click
// creates a new, permanent, listed entry (see project-status-report
// component's history list), never overwritten.
export interface StatusFormSubmission {
  id: number;
  projectId: number;
  formId: number | null;
  formTitle: string;
  subject: string;
  answers: StatusReportAnswer[];
  submittedBy: User;
  submittedAt: string;
  sent: boolean;
  sentAt: string | null;
  recipients: string[];
}

export interface CreateStatusReportSubmissionPayload {
  statusFormId: number;
  subject: string;
  answers: StatusReportAnswer[];
  send: boolean;
  recipients?: string[];
}
