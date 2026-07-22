import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit {
  form: FormGroup;
  error = '';
  loading = false;
  showPassword = false;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
    });
  }

  ngOnInit() {
    // Best-effort — a slow/failed warm-up must never block or surface an
    // error on the login form itself.
    this.auth.warmDb().subscribe({ error: () => {} });
  }

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    this.error = '';

    const { email, password } = this.form.value;
    // e.g. a shared project link (authGuard attaches this before bouncing an
    // unauthenticated visitor here) — land them back where they meant to go.
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    this.auth.login(email, password).subscribe({
      next: () => {
        const landing = this.auth.getUser()?.defaultLandingPage || 'dashboard';
        this.router.navigateByUrl(returnUrl || `/${landing}`);
      },
      error: (err) => {
        this.error = err.error?.message || 'Login failed';
        this.loading = false;
      },
    });
  }
}
