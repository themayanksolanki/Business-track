import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { cloudinary } from '../middleware/upload.js';
import streamRemoteFile from '../utils/streamRemoteFile.js';
import { getAccessibleDepartmentIds, canAccessDepartment } from '../utils/access.js';

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
      role: { select: { id: true, title: true, description: true, isDefault: true, rank: true } },
    },
  },
};

// Lightweight include for calls that only need to run canAccessProject /
// canManageProjectSettings — those only ever look at members[].userId and
// scalar FK columns, so there's no reason to join user/role/tags/etc. just
// to check permissions.
const ACCESS_INCLUDE = { members: { select: { userId: true } } };

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

const VALID_PROJECT_STATUSES = ['active', 'archived', 'completed'];

export const getProjects = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const where = { organizationId: req.user.organizationId };

    if (VALID_PROJECT_STATUSES.includes(req.query.status)) where.status = req.query.status;

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

    const project = await prisma.project.create({
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
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        tags: { connect: (tags ?? []).map((id) => ({ id: Number(id) })) },
      },
      include: PROJECT_INCLUDE,
    });

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

    const updated = await prisma.project.update({
      where: { id: project.id },
      data,
      include: PROJECT_INCLUDE,
    });

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
    // Cloudinary and must be cleaned up explicitly — everything else
    // (ProjectItems, Comments, Attachment rows themselves) cascades away at
    // the DB level once the project row is deleted (see schema.prisma).
    const attachments = await prisma.attachment.findMany({
      where: { OR: [{ projectId: project.id }, { projectItem: { projectId: project.id } }] },
      select: { publicId: true },
    });
    await Promise.allSettled(
      attachments.filter((a) => a.publicId).map((a) => cloudinary.uploader.destroy(a.publicId))
    );

    if (project.planPublicId) {
      await cloudinary.uploader.destroy(project.planPublicId).catch(() => {});
    }

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

    if (project.planPublicId) {
      await cloudinary.uploader.destroy(project.planPublicId).catch(() => {});
    }

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        planFileName: req.file.originalname,
        planUrl: req.file.path,
        planPublicId: req.file.filename,
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

// The plan file now lives on Cloudinary, so "download" is just handing back
// the direct URL instead of piping bytes through this server.
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

    await streamRemoteFile(
      res,
      { url: project.planUrl, mimeType: project.planMimeType, fileName: project.planFileName },
      next
    );
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

    if (project.planPublicId) {
      await cloudinary.uploader.destroy(project.planPublicId).catch(() => {});
    }

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        planFileName: null,
        planUrl: null,
        planPublicId: null,
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
