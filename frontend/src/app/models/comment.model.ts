import { User } from './user.model';

export interface CommentMention {
  userId: number;
  username: string;
}

export interface ProjectComment {
  id: number;
  projectItem: number;
  author: User;
  body: string;
  mentions: CommentMention[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentPayload {
  body: string;
  mentions?: CommentMention[];
}

export interface UpdateCommentPayload {
  body: string;
  mentions?: CommentMention[];
}
