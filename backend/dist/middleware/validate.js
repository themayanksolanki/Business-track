import AppError from '../utils/AppError.js';
import { METRIC_FREQUENCIES } from '../models/metricTracking.model.js';
import { periodCount } from '../utils/metricPeriods.js';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_REGEX = /^[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ['Admin', 'Manager', 'Team Lead', 'User'];
// Ids are Postgres autoincrement integers — accept a positive integer or the
// numeric string a route param/JSON body would carry it as.
const isValidId = (value) => {
    if (typeof value === 'number')
        return Number.isInteger(value) && value > 0;
    if (typeof value === 'string')
        return /^[1-9]\d*$/.test(value);
    return false;
};
const validateTagIdsArray = (tags) => {
    if (tags === undefined)
        return null;
    if (!Array.isArray(tags))
        return 'tags must be an array';
    if (!tags.every((id) => isValidId(id)))
        return 'tags must all be valid IDs';
    return null;
};
// Shared "array of valid IDs" check reused by validateBulkMoveToParent/
// validateReorder/validateProjectRoleReorder/validateDepartmentIds — each
// used to hand-roll the same two checks (non-empty + every-id-valid) with a
// field name baked into the message.
const validateIdArray = (fieldName, ids, opts) => {
    if (!Array.isArray(ids))
        return `${fieldName} must be an array`;
    if (!opts?.allowEmpty && ids.length === 0)
        return `${fieldName} must be a non-empty array`;
    if (!ids.every((id) => isValidId(id)))
        return `${fieldName} must all be valid IDs`;
    return null;
};
export const validateOrgRegister = (req, res, next) => {
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
export const validateUpdateUser = (req, res, next) => {
    const { username, email, role } = req.body;
    if (username !== undefined && !username.trim())
        return next(new AppError('Username cannot be empty', 400));
    if (email !== undefined && !EMAIL_REGEX.test(email))
        return next(new AppError('A valid email is required', 400));
    if (role !== undefined && !VALID_ROLES.includes(role))
        return next(new AppError(`Role must be one of: ${VALID_ROLES.join(', ')}`, 400));
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
];
const VALID_SIDEBAR_THEMES = ['MIDNIGHT', 'CHARCOAL', 'OCEAN', 'FOREST', 'PLUM', 'DAYLIGHT', 'ROSE', 'SKY', 'SAND', 'LEMON'];
const VALID_CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'INR'];
const VALID_MEASUREMENT_UNITS = ['KG', 'LB', 'LTR'];
// Fields are all independently optional — this endpoint is shared by the
// Profile page's phone editor and Settings > General's date/time-format/
// landing-page pickers, and a request from one shouldn't need to (or
// accidentally) touch the others' fields.
export const validateUpdateProfile = (req, res, next) => {
    const { phoneCountry, phoneNumber, dateFormat, timeFormat, defaultLandingPage, sidebarTheme, sidebarTextColor, currency, unit, decimalPoints, } = req.body;
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
    if (sidebarTheme !== undefined && !VALID_SIDEBAR_THEMES.includes(sidebarTheme))
        return next(new AppError(`sidebarTheme must be one of: ${VALID_SIDEBAR_THEMES.join(', ')}`, 400));
    // null clears the override back to the active theme's own default text color.
    if (sidebarTextColor !== undefined && sidebarTextColor !== null && !HEX_COLOR_REGEX.test(sidebarTextColor))
        return next(new AppError('sidebarTextColor must be a valid hex color', 400));
    if (currency !== undefined && !VALID_CURRENCIES.includes(currency))
        return next(new AppError(`currency must be one of: ${VALID_CURRENCIES.join(', ')}`, 400));
    if (unit !== undefined && !VALID_MEASUREMENT_UNITS.includes(unit))
        return next(new AppError(`unit must be one of: ${VALID_MEASUREMENT_UNITS.join(', ')}`, 400));
    if (decimalPoints !== undefined && (!Number.isInteger(decimalPoints) || decimalPoints < 0 || decimalPoints > 7))
        return next(new AppError('decimalPoints must be an integer between 0 and 7', 400));
    next();
};
export const validateTask = (req, res, next) => {
    const { title, status, assignedTo, parentTask, startDate, dueDate, tags } = req.body;
    if (req.method === 'POST' && (!title || !title.trim()))
        return next(new AppError('Title is required', 400));
    if (status !== undefined && !['todo', 'pending', 'completed'].includes(status))
        return next(new AppError("Status must be 'todo', 'pending', or 'completed'", 400));
    if (assignedTo && !isValidId(assignedTo))
        return next(new AppError('assignedTo is not a valid ID', 400));
    if (parentTask && !isValidId(parentTask))
        return next(new AppError('parentTask is not a valid ID', 400));
    const dateError = validateDateRange(startDate, dueDate, 'startDate', 'dueDate');
    if (dateError)
        return next(new AppError(dateError, 400));
    const tagsError = validateTagIdsArray(tags);
    if (tagsError)
        return next(new AppError(tagsError, 400));
    next();
};
export const validateReassign = (req, res, next) => {
    const { assignedTo } = req.body;
    if (!assignedTo)
        return next(new AppError('assignedTo is required', 400));
    if (!isValidId(assignedTo))
        return next(new AppError('assignedTo is not a valid ID', 400));
    next();
};
export const validateObjectId = (req, res, next) => {
    if (!isValidId(req.params.id))
        return next(new AppError(`Invalid ID: ${req.params.id}`, 400));
    next();
};
const validateParamId = (paramName) => (req, res, next) => {
    if (!isValidId(req.params[paramName]))
        return next(new AppError(`Invalid ID: ${req.params[paramName]}`, 400));
    next();
};
export const validateProjectId = validateParamId('projectId');
export const validateItemId = validateParamId('itemId');
export const validateCommentId = validateParamId('commentId');
export const validateAttachmentId = validateParamId('attachmentId');
const isValidDateValue = (value) => !isNaN(new Date(value).getTime());
const validateDateRange = (startDate, endDate, startField = 'startDate', endField = 'endDate') => {
    if (startDate !== undefined && startDate !== null && !isValidDateValue(startDate))
        return `${startField} is not a valid date`;
    if (endDate !== undefined && endDate !== null && !isValidDateValue(endDate))
        return `${endField} is not a valid date`;
    if (startDate && endDate && new Date(endDate) < new Date(startDate))
        return `${endField} must be on or after ${startField}`;
    return null;
};
const VALID_PRIORITIES = ['low', 'medium', 'high'];
const VALID_PROJECT_STATUSES = ['active', 'archived', 'completed', 'draft'];
const VALID_DETAILS_CARD_IDS = ['details', 'attachments', 'plan', 'dates', 'priority', 'effort', 'links'];
const URL_REGEX = /^https?:\/\/[^\s]+\.[^\s]+$/i;
const validateDetailsLayout = (detailsLayout) => {
    if (!Array.isArray(detailsLayout))
        return 'detailsLayout must be an array';
    const seen = new Set();
    for (const entry of detailsLayout) {
        if (!entry || typeof entry !== 'object')
            return 'detailsLayout entries must be objects';
        if (!VALID_DETAILS_CARD_IDS.includes(entry.cardId))
            return `detailsLayout cardId must be one of: ${VALID_DETAILS_CARD_IDS.join(', ')}`;
        if (seen.has(entry.cardId))
            return 'detailsLayout has a duplicate cardId';
        seen.add(entry.cardId);
        if (entry.width != null && typeof entry.width !== 'number')
            return 'detailsLayout width must be a number';
        if (entry.height != null && typeof entry.height !== 'number')
            return 'detailsLayout height must be a number';
    }
    return null;
};
export const validateProject = (req, res, next) => {
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
    if (tagsError)
        return next(new AppError(tagsError, 400));
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority))
        return next(new AppError(`Priority must be one of: ${VALID_PRIORITIES.join(', ')}`, 400));
    if (status !== undefined && !VALID_PROJECT_STATUSES.includes(status))
        return next(new AppError(`Status must be one of: ${VALID_PROJECT_STATUSES.join(', ')}`, 400));
    if (status === 'draft' && (startDate || endDate))
        return next(new AppError('Draft projects cannot have a start or end date', 400));
    const dateError = validateDateRange(startDate, endDate);
    if (dateError)
        return next(new AppError(dateError, 400));
    if (detailsText !== undefined && typeof detailsText !== 'string')
        return next(new AppError('detailsText must be a string', 400));
    if (effort !== undefined && !VALID_PRIORITIES.includes(effort))
        return next(new AppError(`effort must be one of: ${VALID_PRIORITIES.join(', ')}`, 400));
    if (links !== undefined) {
        if (!Array.isArray(links))
            return next(new AppError('links must be an array', 400));
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
export const validateProjectDetailsLayout = (req, res, next) => {
    const layoutError = validateDetailsLayout(req.body.detailsLayout);
    if (layoutError)
        return next(new AppError(layoutError, 400));
    next();
};
const VALID_ITEM_STATUSES = ['todo', 'doing', 'completed'];
const VALID_ITEM_PRIORITIES = VALID_PRIORITIES;
export const validateProjectItem = (req, res, next) => {
    const { title, status, priority, assignedTo, parentId, startDate, endDate, tags, emoji, meetingLinkUrl, meetingLinkTitle, meetingLinkAt, } = req.body;
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
    // Generous cap, not a strict single-grapheme check — some emoji are
    // multi-codepoint sequences (skin tone modifiers, ZWJ family/profession
    // joins) that run well past a naive `.length` of 1-2.
    if (emoji != null && typeof emoji === 'string' && emoji.length > 16)
        return next(new AppError('emoji is too long', 400));
    const dateError = validateDateRange(startDate, endDate);
    if (dateError)
        return next(new AppError(dateError, 400));
    const tagsError = validateTagIdsArray(tags);
    if (tagsError)
        return next(new AppError(tagsError, 400));
    // Only validated when actually setting a link — sending null/'' for all
    // three clears it, which the controller treats as "remove", not "add".
    if (meetingLinkUrl) {
        let parsedUrl;
        try {
            parsedUrl = new URL(meetingLinkUrl);
        }
        catch {
            return next(new AppError('meetingLinkUrl must be a valid URL', 400));
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
            return next(new AppError('meetingLinkUrl must use http or https', 400));
        if (!meetingLinkTitle || !meetingLinkTitle.trim())
            return next(new AppError('meetingLinkTitle is required when adding a meeting link', 400));
        if (meetingLinkTitle.length > 100)
            return next(new AppError('meetingLinkTitle is too long', 400));
        if (!meetingLinkAt || isNaN(new Date(meetingLinkAt).getTime()))
            return next(new AppError('meetingLinkAt is required when adding a meeting link', 400));
    }
    next();
};
const VALID_MOVE_DIRECTIONS = ['up', 'down', 'indent', 'outdent'];
export const validateMove = (req, res, next) => {
    const { direction } = req.body;
    if (!VALID_MOVE_DIRECTIONS.includes(direction))
        return next(new AppError(`direction must be one of: ${VALID_MOVE_DIRECTIONS.join(', ')}`, 400));
    next();
};
export const validateMoveToParent = (req, res, next) => {
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
export const validateMoveToProject = (req, res, next) => {
    const { targetProjectId, targetParentId } = req.body;
    if (!isValidId(targetProjectId))
        return next(new AppError('targetProjectId is not a valid ID', 400));
    if (targetParentId != null && !isValidId(targetParentId))
        return next(new AppError('targetParentId is not a valid ID', 400));
    next();
};
export const validateBulkMoveToParent = (req, res, next) => {
    const { itemIds, parentId } = req.body;
    if (!isValidId(parentId))
        return next(new AppError('parentId is not a valid ID', 400));
    const idsError = validateIdArray('itemIds', itemIds);
    if (idsError)
        return next(new AppError(idsError, 400));
    next();
};
export const validateBulkMoveToProject = (req, res, next) => {
    const { itemIds, targetProjectId, targetParentId } = req.body;
    if (!isValidId(targetProjectId))
        return next(new AppError('targetProjectId is not a valid ID', 400));
    if (!isValidId(targetParentId))
        return next(new AppError('targetParentId is not a valid ID', 400));
    const idsError = validateIdArray('itemIds', itemIds);
    if (idsError)
        return next(new AppError(idsError, 400));
    next();
};
export const validateReorder = (req, res, next) => {
    const { parentId, orderedIds } = req.body;
    if (parentId && !isValidId(parentId))
        return next(new AppError('parentId is not a valid ID', 400));
    const idsError = validateIdArray('orderedIds', orderedIds);
    if (idsError)
        return next(new AppError(idsError, 400));
    next();
};
export const validateComment = (req, res, next) => {
    const { body } = req.body;
    if (!body || !body.trim())
        return next(new AppError('Comment body is required', 400));
    next();
};
export const validateAttachmentLink = (req, res, next) => {
    const { url } = req.body;
    if (!url || !url.trim())
        return next(new AppError('A URL is required', 400));
    try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            throw new Error('bad protocol');
    }
    catch {
        return next(new AppError('A valid http(s) URL is required', 400));
    }
    next();
};
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const validateDepartment = (req, res, next) => {
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
export const validateDepartmentIds = (req, res, next) => {
    const { departmentIds } = req.body;
    const idsError = validateIdArray('departmentIds', departmentIds, { allowEmpty: true });
    if (idsError)
        return next(new AppError(idsError, 400));
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
    if (parentId && !isValidId(parentId))
        return next(new AppError('parentId is not a valid ID', 400));
    next();
};
export const validateCategoryId = validateParamId('id');
export const validateProjectRole = (req, res, next) => {
    const { title, description } = req.body;
    if (req.method === 'POST' && (!title || !title.trim()))
        return next(new AppError('Role title is required', 400));
    if (description !== undefined && typeof description !== 'string')
        return next(new AppError('description must be a string', 400));
    next();
};
export const validateProjectRoleId = validateParamId('id');
export const validateProjectRoleReorder = (req, res, next) => {
    const { orderedIds } = req.body;
    const idsError = validateIdArray('orderedIds', orderedIds);
    if (idsError)
        return next(new AppError(idsError, 400));
    next();
};
export const validateAddMember = (req, res, next) => {
    const { userId, roleId } = req.body;
    if (!userId || !isValidId(userId))
        return next(new AppError('userId is not a valid ID', 400));
    if (!roleId || !isValidId(roleId))
        return next(new AppError('roleId is not a valid ID', 400));
    next();
};
export const validateUpdateMemberRole = (req, res, next) => {
    const { roleId } = req.body;
    if (!roleId || !isValidId(roleId))
        return next(new AppError('roleId is not a valid ID', 400));
    next();
};
export const validateMemberId = validateParamId('memberId');
const VALID_METRIC_STATUSES = ['active', 'archived', 'deleted'];
const VALID_METRIC_DATA_TYPES = ['number', 'weight', 'currency', 'percentage'];
export const validateMetric = (req, res, next) => {
    const { title, department, category, owner, parentId, startDate, dueDate, notes, status, dataType } = req.body;
    if (req.method === 'POST') {
        if (!title || !title.trim())
            return next(new AppError('Title is required', 400));
        if (!department || !isValidId(department))
            return next(new AppError('department is required', 400));
        if (!owner || !isValidId(owner))
            return next(new AppError('owner is required', 400));
    }
    else {
        if (title !== undefined && !title.trim())
            return next(new AppError('Title cannot be empty', 400));
        if (department !== undefined && !isValidId(department))
            return next(new AppError('department is not a valid ID', 400));
        if (owner !== undefined && !isValidId(owner))
            return next(new AppError('owner is not a valid ID', 400));
    }
    // category is optional and clearable — null unsets it, anything else must
    // be a valid ID.
    if (category !== undefined && category !== null && !isValidId(category))
        return next(new AppError('category is not a valid ID', 400));
    if (parentId != null && !isValidId(parentId))
        return next(new AppError('parentId is not a valid ID', 400));
    if (notes !== undefined && typeof notes !== 'string')
        return next(new AppError('notes must be a string', 400));
    if (status !== undefined && !VALID_METRIC_STATUSES.includes(status))
        return next(new AppError(`status must be one of: ${VALID_METRIC_STATUSES.join(', ')}`, 400));
    if (dataType !== undefined && !VALID_METRIC_DATA_TYPES.includes(dataType))
        return next(new AppError(`dataType must be one of: ${VALID_METRIC_DATA_TYPES.join(', ')}`, 400));
    const dateError = validateDateRange(startDate, dueDate, 'startDate', 'dueDate');
    if (dateError)
        return next(new AppError(dateError, 400));
    next();
};
export const validateMetricId = validateParamId('metricId');
const VALID_METRIC_FREQUENCIES = METRIC_FREQUENCIES;
// Only 'daily' is actually implemented yet (see backend/utils/metricPeriods.ts)
// — the others are accepted here as a recognizable shape so the frontend gets
// a clean "not implemented" 400 instead of falling through to a 500 deeper in
// the controller/model layer.
const IMPLEMENTED_METRIC_FREQUENCIES = ['daily'];
export const validateTrackingParams = (req, res, next) => {
    const frequency = String(req.params.frequency);
    const year = Number(req.query.year);
    const month = req.query.month !== undefined ? Number(req.query.month) : undefined;
    if (!VALID_METRIC_FREQUENCIES.includes(frequency))
        return next(new AppError(`frequency must be one of: ${VALID_METRIC_FREQUENCIES.join(', ')}`, 400));
    if (!IMPLEMENTED_METRIC_FREQUENCIES.includes(frequency))
        return next(new AppError(`'${frequency}' tracking is not implemented yet`, 400));
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
        return next(new AppError('year must be a valid 4-digit year', 400));
    if (frequency === 'daily' && (!Number.isInteger(month) || month < 1 || month > 12))
        return next(new AppError('month must be between 1 and 12 for daily frequency', 400));
    next();
};
export const validateTrackingDiff = (req, res, next) => {
    const { diff } = req.body;
    if (diff === undefined || diff === null || typeof diff !== 'object' || Array.isArray(diff))
        return next(new AppError('diff must be an object', 400));
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    // req.params.frequency is guaranteed 'daily' by validateTrackingParams,
    // which always runs first on these routes.
    const maxPeriod = periodCount('daily', year, month);
    for (const [key, value] of Object.entries(diff)) {
        const periodNum = Number(key);
        if (!Number.isInteger(periodNum) || periodNum < 1 || periodNum > maxPeriod)
            return next(new AppError(`diff key "${key}" is out of range for this period`, 400));
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return next(new AppError(`diff["${key}"] must be an object`, 400));
        const { actual, target } = value;
        if (actual !== undefined && actual !== null && typeof actual !== 'number')
            return next(new AppError(`diff["${key}"].actual must be a number or null`, 400));
        if (target !== undefined && target !== null && typeof target !== 'number')
            return next(new AppError(`diff["${key}"].target must be a number or null`, 400));
    }
    next();
};
export const validateEventId = validateParamId('eventId');
const VALID_EVENT_VISIBILITY = ['standard', 'private', 'public'];
const VALID_EVENT_BUSY_STATUS = ['busy', 'free'];
const VALID_REMINDER_METHODS = ['notification', 'email'];
const VALID_RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
export const validateEvent = (req, res, next) => {
    const { title, description, location, start, end, color, categoryId, calendarId, meetingLinkUrl, meetingLinkTitle, visibility, busyStatus, guests, reminders, recurrence, } = req.body;
    if (req.method === 'POST') {
        if (!title || !title.trim())
            return next(new AppError('Title is required', 400));
        if (!start || !isValidDateValue(start))
            return next(new AppError('start is required and must be a valid date', 400));
        if (!end || !isValidDateValue(end))
            return next(new AppError('end is required and must be a valid date', 400));
    }
    else {
        if (title !== undefined && !title.trim())
            return next(new AppError('Title cannot be empty', 400));
        if (start !== undefined && !isValidDateValue(start))
            return next(new AppError('start is not a valid date', 400));
        if (end !== undefined && !isValidDateValue(end))
            return next(new AppError('end is not a valid date', 400));
    }
    if (start && end && new Date(end).getTime() < new Date(start).getTime())
        return next(new AppError('end must be on or after start', 400));
    if (description !== undefined && typeof description !== 'string')
        return next(new AppError('description must be a string', 400));
    if (location !== undefined && location !== null && typeof location !== 'string')
        return next(new AppError('location must be a string', 400));
    if (color !== undefined && color !== null && !HEX_COLOR_REGEX.test(color))
        return next(new AppError('color must be a valid hex color', 400));
    if (categoryId != null && !isValidId(categoryId))
        return next(new AppError('categoryId is not a valid ID', 400));
    if (calendarId != null && !isValidId(calendarId))
        return next(new AppError('calendarId is not a valid ID', 400));
    if (visibility !== undefined && !VALID_EVENT_VISIBILITY.includes(visibility))
        return next(new AppError(`visibility must be one of: ${VALID_EVENT_VISIBILITY.join(', ')}`, 400));
    if (busyStatus !== undefined && !VALID_EVENT_BUSY_STATUS.includes(busyStatus))
        return next(new AppError(`busyStatus must be one of: ${VALID_EVENT_BUSY_STATUS.join(', ')}`, 400));
    // Only validated when actually setting a link — null/'' clears it.
    if (meetingLinkUrl) {
        try {
            const parsed = new URL(meetingLinkUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
                return next(new AppError('meetingLinkUrl must use http or https', 400));
        }
        catch {
            return next(new AppError('meetingLinkUrl must be a valid URL', 400));
        }
        if (meetingLinkTitle !== undefined && meetingLinkTitle !== null && typeof meetingLinkTitle !== 'string')
            return next(new AppError('meetingLinkTitle must be a string', 400));
    }
    if (guests !== undefined) {
        if (!Array.isArray(guests))
            return next(new AppError('guests must be an array', 400));
        for (const g of guests) {
            if (!g || typeof g !== 'object')
                return next(new AppError('Each guest must be an object', 400));
            if (!g.email || !EMAIL_REGEX.test(g.email))
                return next(new AppError('Each guest needs a valid email', 400));
            if (g.userId !== undefined && g.userId !== null && !isValidId(g.userId))
                return next(new AppError('guest userId is not a valid ID', 400));
        }
    }
    if (reminders !== undefined) {
        if (!Array.isArray(reminders))
            return next(new AppError('reminders must be an array', 400));
        for (const r of reminders) {
            if (!r || typeof r !== 'object')
                return next(new AppError('Each reminder must be an object', 400));
            if (r.method !== undefined && !VALID_REMINDER_METHODS.includes(r.method))
                return next(new AppError(`reminder method must be one of: ${VALID_REMINDER_METHODS.join(', ')}`, 400));
            if (r.minutesBefore !== undefined && (!Number.isInteger(r.minutesBefore) || r.minutesBefore < 0))
                return next(new AppError('reminder minutesBefore must be a non-negative integer', 400));
        }
    }
    if (recurrence !== undefined && recurrence !== null) {
        if (typeof recurrence !== 'object' || Array.isArray(recurrence))
            return next(new AppError('recurrence must be an object', 400));
        if (!VALID_RECURRENCE_FREQUENCIES.includes(recurrence.frequency))
            return next(new AppError(`recurrence.frequency must be one of: ${VALID_RECURRENCE_FREQUENCIES.join(', ')}`, 400));
        if (recurrence.interval !== undefined && (!Number.isInteger(recurrence.interval) || recurrence.interval < 1))
            return next(new AppError('recurrence.interval must be a positive integer', 400));
        if (recurrence.byWeekday !== undefined) {
            const validWeekdays = Array.isArray(recurrence.byWeekday) &&
                recurrence.byWeekday.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
            if (!validWeekdays)
                return next(new AppError('recurrence.byWeekday must be an array of integers 0-6', 400));
        }
        if (recurrence.count !== undefined && recurrence.count !== null && (!Number.isInteger(recurrence.count) || recurrence.count < 1))
            return next(new AppError('recurrence.count must be a positive integer', 400));
        if (recurrence.until !== undefined && recurrence.until !== null && !isValidDateValue(recurrence.until))
            return next(new AppError('recurrence.until must be a valid date', 400));
    }
    next();
};
export const validateCalendarCategoryId = validateParamId('id');
export const validateCalendarCategory = (req, res, next) => {
    const { name, color } = req.body;
    if (req.method === 'POST' && (!name || !name.trim()))
        return next(new AppError('Name is required', 400));
    if (name !== undefined && !name.trim())
        return next(new AppError('Name cannot be empty', 400));
    if (color !== undefined && color !== null && !HEX_COLOR_REGEX.test(color))
        return next(new AppError('color must be a valid hex color', 400));
    next();
};
export const validateCalendarId = validateParamId('id');
// `originalStart` identifies which generated occurrence slot a request
// targets (see EventException/backend/utils/recurrence.ts) — it's a date,
// not an id, so it needs its own param validator rather than validateParamId.
export const validateOccurrenceParams = (req, res, next) => {
    if (!isValidId(req.params.eventId))
        return next(new AppError(`Invalid ID: ${req.params.eventId}`, 400));
    if (!isValidDateValue(req.params.originalStart))
        return next(new AppError(`Invalid originalStart: ${req.params.originalStart}`, 400));
    next();
};
export const validateCalendar = (req, res, next) => {
    const { name, color, isEnabled } = req.body;
    if (req.method === 'POST' && (!name || !name.trim()))
        return next(new AppError('Name is required', 400));
    if (name !== undefined && !name.trim())
        return next(new AppError('Name cannot be empty', 400));
    if (color !== undefined && color !== null && !HEX_COLOR_REGEX.test(color))
        return next(new AppError('color must be a valid hex color', 400));
    if (isEnabled !== undefined && typeof isEnabled !== 'boolean')
        return next(new AppError('isEnabled must be a boolean', 400));
    next();
};
//# sourceMappingURL=validate.js.map