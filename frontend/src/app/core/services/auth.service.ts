import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthResponse, User } from '../../models/user.model';

export interface RegisterResponse {
  message: string;
  pending?: boolean;
  token?: string;
  user?: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = `${environment.apiUrl}/auth`;
  private readonly USER_KEY = 'user';
  private readonly CREDS = { withCredentials: true };

  private accessToken = signal<string | null>(null);
  currentUser = signal<User | null>(this.loadUser());

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  register(payload: {
    username: string;
    email: string;
    password: string;
    role: string;
    referenceEmail?: string;
  }) {
    return this.http
      .post<RegisterResponse>(`${this.api}/register`, payload, this.CREDS)
      .pipe(
        tap((res) => {
          if (res.token && res.user) this.persist(res as AuthResponse);
        }),
      );
  }

  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>(`${this.api}/login`, { email, password }, this.CREDS)
      .pipe(tap((res) => this.persist(res)));
  }

  refresh() {
    return this.http
      .post<AuthResponse>(`${this.api}/refresh`, {}, this.CREDS)
      .pipe(tap((res) => this.persist(res)));
  }

  getMe() {
    return this.http.get<User>(`${this.api}/me`);
  }

  logout() {
    this.http.post(`${this.api}/logout`, {}, this.CREDS).subscribe({
      complete: () => this.clearSession(),
      error: () => this.clearSession(),
    });
  }

  isLoggedIn(): boolean {
    return !!this.accessToken();
  }

  getToken(): string | null {
    return this.accessToken();
  }

  getUser(): User | null {
    return this.currentUser();
  }

  private persist(res: AuthResponse) {
    this.accessToken.set(res.token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(res.user));
    this.currentUser.set(res.user);
  }

  clearSession() {
    this.accessToken.set(null);
    localStorage.removeItem(this.USER_KEY);
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }

  private loadUser(): User | null {
    const raw = localStorage.getItem(this.USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
}
