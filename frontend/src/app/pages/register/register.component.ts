import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Currency, CURRENCY_SYMBOLS, MeasurementUnit, MEASUREMENT_UNIT_SYMBOLS } from '../../models/user.model';

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

// Same option shape/order as Settings > General used to offer per-user —
// now a one-time choice made at signup instead (see Organization.currency).
const CURRENCY_OPTIONS: CurrencyOption[] = [
  { value: 'USD', flag: '🇺🇸', name: 'US Dollar', symbol: CURRENCY_SYMBOLS.USD },
  { value: 'EUR', flag: '🇪🇺', name: 'Euro', symbol: CURRENCY_SYMBOLS.EUR },
  { value: 'JPY', flag: '🇯🇵', name: 'Japanese Yen', symbol: CURRENCY_SYMBOLS.JPY },
  { value: 'GBP', flag: '🇬🇧', name: 'British Pound', symbol: CURRENCY_SYMBOLS.GBP },
  { value: 'CNY', flag: '🇨🇳', name: 'Chinese Yuan', symbol: CURRENCY_SYMBOLS.CNY },
  { value: 'INR', flag: '🇮🇳', name: 'Indian Rupee', symbol: CURRENCY_SYMBOLS.INR },
];

// Same reasoning as CURRENCY_OPTIONS above — see Organization.unit.
const MEASUREMENT_UNIT_OPTIONS: MeasurementUnitOption[] = [
  { value: 'KG', name: 'Kilograms', symbol: MEASUREMENT_UNIT_SYMBOLS.KG },
  { value: 'LB', name: 'Pounds', symbol: MEASUREMENT_UNIT_SYMBOLS.LB },
];

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css',
})
export class RegisterComponent {
  readonly currencyOptions = CURRENCY_OPTIONS;
  readonly measurementUnitOptions = MEASUREMENT_UNIT_OPTIONS;

  form: FormGroup;
  error = '';
  loading = false;

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {
    this.form = this.fb.group({
      username: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      organizationName: ['', Validators.required],
      emailDomain: ['', Validators.required],
      currency: this.fb.control<Currency>('USD', Validators.required),
      unit: this.fb.control<MeasurementUnit>('KG', Validators.required),
    });
  }

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    this.error = '';

    const { username, email, password, organizationName, emailDomain, currency, unit } = this.form.value;

    this.auth.registerOrganization({ username, email, password, organizationName, emailDomain, currency, unit }).subscribe({
      next: () => {
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.error = err.error?.message || 'Registration failed';
        this.loading = false;
      },
    });
  }
}
