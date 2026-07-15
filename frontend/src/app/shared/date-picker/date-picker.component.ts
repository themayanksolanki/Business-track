import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import moment from 'moment';

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
export class DatePickerComponent implements OnChanges {
  @Input() value: string | null = null; // 'YYYY-MM-DD'
  @Input() placeholder = 'Select date';
  @Input() min: string | null = null; // 'YYYY-MM-DD' — days before this are disabled
  @Input() align: 'left' | 'right' = 'left'; // panel anchor side, use 'right' near a container's right edge
  @Input() compact = false; // shorter, borderless trigger for use inline in dense rows/tables

  @Output() valueChange = new EventEmitter<string | null>();

  open = false;
  viewMonth = moment().startOf('month');
  weeks: CalendarDay[][] = [];

  readonly weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  constructor() {
    this.buildCalendar();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['value']) {
      this.viewMonth = (this.value ? moment(this.value, 'YYYY-MM-DD') : moment()).clone().startOf('month');
      this.buildCalendar();
    }
  }

  get displayLabel(): string {
    return this.value ? moment(this.value, 'YYYY-MM-DD').format('MMM D, YYYY') : this.placeholder;
  }

  get monthLabel(): string {
    return this.viewMonth.format('MMMM YYYY');
  }

  toggle() {
    this.open = !this.open;
    if (this.open) {
      this.viewMonth = (this.value ? moment(this.value, 'YYYY-MM-DD') : moment()).clone().startOf('month');
      this.buildCalendar();
    }
  }

  close() {
    this.open = false;
  }

  prevMonth() {
    this.viewMonth = this.viewMonth.clone().subtract(1, 'month');
    this.buildCalendar();
  }

  nextMonth() {
    this.viewMonth = this.viewMonth.clone().add(1, 'month');
    this.buildCalendar();
  }

  isDisabled(iso: string): boolean {
    return !!this.min && iso < this.min;
  }

  selectDay(day: CalendarDay) {
    if (this.isDisabled(day.iso)) return;
    this.valueChange.emit(day.iso);
    this.open = false;
  }

  selectToday() {
    this.selectDay({
      iso: moment().format('YYYY-MM-DD'),
      label: moment().date(),
      inMonth: true,
      isToday: true,
      isSelected: false,
    });
  }

  clear() {
    this.valueChange.emit(null);
    this.open = false;
  }

  private buildCalendar() {
    const startOfMonth = this.viewMonth.clone().startOf('month');
    const gridStart = startOfMonth.clone().startOf('week');
    const today = moment().format('YYYY-MM-DD');
    const selected = this.value;

    const days: CalendarDay[] = [];
    const cursor = gridStart.clone();
    for (let i = 0; i < 42; i++) {
      const iso = cursor.format('YYYY-MM-DD');
      days.push({
        iso,
        label: cursor.date(),
        inMonth: cursor.month() === this.viewMonth.month(),
        isToday: iso === today,
        isSelected: iso === selected,
      });
      cursor.add(1, 'day');
    }

    this.weeks = [];
    for (let i = 0; i < 6; i++) {
      this.weeks.push(days.slice(i * 7, i * 7 + 7));
    }
  }
}
