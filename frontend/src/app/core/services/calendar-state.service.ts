import { Injectable, signal, computed, effect } from '@angular/core';
import {
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  isSameMonth,
  format,
} from 'date-fns';
import { CalendarEvent as MwlCalendarEvent } from 'angular-calendar';
import { EventService } from './event.service';
import { CalendarService } from './calendar.service';
import { CalendarOccurrence } from '../../models/event.model';
import { isAllDayOrMultiDay, resolveEventColor } from './calendar-layout.util';

export type CalendarViewMode = 'day' | 'week' | 'month';
export type EventDialogMode = 'create' | 'edit' | 'view';

// Provided per-instance in CalendarComponent (not providedIn:'root') so it's
// scoped to the /calendar feature and shared between the shell (toolbar/
// sidebar) and whichever Day/Week/Month child route is currently routed in —
// mirrors DropListRegistryService's component-scoped-service pattern used in
// project-detail.component.ts. Also owns fetching events for whatever range
// is currently visible, so the three view components don't each need their
// own fetch logic.
@Injectable()
export class CalendarStateService {
  private readonly _viewDate = signal<Date>(new Date());
  private readonly _viewMode = signal<CalendarViewMode>('month');
  private readonly _events = signal<CalendarOccurrence[]>([]);
  private readonly _eventsLoading = signal(false);
  private readonly _eventsError = signal('');
  // Which event's dialog is open — read by CalendarComponent (the shell,
  // where the dialog itself renders) and set by whichever Day/Week/Month
  // child is currently active when its (eventClicked) fires, or by the
  // shell's own "Create event" button/day-cell click.
  private readonly _selectedEventId = signal<number | null>(null);
  // Set alongside _selectedEventId only when the clicked item is one
  // instance of a recurring series — null for a plain event or a create.
  // Lets the dialog load/act on just this occurrence instead of the master.
  private readonly _selectedOriginalStart = signal<string | null>(null);
  private readonly _dialogMode = signal<EventDialogMode>('view');
  private readonly _createRangeStart = signal<Date | null>(null);
  private readonly _createRangeEnd = signal<Date | null>(null);
  private readonly _createAllDay = signal(false);
  // Which day's "+N more" popup is open — null means closed. Hoisted into
  // CalendarComponent's template the same way the other dialog state is.
  private readonly _dayEventsPopupDate = signal<Date | null>(null);
  private readonly _dayEventsPopupOccurrences = signal<CalendarOccurrence[]>([]);

  readonly viewDate = this._viewDate.asReadonly();
  readonly viewMode = this._viewMode.asReadonly();
  readonly events = this._events.asReadonly();
  readonly eventsLoading = this._eventsLoading.asReadonly();
  readonly eventsError = this._eventsError.asReadonly();
  readonly selectedEventId = this._selectedEventId.asReadonly();
  readonly selectedOriginalStart = this._selectedOriginalStart.asReadonly();
  readonly dialogMode = this._dialogMode.asReadonly();
  readonly createRangeStart = this._createRangeStart.asReadonly();
  readonly createRangeEnd = this._createRangeEnd.asReadonly();
  readonly createAllDay = this._createAllDay.asReadonly();
  readonly dialogOpen = computed(() => this._dialogMode() === 'create' || this._selectedEventId() !== null);
  readonly dayEventsPopupDate = this._dayEventsPopupDate.asReadonly();
  readonly dayEventsPopupOccurrences = this._dayEventsPopupOccurrences.asReadonly();
  readonly dayEventsPopupOpen = computed(() => this._dayEventsPopupDate() !== null);

  // Calendars the user has toggled off (see CalendarService.calendars'
  // isEnabled) are hidden from the grid without re-fetching — filtered
  // client-side against the already-fetched event list.
  private readonly enabledCalendarIds = computed(
    () => new Set(this.calendarService.calendars().filter((c) => c.isEnabled).map((c) => c.id))
  );

  // Raw occurrences filtered down to enabled calendars — the shared base
  // that mwlEvents/timedGridEvents/strapEvents all build on.
  readonly enabledEvents = computed(() =>
    this._events().filter((e) => this.enabledCalendarIds().has(e.calendar.id))
  );

  // Converted to the shape mwl-calendar-*-view expects — computed so all
  // three view components can just bind `[events]="state.mwlEvents()"`
  // without each doing their own mapping.
  readonly mwlEvents = computed(() => this.enabledEvents().map((e) => this.toMwlEvent(e)));

  // Split for week/day view: timed (single-day, non-all-day) events still
  // go through the library's hourly grid, while all-day/multi-day events
  // are rendered by the custom EventStrapRowComponent instead — never both,
  // so an event never appears twice.
  readonly timedGridEvents = computed(() => this.enabledEvents().filter((e) => !isAllDayOrMultiDay(e)));
  readonly strapEvents = computed(() => this.enabledEvents().filter((e) => isAllDayOrMultiDay(e)));
  readonly timedMwlEvents = computed(() => this.timedGridEvents().map((e) => this.toMwlEvent(e)));

  readonly rangeLabel = computed(() => {
    const d = this._viewDate();
    switch (this._viewMode()) {
      case 'day':
        return format(d, 'EEEE, MMMM d, yyyy');
      case 'week': {
        const start = startOfWeek(d);
        const end = endOfWeek(d);
        return isSameMonth(start, end)
          ? `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
          : `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
      }
      default:
        return format(d, 'MMMM yyyy');
    }
  });

