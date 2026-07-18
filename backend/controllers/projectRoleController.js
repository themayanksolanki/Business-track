import ProjectRole from '../models/ProjectRole.js';
import Project from '../models/Project.js';
import AppError from '../utils/AppError.js';

const sameOrg = (a, b) => String(a ?? '') === String(b ?? '');

const DEFAULT_ROLE_TITLES = ['Owner', 'Editor', 'Viewer'];

// Every organization always has Owner/Editor/Viewer available. Rather than a
// migration that has to be remembered for existing orgs, this seeds them
// idempotently the first time they're needed (called both right after an
// org is created, and lazily here) — a duplicate-key race just no-ops.
export const ensureDefaultProjectRoles = async (organizationId, actorId) => {
  const existing = await ProjectRole.countDocuments({ organization: organizationId, isDefault: true });
  if (existing >= DEFAULT_ROLE_TITLES.length) return;

  for (let i = 0; i < DEFAULT_ROLE_TITLES.length; i++) {
    try {
      await ProjectRole.create({
        title: DEFAULT_ROLE_TITLES[i],
        rank: i,
        isDefault: true,
        organization: organizationId,
        createdBy: actorId,
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
};

export const getProjectRoles = async (req, res, next) => {
  try {
    await ensureDefaultProjectRoles(req.user.organization, req.user._id);

    const roles = await ProjectRole.find({ organization: req.user.organization }).sort({ rank: 1 });
    const roleIds = roles.map((r) => r._id);

    const usageCounts = await Project.aggregate([
      { $match: { 'members.role': { $in: roleIds } } },
      { $unwind: '$members' },
      { $match: { 'members.role': { $in: roleIds } } },
      { $group: { _id: '$members.role', count: { $sum: 1 } } },
    ]);
    const usageMap = new Map(usageCounts.map((r) => [String(r._id), r.count]));

    const withCounts = roles.map((r) => ({
      ...r.toObject(),
      membersUsingCount: usageMap.get(String(r._id)) ?? 0,
    }));

    res.status(200).json(withCounts);
  } catch (err) {
    next(err);
  }
};

export const createProjectRole = async (req, res, next) => {
  try {
    const { title, description } = req.body;
    const rank = await ProjectRole.countDocuments({ organization: req.user.organization });

    const role = await ProjectRole.create({
      title: title.trim(),
      description: description ?? '',
      rank,
      isDefault: false,
      organization: req.user.organization,
      createdBy: req.user._id,
    });

    res.status(201).json({ message: 'Role created', role });
  } catch (err) {
    if (err.code === 11000) return next(new AppError('A role with this title already exists', 409));
    next(err);
  }
};

export const updateProjectRole = async (req, res, next) => {
  try {
    const role = await ProjectRole.findById(req.params.id);
    if (!role || !sameOrg(role.organization, req.user.organization))
      return next(new AppError('Role not found', 404));

    const { title, description } = req.body;

    if (role.isDefault && title !== undefined && title.trim() !== role.title)
      return next(new AppError('Default roles cannot be renamed', 403));

    if (title !== undefined) role.title = title.trim();
    if (description !== undefined) role.description = description;
    role.updatedBy = req.user._id;

    await role.save();
    res.status(200).json({ message: 'Role updated', role });
  } catch (err) {
    if (err.code === 11000) return next(new AppError('A role with this title already exists', 409));
    next(err);
  }
};

export const deleteProjectRole = async (req, res, next) => {
  try {
    const role = await ProjectRole.findById(req.params.id);
    if (!role || !sameOrg(role.organization, req.user.organization))
      return next(new AppError('Role not found', 404));

    if (role.isDefault) return next(new AppError('Default roles cannot be deleted', 403));

    const inUse = await Project.countDocuments({ 'members.role': role._id });
    if (inUse > 0)
      return next(
        new AppError(`This role is assigned to members in ${inUse} project(s) and cannot be deleted`, 400)
      );

    await ProjectRole.findByIdAndDelete(role._id);
    res.status(200).json({ message: 'Role deleted' });
  } catch (err) {
    next(err);
  }
};

export const reorderProjectRoles = async (req, res, next) => {
  try {
    const { orderedIds } = req.body;

    const roles = await ProjectRole.find({ organization: req.user.organization }).select('_id');
    const roleIds = new Set(roles.map((r) => String(r._id)));

    if (orderedIds.length !== roleIds.size || !orderedIds.every((id) => roleIds.has(String(id))))
      return next(new AppError('orderedIds must match exactly the roles in this organization', 400));

    await ProjectRole.bulkWrite(
      orderedIds.map((id, index) => ({
        updateOne: { filter: { _id: id }, update: { rank: index } },
      }))
    );

    res.status(200).json({ message: 'Order updated' });
  } catch (err) {
    next(err);
  }
};
