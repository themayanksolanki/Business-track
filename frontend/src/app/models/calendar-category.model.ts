export interface CalendarCategory {
  id: number;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCalendarCategoryPayload {
  name: string;
  color?: string;
}

export type UpdateCalendarCategoryPayload = Partial<CreateCalendarCategoryPayload>;
