import { Component, Input, Output, EventEmitter, ElementRef, ViewChild, AfterViewChecked, OnDestroy, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import dayjs from 'dayjs/esm';
import { DateFormatService } from '../../core/services/date-format.service';

interface TimeSlot {
  value: string; // 'HH:mm'
  label: string; // formatted per the user's 12h/24h time-format preference
}

// Rough panel height (time-list max-height + header/footer chrome) used to
// decide whether there's room to open downward — see updatePanelPosition().
const PANEL_HEIGHT_ESTIMATE = 320;

@Component({
  selector: 'app-time-picker',
  standalone: true,
  templateUrl: './time-picker.component.html',
  styleUrl: './time-picker.component.css',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TimePickerComponent), multi: true },
  ],
})
export class TimePickerComponent implements ControlValueAccessor, AfterViewChecked, OnDestroy {
  @Input() value: string | null = null; // 'HH:mm'
  @Input() placeholder = 'Select time';
  @Input() align: 'left' | 'right' = 'left';
  @Input() disabled = false; // read-only trigger (e.g. locked until a draft is approved) — cursor: not-allowed, no panel

  @Output() valueChange = new EventEmitter<string | null>();

  @ViewChild('list') listRef?: ElementRef<HTMLDivElement>;
  @ViewChild('trigger') triggerRef!: ElementRef<HTMLElement>;

  open = false;
  private scrollPending = false;

  slots: TimeSlot[] = [];

  // Panel is position:fixed and its coords are computed from the trigger's
  // viewport rect so it always escapes clipping ancestors (e.g. a scrollable
  // modal body with overflow: hidden/auto) instead of being cut off, and
  // flips to open upward when there isn't room below — see updatePanelPosition().
  panelTop: number | null = 0;
  panelBottom: number | null = null;
  panelLeft: number | null = 0;
  panelRight: number | null = null;

  private readonly reposition = () => this.updatePanelPosition();
  private onChange: (value: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private dateFormat: DateFormatService) {
    // Built in the constructor body (not a field initializer) so the
    // injected DateFormatService is assigned before buildSlots() reads it.
    this.slots = this.buildSlots();
  }

  ngOnDestroy() {
    this.removePositionListeners();
  }

  // ControlValueAccessor — additive: lets this component be bound via
  // [formControl]/formControlName as an alternative to its existing plain
  // [value]/(valueChange) @Input/@Output pair, which stays exactly as-is for
  // every other (template-driven) usage across the app.
  writeValue(value: string | null): void {
    this.value = value;
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  // onChange (the ControlValueAccessor callback, when bound via
  // formControlName) runs before the plain valueChange @Output — a
  // template's (valueChange) handler (e.g. clamping a paired end-date) may
  // read the FormControl's value synchronously and needs it already updated.
  private emit(value: string | null) {
    this.onChange(value);
    this.valueChange.emit(value);
  }

  get displayLabel(): string {
    return this.value ? dayjs(this.value, 'HH:mm').format(this.dateFormat.timeToken) : this.placeholder;
  }

  toggle() {
    if (this.disabled) return;
    this.open = !this.open;
    if (this.open) {
      this.scrollPending = true;
      this.updatePanelPosition();
      this.addPositionListeners();
    } else {
      this.removePositionListeners();
    }
  }

  close() {
    this.open = false;
    this.onTouched();
    this.removePositionListeners();
  }

  select(slot: TimeSlot) {
    this.emit(slot.value);
    this.close();
  }

  clear() {
    this.emit(null);
    this.close();
  }

  ngAfterViewChecked() {
    if (this.scrollPending && this.listRef) {
      const selectedEl = this.listRef.nativeElement.querySelector('.time-slot-selected');
      selectedEl?.scrollIntoView({ block: 'center' });
      this.scrollPending = false;
    }
  }

  private updatePanelPosition() {
    if (!this.triggerRef) return;
    const rect = this.triggerRef.nativeElement.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < PANEL_HEIGHT_ESTIMATE && rect.top > spaceBelow;

    if (openUpward) {
      this.panelTop = null;
      this.panelBottom = window.innerHeight - rect.top + 6;
    } else {
      this.panelTop = rect.bottom + 6;
      this.panelBottom = null;
    }

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
