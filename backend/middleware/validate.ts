import type { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_REGEX = /^[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['Admin', 'Manager', 'Team Lead', 'User'];

// Ids are Postgres autoincrement integers — accept a positive integer or the
// numeric string a route param/JSON body would carry it as.
const isValidId = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  if (typeof value === 'string') return /^[1-9]\d*$/.test(value);
  return false;
};

const validateTagIdsArray = (tags: unknown): string | null => {
  if (tags === undefined) return null;
  if (!Array.isArray(tags)) return 'tags must be an array';
  if (!tags.every((id) => isValidId(id))) return 'tags must all be valid IDs';
  return null;
};

export const validateOrgRegister = (req: Request, res: Response, next: NextFunction) => {
  const { username, email, password, organizationName, emailDomain } = req.body;

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

  next();
};

export const validateInvite = (req: Request, res: Response, next: NextFunction) => {
  const { email, role } = req.body;

  if (!email || !EMAIL_REGEX.test(email))
    return next(new AppError('A valid email is required', 400));

  if (!role || !VALID_ROLES.includes(role))
    return next(new AppError(`Role must be one of: ${VALID_ROLES.join(', ')}`, 400));

  next();
};

export const validateActivateInvite = (req: Request, res: Response, next: NextFunction) => {
  const { username, password } = req.body;

  if (!username || !username.trim())
    return next(new AppError('Username is required', 400));

  if (!password || password.length < 6)
    return next(new AppError('Password must be at least 6 characters', 400));

  next();
};

export const validateUpdateUser = (req: Request, res: Response, next: NextFunction) => {
  const { username, email, role } = req.body;

  if (username !== undefined && !username.trim())
    return next(new AppError('Username cannot be empty', 400));

  if (email !== undefined && !EMAIL_REGEX.test(email))
    return next(new AppError('A valid email is required', 400));

  if (role !== undefined && !VALID_ROLES.includes(role))
    return next(new AppError(`Role must be one of: ${VALID_ROLES.join(', ')}`, 400));

  next();
};

export const validateLogin = (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;

  if (!email || !EMAIL_REGEX.test(email))
    return next(new AppError('A valid email is required', 400));

  if (!password)
    return next(new AppError('Password is required', 400));

  next();
};

const ISO2_REGEX = /^[A-Z]{2}$/;
const PHONE_NUMBER_REGEX = /^\d{4,14}$/;
const VALID_DATE_FORMATS = ['DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD', 'DD_MMM_YY'];
const VALID_TIME_FORMATS = ['HOUR_12', 'HOUR_24'];
// The full set of top-level routes a "default landing page" may point at
// (see app.routes.ts) — role-appropriateness is enforced by the Settings >
// General dropdown offering only relevant options, and defensively by
// roleGuard bouncing an inaccessible choice back to /dashboard at nav time.
const VALID_LANDING_PAGES = [
  'dashboard',
  'tasks',
  'projects',
  'drafts',
  'chat',
  'users',
  'organization',
  'team-tasks',
];

// Fields are all independently optional — this endpoint is shared by the
// Profile page's phone editor and Settings > General's date/time-format/
// landing-page pickers, and a request from one shouldn't need to (or
// accidentally) touch the others' fields.
export const validateUpdateProfile = (req: Request, res: Response, next: NextFunction) => {
  const { phoneCountry, phoneNumber, dateFormat, timeFormat, defaultLandingPage } = req.body;

  // Both null/empty clears the phone number; otherwise both must be present
  // and valid — a country code with no number (or vice versa) isn't useful.
  if (phoneCountry || phoneNumber) {
    if (!phoneCountry || !ISO2_REGEX.test(phoneCountry))
      return next(new AppError('phoneCountry must be a 2-letter country code', 400));

    if (!phoneNumber || !PHONE_NUMBER_REGEX.test(phoneNumber))
      return next(new AppError('phoneNumber must be 4-14 digits', 400));
  }

  if (dateFormat !== undefined && !VALID_DATE_FORMATS.includes(dateFormat))
    return next(new AppError(`dateFormat must be one of: ${VALID_DATE_FORMATS.join(', ')}`, 400));

  if (timeFormat !== undefined && !VALID_TIME_FORMATS.includes(timeFormat))
    return next(new AppError(`timeFormat must be one of: ${VALID_TIME_FORMATS.join(', ')}`, 400));

  if (defaultLandingPage !== undefined && !VALID_LANDING_PAGES.includes(defaultLandingPage))
    return next(new AppError(`defaultLandingPage must be one of: ${VALID_LANDING_PAGES.join(', ')}`, 400));

  next();
};

export const validateTask = (req: Request, res: Response, next: NextFunction) => {
  const { title, status, assignedTo, parentTask, tags } = req.body;

  if (req.method === 'POST' && (!title || !title.trim()))
    return next(new AppError('Title is required', 400));

  if (status !== undefined && !['todo', 'pending', 'completed'].includes(status))
    return next(new AppError("Status must be 'todo', 'pending', or 'completed'", 400));

  if (assignedTo && !isValidId(assignedTo))
    return next(new AppError('assignedTo is not a valid ID', 400));

  if (parentTask && !isValidId(parentTask))
    return next(new AppError('parentTask is not a valid ID', 400));

  const tagsError = validateTagIdsArray(tags);
  if (tagsError) return next(new AppError(tagsError, 400));

  next();
};

export const validateReassign = (req: Request, res: Response, next: NextFunction) => {
  const { assignedTo } = req.body;

  if (!assignedTo)
    return next(new AppError('assignedTo is required', 400));

  if (!isValidId(assignedTo))
    return next(new AppError('assignedTo is not a valid ID', 400));

  next();
};

export const validateObjectId = (req: Request, res: Response, next: NextFunction) => {
  if (!isValidId(req.params.id))
    return next(new AppError(`Invalid ID: ${req.params.id}`, 400));

  next();
};

const validateParamId = (paramName: string) => (req: Request, res: Response, next: NextFunction) => {
  if (!isValidId(req.params[paramName]))
    return next(new AppError(`Invalid ID: ${req.params[paramName]}`, 400));

  next();
};

export const validateProjectId = validateParamId('projectId');
export const validateItemId = validateParamId('itemId');
export const validateCommentId = validateParamId('commentId');
export const validateAttachmentId = validateParamId('attachmentId');

const isValidDateValue = (value: unknown): boolean => !isNaN(new Date(value as any).getTime());

const validateDateRange = (startDate: unknown, endDate: unknown): string | null => {
  if (startDate !== undefined && startDate !== null && !isValidDateValue(startDate))
    return 'startDate is not a valid date';

  if (endDate !== undefined && endDate !== null && !isValidDateValue(endDate))
    return 'endDate is not a valid date';

  if (startDate && endDate && new Date(endDate as any) < new Date(startDate as any))
    return 'endDate must be on or after startDate';

  return null;
};

const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_PROJECT_STATUSES = ['active', 'archived', 'completed', 'draft'];
const VALID_DETAILS_CARD_IDS = ['details', 'attachments', 'plan', 'dates', 'priority', 'effort', 'links'];
const URL_REGEX = /^https?:\/\/[^\s]+\.[^\s]+$/i;

const validateDetailsLayout = (detailsLayout: unknown): string | null => {
  if (!Array.isArray(detailsLayout)) return 'detailsLayout must be an array';
  const seen = new Set();
  for (const entry of detailsLayout) {
    if (!entry || typeof entry !== 'object') return 'detailsLayout entries must be objects';
    if (!VALID_DETAILS_CARD_IDS.includes(entry.cardId))
      return `detailsLayout cardId must be one of: ${VALID_DETAILS_CARD_IDS.join(', ')}`;
    if (seen.has(entry.cardId)) return 'detailsLayout has a duplicate cardId';
    seen.add(entry.cardId);
    if (entry.width != null && typeof entry.width !== 'number') return 'detailsLayout width must be a number';
    if (entry.height != null && typeof entry.height !== 'number') return 'detailsLayout height must be a number';
  }
  return null;
};

export const validateProject = (req: Request, res: Response, next: NextFunction) => {
  const { name, startDate, endDate, owner, priority, department, category, status, detailsText, effort, links, tags } = req.body;

  if (req.method === 'POST' && (!name || !name.trim()))
    return next(new AppError('Project name is required', 400));

  if (owner && !isValidId(owner))
    return next(new AppError('owner is not a valid ID', 400));

  if (department && !isValidId(department))
    return next(new AppError('department is not a valid ID', 400));

  if (category && !isValidId(category))
    return next(new AppError('category is not a valid ID', 400));

  const tagsError = validateTagIdsArray(tags);
  if (tagsError) return next(new AppError(tagsError, 400));

  if (priority !== undefined && !VALID_PRIORITIES.includes(priority))
    return next(new AppError(`Priority must be one of: ${VALID_PRIORITIES.join(', ')}`, 400));

  if (status !== undefined && !VALID_PROJECT_STATUSES.includes(status))
    return next(new AppError(`Status must be one of: ${VALID_PROJECT_STATUSES.join(', ')}`, 400));

  if (status === 'draft' && (startDate || endDate))
    return next(new AppError('Draft projects cannot have a start or end date', 400));

  const dateError = validateDateRange(startDate, endDate);
  if (dateError) return next(new AppError(dateError, 400));

  if (detailsText !== undefined && typeof detailsText !== 'string')
    return next(new AppError('detailsText must be a string', 400));

  if (effort !== undefined && !VALID_PRIORITIES.includes(effort))
    return next(new AppError(`effort must be one of: ${VALID_PRIORITIES.join(', ')}`, 400));

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

// Any project member can rearrange the shared Details-tab board (it's cosmetic,
// not a project setting), so this stays deliberately separate from
// validateProject/canManageProjectSettings, which gate actual settings fields.
export const validateProjectDetailsLayout = (req: Request, res: Response, next: NextFunction) => {
  const layoutError = validateDetailsLayout(req.body.detailsLayout);
  if (layoutError) return next(new AppError(layoutError, 400));
  next();
};

const VALID_ITEM_STATUSES = ['todo', 'doing', 'completed'];
const VALID_ITEM_PRIORITIES = VALID_PRIORITIES;

export const validateProjectItem = (req: Request, res: Response, next: NextFunction) => {
  const { title, status, priority, assignedTo, parentId, startDate, endDate, tags } = req.body;

  if (req.method === 'POST' && (!title || !title.trim()))
    return next(new AppError('Title is required', 400));

  if (status !== undefined && !VALID_ITEM_STATUSES.includes(status))
    return next(new AppError(`Status must be one of: ${VALID_ITEM_STATUSES.join(', ')}`, 400));

  if (priority !== undefined && !VALID_ITEM_PRIORITIES.includes(priority))
    return next(new AppError(`Priority must be one of: ${VALID_ITEM_PRIORITIES.join(', ')}`, 400));

  if (assignedTo && !isValidId(assignedTo))
    return next(new AppError('assignedTo is not a valid ID', 400));

  if (parentId && !isValidId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  const dateError = validateDateRange(startDate, endDate);
  if (dateError) return next(new AppError(dateError, 400));

  const tagsError = validateTagIdsArray(tags);
  if (tagsError) return next(new AppError(tagsError, 400));

  next();
};

const VALID_MOVE_DIRECTIONS = ['up', 'down', 'indent', 'outdent'];

export const validateMove = (req: Request, res: Response, next: NextFunction) => {
  const { direction } = req.body;

  if (!VALID_MOVE_DIRECTIONS.includes(direction))
    return next(new AppError(`direction must be one of: ${VALID_MOVE_DIRECTIONS.join(', ')}`, 400));

  next();
};

export const validateMoveToParent = (req: Request, res: Response, next: NextFunction) => {
  const { parentId, index } = req.body;

  if (parentId != null && !isValidId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  if (index !== undefined && (!Number.isInteger(index) || index < 0))
    return next(new AppError('index must be a non-negative integer', 400));

  next();
};

// Unlike validateMoveToParent, targetParentId is looked up in a DIFFERENT
// project (req.body.targetProjectId) than the item's own — the controller
// re-validates it belongs there, this just checks the shapes are sane.
export const validateMoveToProject = (req: Request, res: Response, next: NextFunction) => {
  const { targetProjectId, targetParentId } = req.body;

  if (!isValidId(targetProjectId))
    return next(new AppError('targetProjectId is not a valid ID', 400));

  if (targetParentId != null && !isValidId(targetParentId))
    return next(new AppError('targetParentId is not a valid ID', 400));

  next();
};

export const validateBulkMoveToParent = (req: Request, res: Response, next: NextFunction) => {
  const { itemIds, parentId } = req.body;

  if (!isValidId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  if (!Array.isArray(itemIds) || itemIds.length === 0)
    return next(new AppError('itemIds must be a non-empty array', 400));

  if (!itemIds.every((id: unknown) => isValidId(id)))
    return next(new AppError('itemIds must all be valid IDs', 400));

  next();
};

export const validateReorder = (req: Request, res: Response, next: NextFunction) => {
  const { parentId, orderedIds } = req.body;

  if (parentId && !isValidId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  if (!Array.isArray(orderedIds) || orderedIds.length === 0)
    return next(new AppError('orderedIds must be a non-empty array', 400));

  if (!orderedIds.every((id: unknown) => isValidId(id)))
    return next(new AppError('orderedIds must all be valid IDs', 400));

  next();
};

export const validateComment = (req: Request, res: Response, next: NextFunction) => {
  const { body } = req.body;

  if (!body || !body.trim())
    return next(new AppError('Comment body is required', 400));

  next();
};

export const validateAttachmentLink = (req: Request, res: Response, next: NextFunction) => {
  const { url } = req.body;
  if (!url || !url.trim()) return next(new AppError('A URL is required', 400));

  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad protocol');
  } catch {
    return next(new AppError('A valid http(s) URL is required', 400));
  }

  next();
};

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const validateDepartment = (req: Request, res: Response, next: NextFunction) => {
  const { name, color, parentId } = req.body;

  if (req.method === 'POST' && (!name || !name.trim()))
    return next(new AppError('Department name is required', 400));

  if (color !== undefined && !HEX_COLOR_REGEX.test(color))
    return next(new AppError('color must be a valid hex color', 400));

  if (parentId && !isValidId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  next();
};

export const validateDepartmentId = validateParamId('id');

export const validateDepartmentIds = (req: Request, res: Response, next: NextFunction) => {
  const { departmentIds } = req.body;

  if (!Array.isArray(departmentIds))
    return next(new AppError('departmentIds must be an array', 400));

  if (!departmentIds.every((id: unknown) => isValidId(id)))
    return next(new AppError('departmentIds must all be valid IDs', 400));

  next();
};

export const validateTag = (req: Request, res: Response, next: NextFunction) => {
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

export const validateCategory = (req: Request, res: Response, next: NextFunction) => {
  const { name, color, parentId } = req.body;

  if (req.method === 'POST' && (!name || !name.trim()))
    return next(new AppError('Category name is required', 400));

  if (color !== undefined && !HEX_COLOR_REGEX.test(color))
    return next(new AppError('color must be a valid hex color', 400));

  if (parentId && !isValidId(parentId))
    return next(new AppError('parentId is not a valid ID', 400));

  next();
};

export const validateCategoryId = validateParamId('id');

export const validateProjectRole = (req: Request, res: Response, next: NextFunction) => {
  const { title, description } = req.body;

  if (req.method === 'POST' && (!title || !title.trim()))
    return next(new AppError('Role title is required', 400));

  if (description !== undefined && typeof description !== 'string')
    return next(new AppError('description must be a string', 400));

  next();
};

export const validateProjectRoleId = validateParamId('id');

export const validateProjectRoleReorder = (req: Request, res: Response, next: NextFunction) => {
  const { orderedIds } = req.body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0)
    return next(new AppError('orderedIds must be a non-empty array', 400));

  if (!orderedIds.every((id: unknown) => isValidId(id)))
    return next(new AppError('orderedIds must all be valid IDs', 400));

  next();
};

export const validateAddMember = (req: Request, res: Response, next: NextFunction) => {
  const { userId, roleId } = req.body;

  if (!userId || !isValidId(userId))
    return next(new AppError('userId is not a valid ID', 400));

  if (!roleId || !isValidId(roleId))
    return next(new AppError('roleId is not a valid ID', 400));

  next();
};

export const validateUpdateMemberRole = (req: Request, res: Response, next: NextFunction) => {
  const { roleId } = req.body;

  if (!roleId || !isValidId(roleId))
    return next(new AppError('roleId is not a valid ID', 400));

  next();
};

export const validateMemberId = validateParamId('memberId');
