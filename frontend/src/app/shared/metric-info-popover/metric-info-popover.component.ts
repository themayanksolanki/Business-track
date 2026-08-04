import { Component, Input } from '@angular/core';
import { MetricListItem } from '../../models/metric.model';

// Hover-title info card, shared by the Bowling View and the Tiles View —
// wrap this in a page-local `<ng-template #metricInfoPopover>` and bind
// `[ngbPopover]="metricInfoPopover" ... popoverClass="metric-info-popover"`
// on whichever title element should trigger it (see metric-bowling/
// metric-tiles for the exact attribute set). The `.metric-info-popover`
// wrapper class itself (width/radius/shadow/arrow colors) lives in the
// global stylesheet, not here — that class targets ng-bootstrap's own
// `.popover` element (container="body"), which sits outside this
// component's view and can't be styled from a component-scoped stylesheet.
@Component({
  selector: 'app-metric-info-popover',
  standalone: true,
  templateUrl: './metric-info-popover.component.html',
  styleUrl: './metric-info-popover.component.css',
})
export class MetricInfoPopoverComponent {
  @Input({ required: true }) item!: MetricListItem;
}
