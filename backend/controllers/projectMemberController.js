import Project from '../models/Project.js';
import User from '../models/User.js';
import ProjectRole from '../models/ProjectRole.js';
import AppError from '../utils/AppError.js';
import { canAccessProject, canManageProjectSettings } from './projectController.js';

const MEMBER_POPULATE_FIELDS = [
  { path: 'members.user', select: 'username email role profileImage' },
  { path: 'members.role', select: 'title description isDefault rank' },
];

const sameOrg = (a, b) => String(a ?? '') === String(b ?? '');

// Escapes regex metacharacters so search input can't be used to build an
// unintended pattern (e.g. a bare ".*" matching everything).
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Backs the "Add Member" dropdown: paginated, searchable, org-scoped, and
// excludes users already on the project — loaded only when that dropdown is
// opened, never as part of the Project Details response.
export const getMemberCandidates = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to manage members of this project', 403));

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {
      isActive: true,
      organization: req.user.organization,
      _id: { $nin: project.members.map((m) => m.user) },
    };

    const search = (req.query.search ?? '').trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ username: regex }, { email: regex }];
    }

    const [users, total] = await Promise.all([
      User.find(filter).select('-password').sort({ username: 1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    res.status(200).json({
      users,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

export const getMembers = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId).populate(MEMBER_POPULATE_FIELDS);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));

    res.status(200).json(project.members);
  } catch (err) {
    next(err);
  }
};

export const addMember = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to manage members of this project', 403));

    const { userId, roleId } = req.body;

    const targetUser = await User.findById(userId);
    if (!targetUser || !targetUser.isActive || !sameOrg(targetUser.organization, req.user.organization))
      return next(new AppError('User not found', 404));

    const role = await ProjectRole.findById(roleId);
    if (!role || !sameOrg(role.organization, req.user.organization))
      return next(new AppError('Role not found', 404));

    if (project.members.some((m) => String(m.user) === String(userId)))
      return next(new AppError('This user is already a project member', 409));

    project.members.push({ user: userId, role: roleId, addedAt: new Date(), addedBy: req.user._id });
    project.updatedBy = req.user._id;
    await project.save();

    const populated = await project.populate(MEMBER_POPULATE_FIELDS);
    res.status(201).json({ message: 'Member added', members: populated.members });
  } catch (err) {
    next(err);
  }
};

export const updateMemberRole = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to manage members of this project', 403));

    const member = project.members.id(req.params.memberId);
    if (!member) return next(new AppError('Member not found', 404));

    const { roleId } = req.body;
    const role = await ProjectRole.findById(roleId);
    if (!role || !sameOrg(role.organization, req.user.organization))
      return next(new AppError('Role not found', 404));

    member.role = roleId;
    project.updatedBy = req.user._id;
    await project.save();

    const populated = await project.populate(MEMBER_POPULATE_FIELDS);
    res.status(200).json({ message: 'Member role updated', members: populated.members });
  } catch (err) {
    next(err);
  }
};

export const removeMember = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return next(new AppError('Project not found', 404));
    if (!(await canAccessProject(req.user, project)))
      return next(new AppError('You do not have access to this project', 403));
    if (!canManageProjectSettings(req.user, project))
      return next(new AppError('You do not have permission to manage members of this project', 403));

    const member = project.members.id(req.params.memberId);
    if (!member) return next(new AppError('Member not found', 404));

    member.deleteOne();
    project.updatedBy = req.user._id;
    await project.save();

    const populated = await project.populate(MEMBER_POPULATE_FIELDS);
    res.status(200).json({ message: 'Member removed', members: populated.members });
  } catch (err) {
    next(err);
  }
};
