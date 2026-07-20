import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type IconName =
  | 'brand'
  | 'dashboard'
  | 'tasks'
  | 'projects'
  | 'users'
  | 'team'
  | 'chat'
  | 'profile'
  | 'logout'
  | 'chevron-left'
  | 'grip'
  | 'menu'
  | 'settings'
  | 'building'
  | 'draft';

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="app-icon-svg"
    >
      @switch (name) {
        @case ('brand') {
          <path d="M5 13l4 4L19 7" stroke-width="2.4" />
        }
        @case ('dashboard') {
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="5" rx="2" />
          <rect x="13" y="10" width="8" height="11" rx="2" />
          <rect x="3" y="13" width="8" height="8" rx="2" />
        }
        @case ('tasks') {
          <path d="M4 5.5l2 2 3-3" />
          <line x1="11" y1="5.5" x2="21" y2="5.5" />
          <path d="M4 12.5l2 2 3-3" />
          <line x1="11" y1="12.5" x2="21" y2="12.5" />
          <path d="M4 19.5l2 2 3-3" />
          <line x1="11" y1="19.5" x2="21" y2="19.5" />
        }
        @case ('projects') {
          <rect x="3" y="3" width="5" height="18" rx="1.5" />
          <rect x="9.5" y="3" width="5" height="12" rx="1.5" />
          <rect x="16" y="3" width="5" height="15" rx="1.5" />
        }
        @case ('users') {
          <circle cx="9" cy="8" r="3.6" />
          <path d="M2.5 20.5c0-3.9 2.9-7 6.5-7s6.5 3.1 6.5 7" />
          <circle cx="17.5" cy="8.5" r="2.6" />
          <path d="M15 14c2.7.5 4.8 2.9 5.2 6.3" />
        }
        @case ('team') {
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="12" cy="19" r="3" />
          <path d="M8.6 7.8L10.8 15.7M15.4 7.8L13.2 15.7M9 6h6" />
        }
        @case ('chat') {
          <path
            d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
          />
          <circle cx="8" cy="11" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="11" r="1" fill="currentColor" stroke="none" />
          <circle cx="16" cy="11" r="1" fill="currentColor" stroke="none" />
        }
        @case ('profile') {
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        }
        @case ('logout') {
          <path d="M15 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h9" />
          <line x1="10" y1="12" x2="21" y2="12" />
          <path d="M17 8l4 4-4 4" />
        }
        @case ('chevron-left') {
          <polyline points="15 6 9 12 15 18" />
        }
        @case ('grip') {
          <circle cx="9" cy="5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="15" cy="5" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="9" cy="19" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="15" cy="19" r="1.3" fill="currentColor" stroke="none" />
        }
        @case ('menu') {
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        }
        @case ('settings') {
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        }
        @case ('building') {
          <rect x="4" y="3" width="10" height="18" rx="1" />
          <rect x="16" y="9" width="4" height="12" rx="1" />
          <line x1="7" y1="7" x2="7" y2="7" />
          <line x1="7" y1="11" x2="7" y2="11" />
          <line x1="7" y1="15" x2="7" y2="15" />
          <line x1="11" y1="7" x2="11" y2="7" />
          <line x1="11" y1="11" x2="11" y2="11" />
          <line x1="11" y1="15" x2="11" y2="15" />
        }
        @case ('draft') {
          <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }
  `,
})
export class IconComponent {
  @Input() name!: IconName;
  @Input() size = 20;
}
