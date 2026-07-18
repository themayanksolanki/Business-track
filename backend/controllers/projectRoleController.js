import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';

const DEFAULT_ROLE_TITLES = ['Owner', 'Editor', 'Viewer'];

// Every organization always has Owner/Editor/Viewer available. Rather than a
// migration that has to be remembered for existing orgs, this seeds them
// idempotently the first time they're needed (called both right after an
// org is created, and lazily here) — a duplicate-key race just no-ops.
export const ensureDefaultProjectRoles = async (organizationId, actorId) => {
  const existing = await prisma.projectRole.count({ where: { organizationId, isDefault: true } });
  if (existing >= DEFAULT_ROLE_TITLES.length) return;

  for (let i = 0; i < DEFAULT_ROLE_TITLES.length; i++) {
    try {
      await prisma.projectRole.create({
        data: {
          title: DEFAULT_ROLE_TITLES[i],
          rank: i,
          isDefault: true,
          organizationId,
          createdById: actorId,
        },
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
    }
  }
};

export const getProjectRoles = async (req, res, next) => {
  try {
    await ensureDefaultProjectRoles(req.user.organizationId, req.user.id);

    const roles = await prisma.projectRole.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { rank: 'asc' },
      include: { _count: { select: { members: true } } },
    });

    const withCounts = roles.map((r) => {
      const { _count, ...rest } = r;
      return { ...rest, membersUsingCount: _count.members };
    });

    res.status(200).json(withCounts);
  } catch (err) {
    next(err);
  }
};

export const createProjectRole = async (req, res, next) => {
  try {
    const { title, description } = req.body;
    const rank = await prisma.projectRole.count({ where: { organizationId: req.user.organizationId } });

    const role = await prisma.projectRole.create({
      data: {
        title: title.trim(),
        description: description ?? '',
        rank,
        isDefault: false,
        organizationId: req.user.organizationId,
        createdById: req.user.id,
      },
    });

    res.status(201).json({ message: 'Role created', role });
  } catch (err) {
    if (err.code === 'P2002') return next(new AppError('A role with this title already exists', 409));
    next(err);
  }
};

export const updateProjectRole = async (req, res, next) => {
  try {
    const role = await prisma.projectRole.findUnique({ where: { id: Number(req.params.id) } });
    if (!role || role.organizationId !== req.user.organizationId)
      return next(new AppError('Role not found', 404));

    const { title, description } = req.body;

    if (role.isDefault && title !== undefined && title.trim() !== role.title)
      return next(new AppError('Default roles cannot be renamed', 403));

    const data = { updatedById: req.user.id };
    if (title !== undefined) data.title = title.trim();
    if (description !== undefined) data.description = description;

    const updated = await prisma.projectRole.update({ where: { id: role.id }, data });
    res.status(200).json({ message: 'Role updated', role: updated });
  } catch (err) {
    if (err.code === 'P2002') return next(new AppError('A role with this title already exists', 409));
    next(err);
  }
};

export const deleteProjectRole = async (req, res, next) => {
  try {
    const role = await prisma.projectRole.findUnique({ where: { id: Number(req.params.id) } });
    if (!role || role.organizationId !== req.user.organizationId)
      return next(new AppError('Role not found', 404));

    if (role.isDefault) return next(new AppError('Default roles cannot be deleted', 403));

    const inUse = await prisma.projectMember.count({ where: { roleId: role.id } });
    if (inUse > 0)
      return next(
        new AppError(`This role is assigned to members in ${inUse} project(s) and cannot be deleted`, 400)
      );

    await prisma.projectRole.delete({ where: { id: role.id } });
    res.status(200).json({ message: 'Role deleted' });
  } catch (err) {
    next(err);
  }
};

export const reorderProjectRoles = async (req, res, next) => {
  try {
    const { orderedIds } = req.body;

    const roles = await prisma.projectRole.findMany({
      where: { organizationId: req.user.organizationId },
      select: { id: true },
    });
    const roleIds = new Set(roles.map((r) => r.id));
    const numericIds = orderedIds.map(Number);

    if (numericIds.length !== roleIds.size || !numericIds.every((id) => roleIds.has(id)))
      return next(new AppError('orderedIds must match exactly the roles in this organization', 400));

    await prisma.$transaction(
      numericIds.map((id, index) => prisma.projectRole.update({ where: { id }, data: { rank: index } }))
    );

    res.status(200).json({ message: 'Order updated' });
  } catch (err) {
    next(err);
  }
};
