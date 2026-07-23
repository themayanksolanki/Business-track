import { Injectable, signal } from '@angular/core';

// Transient, not persisted — mirrors the in-progress color-picker drag on
// the Profile > Appearance page so the always-mounted sidebar (a different
// component instance than the picker) can live-preview it before the user
// commits and it's saved via AuthService.updateProfile.
@Injectable({ providedIn: 'root' })
export class SidebarAppearanceService {
  readonly previewTextColor = signal<string | null>(null);

  setPreview(color: string | null) {
    this.previewTextColor.set(color);
  }

  clearPreview() {
    this.previewTextColor.set(null);
  }
}
