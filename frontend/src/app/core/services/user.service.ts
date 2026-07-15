import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { User } from '../../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly api = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  getAllUsers() {
    return this.http.get<User[]>(this.api);
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

  activateUser(id: string) {
    return this.http.patch<{ message: string; user: User }>(`${this.api}/${id}/activate`, {});
  }

  updateUserPassword(id: string, password: string) {
    return this.http.patch<{ message: string }>(`${this.api}/${id}/password`, { password });
  }
}
