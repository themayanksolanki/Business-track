export type NotificationType =
  | 'projectAssigned'
  | 'projectUpdated'
  | 'draftConverted'
  | 'projectMemberAdded'
  | 'taskAssigned'
  | 'taskUpdated'
  | 'taskCommentAdded'
  | 'projectItemAssigned'
  | 'projectItemUpdated'
  | 'mentioned'
  | 'userDeactivated';

export interface NotificationActor {
  id: number;
  username: string;
  profileImage?: string | null;
}

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  actor: NotificationActor | null;
  projectId?: number | null;
  taskId?: number | null;
  projectItemId?: number | null;
  commentId?: number | null;
}
