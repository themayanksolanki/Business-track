import { User } from './user.model';

export interface ProjectComment {
  _id: string;
  projectItem: string;
  author: User;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentPayload {
  body: string;
}
