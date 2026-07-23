import { Component, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { TaskService } from '../../core/services/task.service';
import { ThemeService } from '../../core/services/theme.service';
import { SidebarAppearanceService } from '../../core/services/sidebar-appearance.service';
import { User, SidebarTheme } from '../../models/user.model';
import { Task } from '../../models/task.model';
import { COUNTRIES, DEFAULT_COUNTRY_ISO2, flagEmoji } from '../../models/country.model';
import { DateFormatService } from '../../core/services/date-format.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { SIDEBAR_THEMES } from '../../shared/sidebar-theme-data';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ConfirmDialogComponent],
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

  readonly countries = COUNTRIES;
  readonly flagEmoji = flagEmoji;
  phoneEditing = false;
  phoneSaving = false;
  phoneError = '';
  phoneCountryForm = DEFAULT_COUNTRY_ISO2;
  phoneNumberForm = '';

  readonly sidebarThemes = SIDEBAR_THEMES;
  savingSidebarTheme: SidebarTheme | null = null;
  savingSidebarTextColor = false;
  sidebarTextColorError = '';

  constructor(
    public auth: AuthService,
    private taskService: TaskService,
    public themeSvc: ThemeService,
    private dateFormat: DateFormatService,
    public sidebarAppearance: SidebarAppearanceService,
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

  dialCodeFor(iso2: string | null | undefined): string {
    return this.countries.find((c) => c.iso2 === iso2)?.dialCode ?? '';
  }

  get displayPhone(): string | null {
    if (!this.profile?.phoneCountry || !this.profile?.phoneNumber) return null;
    return `${flagEmoji(this.profile.phoneCountry)} ${this.dialCodeFor(this.profile.phoneCountry)} ${this.profile.phoneNumber}`;
  }

  startEditPhone() {
    this.phoneError = '';
    this.phoneCountryForm = this.profile?.phoneCountry || DEFAULT_COUNTRY_ISO2;
    this.phoneNumberForm = this.profile?.phoneNumber || '';
    this.phoneEditing = true;
  }

  cancelEditPhone() {
    this.phoneEditing = false;
    this.phoneError = '';
  }

  savePhone() {
    const digits = this.phoneNumberForm.replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 14) {
      this.phoneError = 'Enter a valid phone number.';
      return;
    }

    this.phoneError = '';
    this.phoneSaving = true;
    this.auth.updateProfile({ phoneCountry: this.phoneCountryForm, phoneNumber: digits }).subscribe({
      next: (res) => {
        this.profile = this.profile
          ? { ...this.profile, phoneCountry: res.user.phoneCountry, phoneNumber: res.user.phoneNumber }
          : res.user;
        this.phoneSaving = false;
        this.phoneEditing = false;
      },
      error: (err) => {
        this.phoneError = err.error?.message || 'Failed to update phone number.';
        this.phoneSaving = false;
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
    return this.dateFormat.formatDate(this.profile.createdAt);
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

  selectSidebarTheme(theme: SidebarTheme) {
    if (this.savingSidebarTheme || theme === this.profile?.sidebarTheme) return;
    this.savingSidebarTheme = theme;
    this.auth.updateProfile({ sidebarTheme: theme }).subscribe({
      next: (res) => {
        this.profile = this.profile ? { ...this.profile, sidebarTheme: res.user.sidebarTheme } : res.user;
        this.savingSidebarTheme = null;
      },
      error: () => (this.savingSidebarTheme = null),
    });
  }

  // Default text color for the currently-selected sidebar theme — used both
  // as the color-picker's starting value and as the live-preview swatch's
  // fallback while no custom override is set.
  get sidebarThemeDefaultText(): string {
    const key = this.profile?.sidebarTheme ?? 'MIDNIGHT';
    return this.sidebarThemes.find((t) => t.key === key)?.text ?? '#94a3b8';
  }

  get sidebarTextColorValue(): string {
    return this.profile?.sidebarTextColor || this.sidebarThemeDefaultText;
  }

  get currentSidebarThemePreset() {
    const key = this.profile?.sidebarTheme ?? 'MIDNIGHT';
    return this.sidebarThemes.find((t) => t.key === key) ?? this.sidebarThemes[0];
  }

  get sidebarTextPreviewColor(): string {
    return this.sidebarAppearance.previewTextColor() ?? this.sidebarTextColorValue;
  }

  // Fires on every drag tick of the native color input — cheap, local-only,
  // and read by the always-mounted sidebar for a true live preview without
  // hitting the backend on each tick (that happens once, on commit below).
  onSidebarTextColorPreview(event: Event) {
    this.sidebarAppearance.setPreview((event.target as HTMLInputElement).value);
  }

  onSidebarTextColorCommit(event: Event) {
    this.commitSidebarTextColor((event.target as HTMLInputElement).value);
  }

  onSidebarTextColorHexCommit(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
      input.value = this.sidebarTextColorValue;
      return;
    }
    this.commitSidebarTextColor(value);
  }

  resetSidebarTextColor() {
    this.sidebarAppearance.clearPreview();
    this.commitSidebarTextColor(null);
  }

  private commitSidebarTextColor(color: string | null) {
    this.savingSidebarTextColor = true;
    this.sidebarTextColorError = '';
    this.auth.updateProfile({ sidebarTextColor: color }).subscribe({
      next: (res) => {
        this.profile = this.profile ? { ...this.profile, sidebarTextColor: res.user.sidebarTextColor } : res.user;
        this.sidebarAppearance.clearPreview();
        this.savingSidebarTextColor = false;
      },
      error: (err) => {
        this.sidebarTextColorError = err.error?.message || 'Failed to save text color';
        this.sidebarAppearance.clearPreview();
        this.savingSidebarTextColor = false;
      },
    });
  }
}
