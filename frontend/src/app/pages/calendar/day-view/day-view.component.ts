import { Component, OnInit } from '@angular/core';
import { CalendarModule, CalendarEvent } from 'angular-calendar';
import { addHours, endOfDay, startOfDay } from 'date-fns';
import { CalendarStateService } from '../../../core/services/calendar-state.service';
import { CalendarOccurrence } from '../../../models/event.model';
import { overlapsRange } from '../../../core/services/calendar-layout.util';
import { EventStrapRowComponent } from '../event-strap-row/event-strap-row.component';

@Component({
  selector: 'app-calendar-day-view',
  standalone: true,
  imports: [CalendarModule, EventStrapRowComponent],
  templateUrl: './day-view.component.html',
  styleUrl: './day-view.component.css',
})
export class DayViewComponent implements OnInit {
  constructor(public state: CalendarStateService) {}

  ngOnInit() {
    this.state.setViewMode('day');
  }

  get visibleDays(): Date[] {
    return [this.state.viewDate()];
  }

  onEventClicked(event: CalendarEvent) {
    const meta = event.meta as CalendarOccurrence;
    this.state.openEventDetail(meta.id, meta.isRecurring ? meta.originalStart : undefined);
  }

  onStrapEventClicked(occurrence: CalendarOccurrence) {
    this.state.openEventDetail(occurrence.id, occurrence.isRecurring ? occurrence.originalStart : undefined);
  }

  onMoreClicked(day: Date) {
    const dayEvents = this.state.events().filter((e) => overlapsRange(e, startOfDay(day), endOfDay(day)));
    this.state.openDayEventsPopup(day, dayEvents);
  }

  onDayCellClicked(day: Date) {
    this.state.openCreateEvent({ start: startOfDay(day), end: endOfDay(day) }, true);
  }

  // Blank hour-grid cell click — prefill with the exact clicked time rather
  // than the whole day, since this is a timed slot (unlike the all-day
  // strap row above, whose blank-cell click defaults to an all-day event).
  onHourSegmentClicked(segment: { date: Date }) {
    this.state.openCreateEvent({ start: segment.date, end: addHours(segment.date, 1) });
  }
}
