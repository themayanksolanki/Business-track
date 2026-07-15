import { Injectable, computed, signal } from '@angular/core';

export const SIDEBAR_RAIL_WIDTH = 72;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 450;
const DEFAULT_WIDTH = 260;
const WIDTH_KEY = 'sidebar-width';
const COLLAPSED_KEY = 'sidebar-collapsed';

@Injectable({ providedIn: 'root' })
export class SidebarService {
  readonly expandedWidth = signal(this.loadWidth());
  readonly collapsed = signal(this.loadCollapsed());
  readonly dragging = signal(false);
  readonly mobileOpen = signal(false);

  readonly currentWidth = computed(() =>
    this.collapsed() ? SIDEBAR_RAIL_WIDTH : this.expandedWidth(),
  );

  setExpandedWidth(px: number) {
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, px));
    this.expandedWidth.set(clamped);
    localStorage.setItem(WIDTH_KEY, String(clamped));
  }

  setCollapsed(value: boolean) {
    this.collapsed.set(value);
    localStorage.setItem(COLLAPSED_KEY, String(value));
  }

  toggleCollapsed() {
    this.setCollapsed(!this.collapsed());
  }

  setDragging(value: boolean) {
    this.dragging.set(value);
  }

  setMobileOpen(value: boolean) {
    this.mobileOpen.set(value);
  }

  toggleMobileOpen() {
    this.mobileOpen.set(!this.mobileOpen());
  }

  private loadWidth(): number {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (saved && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) return saved;
    return DEFAULT_WIDTH;
  }

  private loadCollapsed(): boolean {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  }
}
