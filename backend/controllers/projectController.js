import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { destroyBlob, cloudinaryDownloadUrl } from '../utils/blobStorage.js';
import { getS3DownloadUrl } from '../lib/s3.js';
import { getAccessibleDepartmentIds, canAccessDepartment } from '../utils/access.js';
import { nextSequenceId } from '../utils/sequence.js';
import { notifyUser, notifyUsers } from '../utils/notifications.js';

const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };

const PROJECT_INCLUDE = {
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
const ACCESS_INCLUDE = { members: { select: { userId: true } } };

// Like ACCESS_INCLUDE, but also pulls each member's role.canEdit — needed by
// canEditProject (below) to tell an edit-capable member from a view-only one.
// Kept separate from ACCESS_INCLUDE so read-only endpoints that never call
// canEditProject don't pay for the extra join.
const ACCESS_INCLUDE_WITH_ROLE = {
  members: { select: { userId: true, role: { select: { canEdit: true } } } },
};

// The plan is flattened onto the Project row (see schema.prisma) since files
// now live on Cloudinary instead of GridFS — reassemble it into the nested
// shape the frontend expects and drop the flat columns from the payload.
const shapeProject = (p) => {
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
export const canAccessProject = async (user, project) => {
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
export const canManageProjectSettings = (user, project) =>
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
export const canEditProject = (user, project) => {
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
export const canApproveDraft = (user, project) =>
  user.role === 'Admin' || project.createdById === user.id;

const VALID_PROJECT_STATUSES = ['active', 'archived', 'completed', 'draft'];

export const getProjects = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const where = { organizationId: req.user.organizationId };

    // No explicit status filter means "All" from the frontend's perspective
    // — drafts are excluded from that by default (they're managed from their
    // own Drafts screen) unless the caller opts in.
    if (VALID_PROJECT_STATUSES.includes(req.query.status)) {
      where.status = req.query.status;
    } else if (req.query.includeDrafts !== 'true') {
      where.status = { not: 'draft' };
    }

    if (req.user.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      where.OR = [
        { departmentId: { in: accessibleIds } },
        { departmentId: null, createdById: req.user.id },
        { departmentId: null, ownerId: req.user.id },
        { members: { some: { userId: req.user.id } } },
      ];
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: PROJECT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.project.count({ where }),
    ]);

    res.status(200).json({
      projects: projects.map(shapeProject),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const createProject = async (req, res, next) => {
  try {
    const { name, description, startDate, endDate, owner, priority, effort, department, category, status, tags } =
      req.body;

    const departmentId = department ? Number(department) : null;

    if (departmentId && req.user.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      if (!canAccessDepartment(accessibleIds, departmentId))
        return next(new AppError('You do not have access to this department', 403));
    }

    const project = await prisma.$transaction(async (tx) => {
      const sequenceId = await nextSequenceId(tx, req.user.organizationId, 'project');
      return tx.project.create({
        data: {
          name: name.trim(),
          description: description ?? '',
          createdById: req.user.id,
          ownerId: owner ? Number(owner) : req.user.id,
          priority: priority ?? 'medium',
          effort: effort ?? 'medium',
          status: status ?? 'active',
          departmentId,
          categoryId: category ? Number(category) : null,
          organizationId: req.user.organizationId,
          sequenceId,
          startDate: startDate ?? null,
          endDate: endDate ?? null,
          tags: { connect: (tags ?? []).map((id) => ({ id: Number(id) })) },
        },
        include: PROJECT_INCLUDE,
      });
    });

    if (project.ownerId) {
      await notifyUser(project.ownerId, req.user.id, {
        type: 'projectAssigned',
        title: 'Assigned to a project',
        message: `${req.user.username} assigned you to "${project.name}"`,
        projectId: project.id,
      });
    }

    res.status(201).json({ message: 'Project created', project: shapeProject(project) });
  } catch (err) {
    next(err);
  }
};

export const getProjectById = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: PROJECT_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    res.status(200).json(shapeProject(project));
  } catch (err) {
    next(err);
  }
};

// Resolves a project by its shareable reference (org + per-org sequence
// number, never the raw numeric id) for the "Copy Project Link" feature.
// Deliberately does NOT gate on canAccessProject — anyone logged into the
// app (any organization, member or not) can view a project they have the
// link to. This has no write counterpart, so there's no privilege-
// escalation surface to worry about; `hasNormalAccess` just tells the
// frontend whether to redirect to the fully-featured /projects/:id route
// (real member/org access) instead of rendering the reduced read-only view.
export const getSharedProject = async (req, res, next) => {
  try {
    const organizationId = Number(req.params.organizationId);
    const sequenceId = Number(req.params.sequenceId);
    const project = await prisma.project.findFirst({
      where: { organizationId, sequenceId },
      include: PROJECT_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));

    const hasNormalAccess = await canAccessProject(req.user, project);

    res.status(200).json({ project: shapeProject(project), hasNormalAccess });
  } catch (err) {
    next(err);
  }
};

export const updateProject = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to update this project', 403));

    const {
      name,
      description,
      startDate,
      endDate,
      owner,
      priority,
      department,
      category,
      status,
      detailsText,
      effort,
      links,
      tags,
    } = req.body;

    const departmentId = department !== undefined ? (department ? Number(department) : null) : undefined;

    if (departmentId && req.user.role !== 'Admin') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      if (!canAccessDepartment(accessibleIds, departmentId))
        return next(new AppError('You do not have access to this department', 403));
    }

    if (project.status === 'draft') {
      if (status === 'completed')
        return next(new AppError('A draft must be approved before it can be completed', 400));

      if ((startDate !== undefined && startDate) || (endDate !== undefined && endDate))
        return next(new AppError('Draft projects cannot have a start or end date', 400));

      if (status === 'active' && !canApproveDraft(req.user, project))
        return next(new AppError("Only an Admin or this draft's creator can approve it", 403));
    }

    const data = { updatedById: req.user.id };
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description;
    if (startDate !== undefined) data.startDate = startDate || null;
    if (endDate !== undefined) data.endDate = endDate || null;
    if (owner !== undefined) data.ownerId = owner ? Number(owner) : null;
    if (priority !== undefined) data.priority = priority;
    if (status !== undefined) data.status = status;
    if (departmentId !== undefined) data.departmentId = departmentId;
    if (category !== undefined) data.categoryId = category ? Number(category) : null;
    if (detailsText !== undefined) data.detailsText = detailsText;
    if (effort !== undefined) data.effort = effort;
    if (links !== undefined) data.links = links.map((l) => ({ title: l.title.trim(), url: l.url.trim() }));
    if (tags !== undefined) data.tags = { set: tags.map((id) => ({ id: Number(id) })) };

    // Approving a draft starts its clock automatically — it never had a
    // start date to set while still a draft (rejected above), so approval
    // is what begins it.
    if (project.status === 'draft' && status === 'active' && !project.startDate) {
      data.startDate = new Date();
    }

    const isDraftConversion = project.status === 'draft' && status === 'active';
    const ownerChanged = owner !== undefined && data.ownerId !== project.ownerId;

    const updated = await prisma.project.update({
      where: { id: project.id },
      data,
      include: PROJECT_INCLUDE,
    });

    if (ownerChanged && data.ownerId) {
      await notifyUser(data.ownerId, req.user.id, {
        type: 'projectAssigned',
        title: 'Assigned to a project',
        message: `${req.user.username} assigned you to "${updated.name}"`,
        projectId: updated.id,
      });
    }

    if (isDraftConversion) {
      const admins = await prisma.user.findMany({
        where: { organizationId: req.user.organizationId, role: 'Admin' },
        select: { id: true },
      });
      await notifyUsers([updated.createdById, ...admins.map((a) => a.id)], req.user.id, {
        type: 'draftConverted',
        title: 'Draft approved',
        message: `${req.user.username} approved "${updated.name}" — it's now an active project`,
        projectId: updated.id,
      });
    } else {
      // A more specific notification (projectAssigned/draftConverted) already
      // covers the ownership/approval cases above — this is the general
      // "something about this project changed" ping for everyone else.
      await notifyUsers(updated.members.map((m) => m.userId), req.user.id, {
        type: 'projectUpdated',
        title: 'Project updated',
        message: `${req.user.username} updated "${updated.name}"`,
        projectId: updated.id,
      });
    }

    res.status(200).json({ message: 'Project updated', project: shapeProject(updated) });
  } catch (err) {
    next(err);
  }
};

