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
  // Distinct from allowGuestJoin above (which only relaxes access to "any
  // other authenticated same-org member with the link") — this instead
  // permits a fully unauthenticated visitor to join after typing a display
  // name. See GuestSessionService/MeetingService.guestJoin.
  allowExternalGuests: boolean;
  muteOnEntry: boolean;
  recordingEnabled: boolean;
}

// GET /meetings/public/:roomCode/info — deliberately minimal, no
// participant list/emails, since the caller has no account at all.
export interface PublicMeetingInfo {
  meetingId: number;
  title: string | null;
  hostName: string;
  callType: 'audio' | 'video';
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  allowExternalGuests: boolean;
}

export interface MeetingCalendarEvent {
  id: number;
  sequenceId: number | null;
  title: string;
  start: string;
  end: string;
}

export interface MeetingProject {
  id: number;
  sequenceId: number | null;
  name: string;
}

export interface MeetingGroup {
  id: number;
  sequenceId: number | null;
  name: string;
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
  calendarEventId: number | null;
  projectId: number | null;
  groupId: number | null;
  createdAt: string;
  updatedAt: string;
  host: MeetingUser;
  settings: MeetingSettings | null;
  participants: MeetingParticipant[];
  calendarEvent: MeetingCalendarEvent | null;
  project: MeetingProject | null;
  group: MeetingGroup | null;
}
