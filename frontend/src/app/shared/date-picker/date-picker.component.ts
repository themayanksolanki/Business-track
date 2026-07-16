import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges, ElementRef, ViewChild } from '@angular/core';
import dayjs from 'dayjs/esm';

interface CalendarDay {
  iso: string;
  label: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

@Component({
  selector: 'app-date-picker',
  standalone: true,
  templateUrl: './date-picker.component.html',
  styleUrl: './date-picker.component.css',
})
export class DatePickerComponent implements OnChanges, OnDestroy {
  @Input() value: string | null = null; // 'YYYY-MM-DD'
  @Input() placeholder = 'Select date';
  @Input() min: string | null = null; // 'YYYY-MM-DD' — days before this are disabled
  @Input() align: 'left' | 'right' = 'left'; // panel anchor side, use 'right' near a container's right edge
  @Input() compact = false; // shorter, borderless trigger for use inline in dense rows/tables

  @Output() valueChange = new EventEmitter<string | null>();

  @ViewChild('trigger') triggerRef!: ElementRef<HTMLElement>;

  open = false;
  viewMonth = dayjs().startOf('month');
  weeks: CalendarDay[][] = [];

  // Panel is position:fixed and its coords are computed from the trigger's
  // viewport rect so it always escapes clipping ancestors (e.g. a scrollable
  // modal body with overflow: hidden/auto) instead of being cut off.
  panelTop = 0;
  panelLeft: number | null = 0;
  panelRight: number | null = null;

  readonly weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  private readonly reposition = () => this.updatePanelPosition();

  constructor() {
    this.buildCalendar();
  }

  ngOnDestroy() {
    this.removePositionListeners();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['value']) {
      this.viewMonth = (this.value ? dayjs(this.value, 'YYYY-MM-DD') : dayjs()).startOf('month');
      this.buildCalendar();
    }
  }

  get displayLabel(): string {
    return this.value ? dayjs(this.value, 'YYYY-MM-DD').format('MMM D, YYYY') : this.placeholder;
  }

  get monthLabel(): string {
    return this.viewMonth.format('MMMM YYYY');
  }

  toggle() {
    this.open = !this.open;
    if (this.open) {
      this.viewMonth = (this.value ? dayjs(this.value, 'YYYY-MM-DD') : dayjs()).startOf('month');
      this.buildCalendar();
      this.updatePanelPosition();
      this.addPositionListeners();
    } else {
      this.removePositionListeners();
    }
  }

  close() {
    this.open = false;
    this.removePositionListeners();
  }

  prevMonth() {
    this.viewMonth = this.viewMonth.subtract(1, 'month');
    this.buildCalendar();
  }

  nextMonth() {
    this.viewMonth = this.viewMonth.add(1, 'month');
    this.buildCalendar();
  }

  isDisabled(iso: string): boolean {
    return !!this.min && iso < this.min;
  }

  selectDay(day: CalendarDay) {
    if (this.isDisabled(day.iso)) return;
    this.valueChange.emit(day.iso);
    this.close();
  }

  selectToday() {
    this.selectDay({
      iso: dayjs().format('YYYY-MM-DD'),
      label: dayjs().date(),
      inMonth: true,
      isToday: true,
      isSelected: false,
    });
  }

  clear() {
    this.valueChange.emit(null);
    this.close();
  }

  private updatePanelPosition() {
    if (!this.triggerRef) return;
    const rect = this.triggerRef.nativeElement.getBoundingClientRect();
    this.panelTop = rect.bottom + 6;
    if (this.align === 'right') {
      this.panelLeft = null;
      this.panelRight = window.innerWidth - rect.right;
    } else {
      this.panelLeft = rect.left;
      this.panelRight = null;
    }
  }

  private addPositionListeners() {
    // capture: true so scroll events from any scrollable ancestor (e.g. a
    // modal body) are seen too — 'scroll' doesn't bubble, but it does fire
    // during the capture phase on window.
    window.addEventListener('scroll', this.reposition, true);
    window.addEventListener('resize', this.reposition);
  }

  private removePositionListeners() {
    window.removeEventListener('scroll', this.reposition, true);
    window.removeEventListener('resize', this.reposition);
  }

  private buildCalendar() {
    const startOfMonth = this.viewMonth.startOf('month');
    const gridStart = startOfMonth.startOf('week');
    const today = dayjs().format('YYYY-MM-DD');
    const selected = this.value;

    const days: CalendarDay[] = [];
    let cursor = gridStart;
    for (let i = 0; i < 42; i++) {
      const iso = cursor.format('YYYY-MM-DD');
      days.push({
        iso,
        label: cursor.date(),
        inMonth: cursor.month() === this.viewMonth.month(),
        isToday: iso === today,
        isSelected: iso === selected,
      });
      cursor = cursor.add(1, 'day');
    }

    this.weeks = [];
    for (let i = 0; i < 6; i++) {
      this.weeks.push(days.slice(i * 7, i * 7 + 7));
    }
  }
}
