import { User } from './user.model';
import { Attachment } from './attachment.model';

export type EventVisibility = 'standard' | 'private' | 'public';
export type EventBusyStatus = 'busy' | 'free';
export type ReminderMethod = 'notification' | 'email';
export type GuestRsvpStatus = 'pending' | 'accepted' | 'declined' | 'tentative';
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ExceptionAction = 'skip' | 'modified';
// Reuses ProjectItem's existing meeting-link platform values (see
// project-item.model.ts) — same field shape, same enum, just attached to a
// CalendarEvent instead.
export type MeetingPlatform = 'ZOOM' | 'GOOGLE_MEET' | 'TEAMS' | 'WEBEX' | 'OTHER';

export interface EventCalendarLite {
  id: number;
  name: string;
  color: string;
}

export interface EventCategoryLite {
  id: number;
  name: string;
  color: string;
}

export interface RecurringRule {
  id: number;
  frequency: RecurrenceFrequency;
  interval: number;
  byWeekday: number[];
  count: number | null;
  until: string | null;
}

export interface Guest {
  id: number;
  email: string;
  name: string | null;
  userId: number | null;
  user?: User | null;
  rsvp: GuestRsvpStatus;
  invitedAt: string;
  respondedAt: string | null;
}

export interface EventReminder {
  id: number;
  method: ReminderMethod;
  minutesBefore: number;
}

export interface CalendarEventModel {
  id: number;
  sequenceId?: number | null;
  title: string;
  description: string;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  color: string | null;
  category: EventCategoryLite | null;
  owner: User;
  calendar: EventCalendarLite;
  meetingLinkUrl: string | null;
  meetingLinkTitle: string | null;
  meetingLinkPlatform: MeetingPlatform | null;
  visibility: EventVisibility;
  busyStatus: EventBusyStatus;
  recurrence: RecurringRule | null;
  guests: Guest[];
  reminders: EventReminder[];
  attachments: Attachment[];
  createdBy: User;
  updatedBy?: User | null;
  createdAt: string;
  updatedAt: string;
}

// List-row shape (GET /events) — guests come back lighter (no full `user`
// join) and there are no attachments/reminders, mirroring
// metricController.ts's METRIC_LIST_INCLUDE vs METRIC_INCLUDE split.
export type CalendarEventListItem = Omit<CalendarEventModel, 'guests' | 'reminders' | 'attachments' | 'recurrence' | 'createdBy' | 'updatedBy'> & {
  guests: Pick<Guest, 'id' | 'email' | 'name' | 'rsvp' | 'userId'>[];
};

// GET /events returns one entry per *occurrence*, not per stored row — a
// recurring master fans out into one of these per generated instance in the
// requested range (see backend/utils/recurrence.ts). Non-recurring events
// flow through the same array with isRecurring: false and originalStart
// equal to their own start. `id` always identifies the master event
// (edit-the-series/delete-the-series still target it); `originalStart`
// is what the occurrence-scoped routes use to address this one instance.
export interface CalendarOccurrence extends CalendarEventListItem {
  isRecurring: boolean;
  originalStart: string;
  isException: boolean;
}

export interface GuestInput {
  email: string;
  name?: string | null;
  userId?: number | null;
}

export interface ReminderInput {
  method?: ReminderMethod;
  minutesBefore?: number;
}

export interface RecurrenceInput {
  frequency: RecurrenceFrequency;
  interval?: number;
  byWeekday?: number[];
  count?: number | null;
  until?: string | null;
}

export interface CreateEventPayload {
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string | null;
  allDay?: boolean;
  color?: string | null;
  categoryId?: number | null;
  calendarId?: number;
  meetingLinkUrl?: string | null;
  meetingLinkTitle?: string | null;
  visibility?: EventVisibility;
  busyStatus?: EventBusyStatus;
  guests?: GuestInput[];
  reminders?: ReminderInput[];
  recurrence?: RecurrenceInput | null;
}

export type UpdateEventPayload = Partial<CreateEventPayload>;

export interface EventListFilters {
  start?: string;
  end?: string;
  search?: string;
  calendarId?: number;
  categoryId?: number;
  page?: number;
  limit?: number;
}

export interface PaginatedEvents {
  events: CalendarOccurrence[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
