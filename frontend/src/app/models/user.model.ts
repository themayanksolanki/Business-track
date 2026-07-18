import { Department } from './department.model';

export type Role = 'Admin' | 'Manager' | 'Team Lead' | 'User';

export interface Organization {
  id?: number;
  name: string;
  emailDomain: string;
  createdBy?: number;
  updatedBy?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

// Minimal shape getMe() populates for manager/teamLead — not the full User record.
export interface UserLite {
  id: number;
  username: string;
  email: string;
}

export interface User {
  id: number;
  numericId?: number | null;
  username: string;
  email: string;
  role: Role;
  isActive?: boolean;
  profileImage?: string | null;
  managerId?: number | null;
  teamLeadId?: number | null;
  manager?: UserLite | null;
  teamLead?: UserLite | null;
  departments?: Department[] | number[];
  organization?: Organization | number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  message: string;
  token: string;
  refreshToken?: string;
  user: User;
}

export interface PaginatedUsers {
  users: User[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
