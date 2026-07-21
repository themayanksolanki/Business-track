export interface ProjectRole {
  id: number;
  sequenceId?: number | null;
  title: string;
  description: string;
  rank: number;
  isDefault: boolean;
  // Whether a member holding this role can edit (vs. only view) the
  // projects they're on. The default "Viewer" role has this false.
  canEdit: boolean;
  organization?: number | null;
  createdBy?: number;
  updatedBy?: number | null;
  createdAt?: string;
  updatedAt?: string;
  membersUsingCount?: number;
}

// The subset of a ProjectRole populated onto a project's members — enough to
// render a role badge and gate edit access, not the full management record.
export type ProjectRoleLite = Pick<ProjectRole, 'id' | 'title' | 'description' | 'isDefault' | 'rank' | 'canEdit'>;

export interface CreateProjectRolePayload {
  title: string;
  description?: string;
  canEdit?: boolean;
}

export interface UpdateProjectRolePayload {
  title?: string;
  description?: string;
  canEdit?: boolean;
}
