import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SecurityContext, SimpleChanges, ViewChild } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import dayjs from 'dayjs/esm';
import { CKEditorModule } from '@ckeditor/ckeditor5-angular';
import {
  ClassicEditor,
  Essentials,
  Paragraph,
  Heading,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link,
  List,
  BlockQuote,
  Indent,
  IndentBlock,
} from 'ckeditor5';
import { environment } from '../../../environments/environment';
import { ModalDirective } from '../modal.directive';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { TimePickerComponent } from '../time-picker/time-picker.component';
import { AttachmentsComponent } from '../attachments/attachments.component';
import { LinkedTasksComponent } from '../linked-tasks/linked-tasks.component';
import { EventService } from '../../core/services/event.service';
import { DepartmentService } from '../../core/services/department.service';
import { CategoryService } from '../../core/services/category.service';
import { CalendarService } from '../../core/services/calendar.service';
import { AuthService } from '../../core/services/auth.service';
import { DateFormatService } from '../../core/services/date-format.service';
import { MeetingService } from '../../core/services/meeting.service';
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
import { Calendar } from '../../models/calendar.model';
import { Department } from '../../models/department.model';
import { Category } from '../../models/category.model';

export type EventDialogMode = 'create' | 'edit';
type RecurrenceEndType = 'never' | 'on' | 'after';

const RECURRENCE_UNIT_LABEL: Record<RecurrenceFrequency, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

const FREQUENCY_OPTIONS: { value: RecurrenceFrequency; label: string; icon: string }[] = [
  { value: 'daily', label: 'Daily', icon: 'bi-calendar-day' },
  { value: 'weekly', label: 'Weekly', icon: 'bi-calendar-week' },
  { value: 'monthly', label: 'Monthly', icon: 'bi-calendar-month' },
  { value: 'yearly', label: 'Yearly', icon: 'bi-calendar-range' },
];

const VISIBILITY_OPTIONS: { value: EventVisibility; label: string; icon: string }[] = [
  { value: 'standard', label: 'Standard', icon: 'bi-eye' },
  { value: 'private', label: 'Private', icon: 'bi-lock-fill' },
  { value: 'public', label: 'Public', icon: 'bi-globe2' },
];

const REMINDER_METHOD_OPTIONS: { value: ReminderMethod; label: string; icon: string }[] = [
  { value: 'notification', label: 'Notification', icon: 'bi-bell-fill' },
  { value: 'email', label: 'Email', icon: 'bi-envelope-fill' },
];

// Single dialog covering both Create and Edit — no separate read-only
// "info" view. A non-manager (guest without edit rights) still lands on
// this same form, just fully disabled (see applyFormPermissions).
@Component({
  selector: 'app-event-detail-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    NgTemplateOutlet,
    RouterLink,
    ModalDirective,
    ConfirmDialogComponent,
    DatePickerComponent,
    TimePickerComponent,
    CKEditorModule,
    AttachmentsComponent,
    LinkedTasksComponent,
  ],
  templateUrl: './event-detail-dialog.component.html',
  styleUrl: './event-detail-dialog.component.css',
})
export class EventDetailDialogComponent implements OnChanges, OnDestroy {
  readonly frequencyOptions = FREQUENCY_OPTIONS;
  readonly visibilityOptions = VISIBILITY_OPTIONS;
  readonly reminderMethodOptions = REMINDER_METHOD_OPTIONS;

  readonly DescriptionEditor = ClassicEditor;
  readonly descriptionEditorConfig = {
    licenseKey: environment.ckeditorLicenseKey,
    plugins: [Essentials, Paragraph, Heading, Bold, Italic, Underline, Strikethrough, Link, List, BlockQuote, Indent, IndentBlock],
    toolbar: [
      'heading', '|',
      'bold', 'italic', 'underline', 'strikethrough', '|',
      'bulletedList', 'numberedList', '|',
      'outdent', 'indent', '|',
      'link', 'blockQuote', '|',
      'undo', 'redo',
    ],
  };

  @Input() open = false;
  @Input() mode: EventDialogMode = 'edit';
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
  @Input() initialAllDay = false;
  // Set when opened from a Project's "Schedule meeting" action (see
  // ProjectDetailComponent) — pre-links the event to this project and forces
  // the "Add Meet Hub room" toggle on, since that's the whole point of that
  // entry point. Left null for the normal calendar-feature open, where no
  // project scoping applies.
  @Input() projectId: number | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();

