import { Component, OnInit } from '@angular/core';
import { CalendarModule, CalendarEvent } from 'angular-calendar';
import { CalendarStateService } from '../../../core/services/calendar-state.service';
import { CalendarOccurrence } from '../../../models/event.model';

@Component({
  selector: 'app-calendar-week-view',
  standalone: true,
  imports: [CalendarModule],
  templateUrl: './week-view.component.html',
  styleUrl: './week-view.component.css',
})
export class WeekViewComponent implements OnInit {
  constructor(public state: CalendarStateService) {}

  ngOnInit() {
    this.state.setViewMode('week');
  }

  onEventClicked(event: CalendarEvent) {
    const meta = event.meta as CalendarOccurrence;
    this.state.openEventDetail(meta.id, meta.isRecurring ? meta.originalStart : undefined);
  }
}
