import { SidebarTheme } from '../models/user.model';

export interface SidebarThemePreset {
  key: SidebarTheme;
  name: string;
  bgStart: string;
  bgEnd: string;
  accent: string;
  // Default menu-item text color for this theme — used as the preview-card
  // swatch color and as the sidebar's own fallback when the user hasn't set
  // a custom text-color override.
  text: string;
}

// Single source of truth for preview-card colors (profile.component.html)
// and the actual sidebar theming (sidebar.component.css defines the same
// values per-theme as CSS custom properties) — see sidebar.component.css
// for the counterpart [data-sidebar-theme='...'] blocks.
export const SIDEBAR_THEMES: SidebarThemePreset[] = [
  { key: 'MIDNIGHT', name: 'Midnight', bgStart: '#0f172a', bgEnd: '#0b1220', accent: '#3b82f6', text: '#94a3b8' },
  { key: 'CHARCOAL', name: 'Charcoal', bgStart: '#27272a', bgEnd: '#18181b', accent: '#a78bfa', text: '#a1a1aa' },
  { key: 'OCEAN', name: 'Ocean', bgStart: '#063a4a', bgEnd: '#042a36', accent: '#22d3ee', text: '#8bb4c0' },
  { key: 'FOREST', name: 'Forest', bgStart: '#0f2b1e', bgEnd: '#0a1f15', accent: '#34d399', text: '#8fb5a3' },
  { key: 'PLUM', name: 'Plum', bgStart: '#2e1140', bgEnd: '#1f0b2c', accent: '#f472b6', text: '#bfa1cc' },
  { key: 'DAYLIGHT', name: 'Daylight', bgStart: '#ffffff', bgEnd: '#f1f5f9', accent: '#2563eb', text: '#475569' },
];

export const DEFAULT_SIDEBAR_THEME: SidebarTheme = 'MIDNIGHT';
