import { User } from './user.model';
import { Department } from './department.model';

export type ProjectPriority = 'low' | 'medium' | 'high';
export type ProjectStatus = 'active' | 'completed';

export interface Project {
  _id: string;
  name: string;
  description: string;
  createdBy: User;
  owner: User | null;
  department: Pick<Department, '_id' | 'name' | 'color'> | null;
  priority: ProjectPriority;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectPayload {
  name: string;
  description?: string;
  owner?: string | null;
  department?: string | null;
  priority?: ProjectPriority;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateProjectPayload {
  name?: string;
  description?: string;
  owner?: string | null;
  department?: string | null;
  priority?: ProjectPriority;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
}

export interface PaginatedProjects {
  projects: Project[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
