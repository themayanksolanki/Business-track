import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';
import { GroupMemberPickerComponent } from '../group-member-picker/group-member-picker.component';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { GroupService } from '../../core/services/group.service';

@Component({
  selector: 'app-create-group-dialog',
  standalone: true,
  imports: [FormsModule, ModalDirective, GroupMemberPickerComponent],
  templateUrl: './create-group-dialog.component.html',
  styleUrl: './create-group-dialog.component.css',
})
export class CreateGroupDialogComponent implements OnChanges {
  @Input() open = false;

  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<Group>();

  name = '';
  selectedUsers: User[] = [];
  loading = false;
  error = '';

  constructor(private groupService: GroupService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.name = '';
      this.selectedUsers = [];
      this.error = '';
      this.loading = false;
    }
  }

  submit() {
    const name = this.name.trim();
    if (!name) {
      this.error = 'Group name is required';
      return;
    }
    this.error = '';
    this.loading = true;
    this.groupService.createGroup({ name, memberIds: this.selectedUsers.map((u) => u.id) }).subscribe({
      next: (res) => {
        this.loading = false;
        this.created.emit(res.group);
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || 'Failed to create group';
      },
    });
  }
}
