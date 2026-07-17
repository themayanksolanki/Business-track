import { Component, Input } from '@angular/core';
import { TagLite } from '../../models/tag.model';

@Component({
  selector: 'app-tag-pill',
  standalone: true,
  templateUrl: './tag-pill.component.html',
  styleUrl: './tag-pill.component.css',
})
export class TagPillComponent {
  @Input({ required: true }) tag!: Pick<TagLite, 'name' | 'textColor' | 'backgroundColor'>;
}
