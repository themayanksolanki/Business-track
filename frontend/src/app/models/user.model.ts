export type Role = 'Manager' | 'Team Lead' | 'Employee';

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
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  message: string;
  token: string;
  refreshToken?: string;
  user: User;
}
