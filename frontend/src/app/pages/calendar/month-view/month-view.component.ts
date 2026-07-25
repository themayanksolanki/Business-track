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

  // Clicking an empty day cell jumps the shared viewDate there without
  // leaving month view (matches how clicking a date in most calendar apps'
  // month grid just re-centers, rather than forcing a switch to day view).
  onDayClicked(day: Date) {
    this.state.setViewDate(day);
  }

  onStrapEventClicked(occurrence: CalendarOccurrence) {
    this.state.openEventDetail(occurrence.id, occurrence.isRecurring ? occurrence.originalStart : undefined);
  }

  onMoreClicked(day: Date) {
    const dayEvents = this.state.events().filter((e) => overlapsRange(e, startOfDay(day), endOfDay(day)));
    this.state.openDayEventsPopup(day, dayEvents);
  }
}
