import { Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { CalendarModule } from 'angular-calendar';
import { format, parseISO } from 'date-fns';
import { CalendarStateService, CalendarViewMode } from '../../core/services/calendar-state.service';
import { CalendarService } from '../../core/services/calendar.service';
import { Calendar as UserCalendar } from '../../models/calendar.model';
import { MiniMonthPickerComponent } from '../../shared/mini-month-picker/mini-month-picker.component';
import { EventDetailDialogComponent } from '../../shared/event-detail-dialog/event-detail-dialog.component';
import { CalendarFormComponent, CalendarFormPayload } from '../../shared/calendar-form/calendar-form.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-calendar',
  standalone: true,
  // CalendarModule.forRoot()'s DateAdapter provider lives on the /calendar
  // route's own `providers` (an environment injector, see app.routes.ts) —
  // a component's `providers` array only accepts plain Provider[], not the
  // EnvironmentProviders that importProvidersFrom(forRoot(...)) returns.
  // Just the plain module is imported here for the mwl-calendar-* directives.
  imports: [
    RouterOutlet,
    MiniMonthPickerComponent,
    CalendarModule,
    EventDetailDialogComponent,
    CalendarFormComponent,
    ConfirmDialogComponent,
  ],
  providers: [CalendarStateService],
  templateUrl: './calendar.component.html',
  styleUrl: './calendar.component.css',
})
export class CalendarComponent {
  readonly viewModes: CalendarViewMode[] = ['day', 'week', 'month'];

  // Mobile-only slide-in state for the mini-calendar sidebar — the toggle
  // button that flips this is itself hidden above the responsive breakpoint
  // (see calendar.component.css), so this never becomes true on desktop.
  sidebarOpen = false;

  calendarFormOpen = false;
  calendarFormMode: 'create' | 'edit' = 'create';
  calendarFormInitial: CalendarFormPayload | null = null;
  calendarFormLoading = false;
  calendarFormError = '';
  private editingCalendarId: number | null = null;

  confirmDeleteCalendarOpen = false;
  confirmDeleteCalendarLoading = false;
  private calendarPendingDelete: UserCalendar | null = null;

  constructor(
    public state: CalendarStateService,
    public calendarService: CalendarService,
    private router: Router
  ) {}

  get selectedDateIso(): string {
    return format(this.state.viewDate(), 'yyyy-MM-dd');
  }

  setView(mode: CalendarViewMode) {
    this.router.navigate(['/calendar', mode]);
    this.sidebarOpen = false;
  }

  onDateSelected(iso: string) {
    this.state.setViewDate(parseISO(iso));
    this.sidebarOpen = false;
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }

  viewLabel(mode: CalendarViewMode): string {
    return mode[0].toUpperCase() + mode.slice(1);
  }

  openCreateEvent() {
    this.state.openCreateEvent();
  }

  toggleCalendarEnabled(cal: UserCalendar) {
    this.calendarService.updateCalendar(cal.id, { isEnabled: !cal.isEnabled }).subscribe({
      next: () => this.calendarService.refreshCalendars().subscribe(),
    });
  }

  openCreateCalendar() {
    this.editingCalendarId = null;
    this.calendarFormMode = 'create';
    this.calendarFormInitial = null;
    this.calendarFormError = '';
    this.calendarFormOpen = true;
  }

  openEditCalendar(cal: UserCalendar) {
    this.editingCalendarId = cal.id;
    this.calendarFormMode = 'edit';
    this.calendarFormInitial = { name: cal.name, color: cal.color };
    this.calendarFormError = '';
    this.calendarFormOpen = true;
  }

  closeCalendarForm() {
    this.calendarFormOpen = false;
  }

  submitCalendarForm(payload: CalendarFormPayload) {
    this.calendarFormLoading = true;
    this.calendarFormError = '';
    const request = this.editingCalendarId
      ? this.calendarService.updateCalendar(this.editingCalendarId, payload)
      : this.calendarService.createCalendar(payload);

    request.subscribe({
      next: () => {
        this.calendarFormLoading = false;
        this.calendarFormOpen = false;
        this.calendarService.refreshCalendars().subscribe();
      },
      error: (err) => {
        this.calendarFormLoading = false;
        this.calendarFormError = err.error?.message || 'Failed to save calendar';
      },
    });
  }

  confirmDeleteCalendar(cal: UserCalendar) {
    this.calendarPendingDelete = cal;
    this.confirmDeleteCalendarOpen = true;
  }

  cancelDeleteCalendar() {
    this.confirmDeleteCalendarOpen = false;
    this.calendarPendingDelete = null;
  }

  get calendarDeleteMessage(): string {
    const cal = this.calendarPendingDelete;
    if (!cal) return '';
    return cal.eventsCount
      ? `Delete "${cal.name}"? This also deletes its ${cal.eventsCount} event(s).`
      : `Delete "${cal.name}"?`;
  }

  deleteCalendar() {
    if (!this.calendarPendingDelete) return;
    this.confirmDeleteCalendarLoading = true;
    this.calendarService.deleteCalendar(this.calendarPendingDelete.id).subscribe({
      next: () => {
        this.confirmDeleteCalendarLoading = false;
        this.confirmDeleteCalendarOpen = false;
        this.calendarPendingDelete = null;
        this.calendarService.refreshCalendars().subscribe();
        this.state.refreshEvents();
      },
      error: () => {
        this.confirmDeleteCalendarLoading = false;
      },
    });
  }
}
