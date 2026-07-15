import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ContextMenuItem {
  label: string;
  icon: string;
  action: string;
  danger?: boolean;
}

@Component({
  selector: 'app-context-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './context-menu.component.html',
  styleUrl: './context-menu.component.css',
})
export class ContextMenuComponent implements OnChanges {
  @Input() visible = false;
  @Input() x = 0;
  @Input() y = 0;
  @Input() items: ContextMenuItem[] = [];

  @Output() action = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();

  posX = 0;
  posY = 0;

  private static readonly MENU_WIDTH = 200;
  private static readonly ITEM_HEIGHT = 40;
  private static readonly PADDING = 16;

  ngOnChanges(changes: SimpleChanges) {
    if (!this.visible) return;
    if (changes['visible'] || changes['x'] || changes['y'] || changes['items']) {
      this.reposition();
    }
  }

  private reposition() {
    const menuWidth  = ContextMenuComponent.MENU_WIDTH;
    const menuHeight = this.items.length * ContextMenuComponent.ITEM_HEIGHT + ContextMenuComponent.PADDING;
    const maxX = window.innerWidth  - menuWidth  - 8;
    const maxY = window.innerHeight - menuHeight - 8;
    this.posX = Math.max(8, Math.min(this.x, maxX));
    this.posY = Math.max(8, Math.min(this.y, maxY));
  }

  onItemClick(item: ContextMenuItem) {
    this.action.emit(item.action);
    this.close.emit();
  }

  onBackdropClick() {
    this.close.emit();
  }
}
