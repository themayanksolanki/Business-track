import { Component, OnInit } from '@angular/core';
import { CalendarModule, CalendarEvent } from 'angular-calendar';
import { eachDayOfInterval, endOfDay, endOfWeek, startOfDay, startOfWeek } from 'date-fns';
import { CalendarStateService } from '../../../core/services/calendar-state.service';
import { CalendarOccurrence } from '../../../models/event.model';
import { overlapsRange } from '../../../core/services/calendar-layout.util';
import { EventStrapRowComponent } from '../event-strap-row/event-strap-row.component';

@Component({
  selector: 'app-calendar-week-view',
  standalone: true,
  imports: [CalendarModule, EventStrapRowComponent],
  templateUrl: './week-view.component.html',
  styleUrl: './week-view.component.css',
})
export class WeekViewComponent implements OnInit {
  constructor(public state: CalendarStateService) {}

  ngOnInit() {
    this.state.setViewMode('week');
  }

  get visibleDays(): Date[] {
    const viewDate = this.state.viewDate();
    return eachDayOfInterval({ start: startOfWeek(viewDate), end: endOfWeek(viewDate) });
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
}
