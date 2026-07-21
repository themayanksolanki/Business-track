import { Pipe, PipeTransform } from '@angular/core';
import { DateFormatService } from '../../core/services/date-format.service';

// Impure — must re-run when the user's date-format preference changes, not
// just when the bound date value changes by reference.
@Pipe({ name: 'appDate', standalone: true, pure: false })
export class AppDatePipe implements PipeTransform {
  constructor(private dateFormat: DateFormatService) {}

  transform(value: string | Date | null | undefined): string {
    return this.dateFormat.formatDate(value);
  }
}
