import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthResponse, User, DateFormat, TimeFormat, LandingPage } from '../../models/user.model';
import { SHOW_LOADER } from '../interceptors/loading.interceptor';

const BASE_URL = environment.apiUrl.replace('/api', '');

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = `${environment.apiUrl}/auth`;
  private readonly USER_KEY = 'user';
  private readonly REFRESH_KEY = 'refreshToken';
  private readonly CREDS = { withCredentials: true };
  // Login/logout are the two auth actions that route through the global
  // loader overlay directly (see loading.interceptor.ts) rather than relying
  // on the navigation-driven loader, so the overlay appears immediately on
  // submit instead of waiting for the post-auth route change.
  private readonly LOADER_CREDS = { withCredentials: true, context: new HttpContext().set(SHOW_LOADER, true) };

  private accessToken = signal<string | null>(null);
  currentUser = signal<User | null>(this.loadUser());

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  registerOrganization(payload: {
    username: string;
    email: string;
    password: string;
    organizationName: string;
    emailDomain: string;
  }) {
    return this.http
      .post<AuthResponse>(`${this.api}/register-organization`, payload, this.CREDS)
      .pipe(tap((res) => this.persist(res)));
  }

  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>(`${this.api}/login`, { email, password }, this.LOADER_CREDS)
      .pipe(tap((res) => this.persist(res)));
  }

  refresh() {
    const refreshToken = this.getRefreshToken();
    return this.http
      .post<AuthResponse>(`${this.api}/refresh`, { refreshToken }, this.CREDS)
      .pipe(tap((res) => this.persist(res)));
  }

  getMe() {
    return this.http.get<User>(`${this.api}/me`);
  }

  // Fire-and-forget — called as soon as the login page mounts so a
  // free-tier Postgres provider that's gone idle (e.g. Supabase auto-pause)
  // has a head start waking up while the user is still typing their
  // credentials, instead of only starting once they submit the form.
  warmDb() {
    return this.http.get<{ status: string }>(`${BASE_URL}/health/db`);
  }

  avatarUrl(user?: User | null): string | null {
    const img = (user ?? this.currentUser())?.profileImage;
    if (!img) return null;
    if (img.startsWith('http')) return img; // Cloudinary URL — use as-is
    return `${BASE_URL}/uploads/avatars/${img}`; // legacy filename
  }

  uploadAvatar(file: File) {
    const form = new FormData();
    form.append('avatar', file);
    return this.http
      .patch<{ message: string; user: User }>(`${this.api}/me/avatar`, form)
      .pipe(tap((res) => this.refreshUser(res.user)));
  }

  // All fields optional/independent — the Profile page's phone editor and
  // Settings > General's date/time-format/landing-page pickers each send
  // only the fields they own, so one never clobbers another's saved value.
  updateProfile(payload: {
    phoneCountry?: string | null;
    phoneNumber?: string | null;
    dateFormat?: DateFormat;
    timeFormat?: TimeFormat;
    defaultLandingPage?: LandingPage;
  }) {
    return this.http
      .patch<{ message: string; user: User }>(`${this.api}/me`, payload)
      .pipe(tap((res) => this.refreshUser(res.user)));
  }

  // Public — the invitee sets their own username/password from the emailed
  // accept-invite link. Lives here (not OrganizationService) because a
  // successful accept establishes a session, same as register()/login().
  acceptInvite(token: string, payload: { username: string; password: string }) {
    return this.http
      .post<AuthResponse>(
        `${environment.apiUrl}/organizations/invites/token/${token}/accept`,
        payload,
        this.CREDS
      )
      .pipe(tap((res) => this.persist(res)));
  }

  forgotPassword(email: string) {
    return this.http.post<{ message: string }>(`${this.api}/forgot-password`, { email });
  }

  resetPassword(email: string, otp: string, newPassword: string) {
    return this.http.post<{ message: string }>(`${this.api}/reset-password`, { email, otp, newPassword });
  }

  removeAvatar() {
    return this.http
      .delete<{ message: string; user: User }>(`${this.api}/me/avatar`)
      .pipe(tap((res) => this.refreshUser(res.user)));
  }

  private refreshUser(user: User) {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }

  logout() {
    this.http.post(`${this.api}/logout`, {}, this.LOADER_CREDS).subscribe({
      complete: () => this.clearSession(),
      error: () => this.clearSession(),
    });
  }

  hasLocalSession(): boolean {
    return !!localStorage.getItem(this.USER_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.accessToken();
  }

  getToken(): string | null {
    return this.accessToken();
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_KEY);
  }

  getUser(): User | null {
    return this.currentUser();
  }

  private persist(res: AuthResponse) {
    this.accessToken.set(res.token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(res.user));
    if (res.refreshToken) localStorage.setItem(this.REFRESH_KEY, res.refreshToken);
    this.currentUser.set(res.user);
  }

  clearSession() {
    this.accessToken.set(null);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.REFRESH_KEY);
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }

  clearSessionSilent() {
    this.accessToken.set(null);
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.REFRESH_KEY);
    this.currentUser.set(null);
  }

  private loadUser(): User | null {
    const raw = localStorage.getItem(this.USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
}
