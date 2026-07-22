import { Role } from './user.model';

export interface Invite {
  id: number;
  organization: number;
  email: string;
  role: Role;
  departments: number[];
  managerId: number | null;
  teamLeadId: number | null;
  invitedBy: number;
  status: 'pending' | 'accepted';
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvitePayload {
  email: string;
  role: Role;
  departments?: number[];
  managerId?: number;
  teamLeadId?: number;
}

export interface ActivateInvitePayload {
  username: string;
  password: string;
}

// Returned by GET /organizations/invites/token/:token — the public
// accept-invite page's read-only lookup before the invitee has an account.
export interface InviteTokenInfo {
  email: string;
  role: Role;
  organizationName: string;
}
