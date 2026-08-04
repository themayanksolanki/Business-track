import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { MetricService } from '../../core/services/metric.service';
import { MetricMember, MetricMemberRole } from '../../models/metric.model';
import { AuthService } from '../../core/services/auth.service';
import { AddMetricMemberModalComponent, AddMetricMemberPayload } from '../add-metric-member-modal/add-metric-member-modal.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-metric-teams',
  standalone: true,
  imports: [FormsModule, TitleCasePipe, AddMetricMemberModalComponent, ConfirmDialogComponent],
  templateUrl: './metric-teams.component.html',
  styleUrl: './metric-teams.component.css',
})
export class MetricTeamsComponent {
  @Input({ required: true }) metricId!: number | string;
  @Input({ required: true }) members: MetricMember[] = [];
  @Input() canManage = false;

  @Output() membersChanged = new EventEmitter<MetricMember[]>();

  readonly roles: MetricMemberRole[] = ['owner', 'editor', 'viewer'];

  addOpen = false;
  addLoading = false;
  addError = '';

  roleSavingId: number | null = null;

  removeOpen = false;
  removeTarget: MetricMember | null = null;
  removeLoading = false;

  constructor(
    private metricService: MetricService,
    public auth: AuthService
  ) {}

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

  submitAdd(payload: AddMetricMemberPayload) {
    this.addLoading = true;
    this.addError = '';
    this.metricService.addMetricMember(this.metricId, payload.userId, payload.role).subscribe({
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

  changeRole(member: MetricMember, role: MetricMemberRole) {
    if (role === member.role) return;
    this.roleSavingId = member.id;
    this.metricService.updateMetricMemberRole(this.metricId, member.id, role).subscribe({
      next: (res) => {
        this.roleSavingId = null;
        this.membersChanged.emit(res.members);
      },
      error: () => {
        this.roleSavingId = null;
      },
    });
  }

  requestRemove(member: MetricMember) {
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
    this.metricService.removeMetricMember(this.metricId, this.removeTarget.id).subscribe({
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
