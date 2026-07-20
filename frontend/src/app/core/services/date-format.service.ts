import { Injectable } from '@angular/core';
import dayjs from 'dayjs/esm';
import { AuthService } from './auth.service';
import { DateFormat, TimeFormat } from '../../models/user.model';

const DATE_FORMAT_TOKENS: Record<DateFormat, string> = {
  DD_MM_YYYY: 'DD/MM/YYYY',
  MM_DD_YYYY: 'MM/DD/YYYY',
  YYYY_MM_DD: 'YYYY/MM/DD',
  DD_MMM_YY: 'DD/MMM/YY',
};

const TIME_FORMAT_TOKENS: Record<TimeFormat, string> = {
  HOUR_12: 'h:mm A',
  HOUR_24: 'HH:mm',
};

// Central place every date/time display in the app should route through, so
// Settings > General's format choice is reflected everywhere at once instead
// of each component picking its own format string.
@Injectable({ providedIn: 'root' })
export class DateFormatService {
  constructor(private auth: AuthService) {}

  // Public so callers with a bare (non-ISO) value dayjs can't parse without
  // an explicit input format — e.g. time-picker's 'HH:mm', date-picker's
  // 'YYYY-MM-DD' — can do `dayjs(value, inputFormat).format(dateFormatSvc.dateToken)`
  // themselves instead of going through formatDate()/formatTime() below.
  get dateToken(): string {
    return DATE_FORMAT_TOKENS[this.auth.currentUser()?.dateFormat ?? 'MM_DD_YYYY'];
  }

  get timeToken(): string {
    return TIME_FORMAT_TOKENS[this.auth.currentUser()?.timeFormat ?? 'HOUR_12'];
  }

  formatDate(value: string | Date | null | undefined): string {
    if (!value) return '';
    const d = dayjs(value);
    return d.isValid() ? d.format(this.dateToken) : '';
  }

  formatTime(value: string | Date | null | undefined): string {
    if (!value) return '';
    const d = dayjs(value);
    return d.isValid() ? d.format(this.timeToken) : '';
  }

  formatDateTime(value: string | Date | null | undefined): string {
    if (!value) return '';
    const d = dayjs(value);
    return d.isValid() ? d.format(`${this.dateToken} ${this.timeToken}`) : '';
  }

  // Renders "today"/"now" in a given format — used by the Settings > General
  // preview so a user can see exactly what each option looks like before
  // picking it.
  exampleDate(format: DateFormat): string {
    return dayjs().format(DATE_FORMAT_TOKENS[format]);
  }

  exampleTime(format: TimeFormat): string {
    return dayjs().format(TIME_FORMAT_TOKENS[format]);
  }
}
