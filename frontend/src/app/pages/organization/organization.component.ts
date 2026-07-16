import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OrganizationService } from '../../core/services/organization.service';
import { UserService } from '../../core/services/user.service';
import { DepartmentService } from '../../core/services/department.service';
import { AuthService } from '../../core/services/auth.service';
import { Organization, User, Role } from '../../models/user.model';
import { Invite, CreateInvitePayload } from '../../models/invite.model';
import { Department } from '../../models/department.model';

@Component({
  selector: 'app-organization',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './organization.component.html',
  styleUrl: './organization.component.css',
})
export class OrganizationComponent implements OnInit {
  organization: Organization | null = null;
  loading = true;
  error = '';

  isAdmin = false;
  isManager = false;
  isTeamLead = false;

  members: User[] = [];
  membersLoading = false;

  invites: Invite[] = [];
  invitesLoading = false;

  departments: Department[] = [];

  editingOrg = false;
  orgName = '';
  orgDomain = '';
  orgSaveLoading = false;
  orgSaveError = '';

  inviteEmail = '';
  inviteRole: Role = 'User';
  inviteDepartmentIds: string[] = [];
  inviteLoading = false;
  inviteError = '';
  inviteSuccess = '';

  constructor(
    private orgService: OrganizationService,
    private userService: UserService,
    private departmentService: DepartmentService,
    private auth: AuthService,
  ) {}

  ngOnInit() {
    const role = this.auth.getUser()?.role;
    this.isAdmin = role === 'Admin';
    this.isManager = role === 'Manager';
    this.isTeamLead = role === 'Team Lead';
    this.inviteRole = this.invitableRoles[0] ?? 'User';

    this.loadOrganization();
    this.loadMembers();
    this.loadInvites();
    this.departmentService.getDepartments().subscribe({ next: (d) => (this.departments = d) });
  }

  loadOrganization() {
    this.loading = true;
    this.error = '';
    this.orgService.getMyOrganization().subscribe({
      next: (org) => {
        this.organization = org;
        this.orgName = org.name;
        this.orgDomain = org.emailDomain;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load organization';
        this.loading = false;
      },
    });
  }

  loadMembers() {
    this.membersLoading = true;
    this.userService.getAllUsers().subscribe({
      next: (users) => {
        this.members = users;
        this.membersLoading = false;
      },
      error: () => {
        this.membersLoading = false;
      },
    });
  }

  loadInvites() {
    this.invitesLoading = true;
    this.orgService.getInvites().subscribe({
      next: (invites) => {
        this.invites = invites;
        this.invitesLoading = false;
      },
      error: () => {
        this.invitesLoading = false;
      },
    });
  }

  get invitableRoles(): Role[] {
    if (this.isAdmin) return ['Admin', 'Manager', 'Team Lead', 'User'];
    if (this.isManager) return ['Team Lead', 'User'];
    if (this.isTeamLead) return ['User'];
    return [];
  }

  startEditOrg() {
    if (!this.organization) return;
    this.orgName = this.organization.name;
    this.orgDomain = this.organization.emailDomain;
    this.orgSaveError = '';
    this.editingOrg = true;
  }

  cancelEditOrg() {
    this.editingOrg = false;
  }

  saveOrg() {
    this.orgSaveLoading = true;
    this.orgSaveError = '';
    this.orgService.updateOrganization({ name: this.orgName, emailDomain: this.orgDomain }).subscribe({
      next: (res) => {
        this.organization = res.organization;
        this.orgSaveLoading = false;
        this.editingOrg = false;
      },
      error: (err) => {
        this.orgSaveError = err.error?.message || 'Failed to update organization';
        this.orgSaveLoading = false;
      },
    });
  }

  isInviteDepartmentSelected(id: string): boolean {
    return this.inviteDepartmentIds.includes(id);
  }

  toggleInviteDepartment(id: string, checked: boolean) {
    this.inviteDepartmentIds = checked
      ? [...this.inviteDepartmentIds, id]
      : this.inviteDepartmentIds.filter((d) => d !== id);
  }

  submitInvite() {
    if (!this.inviteEmail.trim()) return;
    this.inviteLoading = true;
    this.inviteError = '';
    this.inviteSuccess = '';

    const payload: CreateInvitePayload = {
      email: this.inviteEmail.trim(),
      role: this.inviteRole,
    };
    if (this.inviteDepartmentIds.length) payload.departments = this.inviteDepartmentIds;

    this.orgService.createInvite(payload).subscribe({
      next: (res) => {
        this.invites = [res.invite, ...this.invites];
        this.inviteSuccess = res.message;
        this.inviteEmail = '';
        this.inviteDepartmentIds = [];
        this.inviteLoading = false;
      },
      error: (err) => {
        this.inviteError = err.error?.message || 'Failed to create invite';
        this.inviteLoading = false;
      },
    });
  }

  revokeInvite(invite: Invite) {
    this.invites = this.invites.filter((i) => i._id !== invite._id);
    this.orgService.revokeInvite(invite._id).subscribe({
      error: () => this.loadInvites(),
    });
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }
}
