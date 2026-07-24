import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgbDatepickerModule, NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';
import dayjs from 'dayjs/esm';

// Same NgbDateStruct<->ISO conversion as date-picker.component.ts — kept
// local rather than shared since the two components' Input/Output shapes
// differ enough (this one has no text-input/typing) that extracting a
// common helper wasn't worth it for two small functions.
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
  selector: 'app-mini-month-picker',
  standalone: true,
  imports: [FormsModule, NgbDatepickerModule],
  templateUrl: './mini-month-picker.component.html',
  styleUrl: './mini-month-picker.component.css',
})
export class MiniMonthPickerComponent implements OnChanges {
  @Input() selectedDate: string | null = null; // 'YYYY-MM-DD'
  @Output() dateSelected = new EventEmitter<string>();

  ngbModel: NgbDateStruct | null = null;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selectedDate']) {
      this.ngbModel = this.selectedDate ? isoToStruct(this.selectedDate) : null;
    }
  }

  onDateSelect(date: NgbDateStruct) {
    this.dateSelected.emit(structToIso(date));
  }
}
