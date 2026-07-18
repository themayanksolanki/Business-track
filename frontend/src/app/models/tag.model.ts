export interface Tag {
  id: number;
  name: string;
  textColor: string;
  backgroundColor: string;
  organization?: number | null;
  createdBy?: number;
  updatedBy?: number | null;
  createdAt?: string;
  updatedAt?: string;
  projectCount?: number;
  taskCount?: number;
}

// The subset of a Tag that's populated onto Projects/Tasks/ProjectItems wherever
// they're assigned — enough to render a pill, not the full management record.
export type TagLite = Pick<Tag, 'id' | 'name' | 'textColor' | 'backgroundColor'>;

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
