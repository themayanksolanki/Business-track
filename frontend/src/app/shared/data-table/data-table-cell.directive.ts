import { Directive, Input, TemplateRef } from '@angular/core';

// Marks a <ng-template> as the custom cell renderer for one column, e.g.:
//   <ng-template appDataTableCell="owner" let-row>
//     <span>{{ row.owner?.username }}</span>
//   </ng-template>
// Columns with no matching template fall back to plain `row[key]` text —
// see DataTableComponent's defaultCell branch.
@Directive({
  selector: '[appDataTableCell]',
  standalone: true,
})
export class DataTableCellDirective {
  @Input('appDataTableCell') columnKey!: string;

  constructor(public templateRef: TemplateRef<{ $implicit: any; column: string }>) {}
}
