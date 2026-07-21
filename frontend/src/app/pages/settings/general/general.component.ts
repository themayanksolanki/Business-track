import { Component } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { DateFormat, TimeFormat } from '../../../models/user.model';

interface DateFormatOption {
  value: DateFormat;
  label: string;
}

interface TimeFormatOption {
  value: TimeFormat;
  label: string;
}

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [],
  templateUrl: './general.component.html',
  styleUrl: './general.component.css',
})
export class GeneralSettingsComponent {
  readonly dateFormats: DateFormatOption[] = [
    { value: 'DD_MM_YYYY', label: 'DD/MM/YYYY' },
    { value: 'MM_DD_YYYY', label: 'MM/DD/YYYY' },
    { value: 'YYYY_MM_DD', label: 'YYYY/MM/DD' },
    { value: 'DD_MMM_YY', label: 'DD/MMM/YY' },
  ];

  readonly timeFormats: TimeFormatOption[] = [
    { value: 'HOUR_12', label: '12-hour' },
    { value: 'HOUR_24', label: '24-hour' },
  ];

  savingDateFormat: DateFormat | null = null;
  savingTimeFormat: TimeFormat | null = null;
  error = '';

  constructor(
    public auth: AuthService,
    public dateFormatSvc: DateFormatService,
  ) {}

  exampleDate(format: DateFormat): string {
    return this.dateFormatSvc.exampleDate(format);
  }

  exampleTime(format: TimeFormat): string {
    return this.dateFormatSvc.exampleTime(format);
  }

  selectDateFormat(format: DateFormat) {
    if (this.savingDateFormat || format === this.auth.currentUser()?.dateFormat) return;
    this.error = '';
    this.savingDateFormat = format;
    this.auth.updateProfile({ dateFormat: format }).subscribe({
      next: () => (this.savingDateFormat = null),
      error: (err) => {
        this.error = err.error?.message || 'Failed to save date format';
        this.savingDateFormat = null;
      },
    });
  }

  selectTimeFormat(format: TimeFormat) {
    if (this.savingTimeFormat || format === this.auth.currentUser()?.timeFormat) return;
    this.error = '';
    this.savingTimeFormat = format;
    this.auth.updateProfile({ timeFormat: format }).subscribe({
      next: () => (this.savingTimeFormat = null),
      error: (err) => {
        this.error = err.error?.message || 'Failed to save time format';
        this.savingTimeFormat = null;
      },
    });
  }
}
