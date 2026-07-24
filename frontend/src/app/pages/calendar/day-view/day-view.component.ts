import { Component, OnInit } from '@angular/core';
import { CalendarModule, CalendarEvent } from 'angular-calendar';
import { CalendarStateService } from '../../../core/services/calendar-state.service';
import { CalendarOccurrence } from '../../../models/event.model';

@Component({
  selector: 'app-calendar-day-view',
  standalone: true,
  imports: [CalendarModule],
  templateUrl: './day-view.component.html',
  styleUrl: './day-view.component.css',
})
export class DayViewComponent implements OnInit {
  constructor(public state: CalendarStateService) {}

  ngOnInit() {
    this.state.setViewMode('day');
  }

  onEventClicked(event: CalendarEvent) {
    const meta = event.meta as CalendarOccurrence;
    this.state.openEventDetail(meta.id, meta.isRecurring ? meta.originalStart : undefined);
  }
}
