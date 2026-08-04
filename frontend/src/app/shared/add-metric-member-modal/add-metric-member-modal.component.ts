import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';
import { MemberPickerComponent } from '../member-picker/member-picker.component';
import { MetricService } from '../../core/services/metric.service';
import { MetricMemberRole } from '../../models/metric.model';
import { User } from '../../models/user.model';

export interface AddMetricMemberPayload {
  userId: number;
  role: MetricMemberRole;
}

@Component({
  selector: 'app-add-metric-member-modal',
  standalone: true,
  imports: [FormsModule, ModalDirective, MemberPickerComponent],
  templateUrl: './add-metric-member-modal.component.html',
  styleUrl: './add-metric-member-modal.component.css',
})
export class AddMetricMemberModalComponent implements OnChanges {
  @Input() open = false;
  @Input({ required: true }) metricId!: number | string;
  @Input() loading = false;
  @Input() error = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<AddMetricMemberPayload>();

  selectedUser: User | null = null;
  selectedRole: MetricMemberRole = 'editor';
  localError = '';

  get displayError(): string {
    return this.localError || this.error;
  }

  constructor(private metricService: MetricService) {}

  fetchCandidates = (page: number, limit: number, search: string) =>
    this.metricService.getMetricMemberCandidates(this.metricId, page, limit, search);

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.selectedUser = null;
      this.selectedRole = 'editor';
      this.localError = '';
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
    this.localError = '';
    this.submitted.emit({ userId: this.selectedUser.id, role: this.selectedRole });
  }
}
