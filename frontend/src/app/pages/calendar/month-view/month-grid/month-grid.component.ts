import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CalendarOccurrence } from '../../../../models/event.model';
import { chunkIntoWeeks } from '../../../../core/services/calendar-layout.util';
import { EventStrapRowComponent } from '../../event-strap-row/event-strap-row.component';

const MAX_VISIBLE_LANES = 3;

// Custom month grid replacing mwl-calendar-month-view — the library renders
// each day cell independently with no way for an event to visually span
// across cells, so this owns its own day-cell layout instead, with one
// EventStrapRowComponent absolutely positioned over each week row to render
// straps that actually cross day-cell boundaries.
@Component({
  selector: 'app-month-grid',
  standalone: true,
  imports: [EventStrapRowComponent],
  templateUrl: './month-grid.component.html',
  styleUrl: './month-grid.component.css',
})
export class MonthGridComponent implements OnChanges {
  @Input() viewDate: Date = new Date();
  @Input() events: CalendarOccurrence[] = [];

  @Output() dayClicked = new EventEmitter<Date>();
  @Output() eventClicked = new EventEmitter<CalendarOccurrence>();
  @Output() moreClicked = new EventEmitter<Date>();

  weeks: Date[][] = [];
  weekdayLabels: string[] = [];
  readonly maxVisibleLanes = MAX_VISIBLE_LANES;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['viewDate']) {
      const start = startOfWeek(startOfMonth(this.viewDate));
      const end = endOfWeek(endOfMonth(this.viewDate));
      const days = eachDayOfInterval({ start, end });
      this.weeks = chunkIntoWeeks(days);
      this.weekdayLabels = this.weeks[0].map((day) => format(day, 'EEE'));
    }
  }

  isToday(day: Date): boolean {
    return isToday(day);
  }

  isOutOfMonth(day: Date): boolean {
    return !isSameMonth(day, this.viewDate);
  }

  dayNumber(day: Date): string {
    return format(day, 'd');
  }
}
