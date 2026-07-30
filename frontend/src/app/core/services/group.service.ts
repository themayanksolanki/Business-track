import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Group, GroupWithActivity, GroupMember, GroupMemberRole, GroupMessage } from '../../models/group.model';
import { PaginatedUsers } from '../../models/user.model';

@Injectable({ providedIn: 'root' })
export class GroupService {
  private readonly api = `${environment.apiUrl}/groups`;

  // Groups the current user belongs to — the chat sidebar's "Groups" tab
  // reads this cache-first, same pattern as ChatService.contacts.
  private readonly _groups = signal<GroupWithActivity[]>([]);
  readonly groups = this._groups.asReadonly();

  constructor(private http: HttpClient) {}

  getGroups() {
    return this.http.get<GroupWithActivity[]>(this.api).pipe(tap((groups) => this._groups.set(groups)));
  }

  createGroup(payload: { name: string; memberIds?: number[] }) {
    return this.http
      .post<{ message: string; group: Group }>(this.api, payload)
      .pipe(tap((res) => this._groups.set([{ ...res.group, lastMessage: null, unreadCount: 0 }, ...this._groups()])));
  }

  getGroupById(groupId: number) {
    return this.http.get<Group>(`${this.api}/${groupId}`);
  }

  updateGroup(groupId: number, payload: { name?: string; avatarUrl?: string | null }) {
    return this.http.patch<{ message: string; group: Group }>(`${this.api}/${groupId}`, payload);
  }

  uploadAvatar(groupId: number, file: File) {
    const form = new FormData();
    form.append('avatar', file);
    return this.http.patch<{ message: string; group: Group }>(`${this.api}/${groupId}/avatar`, form);
  }

  deleteGroup(groupId: number) {
    return this.http
      .delete<{ message: string }>(`${this.api}/${groupId}`)
      .pipe(tap(() => this._groups.set(this._groups().filter((g) => g.id !== groupId))));
  }

  getMembers(groupId: number) {
    return this.http.get<GroupMember[]>(`${this.api}/${groupId}/members`);
  }

  // groupId omitted → org-wide candidate search for the "create group" flow,
  // before any group exists to scope against.
  getMemberCandidates(groupId: number | null, page: number, limit: number, search?: string) {
    const params: Record<string, string | number> = { page, limit };
    if (search) params['search'] = search;
    const url = groupId ? `${this.api}/${groupId}/members/candidates` : `${this.api}/candidates`;
    return this.http.get<PaginatedUsers>(url, { params });
  }

  addMembers(groupId: number, userIds: number[]) {
    return this.http.post<{ message: string; members: GroupMember[] }>(`${this.api}/${groupId}/members`, { userIds });
  }

  updateMemberRole(groupId: number, memberId: number, role: GroupMemberRole) {
    return this.http.patch<{ message: string; members: GroupMember[] }>(`${this.api}/${groupId}/members/${memberId}`, { role });
  }

  removeMember(groupId: number, memberId: number) {
    return this.http.delete<{ message: string; members: GroupMember[] }>(`${this.api}/${groupId}/members/${memberId}`);
  }

  leaveGroup(groupId: number) {
    return this.http
      .post<{ message: string }>(`${this.api}/${groupId}/leave`, {})
      .pipe(tap(() => this._groups.set(this._groups().filter((g) => g.id !== groupId))));
  }

  getMessages(groupId: number) {
    return this.http.get<GroupMessage[]>(`${this.api}/${groupId}/messages`);
  }
}
