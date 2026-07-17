import { Role } from './user.model';

export interface Invite {
  _id: string;
  organization: string;
  email: string;
  role: Role;
  departments: string[];
  managerId: string | null;
  teamLeadId: string | null;
  invitedBy: string;
  status: 'pending' | 'accepted';
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvitePayload {
  email: string;
  role: Role;
  departments?: string[];
  managerId?: string;
  teamLeadId?: string;
}

export interface ActivateInvitePayload {
  username: string;
  password: string;
}
