import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import dayjs from 'dayjs/esm';
import { CKEditorModule } from '@ckeditor/ckeditor5-angular';
import { ClassicEditor, Essentials, Paragraph, Bold, Italic, Underline, Link, List } from 'ckeditor5';
import { environment } from '../../../environments/environment';
import { ModalDirective } from '../modal.directive';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { TimePickerComponent } from '../time-picker/time-picker.component';
import { AttachmentThumbComponent } from '../attachment-thumb/attachment-thumb.component';
import { AttachmentViewerComponent } from '../attachment-viewer/attachment-viewer.component';
import { EventService } from '../../core/services/event.service';
import { CalendarCategoryService } from '../../core/services/calendar-category.service';
import { CalendarService } from '../../core/services/calendar.service';
import { AuthService } from '../../core/services/auth.service';
import { DateFormatService } from '../../core/services/date-format.service';
import {
  CalendarEventModel,
  CreateEventPayload,
  UpdateEventPayload,
  EventVisibility,
  EventBusyStatus,
  ReminderMethod,
  RecurrenceFrequency,
  GuestInput,
} from '../../models/event.model';
import { CalendarCategory } from '../../models/calendar-category.model';
import { Calendar } from '../../models/calendar.model';
import { Attachment, ACCEPTED_ATTACHMENT_TYPES } from '../../models/attachment.model';

export type EventDialogMode = 'create' | 'edit' | 'view';
type RecurrenceEndType = 'never' | 'on' | 'after';

const RECURRENCE_UNIT_LABEL: Record<RecurrenceFrequency, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

const FREQUENCY_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const VISIBILITY_OPTIONS: { value: EventVisibility; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Public' },
];

const REMINDER_METHOD_OPTIONS: { value: ReminderMethod; label: string }[] = [
  { value: 'notification', label: 'Notification' },
  { value: 'email', label: 'Email' },
];

interface ReminderRow {
  method: ReminderMethod;
  minutesBefore: number;
}

// Single dialog covering all three modes the user asked for (Create/Edit/
// View) rather than a separate viewer + form — 'view' renders the loaded
// event read-only with an Edit button that flips this component's own
// internal mode to 'edit' in place, reusing the same already-loaded data
// instead of closing and reopening a different component.
@Component({
  selector: 'app-event-detail-dialog',
  standalone: true,
  imports: [
    FormsModule,
    NgTemplateOutlet,
    ModalDirective,
    ConfirmDialogComponent,
    DatePickerComponent,
    TimePickerComponent,
    CKEditorModule,
    AttachmentThumbComponent,
    AttachmentViewerComponent,
  ],
  templateUrl: './event-detail-dialog.component.html',
  styleUrl: './event-detail-dialog.component.css',
})
export class EventDetailDialogComponent implements OnChanges, OnInit, OnDestroy {
  readonly frequencyOptions = FREQUENCY_OPTIONS;
  readonly visibilityOptions = VISIBILITY_OPTIONS;
  readonly reminderMethodOptions = REMINDER_METHOD_OPTIONS;
  readonly acceptedFileTypes = ACCEPTED_ATTACHMENT_TYPES;

  readonly DescriptionEditor = ClassicEditor;
  readonly descriptionEditorConfig = {
    licenseKey: environment.ckeditorLicenseKey,
    plugins: [Essentials, Paragraph, Bold, Italic, Underline, Link, List],
    toolbar: ['bold', 'italic', 'underline', '|', 'bulletedList', 'numberedList', '|', 'link', '|', 'undo', 'redo'],
  };

  @Input() open = false;
  @Input() mode: EventDialogMode = 'view';
  @Input() eventId: number | null = null;
  // Set only when the parent clicked one instance of a recurring series
  // (see CalendarStateService.openEventDetail) — identifies which generated
  // occurrence slot this dialog is viewing/editing, distinct from the
  // master event's own id. Null for a plain event or a create.
  @Input() originalStart: string | null = null;
  // Create-mode prefill — e.g. the day cell the user clicked. Defaults to
  // "now, +1h" when omitted.
  @Input() initialStart: Date | null = null;
  @Input() initialEnd: Date | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();

