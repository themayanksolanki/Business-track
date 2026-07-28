import { User } from './user.model';

export type ApproverStatus = 'pending' | 'approved' | 'changesRequested' | 'cancelled';

export type ApprovalHistoryAction =
  | 'approverAssigned'
  | 'approverRemoved'
  | 'approved'
  | 'changesRequested'
  | 'commentAdded'
  | 'commentEdited'
  | 'commentDeleted'
  | 'reRequested'
  | 'statusChanged';

export interface TaskApprover {
  id: number;
  projectItemId: number;
  userId: number;
  status: ApproverStatus;
  assignedById: number;
  assignedAt: string;
  respondedAt: string | null;
  removedAt: string | null;
  user: User;
}

export interface ApprovalProgress {
  approved: number;
  total: number;
}

export interface ApproversResponse {
  approvers: TaskApprover[];
  progress: ApprovalProgress;
}

export interface ApprovalHistoryEntry {
  id: number;
  projectItemId: number;
  userId: number;
  action: ApprovalHistoryAction;
  detail: string | null;
  createdAt: string;
  user: User;
}

export interface ApprovalComment {
  id: number;
  projectItemId: number;
  authorId: number;
  body: string;
  isEdited: boolean;
  editedAt: string | null;
  replyToId: number | null;
  createdAt: string;
  updatedAt: string;
  author: User;
}

export interface CreateApprovalCommentPayload {
  body: string;
  replyToId?: number | null;
}

export interface UpdateApprovalCommentPayload {
  body: string;
}
