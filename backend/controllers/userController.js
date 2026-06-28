import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import { sendPasswordChangedEmail } from '../utils/mailer.js';

export const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({ isActive: true }).select('-password');
    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
};

export const getTeamLeads = async (req, res, next) => {
  try {
    const teamLeads = await User.find({ role: 'Team Lead', isActive: true }).select('-password');
    res.status(200).json(teamLeads);
  } catch (err) {
    next(err);
  }
};

export const getTeamMembers = async (req, res, next) => {
  try {
    const members = await User.find({
      teamLeadId: req.user._id,
      role: 'Employee',
      isActive: true,
    }).select('-password');
    res.status(200).json(members);
  } catch (err) {
    next(err);
  }
};

export const getPendingUsers = async (req, res, next) => {
  try {
    let query = { isActive: false };

    if (req.user.role === 'Manager') {
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
    if (!target) return next(new AppError('User not found', 404));

    const currentRole = req.user.role;
    const targetRole = target.role;

    const canActivate =
      (currentRole === 'Manager' && targetRole === 'Team Lead' &&
        String(target.managerId) === String(req.user._id)) ||
      (currentRole === 'Team Lead' && targetRole === 'Employee' &&
        String(target.teamLeadId) === String(req.user._id)) ||
      (currentRole === 'Manager' && targetRole === 'Employee' &&
        String(target.managerId) === String(req.user._id));

    if (!canActivate)
      return next(new AppError('You do not have permission to activate this user', 403));

    target.isActive = true;
    await target.save();

    res.status(200).json({ message: `${target.username} has been activated`, user: target });
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
    if (!target) return next(new AppError('User not found', 404));

    const callerRole = req.user.role;
    const targetRole = target.role;

    const allowed =
      (callerRole === 'Manager' && (targetRole === 'Team Lead' || targetRole === 'Employee')) ||
      (callerRole === 'Team Lead' && targetRole === 'Employee' &&
        String(target.teamLeadId) === String(req.user._id));

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
