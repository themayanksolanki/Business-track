import { groupBy } from 'lodash-es';

// Column "type" drives which filter widget the header dropdown shows —
// 'none' (or omitted) means the column can still be sortable but has no
// filter UI at all (e.g. a computed/display-only column).
export type DataTableColumnType = 'text' | 'date' | 'multiselect' | 'none';

export interface DataTableFilterOption {
  value: string | number;
  label: string;
  color?: string; // renders a small color dot next to the label (department/category)
  depth?: number; // indentation level for hierarchical options (0 = root) — see toHierarchicalOptions
  // This option's parent value, if any — lets the multiselect checklist
  // cascade select/deselect between parent and descendants generically,
  // without knowing anything about departments/categories specifically.
  parentValue?: string | number | null;
}

export interface DataTableColumn {
  key: string; // unique id — also the field name sent to the backend for sort/filter
  label: string;
  type?: DataTableColumnType; // default 'none'
  sortable?: boolean;
  options?: DataTableFilterOption[]; // required for type: 'multiselect'
  align?: 'left' | 'right' | 'center';
  headerClass?: string;
  cellClass?: string;
  width?: string; // initial width, e.g. '120px' or '120' — also the floor a user can't resize below unless minWidth overrides it
  minWidth?: string; // floor for interactive column resizing; defaults to a fixed fallback if omitted
}

export type DataTableSortDirection = 'asc' | 'desc';

export interface DataTableSortState {
  key: string | null;
  direction: DataTableSortDirection | null;
}

// One entry per filtered column, keyed by DataTableColumn.key. Only the
// field(s) relevant to that column's type are ever populated.
export interface DataTableFilterValue {
  text?: string;
  dateFrom?: string | null; // 'YYYY-MM-DD'
  dateTo?: string | null; // 'YYYY-MM-DD'
  values?: (string | number)[]; // multiselect
}

export type DataTableFilterState = Record<string, DataTableFilterValue>;

// True if a filter value actually constrains anything — an empty/blank entry
// left over from an opened-then-cleared dropdown shouldn't count as active.
export function isFilterValueActive(value: DataTableFilterValue | undefined): boolean {
  if (!value) return false;
  if (value.text && value.text.trim()) return true;
  if (value.dateFrom || value.dateTo) return true;
  if (value.values && value.values.length > 0) return true;
  return false;
}

export interface HierarchicalSource {
  id: number | string;
  parentId: number | string | null;
}

// Flattens a parent/child list (Department, Category, or any future
// self-referencing tree) into proper depth-first tree order — each parent
// immediately followed by all its descendants, recursively — with a `depth`
// on each resulting option so the multiselect checklist can indent it.
// Doesn't trust the source array's own ordering (parentId/order from the
// backend is only guaranteed correct one level deep); an item whose
// parentId doesn't resolve to another item in the list is treated as a
// root rather than silently dropped.
export function toHierarchicalOptions<T extends HierarchicalSource>(
  items: T[],
  toOption: (item: T, depth: number) => DataTableFilterOption
): DataTableFilterOption[] {
  const validIds = new Set(items.map((i) => String(i.id)));
  const byParent = groupBy(items, (item) =>
    item.parentId != null && validIds.has(String(item.parentId)) ? String(item.parentId) : 'root'
  );

  const result: DataTableFilterOption[] = [];
  const visit = (parentKey: string, depth: number, parentValue: string | number | null) => {
    for (const child of byParent[parentKey] ?? []) {
      result.push({ ...toOption(child, depth), parentValue });
      visit(String(child.id), depth + 1, child.id);
    }
  };
  visit('root', 0, null);
  return result;
}
