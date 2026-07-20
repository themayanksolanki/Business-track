import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProjectService } from '../../core/services/project.service';
import { ProjectRoleService } from '../../core/services/project-role.service';
import { ProjectMember } from '../../models/project.model';
import { ProjectRole } from '../../models/project-role.model';
import { AuthService } from '../../core/services/auth.service';
import { AddMemberModalComponent, AddMemberPayload } from '../add-member-modal/add-member-modal.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-project-teams',
  standalone: true,
  imports: [FormsModule, AddMemberModalComponent, ConfirmDialogComponent],
  templateUrl: './project-teams.component.html',
  styleUrl: './project-teams.component.css',
})
export class ProjectTeamsComponent implements OnInit {
  @Input({ required: true }) projectId!: string;
  @Input({ required: true }) members: ProjectMember[] = [];
  @Input() canManage = false;

  @Output() membersChanged = new EventEmitter<ProjectMember[]>();

  roles: ProjectRole[] = [];

  addOpen = false;
  addLoading = false;
  addError = '';

  roleSavingId: number | null = null;

  removeOpen = false;
  removeTarget: ProjectMember | null = null;
  removeLoading = false;

  constructor(
    private projectService: ProjectService,
    private projectRoleService: ProjectRoleService,
    public auth: AuthService
  ) {}

  ngOnInit() {
    this.projectRoleService.getRoles().subscribe({
      next: (roles) => (this.roles = roles),
      error: () => {},
    });
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  openAdd() {
    this.addError = '';
    this.addOpen = true;
  }

  closeAdd() {
    this.addOpen = false;
    this.addError = '';
  }

  submitAdd(payload: AddMemberPayload) {
    this.addLoading = true;
    this.addError = '';
    this.projectService.addMember(this.projectId, payload.userId, payload.roleId).subscribe({
      next: (res) => {
        this.addLoading = false;
        this.addOpen = false;
        this.membersChanged.emit(res.members);
      },
      error: (err) => {
        this.addError = err.error?.message || 'Failed to add member';
        this.addLoading = false;
      },
    });
  }

  changeRole(member: ProjectMember, roleId: number) {
    if (roleId === member.role.id) return;
    this.roleSavingId = member.id;
    this.projectService.updateMemberRole(this.projectId, member.id, roleId).subscribe({
      next: (res) => {
        this.roleSavingId = null;
        this.membersChanged.emit(res.members);
      },
      error: () => {
        this.roleSavingId = null;
      },
    });
  }

  requestRemove(member: ProjectMember) {
    this.removeTarget = member;
    this.removeOpen = true;
  }

  cancelRemove() {
    this.removeOpen = false;
    this.removeTarget = null;
  }

  confirmRemove() {
    if (!this.removeTarget) return;
    this.removeLoading = true;
    this.projectService.removeMember(this.projectId, this.removeTarget.id).subscribe({
      next: (res) => {
        this.removeLoading = false;
        this.removeOpen = false;
        this.removeTarget = null;
        this.membersChanged.emit(res.members);
      },
      error: () => {
        this.removeLoading = false;
        this.removeOpen = false;
        this.removeTarget = null;
      },
    });
  }
}
