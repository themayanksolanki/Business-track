import { Component, Input } from '@angular/core';
import { NgbTooltip, NgbPopover } from '@ng-bootstrap/ng-bootstrap';

// Drop-in "?" icon for inline help. Plain usage renders a hover tooltip
// (short one-liner); set `variant="popover"` for a bigger box that can also
// carry a `heading` — defaults to opening on hover, pass `trigger="click"`
// for longer feature-info content the user dismisses deliberately.
@Component({
  selector: 'app-help-tip',
  standalone: true,
  imports: [NgbTooltip, NgbPopover],
  templateUrl: './help-tip.component.html',
  styleUrl: './help-tip.component.css',
})
export class HelpTipComponent {
  @Input({ required: true }) text!: string;
  @Input() heading = '';
  @Input() variant: 'tooltip' | 'popover' = 'tooltip';
  @Input() trigger: 'hover' | 'click' = 'hover';
  @Input() placement = 'auto';
}
