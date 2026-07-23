import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgbDatepickerModule, NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';
import dayjs from 'dayjs/esm';
import { DateFormatService } from '../../core/services/date-format.service';

// Rough panel height (header + weekday row + 6 week rows + footer) used to
// decide whether there's room to open downward — see updatePanelPosition().
const PANEL_HEIGHT_ESTIMATE = 380;

function isoToStruct(iso: string): NgbDateStruct {
  const d = dayjs(iso, 'YYYY-MM-DD');
  return { year: d.year(), month: d.month() + 1, day: d.date() };
}

function structToIso(s: NgbDateStruct): string {
  return dayjs(`${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`, 'YYYY-MM-DD').format(
    'YYYY-MM-DD'
  );
}

@Component({
  selector: 'app-date-picker',
  standalone: true,
  imports: [FormsModule, NgbDatepickerModule],
  templateUrl: './date-picker.component.html',
  styleUrl: './date-picker.component.css',
})
export class DatePickerComponent implements OnChanges, OnDestroy {
  @Input() value: string | null = null; // 'YYYY-MM-DD'
  // '' means "use the user's configured date format as the placeholder"
  // (see effectivePlaceholder) — pass an explicit string (e.g. "None") to override.
  @Input() placeholder = '';
  @Input() min: string | null = null; // 'YYYY-MM-DD' — days before this are disabled/rejected
  @Input() align: 'left' | 'right' = 'left'; // panel anchor side, use 'right' near a container's right edge
  @Input() compact = false; // shorter, borderless trigger for use inline in dense rows/tables
  @Input() disabled = false; // read-only trigger (e.g. locked until a draft is approved) — cursor: not-allowed, no panel

  @Output() valueChange = new EventEmitter<string | null>();

  @ViewChild('trigger') triggerRef!: ElementRef<HTMLElement>;

  open = false;
  ngbModel: NgbDateStruct | null = null;
  minDate: NgbDateStruct | null = null;
  inputText = '';
  error: string | null = null;

  // Panel/error banner are position:fixed and their coords are computed from
  // the trigger's viewport rect so they always escape clipping ancestors
  // (e.g. a scrollable modal body with overflow: hidden/auto) instead of
  // being cut off, and flip to open upward when there isn't room below —
  // see updatePanelPosition().
  panelTop: number | null = 0;
  panelBottom: number | null = null;
  panelLeft: number | null = 0;
  panelRight: number | null = null;

  private readonly reposition = () => this.updatePanelPosition();

  constructor(private dateFormat: DateFormatService) {}

  ngOnDestroy() {
    this.removePositionListeners();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['value']) {
      this.ngbModel = this.value ? isoToStruct(this.value) : null;
      this.syncInputText();
    }
    if (changes['min']) {
      this.minDate = this.min ? isoToStruct(this.min) : null;
    }
  }

  get effectivePlaceholder(): string {
    return this.placeholder || this.dateFormat.dateToken;
  }

  get startDate(): NgbDateStruct {
    return this.ngbModel ?? isoToStruct(dayjs().format('YYYY-MM-DD'));
  }

  private syncInputText() {
    this.inputText = this.value ? dayjs(this.value, 'YYYY-MM-DD').format(this.dateFormat.dateToken) : '';
    this.clearError();
  }

  onFocus() {
    this.openPanel();
  }

  onInput(event: Event) {
    this.inputText = (event.target as HTMLInputElement).value;
    if (this.error) this.clearError();
  }

  onEnter(event: Event) {
    event.preventDefault();
    if (this.commitInput()) this.close();
  }

  onBlur() {
    this.commitInput();
  }

  // Parses inputText against the user's configured date format (strict, so
  // e.g. a missing leading zero or an out-of-range day like 30 Feb is
  // rejected rather than silently rounded) and, if valid, emits the ISO
  // value. Returns false and sets `error` instead of emitting on any
  // failure — malformed text, impossible date, or before `min`.
  private commitInput(): boolean {
    const text = this.inputText.trim();
    const token = this.dateFormat.dateToken;

    if (!text) {
      this.clearError();
      if (this.value !== null) this.valueChange.emit(null);
      return true;
    }

    const parsed = dayjs(text, token, true);
    if (!parsed.isValid() || parsed.format(token) !== text) {
      this.setError(`Enter a date as ${token}`);
      return false;
    }

    const iso = parsed.format('YYYY-MM-DD');
    if (this.min && iso < this.min) {
      this.setError(`Must be on or after ${dayjs(this.min, 'YYYY-MM-DD').format(token)}`);
      return false;
    }

    this.clearError();
    if (iso !== this.value) this.valueChange.emit(iso);
    else this.syncInputText();
    return true;
  }

  private setError(message: string) {
    this.error = message;
    if (!this.open) {
      this.updatePanelPosition();
      this.addPositionListeners();
    }
  }

  private clearError() {
    const hadError = !!this.error;
    this.error = null;
    if (hadError && !this.open) this.removePositionListeners();
  }

  toggleIcon() {
    if (this.disabled) return;
    if (this.open) this.close();
    else this.openPanel();
  }

  openPanel() {
    if (this.disabled || this.open) return;
    this.open = true;
    this.updatePanelPosition();
    this.addPositionListeners();
  }

  close() {
    this.open = false;
    if (this.error) this.updatePanelPosition();
    else this.removePositionListeners();
  }

  onDateSelect(date: NgbDateStruct) {
    this.valueChange.emit(structToIso(date));
    this.close();
  }

  selectToday() {
    this.valueChange.emit(dayjs().format('YYYY-MM-DD'));
    this.close();
  }

  clear() {
    this.valueChange.emit(null);
    this.inputText = '';
    this.clearError();
    this.close();
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
}
