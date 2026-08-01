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
