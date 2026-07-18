import { Component, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { TaskService } from '../../core/services/task.service';
import { ThemeService } from '../../core/services/theme.service';
import { User } from '../../models/user.model';
import { Task } from '../../models/task.model';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterLink, ConfirmDialogComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css',
})
export class ProfileComponent implements OnInit {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  profile: User | null = null;
  tasks: Task[] = [];
  loading = true;
  error = '';
  activeTab: 'overview' | 'appearance' = 'overview';

  avatarUploading = false;
  avatarRemoving = false;
  avatarError = '';
  removeDialogOpen = false;

  constructor(
    public auth: AuthService,
    private taskService: TaskService,
    public themeSvc: ThemeService,
  ) {}

  ngOnInit() {
    this.auth.getMe().subscribe({
      next: (user) => {
        this.profile = user;
        this.loading = false;
      },
      error: () => {
        this.profile = this.auth.getUser();
        this.loading = false;
        this.error = 'Could not refresh profile from server.';
      },
    });

    this.taskService.getTasks().subscribe({
      next: (tasks) => (this.tasks = tasks),
    });
  }

  get avatarUrl(): string | null {
    return this.auth.avatarUrl(this.profile);
  }

  get initials(): string {
    return this.profile?.username?.[0]?.toUpperCase() ?? '?';
  }

  triggerFileInput() {
    this.fileInput.nativeElement.value = '';
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    this.avatarError = '';
    this.avatarUploading = true;

    this.auth.uploadAvatar(file).subscribe({
      next: (res) => {
        this.profile = res.user;
        this.avatarUploading = false;
      },
      error: (err) => {
        this.avatarError = err.error?.message || 'Upload failed. Max 2 MB, JPEG/PNG/WebP only.';
        this.avatarUploading = false;
      },
    });
  }

  openRemoveDialog() {
    this.removeDialogOpen = true;
  }

  confirmRemoveAvatar() {
    this.avatarError = '';
    this.avatarRemoving = true;
    this.auth.removeAvatar().subscribe({
      next: (res) => {
        this.profile = res.user;
        this.avatarRemoving = false;
        this.removeDialogOpen = false;
      },
      error: () => {
        this.avatarError = 'Failed to remove avatar.';
        this.avatarRemoving = false;
        this.removeDialogOpen = false;
      },
    });
  }

  get todo(): number { return this.tasks.filter((t) => t.status === 'todo').length; }
  get pending(): number { return this.tasks.filter((t) => t.status === 'pending').length; }
  get completed(): number { return this.tasks.filter((t) => t.status === 'completed').length; }

  get completionRate(): number {
    if (!this.tasks.length) return 0;
    return Math.round((this.completed / this.tasks.length) * 100);
  }

  get memberSince(): string {
    if (!this.profile?.createdAt) return '—';
    return new Date(this.profile.createdAt).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  get roleIcon(): string {
    const icons: Record<string, string> = {
      Admin: 'bi-shield-fill-check',
      Manager: 'bi-briefcase-fill',
      'Team Lead': 'bi-diagram-3-fill',
      User: 'bi-person-fill',
    };
    return icons[this.profile?.role ?? ''] ?? 'bi-person-fill';
  }

  get managerName(): string {
    return this.profile?.manager?.username ?? '';
  }

  get teamLeadName(): string {
    return this.profile?.teamLead?.username ?? '';
  }
}
