import { User } from './user.model';
import { Project } from './project.model';

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
}

export interface DepartmentDetail {
  department: Department;
  children: Department[];
  users: User[];
  projects: Project[];
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
