import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

// Call/meeting-specific icon set — kept separate from shared/icon's
// IconComponent (the sidebar nav icon set) since these three come from
// external SVGs each authored on their own viewBox/stroke-width, rather than
// IconComponent's single shared 24x24 / stroke-1.8 grid.
export type CallIconName = 'screen-mirror' | 'to-pip' | 'quit-pip';

@Component({
  selector: 'app-call-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (name) {
      @case ('screen-mirror') {
        <svg [attr.width]="size" [attr.height]="size" viewBox="-0.5 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.5 21.92C18.6263 21.9829 19.7318 21.5974 20.575 20.848C21.4181 20.0985 21.9304 19.0459 22 17.92V7.91998C21.9304 6.79403 21.4181 5.74147 20.575 4.992C19.7318 4.24253 18.6263 3.85707 17.5 3.91998H6.5C5.37366 3.85707 4.26814 4.24253 3.42499 4.992C2.58184 5.74147 2.06958 6.79403 2 7.91998" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12.6094 19.24C12.0403 17.35 11.0092 15.6316 9.60938 14.24C8.22098 12.8361 6.50146 11.8044 4.60938 11.24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5.10077 21.9199C4.93867 21.1714 4.56508 20.4851 4.02441 19.9426C3.48375 19.4002 2.79876 19.0244 2.05078 18.8599" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8.83984 20.5798C8.46814 19.2691 7.76782 18.0751 6.8053 17.1108C5.84277 16.1466 4.64994 15.4439 3.33984 15.0698" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      }
      @case ('to-pip') {
        <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 17C13 15.1144 13 14.1716 13.5858 13.5858C14.1716 13 15.1144 13 17 13H18C19.8856 13 20.8284 13 21.4142 13.5858C22 14.1716 22 15.1144 22 17C22 18.8856 22 19.8284 21.4142 20.4142C20.8284 21 19.8856 21 18 21H17C15.1144 21 14.1716 21 13.5858 20.4142C13 19.8284 13 18.8856 13 17Z" stroke="currentColor" stroke-width="1.5"/>
          <path d="M11.5 11.5V8.5M11.5 11.5H8.5M11.5 11.5L7.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M11 21H10C6.22876 21 4.34315 21 3.17157 19.8284C2 18.6569 2 16.7712 2 13V11M22 11C22 7.22876 22 5.34315 20.8284 4.17157C19.6569 3 17.7712 3 14 3H10C6.22876 3 4.34315 3 3.17157 4.17157C2.51839 4.82475 2.22937 5.69989 2.10149 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      }
      @case ('quit-pip') {
        <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11 21H10C6.22876 21 4.34315 21 3.17157 19.8284C2 18.6569 2 16.7712 2 13V11C2 7.22876 2 5.34315 3.17157 4.17157C4.34315 3 6.22876 3 10 3H14C17.7712 3 19.6569 3 20.8284 4.17157C22 5.34315 22 7.22876 22 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M13 17C13 15.1144 13 14.1716 13.5858 13.5858C14.1716 13 15.1144 13 17 13H18C19.8856 13 20.8284 13 21.4142 13.5858C22 14.1716 22 15.1144 22 17C22 18.8856 22 19.8284 21.4142 20.4142C20.8284 21 19.8856 21 18 21H17C15.1144 21 14.1716 21 13.5858 20.4142C13 19.8284 13 18.8856 13 17Z" stroke="currentColor" stroke-width="1.5"/>
          <path d="M7.5 7.5V10.5M7.5 7.5H10.5M7.5 7.5L11.5 11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      line-height: 0;
    }
  `,
})
export class CallIconComponent {
  @Input() name!: CallIconName;
  @Input() size = 20;
}
