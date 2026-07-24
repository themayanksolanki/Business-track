import { Component, OnInit } from '@angular/core';
import { CalendarModule, CalendarEvent } from 'angular-calendar';
import { CalendarStateService } from '../../../core/services/calendar-state.service';
import { CalendarOccurrence } from '../../../models/event.model';

@Component({
  selector: 'app-calendar-month-view',
  standalone: true,
  imports: [CalendarModule],
  templateUrl: './month-view.component.html',
  styleUrl: './month-view.component.css',
})
export class MonthViewComponent implements OnInit {
  constructor(public state: CalendarStateService) {}

  ngOnInit() {
    this.state.setViewMode('month');
  }

  // mwl-calendar-month-view emits this when a day cell is clicked — jump the
  // shared viewDate there without leaving month view (matches how clicking a
  // date in most calendar apps' month grid just re-centers, rather than
  // forcing a switch to day view).
  onDayClicked(day: { date: Date }) {
    this.state.setViewDate(day.date);
  }

  onEventClicked(event: CalendarEvent) {
    const meta = event.meta as CalendarOccurrence;
    this.state.openEventDetail(meta.id, meta.isRecurring ? meta.originalStart : undefined);
  }
}
