export interface ProjectRole {
  id: number;
  sequenceId?: number | null;
  title: string;
  description: string;
  rank: number;
  isDefault: boolean;
  organization?: number | null;
  createdBy?: number;
  updatedBy?: number | null;
  createdAt?: string;
  updatedAt?: string;
  membersUsingCount?: number;
}

// The subset of a ProjectRole populated onto a project's members — enough to
// render a role badge, not the full management record.
export type ProjectRoleLite = Pick<ProjectRole, 'id' | 'title' | 'description' | 'isDefault' | 'rank'>;

export interface CreateProjectRolePayload {
  title: string;
  description?: string;
}

export interface UpdateProjectRolePayload {
  title?: string;
  description?: string;
}