  // Internal, can diverge from the `mode` input (view -> edit via the Edit
  // button) without the parent needing to know or re-bind anything.
  internalMode: EventDialogMode = 'view';

  loadedEvent: CalendarEventModel | null = null;
  categories: CalendarCategory[] = [];
  calendars: Calendar[] = [];
  loading = false;
  saving = false;
  error = '';

  duplicating = false;
  confirmDeleteOpen = false;
  deleteLoading = false;

  // "This event" vs "All events" prompt shown before saving/deleting when
  // editing one occurrence of a recurring series (see
  // isRecurringOccurrenceContext) — not a shared component, since the choice
  // and what it dispatches to is specific to this dialog's save/delete flow.
  scopeChoiceOpen = false;
  // Not private: the template reads this to phrase the prompt ("Save"/
  // "Delete recurring event").
  scopeChoiceKind: 'save' | 'delete' | null = null;
  private pendingPayload: CreateEventPayload | UpdateEventPayload | null = null;

  // Form fields — populated from loadedEvent (edit/view) or defaults
  // (create), and kept around even in 'view' mode so switching to 'edit'
  // needs no re-fetch.
  title = '';
  description = '';
  location = '';
  startDate: string | null = null;
  startTime: string | null = null;
  endDate: string | null = null;
  endTime: string | null = null;
  allDay = false;
  color = '#3b82f6';
  categoryId: number | null = null;
  calendarId: number | null = null;
  meetingLinkUrl = '';
  meetingLinkTitle = '';
  visibility: EventVisibility = 'standard';
  busyStatus: EventBusyStatus = 'busy';

  repeats = false;
  recurrenceFrequency: RecurrenceFrequency = 'weekly';
  recurrenceInterval = 1;
  recurrenceEndType: RecurrenceEndType = 'never';
  recurrenceUntil: string | null = null;
  recurrenceCount = 1;

  reminders: ReminderRow[] = [];

  guestEmailInput = '';
  guestNameInput = '';
  guests: GuestInput[] = [];

  // Attachments — mirrors attachment-panel.component.ts's logic, keyed off
  // loadedEvent.id instead of a project/item pair. Deliberately NOT sourced
  // from loadedEvent.attachments (populated by EVENT_INCLUDE): for a
  // recurring occurrence that's been individually modified, that embedded
  // field belongs to the separate override row (always empty), not the
  // master series' real list — always fetched fresh via getAttachments().
  attachments: Attachment[] = [];
  attachmentsLoading = false;
  attachmentUploading = false;
  attachmentUploadError = '';
  downloadingId: number | null = null;
  progress = 0;
  viewerOpen = false;
  viewerIndex = 0;

  addLinkOpen = false;
  linkUrlInput = '';
  linkLabelInput = '';
  addLinkLoading = false;
  addLinkError = '';

  // Presentation-only clock the countdown badges read from — the actual
  // deletion is driven server-side off pendingDeleteAt, this just ticks the
  // displayed "Xs" down each second.
  private now = Date.now();
  private tickHandle?: ReturnType<typeof setInterval>;
  private pollHandle?: ReturnType<typeof setInterval>;
  // Matches the backend's countdown (see PENDING_DELETE_MS in
  // attachmentController.ts) — frequent enough that the list catches up
  // shortly after the badge hits 0, without polling constantly.
  private readonly POLL_MS = 2000;

  constructor(
    private eventService: EventService,
    private categoryService: CalendarCategoryService,
    private calendarService: CalendarService,
    public auth: AuthService,
    public dateFormat: DateFormatService
  ) {}

