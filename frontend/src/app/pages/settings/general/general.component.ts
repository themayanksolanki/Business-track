import { Component } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { DateFormat, TimeFormat, LandingPage } from '../../../models/user.model';
import { IconComponent, IconName } from '../../../shared/icon/icon.component';

interface DateFormatOption {
  value: DateFormat;
  label: string;
}

interface TimeFormatOption {
  value: TimeFormat;
  label: string;
}

interface LandingPageOption {
  value: LandingPage;
  label: string;
  icon: IconName;
  // Matches the role gates on the routes themselves (app.routes.ts) —
  // omitted means every role can pick it.
  roles?: string[];
}

const LANDING_PAGE_OPTIONS: LandingPageOption[] = [
  { value: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { value: 'tasks', label: 'My Tasks', icon: 'tasks' },
  { value: 'projects', label: 'Projects', icon: 'projects' },
  { value: 'drafts', label: 'Drafts', icon: 'draft' },
  { value: 'chat', label: 'Chat', icon: 'chat' },
  { value: 'users', label: 'Users', icon: 'users', roles: ['Admin', 'Manager'] },
  { value: 'organization', label: 'Organization', icon: 'building', roles: ['Admin', 'Manager'] },
];

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [IconComponent],
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

  get landingPages(): LandingPageOption[] {
    const role = this.auth.currentUser()?.role;
    return LANDING_PAGE_OPTIONS.filter((opt) => !opt.roles || (role && opt.roles.includes(role)));
  }

  savingDateFormat: DateFormat | null = null;
  savingTimeFormat: TimeFormat | null = null;
  savingLandingPage: LandingPage | null = null;
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

  selectLandingPage(page: LandingPage) {
    if (this.savingLandingPage || page === this.auth.currentUser()?.defaultLandingPage) return;
    this.error = '';
    this.savingLandingPage = page;
    this.auth.updateProfile({ defaultLandingPage: page }).subscribe({
      next: () => (this.savingLandingPage = null),
      error: (err) => {
        this.error = err.error?.message || 'Failed to save default landing page';
        this.savingLandingPage = null;
      },
    });
  }
}
