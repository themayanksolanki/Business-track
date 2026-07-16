import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Department from '../models/Department.js';
import AppError from '../utils/AppError.js';
import { sendPasswordChangedEmail } from '../utils/mailer.js';
import { canManageRole, getAccessibleDepartmentIds } from '../utils/access.js';

const sameOrg = (a, b) => String(a ?? '') === String(b ?? '');

export const getAllUsers = async (req, res, next) => {
  try {
    const filter = { isActive: true, organization: req.user.organization };

    if (req.user.role === 'Manager') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      filter.departments = { $in: accessibleIds };
    }

    const users = await User.find(filter).select('-password');
    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
};

export const getTeamLeads = async (req, res, next) => {
  try {
    const teamLeads = await User.find({
      role: 'Team Lead',
      isActive: true,
      organization: req.user.organization,
    }).select('-password');
    res.status(200).json(teamLeads);
  } catch (err) {
    next(err);
  }
};

export const getTeamMembers = async (req, res, next) => {
  try {
    const members = await User.find({
      teamLeadId: req.user._id,
      role: 'User',
      isActive: true,
      organization: req.user.organization,
    }).select('-password');
    res.status(200).json(members);
  } catch (err) {
    next(err);
  }
};

export const getPendingUsers = async (req, res, next) => {
  try {
    let query = { isActive: false, organization: req.user.organization };

    if (req.user.role === 'Admin') {
      // org-wide
    } else if (req.user.role === 'Manager') {
      query.managerId = req.user._id;
    } else if (req.user.role === 'Team Lead') {
      query.teamLeadId = req.user._id;
    } else {
      return res.status(200).json([]);
    }

    const users = await User.find(query).select('-password');
    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
};

export const activateUser = async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target || !sameOrg(target.organization, req.user.organization))
      return next(new AppError('User not found', 404));

    const currentRole = req.user.role;
    const targetRole = target.role;

    const canActivate =
      canManageRole(currentRole, targetRole) &&
      (currentRole === 'Admin' ||
        (currentRole === 'Manager' && String(target.managerId) === String(req.user._id)) ||
        (currentRole === 'Team Lead' && String(target.teamLeadId) === String(req.user._id)));

    if (!canActivate)
      return next(new AppError('You do not have permission to activate this user', 403));

    target.isActive = true;
    await target.save();

    res.status(200).json({ message: `${target.username} has been activated`, user: target });
  } catch (err) {
    next(err);
  }
};

export const deactivateUser = async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target || !sameOrg(target.organization, req.user.organization))
      return next(new AppError('User not found', 404));

    if (String(target._id) === String(req.user._id))
      return next(new AppError('You cannot deactivate your own account', 400));

    if (!canManageRole(req.user.role, target.role))
      return next(new AppError('You do not have permission to deactivate this user', 403));

    target.isActive = false;
    await target.save();

    res.status(200).json({ message: `${target.username} has been deactivated`, user: target });
  } catch (err) {
    next(err);
  }
};

export const updateUserPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return next(new AppError('Password must be at least 6 characters', 400));

    const target = await User.findById(req.params.id);
    if (!target || !sameOrg(target.organization, req.user.organization))
      return next(new AppError('User not found', 404));

    const callerRole = req.user.role;
    const targetRole = target.role;

    const allowed =
      canManageRole(callerRole, targetRole) &&
      (callerRole === 'Admin' ||
        callerRole === 'Manager' ||
        (callerRole === 'Team Lead' && String(target.teamLeadId) === String(req.user._id)));

    if (!allowed)
      return next(new AppError('You do not have permission to update this password', 403));

    target.password = await bcrypt.hash(password, 10);
    await target.save();

    sendPasswordChangedEmail(target.email, target.username, password).catch(() => {});

    res.status(200).json({ message: `Password updated for ${target.username}` });
  } catch (err) {
    next(err);
  }
};

export const updateUserDepartments = async (req, res, next) => {
  try {
    const { departmentIds } = req.body;

    const target = await User.findById(req.params.id);
    if (!target || !sameOrg(target.organization, req.user.organization))
      return next(new AppError('User not found', 404));

    const uniqueIds = [...new Set(departmentIds)];

    if (req.user.role === 'Manager') {
      const accessibleIds = await getAccessibleDepartmentIds(req.user);
      const outOfScope = uniqueIds.some((id) => !accessibleIds.includes(String(id)));
      if (outOfScope)
        return next(new AppError('You can only assign departments within your own scope', 403));
    }

    const count = await Department.countDocuments({
      _id: { $in: uniqueIds },
      organization: req.user.organization,
    });
    if (count !== uniqueIds.length)
      return next(new AppError('One or more departments were not found', 404));

    target.departments = uniqueIds;
    await target.save();

    const populated = await User.findById(target._id)
      .select('-password')
      .populate({ path: 'departments', select: 'name color depth' });
    res.status(200).json({ message: `Departments updated for ${target.username}`, user: populated });
  } catch (err) {
    next(err);
  }
};
