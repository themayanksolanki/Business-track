import { Pipe, PipeTransform } from '@angular/core';
import { DateFormatService } from '../../core/services/date-format.service';

// Impure — must re-run when the user's time-format preference changes, not
// just when the bound date value changes by reference.
@Pipe({ name: 'appTime', standalone: true, pure: false })
export class AppTimePipe implements PipeTransform {
  constructor(private dateFormat: DateFormatService) {}

  transform(value: string | Date | null | undefined): string {
    return this.dateFormat.formatTime(value);
  }
}
