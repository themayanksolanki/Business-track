import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

// Metric-frequency icon set — used by the Bowling View's lens dropdown (one
// calendar variant per Daily/Weekly/Monthly, a distinct "grouped periods"
// glyph for Quarterly rather than a busier 4th calendar grid, and a
// stacked/overlapping calendar pair for Yearly to read as "multiple years").
export type FrequencyIconName = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

@Component({
  selector: 'app-frequency-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="frequency-icon-svg"
    >
      @switch (name) {
        @case ('daily') {
          <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
          <path d="M3 9.5h18" />
          <path d="M8 2.5v4M16 2.5v4" />
          <rect x="10.3" y="12.3" width="3.4" height="3.4" rx="0.8" fill="currentColor" stroke="none" />
        }
        @case ('weekly') {
          <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
          <path d="M3 9.5h18" />
          <path d="M8 2.5v4M16 2.5v4" />
          <rect x="4.7" y="12.3" width="14.6" height="3.4" rx="1" fill="currentColor" stroke="none" />
        }
        @case ('monthly') {
          <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
          <path d="M3 9.5h18" />
          <path d="M8 2.5v4M16 2.5v4" />
          <path d="M3 14h18M9 9.5v11M15 9.5v11" stroke-width="1.1" opacity="0.55" />
        }
        @case ('quarterly') {
          <path d="M12 3 4 7.2l8 4.2 8-4.2L12 3Z" />
          <path d="M4 12l8 4.2 8-4.2" />
          <path d="M4 16.8 12 21l8-4.2" />
        }
        @case ('yearly') {
          <rect x="7" y="2" width="14" height="12" rx="2" opacity="0.4" />
          <rect x="3" y="7" width="14" height="14" rx="2.5" />
          <path d="M3 11.5h14" />
          <path d="M7 5v4M13 5v4" />
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
export class FrequencyIconComponent {
  @Input() name!: FrequencyIconName;
  @Input() size = 20;
}
