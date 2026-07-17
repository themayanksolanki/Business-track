import { User } from './user.model';
import { Department } from './department.model';
import { Category } from './category.model';
import { TagLite } from './tag.model';

export type ProjectPriority = 'low' | 'medium' | 'high';
export type ProjectStatus = 'active' | 'completed';

export interface ProjectPlan {
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy?: string;
  uploadedAt?: string;
}

export interface ProjectLink {
  _id?: string;
  title: string;
  url: string;
}

export interface Project {
  _id: string;
  numericId?: number | null;
  name: string;
  description: string;
  createdBy: User;
  updatedBy?: User | null;
  owner: User | null;
  department: Pick<Department, '_id' | 'name' | 'color'> | null;
  category: Pick<Category, '_id' | 'name' | 'color'> | null;
  priority: ProjectPriority;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  detailsText: string;
  effort: number;
  plan: ProjectPlan | null;
  links: ProjectLink[];
  tags: TagLite[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectPayload {
  name: string;
  description?: string;
  owner?: string | null;
  department?: string | null;
  category?: string | null;
  priority?: ProjectPriority;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  tags?: string[];
}

export interface UpdateProjectPayload {
  name?: string;
  description?: string;
  owner?: string | null;
  department?: string | null;
  category?: string | null;
  priority?: ProjectPriority;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  detailsText?: string;
  effort?: number;
  links?: ProjectLink[];
  tags?: string[];
}

export interface PaginatedProjects {
  projects: Project[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
