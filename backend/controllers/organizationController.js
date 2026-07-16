import Organization from '../models/Organization.js';
import Invite from '../models/Invite.js';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import { getAccessibleDepartmentIds, canAccessDepartment } from '../utils/access.js';

const CREATABLE_ROLES = {
  Admin: ['Admin', 'Manager', 'Team Lead', 'User'],
  Manager: ['Team Lead', 'User'],
  'Team Lead': ['User'],
};

export const getMyOrganization = async (req, res, next) => {
  try {
    if (!req.user.organization) return next(new AppError('You are not part of an organization', 404));

    const organization = await Organization.findById(req.user.organization);
    if (!organization) return next(new AppError('Organization not found', 404));

    res.status(200).json(organization);
  } catch (err) {
    next(err);
  }
};

export const updateOrganization = async (req, res, next) => {
  try {
    const organization = await Organization.findById(req.user.organization);
    if (!organization) return next(new AppError('Organization not found', 404));

    const { name, emailDomain } = req.body;

    if (name !== undefined) {
      const existing = await Organization.findOne({ name: name.trim(), _id: { $ne: organization._id } });
      if (existing) return next(new AppError('Organization name already taken', 409));
      organization.name = name.trim();
    }

    if (emailDomain !== undefined) {
      const normalizedDomain = emailDomain.toLowerCase().trim();
      const existing = await Organization.findOne({
        emailDomain: normalizedDomain,
        _id: { $ne: organization._id },
      });
      if (existing) return next(new AppError('Organization email domain already registered', 409));
      organization.emailDomain = normalizedDomain;
    }

    await organization.save();
    res.status(200).json({ message: 'Organization updated', organization });
  } catch (err) {
    next(err);
  }
};

export const getAdmins = async (req, res, next) => {
  try {
    const admins = await User.find({ organization: req.user.organization, role: 'Admin' }).select('-password');
    res.status(200).json(admins);
  } catch (err) {
    next(err);
  }
};

export const createInvite = async (req, res, next) => {
  try {
    const { email, role, departments, managerId, teamLeadId } = req.body;

    const allowedRoles = CREATABLE_ROLES[req.user.role] ?? [];
    if (!allowedRoles.includes(role))
      return next(new AppError(`You cannot invite a ${role}`, 403));

    const normalizedEmail = email.toLowerCase().trim();
    const organization = await Organization.findById(req.user.organization);
    if (!organization) return next(new AppError('Organization not found', 404));

    if (normalizedEmail.split('@')[1] !== organization.emailDomain)
      return next(new AppError('Invite email must belong to the organization email domain', 400));

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) return next(new AppError('A user with that email already exists', 409));

    const existingInvite = await Invite.findOne({
      organization: organization._id,
      email: normalizedEmail,
      status: 'pending',
    });
    if (existingInvite) return next(new AppError('An invite for that email is already pending', 409));

    let deptIds = [];
    if (Array.isArray(departments) && departments.length) {
      if (req.user.role !== 'Admin') {
        const accessibleIds = await getAccessibleDepartmentIds(req.user);
        const outOfScope = departments.some((id) => !canAccessDepartment(accessibleIds, id));
        if (outOfScope)
          return next(new AppError('You can only invite into departments within your scope', 403));
      }
      deptIds = departments;
    }

    let resolvedManagerId = managerId ?? null;
    let resolvedTeamLeadId = teamLeadId ?? null;

    if (req.user.role === 'Manager' && role === 'Team Lead' && !resolvedManagerId) {
      resolvedManagerId = req.user._id;
    }
    if (req.user.role === 'Team Lead' && role === 'User') {
      resolvedTeamLeadId = resolvedTeamLeadId ?? req.user._id;
      resolvedManagerId = resolvedManagerId ?? req.user.managerId ?? null;
    }

    const invite = await Invite.create({
      organization: organization._id,
      email: normalizedEmail,
      role,
      departments: deptIds,
      managerId: resolvedManagerId,
      teamLeadId: resolvedTeamLeadId,
      invitedBy: req.user._id,
    });

    res.status(201).json({ message: 'Invite created', invite });
  } catch (err) {
    next(err);
  }
};

export const getInvites = async (req, res, next) => {
  try {
    const filter = { organization: req.user.organization };
    if (req.user.role !== 'Admin') filter.invitedBy = req.user._id;

    const invites = await Invite.find(filter).sort({ createdAt: -1 });
    res.status(200).json(invites);
  } catch (err) {
    next(err);
  }
};

export const revokeInvite = async (req, res, next) => {
  try {
    const invite = await Invite.findById(req.params.id);
    if (!invite || String(invite.organization) !== String(req.user.organization))
      return next(new AppError('Invite not found', 404));

    if (req.user.role !== 'Admin' && String(invite.invitedBy) !== String(req.user._id))
      return next(new AppError('You can only revoke invites you created', 403));

    await Invite.findByIdAndDelete(invite._id);
    res.status(200).json({ message: 'Invite revoked' });
  } catch (err) {
    next(err);
  }
};
