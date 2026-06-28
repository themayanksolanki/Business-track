import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['Manager', 'Team Lead', 'Employee'];

export const validateRegister = (req, res, next) => {
  const { username, email, password, role, referenceEmail } = req.body;

  if (!username || !username.trim())
    return next(new AppError('Username is required', 400));

  if (!email || !EMAIL_REGEX.test(email))
    return next(new AppError('A valid email is required', 400));

  if (!password || password.length < 6)
    return next(new AppError('Password must be at least 6 characters', 400));

  if (!role || !VALID_ROLES.includes(role))
    return next(new AppError(`Role must be one of: ${VALID_ROLES.join(', ')}`, 400));

  if (role !== 'Manager' && referenceEmail && !EMAIL_REGEX.test(referenceEmail))
    return next(new AppError('Reference email must be a valid email address', 400));

  next();
};

export const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !EMAIL_REGEX.test(email))
    return next(new AppError('A valid email is required', 400));

  if (!password)
    return next(new AppError('Password is required', 400));

  next();
};

export const validateTask = (req, res, next) => {
  const { title, status, assignedTo } = req.body;

  if (req.method === 'POST' && (!title || !title.trim()))
    return next(new AppError('Title is required', 400));

  if (status !== undefined && !['pending', 'completed'].includes(status))
    return next(new AppError("Status must be 'pending' or 'completed'", 400));

  if (assignedTo && !mongoose.isValidObjectId(assignedTo))
    return next(new AppError('assignedTo is not a valid ID', 400));

  next();
};

export const validateReassign = (req, res, next) => {
  const { assignedTo } = req.body;

  if (!assignedTo)
    return next(new AppError('assignedTo is required', 400));

  if (!mongoose.isValidObjectId(assignedTo))
    return next(new AppError('assignedTo is not a valid ID', 400));

  next();
};

export const validateObjectId = (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(new AppError(`Invalid ID: ${req.params.id}`, 400));

  next();
};
