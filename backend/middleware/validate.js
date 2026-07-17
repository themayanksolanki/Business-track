import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_REGEX = /^[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['Admin', 'Manager', 'Team Lead', 'User'];

const validateTagIdsArray = (tags) => {
  if (tags === undefined) return null;
  if (!Array.isArray(tags)) return 'tags must be an array';
  if (!tags.every((id) => mongoose.isValidObjectId(id))) return 'tags must all be valid IDs';
  return null;
};

export const validateRegister = (req, res, next) => {
  const { username, email, password, role, referenceEmail } = req.body;

  if (!username || !username.trim())
    return next(new AppError('Username is required', 400));

  if (!email || !EMAIL_REGEX.test(email))
    return next(new AppError('A valid email is required', 400));

  if (!password || password.length < 6)
    return next(new AppError('Password must be at least 6 characters', 400));

  if (!role || !['Manager', 'Team Lead', 'User'].includes(role))
    return next(new AppError("Role must be one of: Manager, Team Lead, User", 400));

  if (role !== 'Manager' && referenceEmail && !EMAIL_REGEX.test(referenceEmail))
    return next(new AppError('Reference email must be a valid email address', 400));

  next();
};

export const validateOrgRegister = (req, res, next) => {
  const { username, email, password, organizationName, emailDomain, managerEmail, teamLeadEmail } = req.body;

  if (!username || !username.trim())
    return next(new AppError('Username is required', 400));

  if (!email || !EMAIL_REGEX.test(email))
    return next(new AppError('A valid email is required', 400));

  if (!password || password.length < 6)
    return next(new AppError('Password must be at least 6 characters', 400));

  if (!organizationName || !organizationName.trim())
    return next(new AppError('Organization name is required', 400));

  if (!emailDomain || !DOMAIN_REGEX.test(emailDomain))
    return next(new AppError('A valid organization email domain is required', 400));

  if (managerEmail && !EMAIL_REGEX.test(managerEmail))
    return next(new AppError('Manager email must be a valid email address', 400));

  if (teamLeadEmail && !EMAIL_REGEX.test(teamLeadEmail))
    return next(new AppError('Team Lead email must be a valid email address', 400));

  if (
    managerEmail &&
    teamLeadEmail &&
    managerEmail.toLowerCase().trim() === teamLeadEmail.toLowerCase().trim()
  )
    return next(new AppError('Manager and Team Lead cannot be the same email', 400));

  next();
};

export const validateInvite = (req, res, next) => {
  const { email, role } = req.body;

  if (!email || !EMAIL_REGEX.test(email))
    return next(new AppError('A valid email is required', 400));

  if (!role || !VALID_ROLES.includes(role))
    return next(new AppError(`Role must be one of: ${VALID_ROLES.join(', ')}`, 400));

  next();
};

export const validateActivateInvite = (req, res, next) => {
  const { username, password } = req.body;

  if (!username || !username.trim())
    return next(new AppError('Username is required', 400));

  if (!password || password.length < 6)
    return next(new AppError('Password must be at least 6 characters', 400));

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
  const { title, status, assignedTo, parentTask, tags } = req.body;

  if (req.method === 'POST' && (!title || !title.trim()))
    return next(new AppError('Title is required', 400));

  if (status !== undefined && !['todo', 'pending', 'completed'].includes(status))
    return next(new AppError("Status must be 'todo', 'pending', or 'completed'", 400));

  if (assignedTo && !mongoose.isValidObjectId(assignedTo))
    return next(new AppError('assignedTo is not a valid ID', 400));

  if (parentTask && !mongoose.isValidObjectId(parentTask))
    return next(new AppError('parentTask is not a valid ID', 400));

  const tagsError = validateTagIdsArray(tags);
  if (tagsError) return next(new AppError(tagsError, 400));

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

const validateParamId = (paramName) => (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params[paramName]))
    return next(new AppError(`Invalid ID: ${req.params[paramName]}`, 400));

  next();
};

export const validateProjectId = validateParamId('projectId');
export const validateItemId = validateParamId('itemId');
export const validateCommentId = validateParamId('commentId');
export const validateAttachmentId = validateParamId('attachmentId');

const isValidDateValue = (value) => !isNaN(new Date(value).getTime());

const validateDateRange = (startDate, endDate) => {
  if (startDate !== undefined && startDate !== null && !isValidDateValue(startDate))
    return 'startDate is not a valid date';

  if (endDate !== undefined && endDate !== null && !isValidDateValue(endDate))
    return 'endDate is not a valid date';

  if (startDate && endDate && new Date(endDate) < new Date(startDate))
    return 'endDate must be on or after startDate';

  return null;
};

const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_PROJECT_STATUSES = ['active', 'completed'];
const URL_REGEX = /^https?:\/\/[^\s]+\.[^\s]+$/i;

