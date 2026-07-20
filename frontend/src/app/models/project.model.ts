import { User } from './user.model';
import { Department } from './department.model';
import { Category } from './category.model';
import { TagLite } from './tag.model';
import { ProjectRoleLite } from './project-role.model';

export type ProjectPriority = 'low' | 'medium' | 'high';
export type ProjectEffort = 'low' | 'medium' | 'high';
export type ProjectStatus = 'active' | 'archived' | 'completed' | 'draft';

export interface ProjectPlan {
  fileName: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedBy?: number;
  uploadedAt?: string;
}

// No id: links are stored as a plain JSON array on the project row (not
// individual relational rows), so there's nothing to key on but array index.
export interface ProjectLink {
  title: string;
  url: string;
}

export interface ProjectMember {
  id: number;
  user: User;
  role: ProjectRoleLite;
  addedAt: string;
  addedBy?: User | null;
}

export interface ProjectDetailsLayoutEntry {
  cardId: string;
  width?: number | null;
  height?: number | null;
}

export interface Project {
  id: number;
  sequenceId?: number | null;
  name: string;
  description: string;
  createdBy: User;
  updatedBy?: User | null;
  owner: User | null;
  department: Pick<Department, 'id' | 'name' | 'color'> | null;
  category: Pick<Category, 'id' | 'name' | 'color'> | null;
  priority: ProjectPriority;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  detailsText: string;
  effort: ProjectEffort;
  plan: ProjectPlan | null;
  links: ProjectLink[];
  tags: TagLite[];
  members: ProjectMember[];
  detailsLayout: ProjectDetailsLayoutEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectPayload {
  name: string;
  description?: string;
  owner?: number | null;
  department?: number | null;
  category?: number | null;
  priority?: ProjectPriority;
  effort?: ProjectEffort;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  tags?: number[];
}

export interface UpdateProjectPayload {
  name?: string;
  description?: string;
  owner?: number | null;
  department?: number | null;
  category?: number | null;
  priority?: ProjectPriority;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  detailsText?: string;
  effort?: ProjectEffort;
  links?: ProjectLink[];
  tags?: number[];
}

export interface PaginatedProjects {
  projects: Project[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
