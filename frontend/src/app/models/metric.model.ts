import { User } from './user.model';
import { Department } from './department.model';
import { Category } from './category.model';
import { MetricFrequency } from './metric-tracking.model';

export type MetricStatus = 'active' | 'archived' | 'deleted';
// Decides how a metric's tracked values are decorated in the Bowling View's
// read mode — the actual unit shown (which currency/weight unit) comes from
// the VIEWING user's own Settings > General preferences, not the metric.
export type MetricDataType = 'number' | 'weight' | 'currency' | 'percentage';

export interface MetricParentLite {
  id: number;
  title: string;
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
  department: Pick<Department, 'id' | 'name' | 'color'>;
  category: Pick<Category, 'id' | 'name' | 'color'> | null;
  parent: MetricParentLite | null;
  owner: User;
  createdBy: User;
  updatedBy?: User | null;
  createdAt: string;
  updatedAt: string;
}

// Metrics-list row shape — only what the table renders (name/department/owner),
// plus frequency since the Bowling View's per-row lens filter needs it.
export type MetricListItem = Pick<Metric, 'id' | 'sequenceId' | 'title' | 'department' | 'owner' | 'status' | 'dataType' | 'frequency'>;

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
}

export interface PaginatedMetrics {
  metrics: MetricListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
