import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { getAccessibleDepartmentIds, canAccessDepartment } from '../utils/access.js';

export const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };

export const PROJECT_INCLUDE = {
  createdBy: { select: USER_SELECT },
  updatedBy: { select: USER_SELECT },
  owner: { select: USER_SELECT },
  department: { select: { id: true, name: true, color: true } },
  category: { select: { id: true, name: true, color: true } },
  tags: { select: { id: true, name: true, textColor: true, backgroundColor: true } },
  members: {
    include: {
      user: { select: USER_SELECT },
      role: { select: { id: true, title: true, description: true, isDefault: true, rank: true, canEdit: true } },
    },
  },
};

// Lightweight include for calls that only need to run canAccessProject /
// canManageProjectSettings — those only ever look at members[].userId and
// scalar FK columns, so there's no reason to join user/role/tags/etc. just
// to check permissions.
export const ACCESS_INCLUDE = { members: { select: { userId: true } } };

// Like ACCESS_INCLUDE, but also pulls each member's role.canEdit — needed by
// canEditProject (below) to tell an edit-capable member from a view-only one.
// Kept separate from ACCESS_INCLUDE so read-only endpoints that never call
// canEditProject don't pay for the extra join.
export const ACCESS_INCLUDE_WITH_ROLE = {
  members: { select: { userId: true, role: { select: { canEdit: true } } } },
};

export type AuthUser = { id: number; role: string; organizationId: number | null };

interface ProjectForAccess {
  organizationId: number | null;
  departmentId?: number | null;
  createdById?: number;
  ownerId?: number | null;
  members: { userId: number }[];
}

interface ProjectForEdit {
  organizationId: number | null;
  members: { userId: number; role?: { canEdit: boolean } | null }[];
}

interface ProjectForSettings {
  createdById: number;
  ownerId: number | null;
}

interface PlanFields {
  planFileName?: string | null;
  planUrl?: string | null;
  planPublicId?: string | null;
  planMimeType?: string | null;
  planSize?: number | null;
  planUploadedById?: number | null;
  planUploadedAt?: Date | null;
}

// The plan is flattened onto the Project row (see schema.prisma) since files
// now live on Cloudinary instead of GridFS — reassemble it into the nested
// shape the frontend expects and drop the flat columns from the payload.
export const shapeProject = <T extends PlanFields>(p: T) => {
  const { planFileName, planUrl, planPublicId, planMimeType, planSize, planUploadedById, planUploadedAt, ...rest } = p;
  return {
    ...rest,
    plan: planUrl
      ? {
          fileName: planFileName,
          url: planUrl,
          mimeType: planMimeType,
          size: planSize,
          uploadedBy: planUploadedById,
          uploadedAt: planUploadedAt,
        }
      : null,
  };
};

// Admins see every project in their organization. Everyone else sees
// projects whose department is within their accessible scope, plus
// department-less ("personal") projects they created or own, plus any
// project they've been explicitly added to as a member regardless of
// department scope.
export const canAccessProject = async (user: AuthUser, project: ProjectForAccess) => {
  if (project.organizationId !== user.organizationId) return false;
  if (user.role === 'Admin') return true;

  if (project.members.some((m) => m.userId === user.id)) return true;

  if (!project.departmentId) {
    return project.createdById === user.id || project.ownerId === user.id;
  }

  const accessibleIds = await getAccessibleDepartmentIds(user);
  return canAccessDepartment(accessibleIds, project.departmentId);
};

// Editing/deleting a project's own settings (as opposed to working within its
// item tree) is reserved for Admins, Managers (within their department
// scope, enforced by canAccessProject already having been checked), and the
// project's own creator/owner.
export const canManageProjectSettings = (user: AuthUser, project: ProjectForSettings) =>
  user.role === 'Admin' ||
  user.role === 'Manager' ||
  project.createdById === user.id ||
  project.ownerId === user.id;