// Deliberately checks view access only (not canManageProjectSettings) — the
// Details-tab card layout is a shared cosmetic board, not a project setting,
// so any member who can see the project can rearrange/resize it.
export const updateProjectDetailsLayout = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { detailsLayout: req.body.detailsLayout },
      include: PROJECT_INCLUDE,
    });

    res.status(200).json({ message: 'Layout updated', project: shapeProject(updated) });
  } catch (err) {
    next(err);
  }
};

export const deleteProject = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to delete this project', 403));

    // Attachments (project-level and on any item in the tree) live on
    // Cloudinary or S3 and must be cleaned up explicitly — everything else
    // (ProjectItems, Comments, Attachment rows themselves) cascades away at
    // the DB level once the project row is deleted (see schema.prisma).
    const attachments = await prisma.attachment.findMany({
      where: { OR: [{ projectId: project.id }, { projectItem: { projectId: project.id } }] },
      select: { publicId: true, storage: true },
    });
    await Promise.allSettled(attachments.map((a) => destroyBlob(a)));

    await destroyBlob({ storage: project.planStorage, publicId: project.planPublicId });

    await prisma.project.delete({ where: { id: project.id } });
    res.status(200).json({ message: 'Project deleted' });
  } catch (err) {
    next(err);
  }
};

