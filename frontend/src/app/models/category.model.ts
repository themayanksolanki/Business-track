import { User } from './user.model';
import { Project } from './project.model';

export interface Category {
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
  projectCount?: number;
  childCount?: number;
}

export interface CategoryDetail {
  category: Category;
  children: Category[];
  projects: Project[];
}

export interface CreateCategoryPayload {
  name: string;
  overview?: string;
  color?: string;
  parentId?: number | null;
}

export interface UpdateCategoryPayload {
  name?: string;
  overview?: string;
  color?: string;
}

export interface PaginatedCategories {
  categories: Category[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
