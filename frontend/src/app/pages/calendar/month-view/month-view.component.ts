import { Component, OnInit } from '@angular/core';
import { endOfDay, startOfDay } from 'date-fns';
import { CalendarStateService } from '../../../core/services/calendar-state.service';
import { CalendarOccurrence } from '../../../models/event.model';
import { overlapsRange } from '../../../core/services/calendar-layout.util';
import { MonthGridComponent } from './month-grid/month-grid.component';

@Component({
  selector: 'app-calendar-month-view',
  standalone: true,
  imports: [MonthGridComponent],
  templateUrl: './month-view.component.html',
  styleUrl: './month-view.component.css',
})
export class MonthViewComponent implements OnInit {
  constructor(public state: CalendarStateService) {}

  ngOnInit() {
    this.state.setViewMode('month');
  }

  // Clicking an empty day cell opens the create-event popup for that day,
  // defaulting to an all-day event since the click carries no time-of-day.
  onDayClicked(day: Date) {
    this.state.openCreateEvent({ start: startOfDay(day), end: endOfDay(day) }, true);
  }

  onStrapEventClicked(occurrence: CalendarOccurrence) {
    this.state.openEventDetail(occurrence.id, occurrence.isRecurring ? occurrence.originalStart : undefined);
  }

  onMoreClicked(day: Date) {
    const dayEvents = this.state.events().filter((e) => overlapsRange(e, startOfDay(day), endOfDay(day)));
    this.state.openDayEventsPopup(day, dayEvents);
  }
}