export const uploadProjectPlan = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to update this project', 403));

    if (!req.file) return next(new AppError('No file uploaded', 400));

    await destroyBlob({ storage: project.planStorage, publicId: project.planPublicId });

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        planFileName: req.file.originalname,
        planUrl: req.file.path,
        planPublicId: req.file.filename,
        planStorage: 's3',
        planMimeType: req.file.mimetype,
        planSize: req.file.size,
        planUploadedById: req.user.id,
        planUploadedAt: new Date(),
        updatedById: req.user.id,
      },
      include: PROJECT_INCLUDE,
    });

    res.status(200).json({ message: 'Plan uploaded', project: shapeProject(updated) });
  } catch (err) {
    next(err);
  }
};

export const downloadProjectPlan = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    if (!project.planUrl) return next(new AppError('No plan has been uploaded', 404));

    let viewUrl;
    let downloadUrl;
    if (project.planStorage === 's3') {
      [viewUrl, downloadUrl] = await Promise.all([
        getS3DownloadUrl({
          key: project.planPublicId,
          mimeType: project.planMimeType,
          fileName: project.planFileName,
          disposition: 'inline',
          expiresIn: 3600,
        }),
        getS3DownloadUrl({
          key: project.planPublicId,
          mimeType: project.planMimeType,
          fileName: project.planFileName,
          disposition: 'attachment',
          expiresIn: 300,
        }),
      ]);
    } else {
      viewUrl = project.planUrl;
      downloadUrl = cloudinaryDownloadUrl(project.planUrl);
    }

    res.status(200).json({ viewUrl, downloadUrl, mimeType: project.planMimeType, fileName: project.planFileName });
  } catch (err) {
    next(err);
  }
};

export const removeProjectPlan = async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: Number(req.params.projectId) },
      include: ACCESS_INCLUDE,
    });
    if (!project) return next(new AppError('Project not found', 404));

    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to update this project', 403));

    await destroyBlob({ storage: project.planStorage, publicId: project.planPublicId });

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        planFileName: null,
        planUrl: null,
        planPublicId: null,
        planStorage: 'cloudinary',
        planMimeType: null,
        planSize: null,
        planUploadedById: null,
        planUploadedAt: null,
        updatedById: req.user.id,
      },
      include: PROJECT_INCLUDE,
    });

    res.status(200).json({ message: 'Plan removed', project: shapeProject(updated) });
  } catch (err) {
    next(err);
  }
};
