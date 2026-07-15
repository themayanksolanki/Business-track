import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css',
})
export class RegisterComponent {
  form: FormGroup;
  error = '';
  loading = false;
  successMessage = '';

  readonly roles = ['Manager', 'Team Lead', 'Employee'];

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {
    this.form = this.fb.group({
      username: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      role: ['Employee', Validators.required],
      referenceEmail: ['', Validators.email],
    });
  }

  get selectedRole() { return this.form.get('role')?.value; }
  get selectedRoleLabel() { return this.form.get('role')?.value || 'Select Role'; }

  get referenceLabel() {
    return this.selectedRole === 'Team Lead' ? 'Manager Email' : 'Team Lead Email';
  }

  get showReferenceEmail() {
    return this.selectedRole === 'Team Lead' || this.selectedRole === 'Employee';
  }

  selectRole(role: string) {
    this.form.get('role')?.setValue(role);
    this.form.get('referenceEmail')?.setValue('');
  }

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    this.error = '';
    this.successMessage = '';

    const { username, email, password, role, referenceEmail } = this.form.value;
    const payload: any = { username, email, password, role };
    if (referenceEmail) payload.referenceEmail = referenceEmail;

    this.auth.register(payload).subscribe({
      next: (res) => {
        if (res.pending) {
          this.successMessage = res.message;
          this.loading = false;
        } else {
          this.router.navigate(['/dashboard']);
        }
      },
      error: (err) => {
        this.error = err.error?.message || 'Registration failed';
        this.loading = false;
      },
    });
  }
}
