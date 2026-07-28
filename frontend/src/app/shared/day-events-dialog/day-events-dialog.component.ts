import { Component, EventEmitter, Input, Output } from '@angular/core';
import { format, parseISO } from 'date-fns';
import { ModalDirective } from '../modal.directive';
import { CalendarOccurrence } from '../../models/event.model';
import { resolveEventColor } from '../../core/services/calendar-layout.util';

// Shown when a month/week/day strap row's "+N more" chip is clicked —
// lists every event for that one day and hands off to the existing
// EventDetailDialogComponent when one is picked (see
// CalendarStateService.openEventFromDayPopup).
@Component({
  selector: 'app-day-events-dialog',
  standalone: true,
  imports: [ModalDirective],
  templateUrl: './day-events-dialog.component.html',
  styleUrl: './day-events-dialog.component.css',
})
export class DayEventsDialogComponent {
  @Input() open = false;
  @Input() date: Date | null = null;
  @Input() occurrences: CalendarOccurrence[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() eventClicked = new EventEmitter<CalendarOccurrence>();

  protected readonly resolveEventColor = resolveEventColor;

  get dateLabel(): string {
    return this.date ? format(this.date, 'EEEE, MMMM d, yyyy') : '';
  }

  timeLabel(occurrence: CalendarOccurrence): string {
    if (occurrence.allDay) return 'All day';
    return `${format(parseISO(occurrence.start), 'h:mm a')} – ${format(parseISO(occurrence.end), 'h:mm a')}`;
  }
}
