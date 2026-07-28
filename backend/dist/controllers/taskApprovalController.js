import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { canAccessProject, canEditProject, canManageProjectSettings } from './projectController.js';
import { notifyUser, notifyUsers } from '../utils/notifications.js';
import { isApprovalCompleteForItem } from '../utils/approval.js';
const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };
const ACCESS_INCLUDE = { members: { select: { userId: true } } };
const ACCESS_INCLUDE_WITH_ROLE = {
    members: { select: { userId: true, role: { select: { canEdit: true } } } },
};
// Task Owner (assignee), Task Creator, or "Project Admin" — there's no
// dedicated project-admin flag in this schema (ProjectRole only has a
// binary canEdit), so this reuses canManageProjectSettings (org Admin/
// Manager, or the project's own createdById/ownerId), the closest existing
// "project admin" concept in the codebase.
const canManageApprovers = (user, item, project) => user.id === item.assignedToId || user.id === item.createdById || canManageProjectSettings(user, project);
const logHistory = (projectItemId, userId, action, detail) => prisma.approvalHistory.create({ data: { projectItemId, userId, action, detail } });
const getActiveApprovers = (projectItemId) => prisma.taskApprover.findMany({
    where: { projectItemId, status: { not: 'cancelled' } },
    include: { user: { select: USER_SELECT } },
    orderBy: { assignedAt: 'asc' },
});
// Shared "load + access-check" prologue every handler below needs — loads
// the project (optionally with role.canEdit for mutating endpoints), checks
// canAccessProject, then loads the item scoped to that project. Returns null
// (having already called next() with the right error) on any failure, so
// callers just do `const ctx = await loadContext(...); if (!ctx) return;`.
async function loadContext(req, next, withRole = false) {
    const project = await prisma.project.findUnique({
        where: { id: Number(req.params.projectId) },
        include: withRole ? ACCESS_INCLUDE_WITH_ROLE : ACCESS_INCLUDE,
    });
    if (!project) {
        next(new AppError('Project not found', 404));
        return null;
    }
    if (!(await canAccessProject(req.user, project))) {
        next(new AppError('You do not have access to this project', 403));
        return null;
    }
    const item = await prisma.projectItem.findFirst({
        where: { id: Number(req.params.itemId), projectId: project.id },
    });
    if (!item) {
        next(new AppError('Item not found', 404));
        return null;
    }
    return { project, item };
}
export const getApprovers = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next);
        if (!ctx)
            return;
        const approvers = await getActiveApprovers(ctx.item.id);
        const approved = approvers.filter((a) => a.status === 'approved').length;
        res.status(200).json({ approvers, progress: { approved, total: approvers.length } });
    }
    catch (err) {
        next(err);
    }
};
export const assignApprovers = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next, true);
        if (!ctx)
            return;
        const { project, item } = ctx;
        if (!canManageApprovers(req.user, item, project))
            return next(new AppError('Only the task owner, creator, or a project admin can assign approvers', 403));
        if (item.status === 'completed')
            return next(new AppError('Cannot change approvers on a completed item', 400));
        const userIds = Array.isArray(req.body.userIds) ? req.body.userIds.map(Number) : [];
        if (userIds.length === 0)
            return next(new AppError('userIds must be a non-empty array', 400));
        const memberIds = new Set(project.members.map((m) => m.userId));
        if (userIds.some((id) => !memberIds.has(id)))
            return next(new AppError('All approvers must be active project members', 400));
        const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } });
        const usernameById = new Map(users.map((u) => [u.id, u.username]));
        for (const userId of userIds) {
            const existing = await prisma.taskApprover.findUnique({
                where: { projectItemId_userId: { projectItemId: item.id, userId } },
            });
            if (existing && existing.status !== 'cancelled')
                continue; // already an active approver
            if (existing) {
                await prisma.taskApprover.update({
                    where: { id: existing.id },
                    data: { status: 'pending', assignedById: req.user.id, assignedAt: new Date(), respondedAt: null, removedAt: null },
                });
            }
            else {
                await prisma.taskApprover.create({
                    data: { projectItemId: item.id, userId, assignedById: req.user.id },
                });
            }
            await logHistory(item.id, req.user.id, 'approverAssigned', `Assigned ${usernameById.get(userId) ?? `user #${userId}`} as approver`);
            await notifyUser(userId, req.user.id, {
                type: 'taskApprovalRequested',
                title: 'Approval requested',
                message: `${req.user.username} requested your approval on "${item.title}"`,
                projectId: project.id,
                projectItemId: item.id,
            });
        }
        res.status(201).json({ message: 'Approvers assigned', approvers: await getActiveApprovers(item.id) });
    }
    catch (err) {
        next(err);
    }
};
export const removeApprover = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next, true);
        if (!ctx)
            return;
        const { project, item } = ctx;
        if (!canManageApprovers(req.user, item, project))
            return next(new AppError('Only the task owner, creator, or a project admin can remove approvers', 403));
        const userId = Number(req.params.userId);
        const approver = await prisma.taskApprover.findUnique({
            where: { projectItemId_userId: { projectItemId: item.id, userId } },
            include: { user: { select: { username: true } } },
        });
        if (!approver || approver.status === 'cancelled')
            return next(new AppError('Approver not found', 404));
        await prisma.taskApprover.update({
            where: { id: approver.id },
            data: { status: 'cancelled', removedAt: new Date() },
        });
        await logHistory(item.id, req.user.id, 'approverRemoved', `Removed ${approver.user.username} as approver`);
        res.status(200).json({ message: 'Approver removed', approvers: await getActiveApprovers(item.id) });
    }
    catch (err) {
        next(err);
    }
};
export const approveItem = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next);
        if (!ctx)
            return;
        const { project, item } = ctx;
        const approver = await prisma.taskApprover.findUnique({
            where: { projectItemId_userId: { projectItemId: item.id, userId: req.user.id } },
        });
        if (!approver || approver.status === 'cancelled')
            return next(new AppError('You are not an assigned approver for this item', 403));
        await prisma.taskApprover.update({
            where: { id: approver.id },
            data: { status: 'approved', respondedAt: new Date() },
        });
        await logHistory(item.id, req.user.id, 'approved');
        if (item.assignedToId) {
            await notifyUser(item.assignedToId, req.user.id, {
                type: 'taskApproved',
                title: 'Task approved',
                message: `${req.user.username} approved "${item.title}"`,
                projectId: project.id,
                projectItemId: item.id,
            });
        }
        const approvers = await getActiveApprovers(item.id);
        if (item.assignedToId && approvers.length > 0 && approvers.every((a) => a.status === 'approved')) {
            await notifyUser(item.assignedToId, req.user.id, {
                type: 'taskFullyApproved',
                title: 'All approvals received',
                message: `"${item.title}" has been approved by all assigned approvers`,
                projectId: project.id,
                projectItemId: item.id,
            });
        }
        res.status(200).json({ message: 'Approved', approvers });
    }
    catch (err) {
        next(err);
    }
};
export const requestChanges = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next);
        if (!ctx)
            return;
        const { project, item } = ctx;
        const commentBody = (req.body.comment || '').trim();
        if (!commentBody)
            return next(new AppError('A comment is required to request changes', 400));
        const approver = await prisma.taskApprover.findUnique({
            where: { projectItemId_userId: { projectItemId: item.id, userId: req.user.id } },
        });
        if (!approver || approver.status === 'cancelled')
            return next(new AppError('You are not an assigned approver for this item', 403));
        await prisma.taskApprover.update({
            where: { id: approver.id },
            data: { status: 'changesRequested', respondedAt: new Date() },
        });
        const comment = await prisma.approvalComment.create({
            data: { projectItemId: item.id, authorId: req.user.id, body: commentBody },
            include: { author: { select: USER_SELECT } },
        });
        await logHistory(item.id, req.user.id, 'changesRequested');
        await logHistory(item.id, req.user.id, 'commentAdded');
        if (item.assignedToId) {
            await notifyUser(item.assignedToId, req.user.id, {
                type: 'taskChangesRequested',
                title: 'Changes requested',
                message: `${req.user.username} requested changes on "${item.title}"`,
                projectId: project.id,
                projectItemId: item.id,
            });
        }
        res.status(200).json({ message: 'Changes requested', approvers: await getActiveApprovers(item.id), comment });
    }
    catch (err) {
        next(err);
    }
};
export const reRequestApproval = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next, true);
        if (!ctx)
            return;
        const { project, item } = ctx;
        if (!canManageApprovers(req.user, item, project))
            return next(new AppError('Only the task owner, creator, or a project admin can re-request approval', 403));
        const toReset = await prisma.taskApprover.findMany({
            where: { projectItemId: item.id, status: 'changesRequested' },
        });
        if (toReset.length === 0)
            return next(new AppError('No approvers currently have changes requested', 400));
        await prisma.taskApprover.updateMany({
            where: { id: { in: toReset.map((a) => a.id) } },
            data: { status: 'pending', respondedAt: null },
        });
        await logHistory(item.id, req.user.id, 'reRequested');
        await notifyUsers(toReset.map((a) => a.userId), req.user.id, {
            type: 'taskApprovalReRequested',
            title: 'Approval re-requested',
            message: `${req.user.username} re-requested your approval on "${item.title}"`,
            projectId: project.id,
            projectItemId: item.id,
        });
        res.status(200).json({ message: 'Approval re-requested', approvers: await getActiveApprovers(item.id) });
    }
    catch (err) {
        next(err);
    }
};
export const getApprovalHistory = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next);
        if (!ctx)
            return;
        const history = await prisma.approvalHistory.findMany({
            where: { projectItemId: ctx.item.id },
            include: { user: { select: USER_SELECT } },
            orderBy: { createdAt: 'desc' },
        });
        res.status(200).json(history);
    }
    catch (err) {
        next(err);
    }
};
export const getApprovalComments = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next);
        if (!ctx)
            return;
        const comments = await prisma.approvalComment.findMany({
            where: { projectItemId: ctx.item.id },
            include: { author: { select: USER_SELECT } },
            orderBy: { createdAt: 'asc' },
        });
        res.status(200).json(comments);
    }
    catch (err) {
        next(err);
    }
};
export const createApprovalComment = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next, true);
        if (!ctx)
            return;
        const { project, item } = ctx;
        if (!canEditProject(req.user, project))
            return next(new AppError('You have view-only access to this project', 403));
        const replyToId = req.body.replyToId ? Number(req.body.replyToId) : null;
        if (replyToId) {
            const parent = await prisma.approvalComment.findFirst({ where: { id: replyToId, projectItemId: item.id } });
            if (!parent)
                return next(new AppError('Comment being replied to was not found', 404));
        }
        const comment = await prisma.approvalComment.create({
            data: { projectItemId: item.id, authorId: req.user.id, body: req.body.body.trim(), replyToId },
            include: { author: { select: USER_SELECT } },
        });
        await logHistory(item.id, req.user.id, 'commentAdded');
        if (item.assignedToId) {
            await notifyUser(item.assignedToId, req.user.id, {
                type: 'taskApprovalCommentAdded',
                title: 'New approval comment',
                message: `${req.user.username} commented on the approval for "${item.title}"`,
                projectId: project.id,
                projectItemId: item.id,
            });
        }
        res.status(201).json({ message: 'Comment added', comment });
    }
    catch (err) {
        next(err);
    }
};
export const updateApprovalComment = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next);
        if (!ctx)
            return;
        const existing = await prisma.approvalComment.findFirst({
            where: { id: Number(req.params.commentId), projectItemId: ctx.item.id },
        });
        if (!existing)
            return next(new AppError('Comment not found', 404));
        if (existing.authorId !== req.user.id)
            return next(new AppError('You can only edit your own comments', 403));
        const comment = await prisma.approvalComment.update({
            where: { id: existing.id },
            data: { body: req.body.body.trim(), isEdited: true, editedAt: new Date() },
            include: { author: { select: USER_SELECT } },
        });
        await logHistory(ctx.item.id, req.user.id, 'commentEdited');
        res.status(200).json({ message: 'Comment updated', comment });
    }
    catch (err) {
        next(err);
    }
};
export const deleteApprovalComment = async (req, res, next) => {
    try {
        const ctx = await loadContext(req, next);
        if (!ctx)
            return;
        const comment = await prisma.approvalComment.findFirst({
            where: { id: Number(req.params.commentId), projectItemId: ctx.item.id },
        });
        if (!comment)
            return next(new AppError('Comment not found', 404));
        if (comment.authorId !== req.user.id)
            return next(new AppError('You can only delete your own comments', 403));
        await prisma.approvalComment.delete({ where: { id: comment.id } });
        await logHistory(ctx.item.id, req.user.id, 'commentDeleted');
        res.status(200).json({ message: 'Comment deleted' });
    }
    catch (err) {
        next(err);
    }
};
export { isApprovalCompleteForItem };
//# sourceMappingURL=taskApprovalController.js.map