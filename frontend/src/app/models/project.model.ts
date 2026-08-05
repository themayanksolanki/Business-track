import { User } from './user.model';
import { Department } from './department.model';
import { Category } from './category.model';
import { TagLite } from './tag.model';
import { ProjectRoleLite } from './project-role.model';
import { StatusForm } from './status-form.model';

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
  // Already present on every API response (never stripped server-side) —
  // typed here for the shareable-link feature, which needs org + sequenceId
  // rather than the raw numeric id. See ProjectService.resolveSharedProject.
  organizationId?: number | null;
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
  // Status Report tab — which admin-authored template is currently selected
  // (reloaded each visit instead of re-prompting the picker every time) and
  // the default recipients auto-filled into the send-to box when composing
  // a new report. See ProjectStatusReportComponent / StatusReportService.
  activeStatusFormId: number | null;
  activeStatusForm: StatusForm | null;
  statusReportRecipients: string[];
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

// Backs GET /projects/stats — status breakdown + overdue count for the
// Projects page's stats cards; see ProjectService.getProjectStats.
export interface ProjectStats {
  total: number;
  active: number;
  completed: number;
  archived: number;
  draft: number;
  overdue: number;
}

// Narrow row shape for pickers (e.g. the event "Tasks" tab's project search)
// — backed by GET /projects?minimal=true, which selects only these columns
// server-side rather than the full Project include.
export interface ProjectPickerRow {
  id: number;
  name: string;
  status: ProjectStatus;
  department: Pick<Department, 'id' | 'name'> | null;
}

export interface PaginatedProjectPickerRows {
  projects: ProjectPickerRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