  @ViewChild('titleInput') titleInput?: ElementRef<HTMLInputElement>;

  internalMode: EventDialogMode = 'edit';

  loadedEvent: CalendarEventModel | null = null;
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

  // The event form itself — reminders/guests are FormArrays; the transient
  // "add a guest" composer bar is its own small nested group since its two
  // fields are never part of the submitted payload directly (addGuest()
  // reads them, appends to the guests array, then resets just this group).
  // Built in the constructor body, not here — a field initializer runs
  // before constructor-parameter properties (like `fb`) are assigned.
  readonly form: FormGroup;

  // Attachments — the actual list/loading/upload/delete state now lives
  // inside the shared <app-attachments> component; this is just the count
  // for the tab header badge, kept in sync via its (attachmentsChange)
  // output. Deliberately NOT sourced from loadedEvent.attachments (populated
  // by EVENT_INCLUDE): for a recurring occurrence that's been individually
  // modified, that embedded field belongs to the separate override row
  // (always empty), not the master series' real list.
  attachmentsCount = 0;

  // Which top-level pane is showing — "Details" is today's existing
  // two-panel view/edit content, "Tasks" is the new linked-tasks panel.
  // Always resets to 'details' whenever the dialog (re)opens/loads a
  // different event, same reasoning as attachmentsCount above: tasksCount
  // is kept in sync purely via <app-linked-tasks>'s (tasksChange) output.
  activeTab: 'details' | 'tasks' = 'details';
  tasksCount = 0;

  private subs = new Subscription();

