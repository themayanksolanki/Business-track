import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Organization, User } from '../../models/user.model';
import { Invite, CreateInvitePayload } from '../../models/invite.model';

@Injectable({ providedIn: 'root' })
export class OrganizationService {
  private readonly api = `${environment.apiUrl}/organizations`;

  constructor(private http: HttpClient) {}

  getMyOrganization() {
    return this.http.get<Organization>(`${this.api}/me`);
  }

  updateOrganization(payload: { name?: string; emailDomain?: string }) {
    return this.http.patch<{ message: string; organization: Organization }>(`${this.api}/me`, payload);
  }

  getAdmins() {
    return this.http.get<User[]>(`${this.api}/admins`);
  }

  createInvite(payload: CreateInvitePayload) {
    return this.http.post<{ message: string; invite: Invite }>(`${this.api}/invites`, payload);
  }

  getInvites() {
    return this.http.get<Invite[]>(`${this.api}/invites`);
  }

  revokeInvite(id: string) {
    return this.http.delete<{ message: string }>(`${this.api}/invites/${id}`);
  }
}
