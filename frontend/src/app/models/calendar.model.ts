export interface Calendar {
  id: number;
  name: string;
  color: string;
  isEnabled: boolean;
  eventsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCalendarPayload {
  name: string;
  color?: string;
}

export type UpdateCalendarPayload = Partial<CreateCalendarPayload> & { isEnabled?: boolean };