  constructor(
    private eventService: EventService,
    private calendarService: CalendarService
  ) {
    // Runs once immediately (loading the current month) and again whenever
    // viewDate/viewMode change — reading both signals here is what makes
    // this effect re-fire on either changing.
    effect(
      () => {
        const mode = this._viewMode();
        const date = this._viewDate();
        this.loadEvents(mode, date);
      },
      // loadEvents sets _eventsLoading/_eventsError/_events, none of which
      // this effect reads — safe from feedback loops, just needs the flag
      // since those writes happen synchronously inside the effect.
      { allowSignalWrites: true }
    );

    // Kicked off alongside the first event load so enabledCalendarIds is
    // populated by the time mwlEvents first computes (a brief empty flash
    // otherwise, since events can't render until we know which calendars
    // they belong to are enabled).
    this.calendarService.ensureCalendarsLoaded();
  }

  // Set by each Day/Week/Month view component's own ngOnInit — keeps this
  // in sync with whichever route is actually active regardless of how
  // navigation happened (toolbar click, direct link, browser back/forward),
  // rather than only updating it from the toolbar's own click handler.
  setViewMode(mode: CalendarViewMode) {
    this._viewMode.set(mode);
  }

  setViewDate(date: Date) {
    this._viewDate.set(date);
  }

  today() {
    this._viewDate.set(new Date());
  }

  next() {
    const d = this._viewDate();
    switch (this._viewMode()) {
      case 'day':
        this._viewDate.set(addDays(d, 1));
        break;
      case 'week':
        this._viewDate.set(addWeeks(d, 1));
        break;
      case 'month':
        this._viewDate.set(addMonths(d, 1));
        break;
    }
  }

  prev() {
    const d = this._viewDate();
    switch (this._viewMode()) {
      case 'day':
        this._viewDate.set(subDays(d, 1));
        break;
      case 'week':
        this._viewDate.set(subWeeks(d, 1));
        break;
      case 'month':
        this._viewDate.set(subMonths(d, 1));
        break;
    }
  }

  // Re-fetches for whatever's currently visible — call after a create/
  // update/delete so the grid reflects the change without a full reload.
  refreshEvents() {
    this.loadEvents(this._viewMode(), this._viewDate());
  }

  openEventDetail(eventId: number, originalStart?: string) {
    this._dialogMode.set('view');
    this._selectedEventId.set(eventId);
    this._selectedOriginalStart.set(originalStart ?? null);
  }

  openCreateEvent(range?: { start: Date; end: Date }, allDay = false) {
    this._createRangeStart.set(range?.start ?? null);
    this._createRangeEnd.set(range?.end ?? null);
    this._createAllDay.set(allDay);
    this._dialogMode.set('create');
    this._selectedEventId.set(null);
    this._selectedOriginalStart.set(null);
  }

  closeEventDetail() {
    this._selectedEventId.set(null);
    this._selectedOriginalStart.set(null);
    this._dialogMode.set('view');
    this._createRangeStart.set(null);
    this._createRangeEnd.set(null);
    this._createAllDay.set(false);
  }

  openDayEventsPopup(date: Date, occurrences: CalendarOccurrence[]) {
    this._dayEventsPopupDate.set(date);
    this._dayEventsPopupOccurrences.set(occurrences);
  }

  closeDayEventsPopup() {
    this._dayEventsPopupDate.set(null);
    this._dayEventsPopupOccurrences.set([]);
  }

  // Hands off from the day-events popup to the existing event-detail dialog
  // — same isRecurring/originalStart handling every view's onEventClicked
  // already does when calling openEventDetail directly.
  openEventFromDayPopup(occurrence: CalendarOccurrence) {
    this.closeDayEventsPopup();
    this.openEventDetail(occurrence.id, occurrence.isRecurring ? occurrence.originalStart : undefined);
  }

  private loadEvents(mode: CalendarViewMode, date: Date) {
    const { start, end } = this.visibleRange(mode, date);
    this._eventsLoading.set(true);
    this._eventsError.set('');
    this.eventService.getEventsBetween(start.toISOString(), end.toISOString(), { limit: 200 }).subscribe({
      next: (res) => {
        this._events.set(res.events);
        this._eventsLoading.set(false);
      },
      error: (err) => {
        this._eventsError.set(err.error?.message || 'Failed to load events');
        this._eventsLoading.set(false);
      },
    });
  }

  private visibleRange(mode: CalendarViewMode, date: Date): { start: Date; end: Date } {
    switch (mode) {
      case 'day':
        return { start: startOfDay(date), end: endOfDay(date) };
      case 'week':
        return { start: startOfWeek(date), end: endOfWeek(date) };
      default: {
        // Include the leading/trailing padding days from adjacent months
        // that mwl-calendar-month-view's 6-week grid actually renders.
        return { start: startOfWeek(startOfMonth(date)), end: endOfWeek(endOfMonth(date)) };
      }
    }
  }

  private toMwlEvent(event: CalendarOccurrence): MwlCalendarEvent {
    const primary = resolveEventColor(event);
    return {
      // One recurring master can now produce many occurrences in the same
      // response — angular-calendar needs a unique id per grid item, not
      // just per underlying event, so this composes the master id with the
      // slot it occupies.
      id: `${event.id}:${event.originalStart}`,
      start: new Date(event.start),
      end: new Date(event.end),
      title: event.title,
      allDay: event.allDay,
      color: { primary, secondary: `${primary}22` },
      meta: event,
    };
  }
}
