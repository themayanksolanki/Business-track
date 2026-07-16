import { Department } from './department.model';

export type Role = 'Admin' | 'Manager' | 'Team Lead' | 'User';

export interface Organization {
  id?: string;
  _id?: string;
  name: string;
  emailDomain: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: string;
  _id?: string;
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