  get canManage(): boolean {
    if (!this.loadedEvent) return this.mode !== 'view';
    const user = this.auth.currentUser();
    return !!user && (user.role === 'Admin' || user.id === this.loadedEvent.owner.id);
  }

  get isViewing(): boolean {
    return this.internalMode === 'view';
  }

  // True only when this dialog is looking at one instance of a recurring
  // series (not the series' own definition) — that's when "this occurrence
  // vs entire series" needs asking before a save/delete goes through.
  get isRecurringOccurrenceContext(): boolean {
    return !!this.originalStart && !!this.loadedEvent?.recurrence;
  }

  get dialogTitle(): string {
    if (this.internalMode === 'create') return 'New Event';
    if (this.internalMode === 'edit') return 'Edit Event';
    return this.loadedEvent?.title || 'Event';
  }

  get timeRangeLabel(): string {
    if (!this.loadedEvent) return '';
    const { start, end, allDay } = this.loadedEvent;
    const sameDay = this.dateFormat.formatDate(start) === this.dateFormat.formatDate(end);

    if (allDay) {
      return sameDay ? this.dateFormat.formatDate(start) : `${this.dateFormat.formatDate(start)} – ${this.dateFormat.formatDate(end)}`;
    }
    return sameDay
      ? `${this.dateFormat.formatDate(start)} · ${this.dateFormat.formatTime(start)} – ${this.dateFormat.formatTime(end)}`
      : `${this.dateFormat.formatDateTime(start)} – ${this.dateFormat.formatDateTime(end)}`;
  }

  get recurrenceLabel(): string | null {
    const r = this.loadedEvent?.recurrence;
    if (!r) return null;
    const unit = RECURRENCE_UNIT_LABEL[r.frequency];
    const base = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
    if (r.until) return `${base}, until ${this.dateFormat.formatDate(r.until)}`;
    if (r.count) return `${base}, ${r.count} times`;
    return base;
  }

  ngOnInit() {
    this.tickHandle = setInterval(() => (this.now = Date.now()), 1000);
  }

  ngOnDestroy() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.stopPolling();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.error = '';
      this.confirmDeleteOpen = false;
      this.categoryService.getCategories().subscribe({ next: (cats) => (this.categories = cats) });
      this.calendarService.getCalendars().subscribe({
        next: (cals) => {
          this.calendars = cals;
          if (this.mode === 'create' && this.calendarId === null) {
            const firstEnabled = cals.find((c) => c.isEnabled);
            if (firstEnabled) this.calendarId = firstEnabled.id;
          }
        },
      });

