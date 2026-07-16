import { Component, Input, Output, EventEmitter, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import dayjs from 'dayjs/esm';

interface TimeSlot {
  value: string; // 'HH:mm'
  label: string; // 'h:mm A'
}

@Component({
  selector: 'app-time-picker',
  standalone: true,
  templateUrl: './time-picker.component.html',
  styleUrl: './time-picker.component.css',
})
export class TimePickerComponent implements AfterViewChecked {
  @Input() value: string | null = null; // 'HH:mm'
  @Input() placeholder = 'Select time';
  @Input() align: 'left' | 'right' = 'left';

  @Output() valueChange = new EventEmitter<string | null>();

  @ViewChild('list') listRef?: ElementRef<HTMLDivElement>;

  open = false;
  private scrollPending = false;

  readonly slots: TimeSlot[] = this.buildSlots();

  get displayLabel(): string {
    return this.value ? dayjs(this.value, 'HH:mm').format('h:mm A') : this.placeholder;
  }

  toggle() {
    this.open = !this.open;
    if (this.open) this.scrollPending = true;
  }

  close() {
    this.open = false;
  }

  select(slot: TimeSlot) {
    this.valueChange.emit(slot.value);
    this.open = false;
  }

  clear() {
    this.valueChange.emit(null);
    this.open = false;
  }

  ngAfterViewChecked() {
    if (this.scrollPending && this.listRef) {
      const selectedEl = this.listRef.nativeElement.querySelector('.time-slot-selected');
      selectedEl?.scrollIntoView({ block: 'center' });
      this.scrollPending = false;
    }
  }

  private buildSlots(): TimeSlot[] {
    const slots: TimeSlot[] = [];
    let cursor = dayjs().startOf('day');
    for (let i = 0; i < 48; i++) {
      slots.push({ value: cursor.format('HH:mm'), label: cursor.format('h:mm A') });
      cursor = cursor.add(30, 'minutes');
    }
    return slots;
  }
}
