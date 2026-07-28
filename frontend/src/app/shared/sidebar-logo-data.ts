import { SidebarLogo } from '../models/user.model';
import { IconName } from './icon/icon.component';

export interface SidebarLogoPreset {
  key: SidebarLogo;
  name: string;
  icon: IconName;
}

// Single source of truth for the logo picker (profile.component.html) and
// the actual brand mark rendered in the sidebar (sidebar.component.html) —
// both look up the icon by `key` from this list.
export const SIDEBAR_LOGOS: SidebarLogoPreset[] = [
  { key: 'CHECK', name: 'Check', icon: 'brand' },
  { key: 'ROCKET', name: 'Rocket', icon: 'rocket' },
  { key: 'BOLT', name: 'Bolt', icon: 'bolt' },
  { key: 'STAR', name: 'Star', icon: 'star' },
  { key: 'SHIELD', name: 'Shield', icon: 'shield' },
  { key: 'DIAMOND', name: 'Diamond', icon: 'diamond' },
];

export const DEFAULT_SIDEBAR_LOGO: SidebarLogo = 'CHECK';
