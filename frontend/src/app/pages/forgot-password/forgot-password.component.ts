import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.css',
})
export class ForgotPasswordComponent {
  step: 'email' | 'reset' = 'email';

  emailForm: FormGroup;
  resetForm: FormGroup;

  emailLoading = false;
  emailError = '';
  emailSuccess = '';

  resetLoading = false;
  resetError = '';
  resetSuccess = '';

  showPassword = false;
  showConfirm = false;

  private sentToEmail = '';

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
  ) {
    this.emailForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });

    this.resetForm = this.fb.group({
      otp: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required],
    });
  }

  submitEmail() {
    if (this.emailForm.invalid) return;
    this.emailLoading = true;
    this.emailError = '';
    this.emailSuccess = '';

    const email = this.emailForm.value.email;
    this.auth.forgotPassword(email).subscribe({
      next: (res) => {
        this.sentToEmail = email;
        this.emailSuccess = res.message;
        this.emailLoading = false;
        setTimeout(() => { this.step = 'reset'; }, 800);
      },
      error: (err) => {
        this.emailError = err.error?.message || 'Failed to send OTP. Please try again.';
        this.emailLoading = false;
      },
    });
  }

  submitReset() {
    if (this.resetForm.invalid) return;
    const { otp, newPassword, confirmPassword } = this.resetForm.value;
    if (newPassword !== confirmPassword) {
      this.resetError = 'Passwords do not match.';
      return;
    }
    this.resetLoading = true;
    this.resetError = '';

    this.auth.resetPassword(this.sentToEmail, otp, newPassword).subscribe({
      next: (res) => {
        this.resetSuccess = res.message;
        this.resetLoading = false;
        setTimeout(() => this.router.navigate(['/login']), 2000);
      },
      error: (err) => {
        this.resetError = err.error?.message || 'Failed to reset password.';
        this.resetLoading = false;
      },
    });
  }

  resendOtp() {
    if (!this.sentToEmail) return;
    this.resetError = '';
    this.auth.forgotPassword(this.sentToEmail).subscribe({
      next: () => { this.resetError = ''; },
      error: (err) => { this.resetError = err.error?.message || 'Failed to resend OTP.'; },
    });
  }

  get maskedEmail(): string {
    if (!this.sentToEmail) return '';
    const [local, domain] = this.sentToEmail.split('@');
    return local.slice(0, 2) + '****@' + domain;
  }
}
