import { User } from './user.model';

export type ProjectPriority = 'low' | 'medium' | 'high';

export interface Project {
  _id: string;
  name: string;
  description: string;
  createdBy: User;
  owner: User | null;
  priority: ProjectPriority;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectPayload {
  name: string;
  description?: string;
  owner?: string | null;
  priority?: ProjectPriority;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateProjectPayload {
  name?: string;
  description?: string;
  owner?: string | null;
  priority?: ProjectPriority;
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
