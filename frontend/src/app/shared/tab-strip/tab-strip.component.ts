import { Component, Input, Output, EventEmitter } from '@angular/core';

export interface TabDef {
  key: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-tab-strip',
  standalone: true,
  templateUrl: './tab-strip.component.html',
  styleUrl: './tab-strip.component.css',
})
export class TabStripComponent {
  @Input() tabs: TabDef[] = [];
  @Input() activeKey = '';
  @Output() tabChange = new EventEmitter<string>();

  select(key: string) {
    if (key === this.activeKey) return;
    this.tabChange.emit(key);
  }
}