export const validateProject = (req, res, next) => {
  const { name, startDate, endDate, owner, priority, department, category, status, detailsText, effort, links, tags } = req.body;

  if (req.method === 'POST' && (!name || !name.trim()))
    return next(new AppError('Project name is required', 400));

  if (owner && !mongoose.isValidObjectId(owner))
    return next(new AppError('owner is not a valid ID', 400));

  if (department && !mongoose.isValidObjectId(department))
    return next(new AppError('department is not a valid ID', 400));

  if (category && !mongoose.isValidObjectId(category))
    return next(new AppError('category is not a valid ID', 400));

  const tagsError = validateTagIdsArray(tags);
  if (tagsError) return next(new AppError(tagsError, 400));

  if (priority !== undefined && !VALID_PRIORITIES.includes(priority))
    return next(new AppError(`Priority must be one of: ${VALID_PRIORITIES.join(', ')}`, 400));

  if (status !== undefined && !VALID_PROJECT_STATUSES.includes(status))
    return next(new AppError(`Status must be one of: ${VALID_PROJECT_STATUSES.join(', ')}`, 400));

  const dateError = validateDateRange(startDate, endDate);
  if (dateError) return next(new AppError(dateError, 400));

  if (detailsText !== undefined && typeof detailsText !== 'string')
    return next(new AppError('detailsText must be a string', 400));

  if (effort !== undefined && effort !== null) {
    const effortNum = Number(effort);
    if (!Number.isFinite(effortNum) || effortNum < 1 || effortNum > 10)
      return next(new AppError('effort must be a number between 1 and 10', 400));
  }

  if (links !== undefined) {
    if (!Array.isArray(links)) return next(new AppError('links must be an array', 400));
    for (const link of links) {
      if (!link || typeof link !== 'object' || !link.title || !link.title.trim())
        return next(new AppError('Each link must have a title', 400));
      if (!link.url || !URL_REGEX.test(link.url))
        return next(new AppError(`"${link.title}" has an invalid URL — it must start with http:// or https://`, 400));
    }
  }

  next();
};

const VALID_ITEM_STATUSES = ['todo', 'doing', 'completed'];
const VALID_ITEM_PRIORITIES = VALID_PRIORITIES;

export const validateProjectItem = (req, res, next) => {
  const { title, status, priority, assignedTo, parentId, startDate, endDate, tags } = req.body;

  if (req.method === 'POST' && (!title || !title.trim()))
    return next(new AppError('Title is required', 400));

  if (status !== undefined && !VALID_ITEM_STATUSES.includes(status))
    return next(new AppError(`Status must be one of: ${VALID_ITEM_STATUSES.join(', ')}`, 400));

  if (priority !== undefined && !VALID_ITEM_PRIORITIES.includes(priority))
    return next(new AppError(`Priority must be one of: ${VALID_ITEM_PRIORITIES.join(', ')}`, 400));

  if (assignedTo && !mongoose.isValidObjectId(assignedTo))
    return next(new AppError('assignedTo is not a valid ID', 400));

  if (parentId && !mongoose.isValidObjectId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  const dateError = validateDateRange(startDate, endDate);
  if (dateError) return next(new AppError(dateError, 400));

  const tagsError = validateTagIdsArray(tags);
  if (tagsError) return next(new AppError(tagsError, 400));

  next();
};

const VALID_MOVE_DIRECTIONS = ['up', 'down', 'indent', 'outdent'];

export const validateMove = (req, res, next) => {
  const { direction } = req.body;

  if (!VALID_MOVE_DIRECTIONS.includes(direction))
    return next(new AppError(`direction must be one of: ${VALID_MOVE_DIRECTIONS.join(', ')}`, 400));

  next();
};

export const validateReorder = (req, res, next) => {
  const { parentId, orderedIds } = req.body;

  if (parentId && !mongoose.isValidObjectId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  if (!Array.isArray(orderedIds) || orderedIds.length === 0)
    return next(new AppError('orderedIds must be a non-empty array', 400));

  if (!orderedIds.every((id) => mongoose.isValidObjectId(id)))
    return next(new AppError('orderedIds must all be valid IDs', 400));

  next();
};

export const validateComment = (req, res, next) => {
  const { body } = req.body;

  if (!body || !body.trim())
    return next(new AppError('Comment body is required', 400));

  next();
};

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const validateDepartment = (req, res, next) => {
  const { name, color, parentId } = req.body;

  if (req.method === 'POST' && (!name || !name.trim()))
    return next(new AppError('Department name is required', 400));

  if (color !== undefined && !HEX_COLOR_REGEX.test(color))
    return next(new AppError('color must be a valid hex color', 400));

  if (parentId && !mongoose.isValidObjectId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  next();
};

export const validateDepartmentId = validateParamId('id');

export const validateDepartmentIds = (req, res, next) => {
  const { departmentIds } = req.body;

  if (!Array.isArray(departmentIds))
    return next(new AppError('departmentIds must be an array', 400));

  if (!departmentIds.every((id) => mongoose.isValidObjectId(id)))
    return next(new AppError('departmentIds must all be valid IDs', 400));

  next();
};

export const validateTag = (req, res, next) => {
  const { name, textColor, backgroundColor } = req.body;

  if (req.method === 'POST' && (!name || !name.trim()))
    return next(new AppError('Tag name is required', 400));

  if (textColor !== undefined && !HEX_COLOR_REGEX.test(textColor))
    return next(new AppError('textColor must be a valid hex color', 400));

  if (backgroundColor !== undefined && !HEX_COLOR_REGEX.test(backgroundColor))
    return next(new AppError('backgroundColor must be a valid hex color', 400));

  next();
};

export const validateTagId = validateParamId('id');

export const validateCategory = (req, res, next) => {
  const { name, color, parentId } = req.body;

  if (req.method === 'POST' && (!name || !name.trim()))
    return next(new AppError('Category name is required', 400));

  if (color !== undefined && !HEX_COLOR_REGEX.test(color))
    return next(new AppError('color must be a valid hex color', 400));

  if (parentId && !mongoose.isValidObjectId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  next();
};

export const validateCategoryId = validateParamId('id');