  constructor(
    private fb: FormBuilder,
    public eventService: EventService,
    public departmentService: DepartmentService,
    public categoryService: CategoryService,
    private calendarService: CalendarService,
    public auth: AuthService,
    public dateFormat: DateFormatService,
    private meetingService: MeetingService,
    private sanitizer: DomSanitizer
  ) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      location: [''],
      startDate: this.fb.control<string | null>(null, Validators.required),
      startTime: this.fb.control<string | null>(null),
      endDate: this.fb.control<string | null>(null, Validators.required),
      endTime: this.fb.control<string | null>(null),
      allDay: [false],
      color: ['#3b82f6'],
      departmentId: this.fb.control<number | null>(null),
      categoryId: this.fb.control<number | null>(null),
      calendarId: this.fb.control<number | null>(null),
      meetingLinkUrl: [''],
      meetingLinkTitle: [{ value: '', disabled: true }],
      // Alternative to pasting an external link — creates an internal Meet
      // Hub room instead (see attachMeetHubRoom). Mutually exclusive with
      // meetingLinkUrl in the UI, though the backend doesn't hard-enforce it.
      meetHubRoom: [false],
      visibility: this.fb.control<EventVisibility>('standard'),
      busyStatus: this.fb.control<EventBusyStatus>('busy'),
      repeats: [false],
      recurrenceFrequency: this.fb.control<RecurrenceFrequency>('weekly'),
      recurrenceInterval: [1],
      recurrenceEndType: this.fb.control<RecurrenceEndType>('never'),
      recurrenceUntil: this.fb.control<string | null>(null),
      recurrenceCount: [1],
      reminders: this.fb.array<FormGroup>([]),
      guests: this.fb.array<FormGroup>([]),
      guestComposer: this.fb.group({ email: [''], name: [''] }),
    });

    // meetingLinkTitle only makes sense once a link is present — mirrors the
    // old plain-DOM [disabled] check, done here via enable()/disable() since
    // Angular reactive forms owns the disabled state once formControlName is
    // in play (a template-level [disabled] binding on the same element would
    // conflict with it).
    this.subs.add(
      this.form.get('meetingLinkUrl')!.valueChanges.subscribe((url: string) => {
        const titleControl = this.form.get('meetingLinkTitle')!;
        if (url && url.trim()) titleControl.enable({ emitEvent: false });
        else titleControl.disable({ emitEvent: false });
      })
    );

    // Toggling on a Meet Hub room clears/locks the pasted-link fields —
    // an event has either an external link or an internal room, not both.
    this.subs.add(
      this.form.get('meetHubRoom')!.valueChanges.subscribe((on: boolean) => {
        const urlControl = this.form.get('meetingLinkUrl')!;
        if (on) {
          urlControl.setValue('', { emitEvent: false });
          urlControl.disable({ emitEvent: false });
          this.form.get('meetingLinkTitle')!.disable({ emitEvent: false });
        } else if (this.canManage) {
          urlControl.enable({ emitEvent: false });
        }
      })
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }

  get remindersArray(): FormArray<FormGroup> {
    return this.form.get('reminders') as FormArray<FormGroup>;
  }

  get guestsArray(): FormArray<FormGroup> {
    return this.form.get('guests') as FormArray<FormGroup>;
  }

  get guestComposer(): FormGroup {
    return this.form.get('guestComposer') as FormGroup;
  }

  get canManage(): boolean {
    if (!this.loadedEvent) return true;
    const user = this.auth.currentUser();
    return !!user && (user.role === 'Admin' || user.id === this.loadedEvent.owner.id);
  }

  // Lookups backing the Details tab's dropdown triggers — each dropdown's
  // control still just stores the selected id/value, same as the <select>
  // it replaced; the trigger button re-derives the full object to render.
  get selectedDepartment(): Department | null {
    const id = this.form.get('departmentId')?.value ?? null;
    return id !== null ? (this.departmentService.departments().find((d) => d.id === id) ?? null) : null;
  }

  get selectedCategory(): Category | null {
    const id = this.form.get('categoryId')?.value ?? null;
    return id !== null ? (this.categoryService.categories().find((c) => c.id === id) ?? null) : null;
  }

  get selectedCalendar(): Calendar | null {
    const id = this.form.get('calendarId')?.value ?? null;
    return id !== null ? (this.calendars.find((c) => c.id === id) ?? null) : null;
  }

  get selectedFrequencyOption() {
    const value = this.form.get('recurrenceFrequency')?.value;
    return FREQUENCY_OPTIONS.find((o) => o.value === value) ?? FREQUENCY_OPTIONS[0];
  }

  get selectedVisibilityOption() {
    const value = this.form.get('visibility')?.value;
    return VISIBILITY_OPTIONS.find((o) => o.value === value) ?? VISIBILITY_OPTIONS[0];
  }

  reminderMethodOption(group: FormGroup) {
    const value = group.get('method')?.value;
    return REMINDER_METHOD_OPTIONS.find((o) => o.value === value) ?? REMINDER_METHOD_OPTIONS[0];
  }

  selectDepartment(id: number | null) {
    if (!this.canManage) return;
    this.form.patchValue({ departmentId: id });
  }

  selectCategory(id: number | null) {
    if (!this.canManage) return;
    this.form.patchValue({ categoryId: id });
  }

  selectCalendar(id: number) {
    if (!this.canManage) return;
    this.form.patchValue({ calendarId: id });
  }

  selectFrequency(value: RecurrenceFrequency) {
    if (!this.canManage) return;
    this.form.patchValue({ recurrenceFrequency: value });
  }

  selectVisibility(value: EventVisibility) {
    if (!this.canManage) return;
    this.form.patchValue({ visibility: value });
  }

  selectReminderMethod(group: FormGroup, value: ReminderMethod) {
    if (!this.canManage) return;
    group.patchValue({ method: value });
  }

  // A viewer without manage rights sees the description's saved HTML
  // rendered directly rather than inside the CKEditor editable region —
  // CKEditor's editing view intercepts clicks on links (so the cursor can be
  // placed) even once the control is disabled, so links there are inert.
  // Explicitly sanitized (not bypassSecurityTrustHtml'd) since `description`
  // reaches the DB through a plain string API field with no server-side HTML
  // sanitization — this view is what other users (event guests) see, so a
  // raw API write can't smuggle a script/handler through to them.
  get descriptionHtml(): SafeHtml {
    const raw = this.form.get('description')!.value || '';
    const clean = this.sanitizer.sanitize(SecurityContext.HTML, raw) || '';
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  // True only when this dialog is looking at one instance of a recurring
  // series (not the series' own definition) — that's when "this occurrence
  // vs entire series" needs asking before a save/delete goes through.
  get isRecurringOccurrenceContext(): boolean {
    return !!this.originalStart && !!this.loadedEvent?.recurrence;
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

  // True once a Meet Hub room is already attached, or this dialog was opened
  // pre-scoped to a project (see @Input() projectId) — in both cases the
  // toggle is shown but locked, since there's no "detach the room" flow yet.
  get meetHubRoomLocked(): boolean {
    return !!this.loadedEvent?.meeting || this.projectId !== null;
  }

  get hasExistingMeeting(): boolean {
    return !!this.loadedEvent?.meeting;
  }

  // Join button activates 5 minutes before start and stays until the room
  // is no longer live/scheduled (mirrors the "starts in X minutes" idea
  // referenced in the spec — no prior art elsewhere in this component).
  get canJoinMeeting(): boolean {
    const meeting = this.loadedEvent?.meeting;
    if (!meeting || !this.loadedEvent) return false;
    if (meeting.status !== 'scheduled' && meeting.status !== 'live') return false;
    return dayjs().isAfter(dayjs(this.loadedEvent.start).subtract(5, 'minute'));
  }

  get joinMeetingUrl(): string | null {
    return this.loadedEvent?.meeting ? `/meet/${this.loadedEvent.meeting.roomCode}` : null;
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

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.error = '';
      this.confirmDeleteOpen = false;
      this.activeTab = 'details';
      this.tasksCount = 0;
      this.departmentService.ensureDepartmentsLoaded();
      this.categoryService.ensureCategoriesLoaded();
      this.calendarService.getCalendars().subscribe({
        next: (cals) => {
          this.calendars = cals;
          if (this.mode === 'create' && this.form.value.calendarId === null) {
            const firstEnabled = cals.find((c) => c.isEnabled);
            if (firstEnabled) this.form.patchValue({ calendarId: firstEnabled.id });
          }
        },
      });

      if (this.mode === 'create') {
        this.internalMode = 'create';
        this.loadedEvent = null;
        this.attachmentsCount = 0;
        this.resetFormForCreate();
        this.applyFormPermissions();
      } else if (this.eventId !== null) {
        this.internalMode = this.mode;
        if (this.originalStart) this.loadOccurrence(this.eventId, this.originalStart);
        else this.load(this.eventId);
      }
    } else if (changes['open'] && !this.open) {
      this.loadedEvent = null;
      this.attachmentsCount = 0;
      this.tasksCount = 0;
      this.scopeChoiceOpen = false;
      this.scopeChoiceKind = null;
      this.pendingPayload = null;
    }
  }

  // Bound to the modal element's `shown.bs.modal` event rather than run
  // from ngOnChanges: Bootstrap's own Modal (see modal.service.ts's
  // `focus: true`) grabs focus for itself once its fade-in transition
  // finishes, which happens after ngOnChanges — an early focus() call there
  // just gets stolen back. `shown.bs.modal` fires right after Bootstrap's
  // own focus grab, so calling focus() here reliably wins.
  focusTitleInput() {
    this.titleInput?.nativeElement.focus();
  }

  private load(id: number) {
    this.loading = true;
    this.loadedEvent = null;
    this.eventService.getEventById(id).subscribe({
      next: (event) => {
        this.loadedEvent = event;
        this.populateForm(event);
        this.applyFormPermissions();
        this.loading = false;
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
        this.applyFormPermissions();
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load event';
        this.loading = false;
      },
    });
  }

  // No separate read-only view — a guest/non-owner without manage rights
  // still lands on this same form, just disabled outright (the backend
  // would reject their save anyway, so an editable form would be
  // misleading). meetingLinkTitle's own enable/disable (tied to whether
  // meetingLinkUrl has a value, see the constructor subscription) only ever
  // narrows further, so re-apply it after a blanket enable() re-opens it.
  private applyFormPermissions() {
    if (this.canManage) {
      this.form.enable({ emitEvent: false });
      const url = (this.form.get('meetingLinkUrl')!.value || '').trim();
      if (!url) this.form.get('meetingLinkTitle')!.disable({ emitEvent: false });
      if (this.form.get('meetHubRoom')!.value) {
        this.form.get('meetingLinkUrl')!.disable({ emitEvent: false });
        this.form.get('meetingLinkTitle')!.disable({ emitEvent: false });
      }
      if (this.meetHubRoomLocked) this.form.get('meetHubRoom')!.disable({ emitEvent: false });
    } else {
      this.form.disable({ emitEvent: false });
    }
  }

  private resetFormForCreate() {
    const start = this.initialStart ?? dayjs().add(1, 'hour').startOf('hour').toDate();
    const end = this.initialEnd ?? dayjs(start).add(1, 'hour').toDate();

    this.form.reset({
      title: '',
      description: '',
      location: '',
      startDate: dayjs(start).format('YYYY-MM-DD'),
      startTime: dayjs(start).format('HH:mm'),
      endDate: dayjs(end).format('YYYY-MM-DD'),
      endTime: dayjs(end).format('HH:mm'),
      allDay: this.initialAllDay,
      color: '#3b82f6',
      departmentId: null,
      categoryId: null,
      calendarId: null,
      meetingLinkUrl: '',
      meetingLinkTitle: '',
      meetHubRoom: this.projectId !== null,
      visibility: 'standard',
      busyStatus: 'busy',
      repeats: false,
      recurrenceFrequency: 'weekly',
      recurrenceInterval: 1,
      recurrenceEndType: 'never',
      recurrenceUntil: null,
      recurrenceCount: 1,
      guestComposer: { email: '', name: '' },
    });
    this.setReminders([]);
    this.setGuests([]);
  }

  private populateForm(event: CalendarEventModel) {
    const start = dayjs(event.start);
    const end = dayjs(event.end);
    const r = event.recurrence;

    this.form.reset({
      title: event.title,
      description: event.description,
      location: event.location || '',
      startDate: start.format('YYYY-MM-DD'),
      startTime: start.format('HH:mm'),
      endDate: end.format('YYYY-MM-DD'),
      endTime: end.format('HH:mm'),
      allDay: event.allDay,
      color: event.color || '#3b82f6',
      departmentId: event.department?.id ?? null,
      categoryId: event.category?.id ?? null,
      calendarId: event.calendar.id,
      meetingLinkUrl: event.meetingLinkUrl || '',
      meetingLinkTitle: event.meetingLinkTitle || '',
      meetHubRoom: !!event.meeting,
      visibility: event.visibility,
      busyStatus: event.busyStatus,
      repeats: !!r,
      recurrenceFrequency: r?.frequency ?? 'weekly',
      recurrenceInterval: r?.interval ?? 1,
      recurrenceEndType: r?.until ? 'on' : r?.count ? 'after' : 'never',
      recurrenceUntil: r?.until ? dayjs(r.until).format('YYYY-MM-DD') : null,
      recurrenceCount: r?.count ?? 1,
      guestComposer: { email: '', name: '' },
    });
    this.setReminders(event.reminders.map((rem) => ({ method: rem.method, minutesBefore: rem.minutesBefore })));
    this.setGuests(event.guests.map((g) => ({ email: g.email, name: g.name, userId: g.userId })));
  }

  private createReminderGroup(method: ReminderMethod = 'notification', minutesBefore = 10): FormGroup {
    return this.fb.group({ method: [method], minutesBefore: [minutesBefore] });
  }

  private setReminders(rows: { method: ReminderMethod; minutesBefore: number }[]) {
    this.remindersArray.clear();
    rows.forEach((r) => this.remindersArray.push(this.createReminderGroup(r.method, r.minutesBefore)));
  }

  private createGuestGroup(g: GuestInput): FormGroup {
    return this.fb.group({ email: [g.email], name: [g.name ?? null], userId: [g.userId ?? null] });
  }

  private setGuests(list: GuestInput[]) {
    this.guestsArray.clear();
    list.forEach((g) => this.guestsArray.push(this.createGuestGroup(g)));
  }

  cancelEdit() {
    this.close();
  }

  addReminder() {
    this.remindersArray.push(this.createReminderGroup());
  }

  removeReminder(index: number) {
    this.remindersArray.removeAt(index);
  }

  addGuest() {
    const email = (this.guestComposer.value.email || '').trim().toLowerCase();
    const name = (this.guestComposer.value.name || '').trim();
    if (!email) return;

    const alreadyGuest = this.guestsArray.controls.some((g) => (g.value.email || '').toLowerCase() === email);
    if (!alreadyGuest) {
      this.guestsArray.push(this.createGuestGroup({ email, name: name || null }));
    }
    this.guestComposer.reset({ email: '', name: '' });
  }

  removeGuest(index: number) {
    this.guestsArray.removeAt(index);
  }

  private combineDateTime(date: string | null, time: string | null): string {
    if (!date) return dayjs().toISOString();
    if (this.form.value.allDay) return dayjs(date, 'YYYY-MM-DD').startOf('day').toISOString();
    return dayjs(`${date} ${time || '00:00'}`, 'YYYY-MM-DD HH:mm').toISOString();
  }

  // Keeps end >= start by moving end (date and time) up to start whenever a
  // start-side edit pushes it past the current end — compares full
  // date+time (via combineDateTime, which already folds in allDay), not
  // just the date. Triggered by the date/time pickers' (valueChange) — by
  // the time that fires, the paired FormControl already holds the new value
  // (date-picker/time-picker's emit() runs onChange before valueChange).
  clampEndToStart() {
    const { startDate, startTime, endDate, endTime } = this.form.value;
    if (!startDate || !endDate) return;
    const start = this.combineDateTime(startDate, startTime);
    const end = this.combineDateTime(endDate, endTime);
    if (dayjs(start).isAfter(end)) {
      this.form.patchValue({ endDate: startDate, endTime: startTime });
    }
  }

  clampStartToEnd() {
    const { startDate, startTime, endDate, endTime } = this.form.value;
    if (!startDate || !endDate) return;
    const start = this.combineDateTime(startDate, startTime);
    const end = this.combineDateTime(endDate, endTime);
    if (dayjs(end).isBefore(start)) {
      this.form.patchValue({ startDate: endDate, startTime: endTime });
    }
  }

  private buildPayload(): CreateEventPayload | UpdateEventPayload {
    // getRawValue(), not .value — meetingLinkTitle is a genuinely disabled
    // control while there's no link, and .value silently omits disabled
    // controls entirely.
    const v = this.form.getRawValue();
    const guests: GuestInput[] = this.guestsArray.controls.map((g) => ({
      email: g.value.email,
      name: g.value.name,
      userId: g.value.userId,
    }));
    const reminders = this.remindersArray.controls.map((r) => ({
      method: r.value.method as ReminderMethod,
      minutesBefore: r.value.minutesBefore,
    }));

    return {
      title: v.title.trim(),
      description: v.description,
      location: v.location.trim() || null,
      start: this.combineDateTime(v.startDate, v.startTime),
      end: this.combineDateTime(v.endDate, v.endTime),
      allDay: v.allDay,
      color: v.color,
      departmentId: v.departmentId,
      categoryId: v.categoryId,
      calendarId: v.calendarId ?? undefined,
      ...(this.projectId !== null ? { projectId: this.projectId } : {}),
      meetingLinkUrl: v.meetHubRoom ? null : v.meetingLinkUrl.trim() || null,
      meetingLinkTitle: !v.meetHubRoom && v.meetingLinkUrl.trim() ? v.meetingLinkTitle.trim() || null : null,
      visibility: v.visibility,
      busyStatus: v.busyStatus,
      guests,
      reminders,
      recurrence: v.repeats
        ? {
            frequency: v.recurrenceFrequency,
            interval: v.recurrenceInterval,
            until: v.recurrenceEndType === 'on' ? this.combineUntil() : null,
            count: v.recurrenceEndType === 'after' ? v.recurrenceCount : null,
          }
        : null,
    };
  }

  private combineUntil(): string | null {
    const until = this.form.value.recurrenceUntil;
    return until ? dayjs(until, 'YYYY-MM-DD').endOf('day').toISOString() : null;
  }

  submit() {
    const { title, startDate, endDate } = this.form.value;
    if (!title.trim()) {
      this.error = 'Title is required';
      return;
    }
    if (!startDate || !endDate) {
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
    const wantsMeetHubRoom = this.form.getRawValue().meetHubRoom && !this.hasExistingMeeting;
    const request =
      this.internalMode === 'create'
        ? this.eventService.createEvent(payload as CreateEventPayload)
        : this.eventService.updateEvent(this.eventId!, payload);

    request.subscribe({
      next: (res) => {
        if (wantsMeetHubRoom) this.attachMeetHubRoom(res.event);
        else {
          this.saving = false;
          this.saved.emit();
          this.close();
        }
      },
      error: (err) => {
        this.saving = false;
        this.error = err.error?.message || 'Failed to save event';
      },
    });
  }

  // Attaches a hosted Meet Hub room to the just-saved event via
  // calendarEventId — the backend links it and writes the internal room URL
  // back onto the event's meetingLinkUrl (see meetingController.createMeeting).
  private attachMeetHubRoom(event: CalendarEventModel) {
    this.meetingService
      .create({
        title: event.title,
        calendarEventId: event.id,
        scheduledStart: event.start,
        scheduledEnd: event.end,
        ...(this.projectId !== null ? { projectId: this.projectId } : {}),
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.saved.emit();
          this.close();
        },
        error: (err) => {
          this.saving = false;
          this.error = err.error?.message || 'Event saved, but creating the Meet Hub room failed';
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
}
