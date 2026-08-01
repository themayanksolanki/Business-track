import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { GroupMemberPickerComponent } from '../group-member-picker/group-member-picker.component';
import { GroupService } from '../../core/services/group.service';
import { AuthService } from '../../core/services/auth.service';
import { Group, GroupMember, GroupMemberRole } from '../../models/group.model';
import { User } from '../../models/user.model';

// Manage-members dialog for an existing group — the group-chat analogue of
// ProjectTeamsComponent, but as a modal (the chat page has no per-conversation
// tabs to host a dedicated panel in).
@Component({
  selector: 'app-group-members-dialog',
  standalone: true,
  imports: [FormsModule, ModalDirective, ConfirmDialogComponent, GroupMemberPickerComponent],
  templateUrl: './group-members-dialog.component.html',
  styleUrl: './group-members-dialog.component.css',
})
export class GroupMembersDialogComponent implements OnChanges {
  @Input() open = false;
  @Input() group: Group | null = null;
  @Input() canManage = false;

  @Output() closed = new EventEmitter<void>();
  @Output() groupUpdated = new EventEmitter<Group>();
  @Output() groupDeleted = new EventEmitter<void>();
  @Output() left = new EventEmitter<void>();

  @ViewChild('avatarInput') avatarInputRef?: ElementRef<HTMLInputElement>;
  avatarUploading = false;

  addingMembers = false;
  selectedNewUsers: User[] = [];
  addLoading = false;
  addError = '';

  roleSavingId: number | null = null;

  removeOpen = false;
  removeTarget: GroupMember | null = null;
  removeLoading = false;

  deleteConfirmOpen = false;
  deleteLoading = false;
  leaveLoading = false;

  constructor(private groupService: GroupService, public auth: AuthService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.addingMembers = false;
      this.selectedNewUsers = [];
      this.addError = '';
      this.removeOpen = false;
      this.deleteConfirmOpen = false;
    }
  }

  get currentUserId(): number | undefined {
    return this.auth.getUser()?.id;
  }

  roleClass(role: string): string {
    return role.toLowerCase();
  }

  triggerAvatarUpload() {
    if (!this.canManage) return;
    this.avatarInputRef!.nativeElement.value = '';
    this.avatarInputRef!.nativeElement.click();
  }

  onAvatarSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.group) return;
    this.avatarUploading = true;
    this.groupService.uploadAvatar(this.group.id, file).subscribe({
      next: (res) => {
        this.avatarUploading = false;
        if (this.group) this.groupUpdated.emit({ ...this.group, avatarUrl: res.group.avatarUrl });
      },
      error: () => {
        this.avatarUploading = false;
      },
    });
  }

  toggleAddMembers() {
    this.addingMembers = !this.addingMembers;
    this.selectedNewUsers = [];
    this.addError = '';
  }

  submitAddMembers() {
    if (!this.group || this.selectedNewUsers.length === 0) return;
    this.addLoading = true;
    this.groupService.addMembers(this.group.id, this.selectedNewUsers.map((u) => u.id)).subscribe({
      next: (res) => {
        this.addLoading = false;
        this.addingMembers = false;
        this.selectedNewUsers = [];
        if (this.group) this.groupUpdated.emit({ ...this.group, members: res.members });
      },
      error: (err) => {
        this.addLoading = false;
        this.addError = err.error?.message || 'Failed to add members';
      },
    });
  }

  changeRole(member: GroupMember, role: GroupMemberRole) {
    if (!this.group || role === member.role) return;
    this.roleSavingId = member.id;
    this.groupService.updateMemberRole(this.group.id, member.id, role).subscribe({
      next: (res) => {
        this.roleSavingId = null;
        if (this.group) this.groupUpdated.emit({ ...this.group, members: res.members });
      },
      error: () => {
        this.roleSavingId = null;
      },
    });
  }

  requestRemove(member: GroupMember) {
    this.removeTarget = member;
    this.removeOpen = true;
  }

  cancelRemove() {
    this.removeOpen = false;
    this.removeTarget = null;
  }

  confirmRemove() {
    if (!this.group || !this.removeTarget) return;
    this.removeLoading = true;
    this.groupService.removeMember(this.group.id, this.removeTarget.id).subscribe({
      next: (res) => {
        this.removeLoading = false;
        this.removeOpen = false;
        this.removeTarget = null;
        if (this.group) this.groupUpdated.emit({ ...this.group, members: res.members });
      },
      error: () => {
        this.removeLoading = false;
        this.removeOpen = false;
        this.removeTarget = null;
      },
    });
  }

  openDeleteConfirm() {
    this.deleteConfirmOpen = true;
  }

  cancelDeleteConfirm() {
    this.deleteConfirmOpen = false;
  }

  confirmDelete() {
    if (!this.group) return;
    this.deleteLoading = true;
    this.groupService.deleteGroup(this.group.id).subscribe({
      next: () => {
        this.deleteLoading = false;
        this.deleteConfirmOpen = false;
        this.groupDeleted.emit();
      },
      error: () => {
        this.deleteLoading = false;
        this.deleteConfirmOpen = false;
      },
    });
  }

  leaveGroup() {
    if (!this.group) return;
    this.leaveLoading = true;
    this.groupService.leaveGroup(this.group.id).subscribe({
      next: () => {
        this.leaveLoading = false;
        this.left.emit();
      },
      error: () => {
        this.leaveLoading = false;
      },
    });
  }
}
