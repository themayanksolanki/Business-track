import { User } from './user.model';
import { TagLite } from './tag.model';

export type TaskStatus = 'todo' | 'pending' | 'completed';

export interface Task {
  id: number;
  sequenceId?: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  startDate?: string | null;
  dueDate?: string | null;
  createdBy: User;
  updatedBy?: User | null;
  assignedTo: User;
  parentTask?: number | null;
  tags: TagLite[];
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  assignedTo?: number;
  parentTask?: number;
  startDate?: string | null;
  dueDate?: string | null;
  tags?: number[];
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string;
  status?: TaskStatus;
  startDate?: string | null;
  dueDate?: string | null;
  tags?: number[];
}
