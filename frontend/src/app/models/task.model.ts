import { User } from './user.model';
import { TagLite } from './tag.model';

export type TaskStatus = 'todo' | 'pending' | 'completed';

export interface Task {
  _id: string;
  numericId?: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  createdBy: User;
  updatedBy?: User | null;
  assignedTo: User;
  parentTask?: string | null;
  tags: TagLite[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  assignedTo?: string;
  parentTask?: string;
  tags?: string[];
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string;
  status?: TaskStatus;
  tags?: string[];
}
