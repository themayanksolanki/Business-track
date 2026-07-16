import { User } from './user.model';
import { Project } from './project.model';

export interface Department {
  _id: string;
  name: string;
  overview: string;
  color: string;
  parentId: string | null;
  depth: number;
  order: number;
  createdBy: User;
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
  parentId?: string | null;
}

export interface UpdateDepartmentPayload {
  name?: string;
  overview?: string;
  color?: string;
}
