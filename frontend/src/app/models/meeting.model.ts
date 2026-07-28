export interface MeetingUser {
  id: number;
  username: string;
  email: string;
  role: string;
  profileImage: string | null;
}

export interface MeetingParticipant {
  id: number;
  meetingId: number;
  userId: number;
  role: 'host' | 'coHost' | 'attendee';
  invited: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  user: MeetingUser;
}

export interface MeetingSettings {
  id: number;
  meetingId: number;
  waitingRoomEnabled: boolean;
  allowGuestJoin: boolean;
  muteOnEntry: boolean;
  recordingEnabled: boolean;
}

export interface Meeting {
  id: number;
  sequenceId: number | null;
  roomCode: string;
  title: string | null;
  hostId: number;
  organizationId: number | null;
  callType: 'audio' | 'video';
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  host: MeetingUser;
  settings: MeetingSettings | null;
  participants: MeetingParticipant[];
}
