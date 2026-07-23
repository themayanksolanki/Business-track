import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { OrganizationService } from '../../core/services/organization.service';
import { InviteTokenInfo } from '../../models/invite.model';

@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './accept-invite.component.html',
  styleUrl: './accept-invite.component.css',
})
export class AcceptInviteComponent implements OnInit {
  private token = '';

  checkingToken = true;
  tokenError = '';
  invite: InviteTokenInfo | null = null;

  form: FormGroup;
  submitLoading = false;
  submitError = '';

  showPassword = false;
  showConfirm = false;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private orgService: OrganizationService,
  ) {
    this.form = this.fb.group({
      username: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required],
    });
  }

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.checkingToken = false;
      this.tokenError = 'This invite link is invalid.';
      return;
    }

    this.orgService.getInviteByToken(this.token).subscribe({
      next: (invite) => {
        this.invite = invite;
        this.form.patchValue({ username: invite.email.split('@')[0] });
        this.checkingToken = false;
      },
      error: (err) => {
        this.tokenError = err.error?.message || 'This invite link is invalid or has expired.';
        this.checkingToken = false;
      },
    });
  }

  submit() {
    if (this.form.invalid) return;
    const { username, password, confirmPassword } = this.form.value;
    if (password !== confirmPassword) {
      this.submitError = 'Passwords do not match.';
      return;
    }

    this.submitLoading = true;
    this.submitError = '';
    this.auth.acceptInvite(this.token, { username: username.trim(), password }).subscribe({
      next: () => this.router.navigateByUrl('/dashboard'),
      error: (err) => {
        this.submitError = err.error?.message || 'Failed to create your account.';
        this.submitLoading = false;
      },
    });
  }
}
