export interface Tag {
  _id: string;
  name: string;
  textColor: string;
  backgroundColor: string;
  organization?: string | null;
  createdBy?: string;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  projectCount?: number;
  taskCount?: number;
}

// The subset of a Tag that's populated onto Projects/Tasks/ProjectItems wherever
// they're assigned — enough to render a pill, not the full management record.
export type TagLite = Pick<Tag, '_id' | 'name' | 'textColor' | 'backgroundColor'>;

export interface CreateTagPayload {
  name: string;
  textColor: string;
  backgroundColor: string;
}

export interface UpdateTagPayload {
  name?: string;
  textColor?: string;
  backgroundColor?: string;
}
