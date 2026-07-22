import prisma from '../lib/prisma.js';
import AppError from '../utils/AppError.js';
import { canAccessProject, canManageProjectSettings } from './projectController.js';
import { notifyUser } from '../utils/notifications.js';
const USER_SELECT = { id: true, username: true, email: true, role: true, profileImage: true };
const ROLE_SELECT = { id: true, title: true, description: true, isDefault: true, rank: true, canEdit: true };
const MEMBER_INCLUDE = { user: { select: USER_SELECT }, role: { select: ROLE_SELECT } };
// Backs the "Add Member" dropdown: paginated, searchable, org-scoped, and
// excludes users already on the project — loaded only when that dropdown is
// opened, never as part of the Project Details response.
export const getMemberCandidates = async (req, res, next) => {
    try {
        const project = await prisma.project.findUnique({
            where: { id: Number(req.params.projectId) },
            include: { members: { select: { userId: true } } },
        });
        if (!project)
            return next(new AppError('Project not found', 404));
        if (!(await canAccessProject(req.user, project)))
            return next(new AppError('You do not have access to this project', 403));
        if (!canManageProjectSettings(req.user, project))
            return next(new AppError('You do not have permission to manage members of this project', 403));
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const skip = (page - 1) * limit;
        const where = {
            isActive: true,
            organizationId: req.user.organizationId,
            id: { notIn: project.members.map((m) => m.userId) },
        };
        const search = (req.query.search ?? '').trim();
        if (search) {
            where.OR = [
                { username: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
            ];
        }
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                omit: { password: true },
                orderBy: { username: 'asc' },
                skip,
                take: limit,
            }),
            prisma.user.count({ where }),
        ]);
        res.status(200).json({
            users,
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        });
    }
    catch (err) {
        next(err);
    }
};
export const getMembers = async (req, res, next) => {
    try {
        const project = await prisma.project.findUnique({
            where: { id: Number(req.params.projectId) },
            include: { members: { include: MEMBER_INCLUDE, orderBy: { addedAt: 'asc' } } },
        });
        if (!project)
            return next(new AppError('Project not found', 404));
        if (!(await canAccessProject(req.user, project)))
            return next(new AppError('You do not have access to this project', 403));
        res.status(200).json(project.members);
    }
    catch (err) {
        next(err);
    }
};
export const addMember = async (req, res, next) => {
    try {
        const project = await prisma.project.findUnique({
            where: { id: Number(req.params.projectId) },
            include: { members: { select: { userId: true } } },
        });
        if (!project)
            return next(new AppError('Project not found', 404));
        if (!(await canAccessProject(req.user, project)))
            return next(new AppError('You do not have access to this project', 403));
        if (!canManageProjectSettings(req.user, project))
            return next(new AppError('You do not have permission to manage members of this project', 403));
        const userId = Number(req.body.userId);
        const roleId = Number(req.body.roleId);
        const targetUser = await prisma.user.findUnique({ where: { id: userId } });
        if (!targetUser || !targetUser.isActive || targetUser.organizationId !== req.user.organizationId)
            return next(new AppError('User not found', 404));
        const role = await prisma.projectRole.findUnique({ where: { id: roleId } });
        if (!role || role.organizationId !== req.user.organizationId)
            return next(new AppError('Role not found', 404));
        if (project.members.some((m) => m.userId === userId))
            return next(new AppError('This user is already a project member', 409));
        await prisma.projectMember.create({
            data: { projectId: project.id, userId, roleId, addedById: req.user.id },
        });
        await prisma.project.update({ where: { id: project.id }, data: { updatedById: req.user.id } });
        const members = await prisma.projectMember.findMany({
            where: { projectId: project.id },
            include: MEMBER_INCLUDE,
            orderBy: { addedAt: 'asc' },
        });
        await notifyUser(userId, req.user.id, {
            type: 'projectMemberAdded',
            title: 'Added to a project',
            message: `${req.user.username} added you to "${project.name}"`,
            projectId: project.id,
        });
        res.status(201).json({ message: 'Member added', members });
    }
    catch (err) {
        next(err);
    }
};
export const updateMemberRole = async (req, res, next) => {
    try {
        const project = await prisma.project.findUnique({
            where: { id: Number(req.params.projectId) },
            include: { members: { select: { userId: true } } },
        });
        if (!project)
            return next(new AppError('Project not found', 404));
        if (!(await canAccessProject(req.user, project)))
            return next(new AppError('You do not have access to this project', 403));
        if (!canManageProjectSettings(req.user, project))
            return next(new AppError('You do not have permission to manage members of this project', 403));
        const member = await prisma.projectMember.findUnique({ where: { id: Number(req.params.memberId) } });
        if (!member || member.projectId !== project.id)
            return next(new AppError('Member not found', 404));
        const roleId = Number(req.body.roleId);
        const role = await prisma.projectRole.findUnique({ where: { id: roleId } });
        if (!role || role.organizationId !== req.user.organizationId)
            return next(new AppError('Role not found', 404));
        await prisma.projectMember.update({ where: { id: member.id }, data: { roleId } });
        await prisma.project.update({ where: { id: project.id }, data: { updatedById: req.user.id } });
        const members = await prisma.projectMember.findMany({
            where: { projectId: project.id },
            include: MEMBER_INCLUDE,
            orderBy: { addedAt: 'asc' },
        });
        res.status(200).json({ message: 'Member role updated', members });
    }
    catch (err) {
        next(err);
    }
};
export const removeMember = async (req, res, next) => {
    try {
        const project = await prisma.project.findUnique({
            where: { id: Number(req.params.projectId) },
            include: { members: { select: { userId: true } } },
        });
        if (!project)
            return next(new AppError('Project not found', 404));
        if (!(await canAccessProject(req.user, project)))
            return next(new AppError('You do not have access to this project', 403));
        if (!canManageProjectSettings(req.user, project))
            return next(new AppError('You do not have permission to manage members of this project', 403));
        const member = await prisma.projectMember.findUnique({ where: { id: Number(req.params.memberId) } });
        if (!member || member.projectId !== project.id)
            return next(new AppError('Member not found', 404));
        await prisma.projectMember.delete({ where: { id: member.id } });
        await prisma.project.update({ where: { id: project.id }, data: { updatedById: req.user.id } });
        const members = await prisma.projectMember.findMany({
            where: { projectId: project.id },
            include: MEMBER_INCLUDE,
            orderBy: { addedAt: 'asc' },
        });
        res.status(200).json({ message: 'Member removed', members });
    }
    catch (err) {
        next(err);
    }
};
//# sourceMappingURL=projectMemberController.js.map