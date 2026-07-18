import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';
import { MemberPickerComponent } from '../member-picker/member-picker.component';
import { ProjectRoleService } from '../../core/services/project-role.service';
import { ProjectRole } from '../../models/project-role.model';
import { User } from '../../models/user.model';

export interface AddMemberPayload {
  userId: string;
  roleId: string;
}

@Component({
  selector: 'app-add-member-modal',
  standalone: true,
  imports: [FormsModule, ModalDirective, MemberPickerComponent],
  templateUrl: './add-member-modal.component.html',
  styleUrl: './add-member-modal.component.css',
})
export class AddMemberModalComponent implements OnChanges {
  @Input() open = false;
  @Input({ required: true }) projectId!: string;
  @Input() loading = false;
  @Input() error = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<AddMemberPayload>();

  roles: ProjectRole[] = [];
  selectedUser: User | null = null;
  selectedRoleId = '';
  localError = '';

  get displayError(): string {
    return this.localError || this.error;
  }

  constructor(private projectRoleService: ProjectRoleService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.selectedUser = null;
      this.selectedRoleId = '';
      this.localError = '';
      this.projectRoleService.getRoles().subscribe({
        next: (roles) => (this.roles = roles),
        error: () => {},
      });
    }
  }

  onUserPicked(user: User) {
    this.selectedUser = user;
  }

  submit() {
    if (!this.selectedUser) {
      this.localError = 'Select a user to add';
      return;
    }
    if (!this.selectedRoleId) {
      this.localError = 'Select a role';
      return;
    }
    this.localError = '';
    this.submitted.emit({ userId: this.selectedUser._id ?? this.selectedUser.id, roleId: this.selectedRoleId });
  }
}
