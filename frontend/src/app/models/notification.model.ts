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
  | 'userDeactivated'
  | 'taskApprovalRequested'
  | 'taskApproved'
  | 'taskChangesRequested'
  | 'taskApprovalReRequested'
  | 'taskFullyApproved'
  | 'taskApprovalCommentAdded'
  | 'meetingStarting'
  | 'meetingCancelled'
  | 'groupMemberAdded';

export interface NotificationActor {
  id: number;
  username: string;
  profileImage?: string | null;
}

// Read-only meeting summary embedded on a meeting-related notification —
// null once the meeting is cancelled/deleted (see notification.prisma's
// onDelete: SetNull comment) so a dead "Join" link never renders.
export interface NotificationMeeting {
  id: number;
  roomCode: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
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
  meetingId?: number | null;
  groupId?: number | null;
  meeting?: NotificationMeeting | null;
}
