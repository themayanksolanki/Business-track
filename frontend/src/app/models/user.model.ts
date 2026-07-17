import { Department } from './department.model';

export type Role = 'Admin' | 'Manager' | 'Team Lead' | 'User';

export interface Organization {
  id?: string;
  _id?: string;
  name: string;
  emailDomain: string;
  createdBy?: string;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: string;
  _id?: string;
  numericId?: number | null;
  username: string;
  email: string;
  role: Role;
  isActive?: boolean;
  profileImage?: string | null;
  managerId?: User | string | null;
  teamLeadId?: User | string | null;
  departments?: Department[] | string[];
  organization?: Organization | string | null;
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
