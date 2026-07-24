import { Component } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import {
  DateFormat,
  TimeFormat,
  LandingPage,
  Currency,
  MeasurementUnit,
  CURRENCY_SYMBOLS,
  MEASUREMENT_UNIT_SYMBOLS,
} from '../../../models/user.model';
import { IconComponent, IconName } from '../../../shared/icon/icon.component';

interface DateFormatOption {
  value: DateFormat;
  label: string;
}

interface TimeFormatOption {
  value: TimeFormat;
  label: string;
}

interface CurrencyOption {
  value: Currency;
  flag: string;
  name: string;
  symbol: string;
}

interface MeasurementUnitOption {
  value: MeasurementUnit;
  name: string;
  symbol: string;
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

  readonly currencies: CurrencyOption[] = [
    { value: 'USD', flag: '🇺🇸', name: 'US Dollar', symbol: CURRENCY_SYMBOLS.USD },
    { value: 'EUR', flag: '🇪🇺', name: 'Euro', symbol: CURRENCY_SYMBOLS.EUR },
    { value: 'JPY', flag: '🇯🇵', name: 'Japanese Yen', symbol: CURRENCY_SYMBOLS.JPY },
    { value: 'GBP', flag: '🇬🇧', name: 'British Pound', symbol: CURRENCY_SYMBOLS.GBP },
    { value: 'CNY', flag: '🇨🇳', name: 'Chinese Yuan', symbol: CURRENCY_SYMBOLS.CNY },
    { value: 'INR', flag: '🇮🇳', name: 'Indian Rupee', symbol: CURRENCY_SYMBOLS.INR },
  ];

  readonly measurementUnits: MeasurementUnitOption[] = [
    { value: 'KG', name: 'Kilograms', symbol: MEASUREMENT_UNIT_SYMBOLS.KG },
    { value: 'LB', name: 'Pounds', symbol: MEASUREMENT_UNIT_SYMBOLS.LB },
    { value: 'LTR', name: 'Liters', symbol: MEASUREMENT_UNIT_SYMBOLS.LTR },
  ];

  // 0-7 — matches the backend's validated range (validate.ts).
  readonly decimalPointsOptions: number[] = [0, 1, 2, 3, 4, 5, 6, 7];
  private readonly decimalExampleValue = 1234.56789123;

  get landingPages(): LandingPageOption[] {
    const role = this.auth.currentUser()?.role;
    return LANDING_PAGE_OPTIONS.filter((opt) => !opt.roles || (role && opt.roles.includes(role)));
  }

  savingDateFormat: DateFormat | null = null;
  savingTimeFormat: TimeFormat | null = null;
  savingLandingPage: LandingPage | null = null;
  savingCurrency: Currency | null = null;
  savingUnit: MeasurementUnit | null = null;
  savingDecimalPoints: number | null = null;
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

  exampleDecimal(points: number): string {
    return this.decimalExampleValue.toFixed(points);
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

  selectCurrency(currency: Currency) {
    if (this.savingCurrency || currency === this.auth.currentUser()?.currency) return;
    this.error = '';
    this.savingCurrency = currency;
    this.auth.updateProfile({ currency }).subscribe({
      next: () => (this.savingCurrency = null),
      error: (err) => {
        this.error = err.error?.message || 'Failed to save currency';
        this.savingCurrency = null;
      },
    });
  }

  selectUnit(unit: MeasurementUnit) {
    if (this.savingUnit || unit === this.auth.currentUser()?.unit) return;
    this.error = '';
    this.savingUnit = unit;
    this.auth.updateProfile({ unit }).subscribe({
      next: () => (this.savingUnit = null),
      error: (err) => {
        this.error = err.error?.message || 'Failed to save unit';
        this.savingUnit = null;
      },
    });
  }

  selectDecimalPoints(points: number) {
    if (this.savingDecimalPoints !== null || points === this.auth.currentUser()?.decimalPoints) return;
    this.error = '';
    this.savingDecimalPoints = points;
    this.auth.updateProfile({ decimalPoints: points }).subscribe({
      next: () => (this.savingDecimalPoints = null),
      error: (err) => {
        this.error = err.error?.message || 'Failed to save decimal points';
        this.savingDecimalPoints = null;
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
