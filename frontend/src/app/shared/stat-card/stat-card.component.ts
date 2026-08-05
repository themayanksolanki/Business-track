import { Component, Input } from '@angular/core';

export type StatCardVariant = 'total' | 'active' | 'completed' | 'archived' | 'overdue' | 'muted';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  templateUrl: './stat-card.component.html',
  styleUrl: './stat-card.component.css',
})
export class StatCardComponent {
  @Input({ required: true }) icon!: string;
  @Input({ required: true }) value!: number | string;
  @Input({ required: true }) label!: string;
  @Input() variant: StatCardVariant = 'muted';
}
