import {
  Component,
  ContentChildren,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  QueryList,
  SimpleChanges,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { omit, uniq } from 'lodash-es';
import { DataTableCellDirective } from './data-table-cell.directive';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import {
  DataTableColumn,
  DataTableFilterOption,
  DataTableFilterState,
  DataTableFilterValue,
  DataTableSortDirection,
  DataTableSortState,
  isFilterValueActive,
} from './data-table.model';

const EMPTY_FILTER_VALUE: DataTableFilterValue = {};
const DEFAULT_COLUMN_WIDTH = 140;
const DEFAULT_MIN_WIDTH = 80;

@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, NgbDropdownModule, DatePickerComponent],
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.css',
})
export class DataTableComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) columns: DataTableColumn[] = [];
  @Input() rows: any[] = [];
  @Input() loading = false;
  @Input() emptyMessage = 'No results found.';

  @Input() sortState: DataTableSortState = { key: null, direction: null };
  @Input() filterState: DataTableFilterState = {};

  // Pagination footer is optional — omit `totalItems` to hide it entirely
  // (e.g. a small client-side-only list with no paging).
  @Input() page = 1;
  @Input() pageSize = 10;
  @Input() totalItems?: number;

  @Input() trackBy: (index: number, row: any) => any = (i, row) => row?.id ?? i;
  @Input() rowClass: (row: any) => string = () => '';

  @Output() sortChange = new EventEmitter<DataTableSortState>();
  @Output() filterChange = new EventEmitter<DataTableFilterState>();
  @Output() rowClick = new EventEmitter<any>();
  @Output() pageChange = new EventEmitter<number>();

  @ContentChildren(DataTableCellDirective) cellTemplates!: QueryList<DataTableCellDirective>;

  // Pending edits for whichever filter dropdown is open — reset from the
  // committed filterState each time a dropdown opens, discarded if closed
  // without hitting Apply. Keyed by column key, same shape as filterState.
  draftFilters: DataTableFilterState = {};
  optionSearchByColumn: Record<string, string> = {};

  // Live column widths in px, keyed by column key — seeded once from each
  // column's `width` (or a fallback) and then only ever touched by dragging
  // a resize handle, so re-renders (new page, new sort) never reset a size
  // the user picked.
  columnWidths: Record<string, number> = {};
  private resizingKey: string | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private readonly onResizeMove = (event: MouseEvent) => {
    if (!this.resizingKey) return;
    const col = this.columns.find((c) => c.key === this.resizingKey);
    const minWidth = this.minWidthFor(col);
    this.columnWidths[this.resizingKey] = Math.max(minWidth, this.resizeStartWidth + (event.clientX - this.resizeStartX));
  };
  private readonly onResizeEnd = () => {
    this.resizingKey = null;
    window.removeEventListener('mousemove', this.onResizeMove);
    window.removeEventListener('mouseup', this.onResizeEnd);
  };

  ngOnChanges(changes: SimpleChanges) {
    if (changes['filterState']) {
      this.draftFilters = { ...this.filterState };
    }
    if (changes['columns']) {
      for (const col of this.columns) {
        if (this.columnWidths[col.key] === undefined) {
          this.columnWidths[col.key] = this.parseWidth(col.width) ?? DEFAULT_COLUMN_WIDTH;
        }
      }
    }
  }

  ngOnDestroy() {
    this.onResizeEnd();
  }

  private parseWidth(width: string | undefined): number | null {
    if (!width) return null;
    const n = parseInt(width, 10);
    return Number.isFinite(n) ? n : null;
  }

  minWidthFor(col: DataTableColumn | undefined): number {
    return this.parseWidth(col?.minWidth) ?? DEFAULT_MIN_WIDTH;
  }

  startResize(event: MouseEvent, col: DataTableColumn) {
    event.preventDefault();
    event.stopPropagation();
    // Defensive: guarantees no duplicate window listeners if a previous drag
    // somehow never got its mouseup (e.g. released outside the window).
    this.onResizeEnd();
    this.resizingKey = col.key;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.columnWidths[col.key] ?? this.parseWidth(col.width) ?? DEFAULT_COLUMN_WIDTH;
    window.addEventListener('mousemove', this.onResizeMove);
    window.addEventListener('mouseup', this.onResizeEnd);
  }

  cellTemplateFor(key: string) {
    return this.cellTemplates?.find((t) => t.columnKey === key)?.templateRef ?? null;
  }

  trackByCol(_: number, col: DataTableColumn) {
    return col.key;
  }

  // --- sorting ---

  sortDirFor(col: DataTableColumn): DataTableSortDirection | null {
    return this.sortState.key === col.key ? this.sortState.direction : null;
  }

  setSort(col: DataTableColumn, direction: DataTableSortDirection) {
    this.sortChange.emit({ key: col.key, direction });
  }

  clearSort() {
    this.sortChange.emit({ key: null, direction: null });
  }

  // --- filter dropdown lifecycle ---

  onDropdownOpenChange(open: boolean, col: DataTableColumn) {
    if (open) {
      this.draftFilters[col.key] = { ...(this.filterState[col.key] ?? {}) };
      this.optionSearchByColumn[col.key] = '';
    }
  }

  draft(key: string): DataTableFilterValue {
    return this.draftFilters[key] ?? EMPTY_FILTER_VALUE;
  }

  isColumnFiltered(col: DataTableColumn): boolean {
    return isFilterValueActive(this.filterState[col.key]);
  }

  setDraftText(key: string, value: string) {
    this.draftFilters[key] = { ...this.draft(key), text: value };
  }

  setDraftDate(key: string, field: 'dateFrom' | 'dateTo', value: string | null) {
    this.draftFilters[key] = { ...this.draft(key), [field]: value };
  }

  isOptionChecked(key: string, value: string | number): boolean {
    return !!this.draft(key).values?.includes(value);
  }

  // A hierarchical option (department/category, ...) shows as indeterminate
  // when it's not itself selected but some of its descendants are — the
  // usual tri-state tree-checkbox convention.
  isOptionIndeterminate(col: DataTableColumn, value: string | number): boolean {
    if (this.isOptionChecked(col.key, value)) return false;
    const descendants = this.getDescendantValues(col, value);
    if (!descendants.length) return false;
    const values = this.draft(col.key).values ?? [];
    return descendants.some((d) => values.includes(d));
  }

  // Checking a parent selects every descendant with it; unchecking it
  // deselects every descendant. Either direction then walks back up:
  // an ancestor becomes checked once ALL of its direct children are
  // checked, and unchecked the moment any of them isn't — so toggling a
  // single leaf can also check/uncheck its parent, grandparent, etc.
  toggleOption(col: DataTableColumn, value: string | number) {
    const willCheck = !this.isOptionChecked(col.key, value);
    const affected = [value, ...this.getDescendantValues(col, value)];
    const current = this.draft(col.key).values ?? [];

    let values = willCheck ? uniq([...current, ...affected]) : current.filter((v) => !affected.includes(v));
    values = this.reconcileAncestors(col, value, values);

    this.draftFilters[col.key] = { ...this.draft(col.key), values };
  }

  private findOption(col: DataTableColumn, value: string | number): DataTableFilterOption | undefined {
    return (col.options ?? []).find((o) => o.value === value);
  }

  private getDescendantValues(col: DataTableColumn, value: string | number): (string | number)[] {
    const directChildren = (col.options ?? []).filter((o) => o.parentValue === value).map((o) => o.value);
    return directChildren.flatMap((childValue) => [childValue, ...this.getDescendantValues(col, childValue)]);
  }

  private reconcileAncestors(
    col: DataTableColumn,
    changedValue: string | number,
    values: (string | number)[]
  ): (string | number)[] {
    let result = values;
    let current = this.findOption(col, changedValue);
    while (current?.parentValue != null) {
      const parentValue = current.parentValue;
      const siblings = (col.options ?? []).filter((o) => o.parentValue === parentValue);
      const allSiblingsChecked = siblings.every((s) => result.includes(s.value));
      result = allSiblingsChecked ? uniq([...result, parentValue]) : result.filter((v) => v !== parentValue);
      current = this.findOption(col, parentValue);
    }
    return result;
  }

  optionSearch(key: string): string {
    return this.optionSearchByColumn[key] ?? '';
  }

  setOptionSearch(key: string, value: string) {
    this.optionSearchByColumn[key] = value;
  }

  filteredOptions(col: DataTableColumn): DataTableFilterOption[] {
    const options = col.options ?? [];
    const query = this.optionSearch(col.key).trim().toLowerCase();
    if (!query) return options;
    return options.filter((o) => o.label.toLowerCase().includes(query));
  }

  applyFilter(key: string) {
    this.filterState = { ...this.filterState, [key]: this.draft(key) };
    this.filterChange.emit(this.filterState);
  }

  clearFilter(key: string) {
    this.filterState = omit(this.filterState, [key]);
    this.draftFilters[key] = {};
    this.filterChange.emit(this.filterState);
  }

  // --- pagination ---

  get totalPages(): number {
    if (this.totalItems === undefined) return 1;
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  get pageStart(): number {
    return !this.totalItems ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.page * this.pageSize, this.totalItems ?? 0);
  }

  get pageNumbers(): number[] {
    const total = this.totalPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages: number[] = [1];
    const left = Math.max(2, this.page - 1);
    const right = Math.min(total - 1, this.page + 1);

    if (left > 2) pages.push(-1);
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < total - 1) pages.push(-1);
    pages.push(total);
    return pages;
  }

  goToPage(p: number) {
    if (p < 1 || p > this.totalPages || p === this.page) return;
    this.pageChange.emit(p);
  }
}
