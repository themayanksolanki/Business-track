import { User } from './user.model';

export interface Department {
  id: number;
  name: string;
  overview: string;
  color: string;
  parentId: number | null;
  depth: number;
  order: number;
  createdBy: User;
  updatedBy?: User | null;
  createdAt: string;
  updatedAt: string;
  userCount?: number;
  projectCount?: number;
  childCount?: number;
  metricCount?: number;
  eventCount?: number;
}

// Projects/metrics/events are deliberately count-only here (see
// Department.projectCount/.metricCount/.eventCount) — the detail panel
// never fetches or renders their individual titles/names, only children
// (sub-department navigation) and users (Team list + assignment) are full
// item lists, see departmentController.ts's getDepartmentById.
export interface DepartmentDetail {
  department: Department;
  children: Department[];
  users: User[];
}

export interface CreateDepartmentPayload {
  name: string;
  overview?: string;
  color?: string;
  parentId?: number | null;
}

export interface UpdateDepartmentPayload {
  name?: string;
  overview?: string;
  color?: string;
}

export interface PaginatedDepartments {
  departments: Department[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
