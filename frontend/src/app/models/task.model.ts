import { User } from './user.model';
import { TagLite } from './tag.model';

export type TaskStatus = 'todo' | 'pending' | 'completed';

export interface Task {
  id: number;
  numericId?: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  createdBy: User;
  updatedBy?: User | null;
  assignedTo: User;
  parentTask?: number | null;
  tags: TagLite[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  assignedTo?: number;
  parentTask?: number;
  tags?: number[];
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string;
  status?: TaskStatus;
  tags?: number[];
}