// Refines "can this user touch this project" (canAccessProject having
// already passed) into edit-vs-view. Admin/creator/owner/department-based
// access stay full-edit, unchanged; only an explicit ProjectMember whose
// assigned role has canEdit:false (e.g. the default "Viewer" role) is
// downgraded to view-only. Requires project.members to include
// role.canEdit (see ACCESS_INCLUDE_WITH_ROLE) — a future share-link grant
// (a non-member, external viewer) is meant to be added here as one more
// branch returning false, so every call site stays untouched when that lands.
export const canEditProject = (user: AuthUser, project: ProjectForEdit) => {
  // A cross-org visitor only ever reaches this via the shared-link view
  // (see getSharedProject) — that surface is deliberately read-only, so
  // force it regardless of role/membership. Every real mutating endpoint
  // already rejects cross-org callers earlier via canAccessProject, so this
  // is defense-in-depth rather than the only thing standing in the way.
  if (user.organizationId !== project.organizationId) return false;
  if (user.role === 'Admin') return true;
  const membership = project.members.find((m) => m.userId === user.id);
  if (membership) return membership.role?.canEdit !== false;
  return true;
};

// Narrower than canManageProjectSettings (which also lets Managers and
// non-creator owners through) — approving a draft into a real project is
// reserved for Admins or the person who drafted it.
export const canApproveDraft = (user: AuthUser, project: ProjectForSettings) =>
  user.role === 'Admin' || project.createdById === user.id;

export type ProjectAccessLevel = 'access' | 'edit' | 'manage';

const DEFAULT_INCLUDE: Record<ProjectAccessLevel, object> = {
  access: ACCESS_INCLUDE,
  manage: ACCESS_INCLUDE,
  edit: ACCESS_INCLUDE_WITH_ROLE,
};

// Replaces the "fetch project → 404 if missing → 403 if no access/no edit/no
// manage rights" block that used to be copy-pasted at the top of ~30
// handlers across projectController/projectItemController/
// projectMemberController/projectCommentController. Defaults to the
// lightest include that satisfies the requested level; pass `include`
// explicitly (e.g. PROJECT_INCLUDE) when the caller also needs the full
// project shape for its response, instead of fetching it twice.
//
// Generic over the include shape so the returned project is properly typed
// with whatever relations the caller asked for (defaulting to
// ACCESS_INCLUDE's shape) — callers that need canEditProject's role.canEdit
// data should pass `include: ACCESS_INCLUDE_WITH_ROLE` explicitly.
export async function loadProjectOrFail<Inc extends Prisma.ProjectInclude = typeof ACCESS_INCLUDE>(
  projectId: number,
  user: AuthUser,
  opts?: {
    require?: ProjectAccessLevel;
    include?: Inc;
    action?: string;
    notFoundMessage?: string;
    accessMessage?: string;
    editMessage?: string;
  }
): Promise<Prisma.ProjectGetPayload<{ include: Inc }>> {
  const require = opts?.require ?? 'access';
  const include = (opts?.include ?? DEFAULT_INCLUDE[require]) as Inc;

  const project = await prisma.project.findUnique({ where: { id: projectId }, include });
  if (!project) throw new AppError(opts?.notFoundMessage ?? 'Project not found', 404);

  if (!(await canAccessProject(user, project as any)))
    throw new AppError(opts?.accessMessage ?? 'You do not have access to this project', 403);

  if (require === 'edit' && !canEditProject(user, project as any))
    throw new AppError(opts?.editMessage ?? 'You have view-only access to this project', 403);

  if (require === 'manage' && !canManageProjectSettings(user, project as any))
    throw new AppError(`You do not have permission to ${opts?.action ?? 'manage'} this project`, 403);

  return project as Prisma.ProjectGetPayload<{ include: Inc }>;
}

// Replaces the "fetch item scoped to project → 404 if missing" block
// repeated across projectItemController/projectCommentController.
export async function loadItemOrFail<Inc extends Prisma.ProjectItemInclude | undefined = undefined>(
  projectId: number,
  itemId: number,
  opts?: { include?: Inc }
): Promise<Prisma.ProjectItemGetPayload<{ include: Inc }>> {
  const item = await prisma.projectItem.findFirst({
    where: { id: itemId, projectId },
    include: opts?.include,
  });
  if (!item) throw new AppError('Item not found', 404);
  return item as Prisma.ProjectItemGetPayload<{ include: Inc }>;
}
