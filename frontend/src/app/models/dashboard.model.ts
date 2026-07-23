import { ProjectPriority, ProjectStatus } from './project.model';

export interface TaskStats {
  todo: number;
  pending: number;
  completed: number;
  total: number;
  overdue: number;
}

export interface ProjectStats {
  active: number;
  completed: number;
  archived: number;
  draft: number;
  total: number;
}

export interface RecentProject {
  id: number;
  name: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  department: { id: number; name: string; color: string } | null;
  itemsTotal: number;
  itemsCompleted: number;
  progress: number;
}

export interface DepartmentBreakdown {
  id: number;
  name: string;
  color: string;
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
}

export interface TeamBreakdown {
  id: number;
  username: string;
  profileImage: string | null;
  todo: number;
  pending: number;
  completed: number;
  total: number;
}

export interface DashboardStats {
  tasks: TaskStats;
  projects: ProjectStats;
  recentProjects: RecentProject[];
  departmentBreakdown?: DepartmentBreakdown[];
  teamBreakdown?: TeamBreakdown[];
}
