import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { EMOJI_CATEGORIES } from '../emoji-data';

// Single-select: one emoji per item, not a reaction set — picking a new one
// replaces whatever was there, and the Clear option sets it back to null.
@Component({
  selector: 'app-emoji-picker',
  standalone: true,
  templateUrl: './emoji-picker.component.html',
  styleUrl: './emoji-picker.component.css',
})
export class EmojiPickerComponent {
  @Input() value: string | null = null;
  @Input() disabled = false;
  // 'default' — bordered box, for a plain card/sidebar background.
  // 'ghost' — borderless, translucent-on-hover (mirrors project-item-detail's
  // .detail-x close button), for sitting on a colored/gradient header where a
  // fixed background or border wouldn't read consistently across themes.
  @Input() variant: 'default' | 'ghost' = 'default';
  @Output() emojiSelected = new EventEmitter<string | null>();

  readonly emojiCategories = EMOJI_CATEGORIES;

  open = false;
  activeCatIdx = 0;

  // Same pattern as chat's emoji picker: a document-level click listener
  // closes it, with (click)="$event.stopPropagation()" on the trigger/panel
  // so opening/interacting with the panel doesn't immediately close itself.
  @HostListener('document:click')
  onDocumentClick() {
    this.open = false;
  }

  toggle(event: MouseEvent) {
    event.stopPropagation();
    if (this.disabled) return;
    this.open = !this.open;
    if (this.open) this.activeCatIdx = 0;
  }

  select(event: MouseEvent, emoji: string) {
    event.stopPropagation();
    this.emojiSelected.emit(emoji);
    this.open = false;
  }

  clear(event: MouseEvent) {
    event.stopPropagation();
    this.emojiSelected.emit(null);
    this.open = false;
  }
}
