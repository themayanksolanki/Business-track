import { User } from './user.model';
import { Department } from './department.model';
import { Category } from './category.model';
import { MetricFrequency } from './metric-tracking.model';

export type MetricStatus = 'active' | 'archived' | 'deleted';
// Decides how a metric's tracked values are decorated in the Bowling View's
// read mode — the actual unit shown (which currency/weight unit) comes from
// the metric's own organization's Settings, not the metric or the viewer.
export type MetricDataType = 'number' | 'weight' | 'currency' | 'percentage';

export interface MetricParentLite {
  id: number;
  title: string;
}

export type MetricMemberRole = 'owner' | 'editor' | 'viewer';

export interface MetricMember {
  id: number;
  user: User;
  role: MetricMemberRole;
  addedAt: string;
  addedBy?: User | null;
}

// Lightweight membership shape returned by the list endpoints (getMetrics/
// getMetricTiles' METRIC_LIST_INCLUDE) — just enough for canEditMetric-style
// client-side gating, unlike MetricMember's full nested-user shape (used by
// the Team tab, from METRIC_INCLUDE/metricMemberController.ts).
export interface MetricMembershipLite {
  userId: number;
  role: MetricMemberRole;
}

// Per-metric custom header labels for the Sheet tab's tracking grid columns
// (shared/metric-sheet/) — any key left unset falls back to the built-in
// default label (e.g. "Actual").
export interface MetricColumnLabels {
  actual?: string;
  target?: string;
  lowest?: string;
  medium?: string;
  upper?: string;
  status?: string;
  note?: string;
}

export interface Metric {
  id: number;
  sequenceId?: number | null;
  title: string;
  notes: string;
  status: MetricStatus;
  dataType: MetricDataType;
  frequency: MetricFrequency;
  order: number;
  depth: number;
  startDate: string | null;
  dueDate: string | null;
  columnLabels?: MetricColumnLabels | null;
  // Freezes every field/tracking edit for everyone (Detail tab, Sheet tab,
  // Bowling View cells) until the owner or an Admin unlocks it again — see
  // canLockMetricListItem (metric-value.util.ts).
  isLocked: boolean;
  department: Pick<Department, 'id' | 'name' | 'color'>;
  category: Pick<Category, 'id' | 'name' | 'color'> | null;
  parent: MetricParentLite | null;
  owner: User;
  createdBy: User;
  updatedBy?: User | null;
  createdAt: string;
  updatedAt: string;
  members?: MetricMember[];
}

// Metrics-list row shape — only what the table renders (name/department/category/owner),
// plus frequency since the Bowling View's per-row lens filter needs it.
// `members` is an optional add-on (only the Metrics/Tiles list endpoints'
// METRIC_LIST_INCLUDE return it, in its lightweight userId+role shape) so
// canEditMetric can be mirrored client-side (see metric-value.util.ts's
// canEditMetricListItem) to gate Create/Edit/Delete buttons and Bowling's
// inline click-to-edit for a Viewer, without breaking existing call sites
// that build a MetricListItem without it (e.g. the Linked tab's SUB_METRIC_INCLUDE).
export type MetricListItem = Pick<Metric, 'id' | 'sequenceId' | 'title' | 'department' | 'category' | 'owner' | 'status' | 'dataType' | 'frequency' | 'isLocked'> & {
  members?: MetricMembershipLite[];
};

// Tiles View row shape — MetricListItem plus what a tile grid needs on top:
// `order`/`parentId` to group and persist drag-drop, `parent` for a
// non-root group's "Under: <parent>" heading.
export type MetricTileItem = MetricListItem & {
  order: number;
  parentId: number | null;
  parent: MetricParentLite | null;
};

export interface CreateMetricPayload {
  title: string;
  department: number;
  owner: number;
  category?: number | null;
  parentId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  notes?: string;
  dataType?: MetricDataType;
  frequency?: MetricFrequency;
  columnLabels?: MetricColumnLabels | null;
}

export interface UpdateMetricPayload {
  title?: string;
  department?: number;
  owner?: number;
  category?: number | null;
  parentId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  notes?: string;
  status?: MetricStatus;
  dataType?: MetricDataType;
  frequency?: MetricFrequency;
  columnLabels?: MetricColumnLabels | null;
}

export interface PaginatedMetrics {
  metrics: MetricListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