      if (this.mode === 'create') {
        this.internalMode = 'create';
        this.loadedEvent = null;
        this.attachments = [];
        this.resetFormForCreate();
      } else if (this.eventId !== null) {
        this.internalMode = this.mode;
        if (this.originalStart) this.loadOccurrence(this.eventId, this.originalStart);
        else this.load(this.eventId);
      }
    } else if (changes['open'] && !this.open) {
      this.loadedEvent = null;
      this.attachments = [];
      this.stopPolling();
      this.scopeChoiceOpen = false;
      this.scopeChoiceKind = null;
      this.pendingPayload = null;
    }
  }

  private load(id: number) {
    this.loading = true;
    this.loadedEvent = null;
    this.eventService.getEventById(id).subscribe({
      next: (event) => {
        this.loadedEvent = event;
        this.populateForm(event);
        this.loading = false;
        this.loadAttachments();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load event';
        this.loading = false;
      },
    });
  }

  private loadOccurrence(id: number, originalStart: string) {
    this.loading = true;
    this.loadedEvent = null;
    this.eventService.getOccurrence(id, originalStart).subscribe({
      next: (event) => {
        this.loadedEvent = event;
        this.populateForm(event);
        this.loading = false;
        this.loadAttachments();
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load event';
        this.loading = false;
      },
    });
  }

  private resetFormForCreate() {
    const start = this.initialStart ?? dayjs().add(1, 'hour').startOf('hour').toDate();
    const end = this.initialEnd ?? dayjs(start).add(1, 'hour').toDate();

    this.title = '';
    this.description = '';
    this.location = '';
    this.startDate = dayjs(start).format('YYYY-MM-DD');
    this.startTime = dayjs(start).format('HH:mm');
    this.endDate = dayjs(end).format('YYYY-MM-DD');
    this.endTime = dayjs(end).format('HH:mm');
    this.allDay = false;
    this.color = '#3b82f6';
    this.categoryId = null;
    this.calendarId = null;
    this.meetingLinkUrl = '';
    this.meetingLinkTitle = '';
    this.visibility = 'standard';
    this.busyStatus = 'busy';
    this.repeats = false;
    this.recurrenceFrequency = 'weekly';
    this.recurrenceInterval = 1;
    this.recurrenceEndType = 'never';
    this.recurrenceUntil = null;
    this.recurrenceCount = 1;
    this.reminders = [];
    this.guests = [];
    this.guestEmailInput = '';
    this.guestNameInput = '';
  }

  private populateForm(event: CalendarEventModel) {
    const start = dayjs(event.start);
    const end = dayjs(event.end);

    this.title = event.title;
    this.description = event.description;
    this.location = event.location || '';
    this.startDate = start.format('YYYY-MM-DD');
    this.startTime = start.format('HH:mm');
    this.endDate = end.format('YYYY-MM-DD');
    this.endTime = end.format('HH:mm');
    this.allDay = event.allDay;
    this.color = event.color || '#3b82f6';
    this.categoryId = event.category?.id ?? null;
    this.calendarId = event.calendar.id;
    this.meetingLinkUrl = event.meetingLinkUrl || '';
    this.meetingLinkTitle = event.meetingLinkTitle || '';
    this.visibility = event.visibility;
    this.busyStatus = event.busyStatus;

    const r = event.recurrence;
    this.repeats = !!r;
    this.recurrenceFrequency = r?.frequency ?? 'weekly';
    this.recurrenceInterval = r?.interval ?? 1;
    this.recurrenceEndType = r?.until ? 'on' : r?.count ? 'after' : 'never';
    this.recurrenceUntil = r?.until ? dayjs(r.until).format('YYYY-MM-DD') : null;
    this.recurrenceCount = r?.count ?? 1;

    this.reminders = event.reminders.map((rem) => ({ method: rem.method, minutesBefore: rem.minutesBefore }));
    this.guests = event.guests.map((g) => ({ email: g.email, name: g.name, userId: g.userId }));
    this.guestEmailInput = '';
    this.guestNameInput = '';
  }

  startEdit() {
    this.internalMode = 'edit';
    this.error = '';
  }

  cancelEdit() {
    if (this.mode === 'create') {
      this.close();
      return;
    }
    if (this.loadedEvent) this.populateForm(this.loadedEvent);
    this.internalMode = 'view';
    this.error = '';
  }

  addReminder() {
    this.reminders.push({ method: 'notification', minutesBefore: 10 });
  }

  removeReminder(index: number) {
    this.reminders.splice(index, 1);
  }

  addGuest() {
    const email = this.guestEmailInput.trim().toLowerCase();
    if (!email) return;
    if (this.guests.some((g) => g.email.toLowerCase() === email)) {
      this.guestEmailInput = '';
      this.guestNameInput = '';
      return;
    }
    this.guests.push({ email, name: this.guestNameInput.trim() || null });
    this.guestEmailInput = '';
    this.guestNameInput = '';
  }

  removeGuest(index: number) {
    this.guests.splice(index, 1);
  }

  private combineDateTime(date: string | null, time: string | null): string {
    if (!date) return dayjs().toISOString();
    if (this.allDay) return dayjs(date, 'YYYY-MM-DD').startOf('day').toISOString();
    return dayjs(`${date} ${time || '00:00'}`, 'YYYY-MM-DD HH:mm').toISOString();
  }

  onStartDateChange(date: string | null) {
    this.startDate = date;
    this.clampEndToStart();
  }

  onStartTimeChange(time: string | null) {
    this.startTime = time;
    this.clampEndToStart();
  }

  onEndDateChange(date: string | null) {
    this.endDate = date;
    this.clampStartToEnd();
  }

  onEndTimeChange(time: string | null) {
    this.endTime = time;
    this.clampStartToEnd();
  }

  // Keeps end >= start by moving end (date and time) up to start whenever a
  // start-side edit pushes it past the current end — compares full
  // date+time (via combineDateTime, which already folds in allDay), not
  // just the date.
  private clampEndToStart() {
    if (!this.startDate || !this.endDate) return;
    const start = this.combineDateTime(this.startDate, this.startTime);
    const end = this.combineDateTime(this.endDate, this.endTime);
    if (dayjs(start).isAfter(end)) {
      this.endDate = this.startDate;
      this.endTime = this.startTime;
    }
  }

  private clampStartToEnd() {
    if (!this.startDate || !this.endDate) return;
    const start = this.combineDateTime(this.startDate, this.startTime);
    const end = this.combineDateTime(this.endDate, this.endTime);
    if (dayjs(end).isBefore(start)) {
      this.startDate = this.endDate;
      this.startTime = this.endTime;
    }
  }

  private buildPayload(): CreateEventPayload | UpdateEventPayload {
    return {
      title: this.title.trim(),
      description: this.description,
      location: this.location.trim() || null,
      start: this.combineDateTime(this.startDate, this.startTime),
      end: this.combineDateTime(this.endDate, this.endTime),
      allDay: this.allDay,
      color: this.color,
      categoryId: this.categoryId,
      calendarId: this.calendarId ?? undefined,
      meetingLinkUrl: this.meetingLinkUrl.trim() || null,
      meetingLinkTitle: this.meetingLinkUrl.trim() ? this.meetingLinkTitle.trim() || null : null,
      visibility: this.visibility,
      busyStatus: this.busyStatus,
      guests: this.guests,
      reminders: this.reminders,
      recurrence: this.repeats
        ? {
            frequency: this.recurrenceFrequency,
            interval: this.recurrenceInterval,
            until: this.recurrenceEndType === 'on' ? this.combineUntil() : null,
            count: this.recurrenceEndType === 'after' ? this.recurrenceCount : null,
          }
        : null,
    };
  }

  private combineUntil(): string | null {
    return this.recurrenceUntil ? dayjs(this.recurrenceUntil, 'YYYY-MM-DD').endOf('day').toISOString() : null;
  }

  submit() {
    if (!this.title.trim()) {
      this.error = 'Title is required';
      return;
    }
    if (!this.startDate || !this.endDate) {
      this.error = 'Start and end are required';
      return;
    }
    const payload = this.buildPayload();
    if (new Date(payload.end as string).getTime() < new Date(payload.start as string).getTime()) {
      this.error = 'End must be on or after start';
      return;
    }

    this.error = '';

    if (this.internalMode === 'edit' && this.isRecurringOccurrenceContext) {
      this.pendingPayload = payload;
      this.scopeChoiceKind = 'save';
      this.scopeChoiceOpen = true;
      return;
    }

    this.saveEvent(payload);
  }

  private saveEvent(payload: CreateEventPayload | UpdateEventPayload) {
    this.saving = true;
    const request =
      this.internalMode === 'create'
        ? this.eventService.createEvent(payload as CreateEventPayload)
        : this.eventService.updateEvent(this.eventId!, payload);

    request.subscribe({
      next: () => {
        this.saving = false;
        this.saved.emit();
        this.close();
      },
      error: (err) => {
        this.saving = false;
        this.error = err.error?.message || 'Failed to save event';
      },
    });
  }

  private saveOccurrence(payload: UpdateEventPayload) {
    this.saving = true;
    this.eventService.updateOccurrence(this.eventId!, this.originalStart!, payload).subscribe({
      next: () => {
        this.saving = false;
        this.saved.emit();
        this.close();
      },
      error: (err) => {
        this.saving = false;
        this.error = err.error?.message || 'Failed to save this occurrence';
      },
    });
  }

  // "This event" — apply the pending save/delete to just this occurrence.
  confirmScopeThis() {
    const kind = this.scopeChoiceKind;
    const payload = this.pendingPayload;
    this.scopeChoiceOpen = false;
    this.scopeChoiceKind = null;
    this.pendingPayload = null;

    if (kind === 'save' && payload) this.saveOccurrence(payload);
    else if (kind === 'delete') this.skipThisOccurrence();
  }

  // "All events" — apply the pending save to the whole series, or fall
  // through to the existing whole-series delete confirmation.
  confirmScopeAll() {
    const kind = this.scopeChoiceKind;
    const payload = this.pendingPayload;
    this.scopeChoiceOpen = false;
    this.scopeChoiceKind = null;
    this.pendingPayload = null;

    if (kind === 'save' && payload) this.saveEvent(payload);
    else if (kind === 'delete') this.confirmDeleteOpen = true;
  }

  cancelScopeChoice() {
    this.scopeChoiceOpen = false;
    this.scopeChoiceKind = null;
    this.pendingPayload = null;
  }

  private skipThisOccurrence() {
    this.deleteLoading = true;
    this.eventService.skipOccurrence(this.eventId!, this.originalStart!).subscribe({
      next: () => {
        this.deleteLoading = false;
        this.deleted.emit();
        this.close();
      },
      error: (err) => {
        this.deleteLoading = false;
        this.error = err.error?.message || 'Failed to skip this occurrence';
      },
    });
  }

  close() {
    this.closed.emit();
  }

  duplicate() {
    if (!this.loadedEvent || this.duplicating) return;
    this.duplicating = true;
    this.eventService.duplicateEvent(this.loadedEvent).subscribe({
      next: () => {
        this.duplicating = false;
        this.saved.emit();
        this.close();
      },
      error: (err) => {
        this.duplicating = false;
        this.error = err.error?.message || 'Failed to duplicate event';
      },
    });
  }

  requestDelete() {
    if (this.isRecurringOccurrenceContext) {
      this.scopeChoiceKind = 'delete';
      this.scopeChoiceOpen = true;
      return;
    }
    this.confirmDeleteOpen = true;
  }

  cancelDelete() {
    this.confirmDeleteOpen = false;
  }

  confirmDelete() {
    const id = this.loadedEvent?.id ?? this.eventId;
    if (!id) return;
    this.deleteLoading = true;
    this.eventService.deleteEvent(id).subscribe({
      next: () => {
        this.deleteLoading = false;
        this.confirmDeleteOpen = false;
        this.deleted.emit();
        this.close();
      },
      error: (err) => {
        this.deleteLoading = false;
        this.error = err.error?.message || 'Failed to delete event';
        this.confirmDeleteOpen = false;
      },
    });
  }

  isPending(a: Attachment): boolean {
    return !!a.pendingDeleteAt && new Date(a.pendingDeleteAt).getTime() > this.now;
  }

  remainingSeconds(a: Attachment): number {
    if (!a.pendingDeleteAt) return 0;
    return Math.max(0, Math.ceil((new Date(a.pendingDeleteAt).getTime() - this.now) / 1000));
  }

  // silent=true skips the loading spinner — used by the background poll so
  // a countdown reaching 0 doesn't flash "Loading…" over the list.
  loadAttachments(silent = false) {
    if (!this.loadedEvent) return;
    if (!silent) this.attachmentsLoading = true;
    this.eventService.getAttachments(this.loadedEvent.id).subscribe({
      next: (list) => {
        this.attachments = list;
        this.attachmentsLoading = false;
        this.syncPolling();
      },
      error: () => (this.attachmentsLoading = false),
    });
  }

  // Keeps polling while a countdown is in flight so the list picks up the
  // permanent delete as soon as the sweep on the server processes it,
  // without the user having to refresh.
  private syncPolling() {
    const hasPending = this.attachments.some((a) => a.pendingDeleteAt);
    if (hasPending && !this.pollHandle) {
      this.pollHandle = setInterval(() => this.loadAttachments(true), this.POLL_MS);
    } else if (!hasPending) {
      this.stopPolling();
    }
  }

  private stopPolling() {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.loadedEvent) return;

    this.attachmentUploading = true;
    this.attachmentUploadError = '';
    this.eventService.uploadAttachment(this.loadedEvent.id, file).subscribe({
      next: (res) => {
        switch (res.type) {
          case HttpEventType.UploadProgress:
            if (res.total) {
              this.progress = Math.round((100 * res.loaded) / res.total);
            }
            break;
          case HttpEventType.Response:
            this.attachments = [res.body.attachment, ...this.attachments];
            this.attachmentUploading = false;
            input.value = '';
            break;
        }
      },
      error: (err) => {
        this.attachmentUploadError = err.error?.message || 'Failed to upload file';
        this.attachmentUploading = false;
        input.value = '';
      },
    });
  }

  toggleAddLink() {
    this.addLinkOpen = !this.addLinkOpen;
    this.addLinkError = '';
    if (!this.addLinkOpen) {
      this.linkUrlInput = '';
      this.linkLabelInput = '';
    }
  }

  submitLink() {
    const url = this.linkUrlInput.trim();
    if (!url || !this.loadedEvent) return;
    this.addLinkLoading = true;
    this.addLinkError = '';
    this.eventService
      .addLinkAttachment(this.loadedEvent.id, { url, fileName: this.linkLabelInput.trim() })
      .subscribe({
        next: (res) => {
          this.attachments = [res.attachment, ...this.attachments];
          this.addLinkLoading = false;
          this.addLinkOpen = false;
          this.linkUrlInput = '';
          this.linkLabelInput = '';
        },
        error: (err) => {
          this.addLinkError = err.error?.message || 'Failed to add link';
          this.addLinkLoading = false;
        },
      });
  }

  download(attachment: Attachment) {
    if (!this.loadedEvent) return;
    this.downloadingId = attachment.id;
    this.eventService.downloadAttachment(this.loadedEvent.id, attachment.id).subscribe({
      next: (info) => {
        window.open(info.downloadUrl, '_blank');
        this.downloadingId = null;
      },
      error: () => (this.downloadingId = null),
    });
  }

  deleteAttachment(attachment: Attachment) {
    if (!this.loadedEvent) return;
    this.eventService.deleteAttachment(this.loadedEvent.id, attachment.id).subscribe({
      next: (res) => {
        this.attachments = this.attachments.map((a) => (a.id === res.attachment.id ? res.attachment : a));
        this.syncPolling();
      },
    });
  }

  undoDeleteAttachment(attachment: Attachment) {
    if (!this.loadedEvent) return;
    this.eventService.undoDeleteAttachment(this.loadedEvent.id, attachment.id).subscribe({
      next: (res) => {
        this.attachments = this.attachments.map((a) => (a.id === res.attachment.id ? res.attachment : a));
        this.syncPolling();
      },
    });
  }

  getAttachmentFileInfo = (attachment: Attachment) =>
    this.eventService.downloadAttachment(this.loadedEvent!.id, attachment.id);

  openViewer(attachment: Attachment) {
    const index = this.attachments.findIndex((a) => a.id === attachment.id);
    this.viewerIndex = index >= 0 ? index : 0;
    this.viewerOpen = true;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
