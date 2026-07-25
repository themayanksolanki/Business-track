import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CalendarOccurrence } from '../../../models/event.model';
import { formatStrapLabel, layoutRow, resolveEventColor, RowLayout } from '../../../core/services/calendar-layout.util';

const EMPTY_LAYOUT: RowLayout = { visibleLanes: 0, placements: [], hiddenCountByDay: [], hasOverflow: false };

// Renders one row of Teamup-style "strap" bars for a contiguous span of
// days — reused once per week-row in the custom month grid, and once above
// the hourly time-grid in week/day view for their all-day/multi-day events.
// The row itself is normal block flow; callers that need it to visually
// overlay a day-cell grid (month view) wrap it in their own absolutely-
// positioned container rather than this component doing so itself, so the
// same component works both overlaid (month) and in-flow (week/day).
@Component({
  selector: 'app-event-strap-row',
  standalone: true,
  imports: [],
  templateUrl: './event-strap-row.component.html',
  styleUrl: './event-strap-row.component.css',
})
export class EventStrapRowComponent implements OnChanges {
  @Input() days: Date[] = [];
  @Input() events: CalendarOccurrence[] = [];
  // Different contexts have different vertical budgets — month grid rows
  // are compact (6 rows must fit on screen), week/day's single strap row
  // has more room — so callers pass their own value rather than relying on
  // one shared default.
  @Input() maxVisibleLanes = 3;

  @Output() eventClicked = new EventEmitter<CalendarOccurrence>();
  // Emits just the day — the caller re-derives that day's full event list
  // from its own already-loaded events, keeping the popup's contract
  // simple ("show everything for this day") regardless of which lane the
  // click landed in.
  @Output() moreClicked = new EventEmitter<Date>();

  rowLayout: RowLayout = EMPTY_LAYOUT;

  protected readonly resolveEventColor = resolveEventColor;
  protected readonly formatStrapLabel = formatStrapLabel;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['days'] || changes['events'] || changes['maxVisibleLanes']) {
      this.rowLayout = layoutRow(this.days, this.events, this.maxVisibleLanes);
    }
  }

  trackByPlacement(_index: number, placement: RowLayout['placements'][number]): string {
    return `${placement.event.id}:${placement.event.originalStart}`;
  }
}
