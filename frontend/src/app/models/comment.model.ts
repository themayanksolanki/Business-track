import { User } from './user.model';

export interface ProjectComment {
  id: number;
  projectItem: number;
  author: User;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentPayload {
  body: string;
}
