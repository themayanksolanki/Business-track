import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User, PaginatedUsers, UpdateUserPayload, ReassignableWork } from '../../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly api = `${environment.apiUrl}/users`;

  // Org-wide user list, shared across every dropdown/picker that used to
  // call getAllUsers() independently (owner/leader pickers, assignee
  // dropdowns, etc.) — loaded once per session and reused, instead of one
  // network round-trip per component. Mirrors ChatService's contacts cache.
  private readonly _users = signal<User[]>([]);
  readonly users = this._users.asReadonly();
  private loaded = false;

  private readonly usersById = computed(() => new Map(this._users().map((u) => [u.id, u])));

  constructor(private http: HttpClient) {}

  getAllUsers() {
    return this.http.get<User[]>(this.api);
  }

  // Lazy shared load — only hits the network the first time any consumer
  // calls this in a session; later calls are no-ops and just read the
  // already-cached signal.
  ensureUsersLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    this.getAllUsers().subscribe({
      next: (users) => this._users.set(users),
      error: () => (this.loaded = false), // allow retry on the next call
    });
  }

  // Forces a fresh fetch and updates the shared cache — call after any
  // mutation that changes the org's user roster or a displayed field
  // (activate, an invite being accepted into a new user, department
  // reassignment, etc.) so every other consumer reading `users`/`nameFor`
  // picks up the change without a full page reload. Returns the Observable
  // so a caller that needs its own loading state (e.g. a spinner) can
  // subscribe directly instead of firing-and-forgetting.
  refreshUsers() {
    return this.getAllUsers().pipe(
      tap((users) => {
        this._users.set(users);
        this.loaded = true;
      })
    );
  }

  nameFor(id: number | null | undefined): string {
    if (id == null) return '—';
    return this.usersById().get(id)?.username ?? '—';
  }

  getUsersPage(page: number, limit: number) {
    return this.http.get<PaginatedUsers>(this.api, { params: { page, limit } });
  }

  getTeamLeads() {
    return this.http.get<User[]>(`${this.api}/team-leads`);
  }

  getTeamMembers() {
    return this.http.get<User[]>(`${this.api}/team-members`);
  }

  getPendingUsers() {
    return this.http.get<User[]>(`${this.api}/pending`);
  }

  activateUser(id: number) {
    return this.http.patch<{ message: string; user: User }>(`${this.api}/${id}/activate`, {});
  }

  // Deactivating with no reassignToId (nothing to reassign) is synchronous —
  // `user` comes back deactivated immediately. With a reassignToId, the
  // reassignment runs as a background job (see backend/workers/
  // userDeactivationWorker.js): this returns right away with `queued: true`
  // and no `user`, since the target isn't deactivated yet.
  deactivateUser(id: number, reassignToId?: number) {
    return this.http.patch<{ message: string; user?: User; queued?: boolean }>(
      `${this.api}/${id}/deactivate`,
      reassignToId ? { reassignToId } : {}
    );
  }

  updateUser(id: number, payload: UpdateUserPayload) {
    return this.http.patch<{ message: string; user: User }>(`${this.api}/${id}`, payload);
  }

  getReassignableWork(id: number) {
    return this.http.get<ReassignableWork>(`${this.api}/${id}/reassignable-work`);
  }

  updateUserPassword(id: number, password: string) {
    return this.http.patch<{ message: string }>(`${this.api}/${id}/password`, { password });
  }

  updateUserDepartments(id: number, departmentIds: number[]) {
    return this.http.patch<{ message: string; user: User }>(`${this.api}/${id}/departments`, {
      departmentIds,
    });
  }
}
