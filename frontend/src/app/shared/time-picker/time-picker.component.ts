import { Component, Input, Output, EventEmitter, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import dayjs from 'dayjs/esm';
import { DateFormatService } from '../../core/services/date-format.service';

interface TimeSlot {
  value: string; // 'HH:mm'
  label: string; // formatted per the user's 12h/24h time-format preference
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
  @Input() disabled = false; // read-only trigger (e.g. locked until a draft is approved) — cursor: not-allowed, no panel

  @Output() valueChange = new EventEmitter<string | null>();

  @ViewChild('list') listRef?: ElementRef<HTMLDivElement>;

  open = false;
  private scrollPending = false;

  slots: TimeSlot[] = [];

  constructor(private dateFormat: DateFormatService) {
    // Built in the constructor body (not a field initializer) so the
    // injected DateFormatService is assigned before buildSlots() reads it.
    this.slots = this.buildSlots();
  }

  get displayLabel(): string {
    return this.value ? dayjs(this.value, 'HH:mm').format(this.dateFormat.timeToken) : this.placeholder;
  }

  toggle() {
    if (this.disabled) return;
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
      slots.push({ value: cursor.format('HH:mm'), label: cursor.format(this.dateFormat.timeToken) });
      cursor = cursor.add(30, 'minutes');
    }
    return slots;
  }
}
