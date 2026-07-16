import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

type RegisterMode = 'individual' | 'business';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css',
})
export class RegisterComponent {
  mode: RegisterMode = 'individual';
  form: FormGroup;
  businessForm: FormGroup;
  error = '';
  loading = false;
  successMessage = '';

  readonly roles = ['Manager', 'Team Lead', 'User'];

  constructor(private fb: FormBuilder, private auth: AuthService, private router: Router) {
    this.form = this.fb.group({
      username: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      role: ['User', Validators.required],
      referenceEmail: ['', Validators.email],
    });

    this.businessForm = this.fb.group({
      username: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      organizationName: ['', Validators.required],
      emailDomain: ['', Validators.required],
      managerEmail: ['', Validators.email],
      teamLeadEmail: ['', Validators.email],
    });
  }

  setMode(mode: RegisterMode) {
    this.mode = mode;
    this.error = '';
  }

  get selectedRole() { return this.form.get('role')?.value; }
  get selectedRoleLabel() { return this.form.get('role')?.value || 'Select Role'; }

  get referenceLabel() {
    return this.selectedRole === 'Team Lead' ? 'Manager Email' : 'Team Lead Email';
  }

  get showReferenceEmail() {
    return this.selectedRole === 'Team Lead' || this.selectedRole === 'User';
  }

  selectRole(role: string) {
    this.form.get('role')?.setValue(role);
    this.form.get('referenceEmail')?.setValue('');
  }

  submit() {
    if (this.mode === 'business') return this.submitBusiness();

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

  get managerTeamLeadSame(): boolean {
    const managerEmail = (this.businessForm.get('managerEmail')?.value || '').trim().toLowerCase();
    const teamLeadEmail = (this.businessForm.get('teamLeadEmail')?.value || '').trim().toLowerCase();
    return !!managerEmail && managerEmail === teamLeadEmail;
  }

  submitBusiness() {
    if (this.businessForm.invalid || this.managerTeamLeadSame) return;
    this.loading = true;
    this.error = '';

    const { username, email, password, organizationName, emailDomain, managerEmail, teamLeadEmail } =
      this.businessForm.value;
    const payload: any = { username, email, password, organizationName, emailDomain };
    if (managerEmail) payload.managerEmail = managerEmail;
    if (teamLeadEmail) payload.teamLeadEmail = teamLeadEmail;

    this.auth.registerOrganization(payload).subscribe({
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
