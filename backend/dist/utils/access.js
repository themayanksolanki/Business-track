import prisma from '../lib/prisma.js';
// `role` is a plain string column (not a Prisma enum — see user.prisma), so
// this is intentionally Record<string, number> rather than a literal-keyed
// object: callers index it with whatever role string a user row happens to
// carry, not just the four names below.
export const ROLE_RANK = { Admin: 4, Manager: 3, 'Team Lead': 2, User: 1 };
// true if `actorRole` is allowed to manage/act on a user/resource owned by
// `targetRole`. Admins outrank (and can manage) everyone, including other
// Admins; everyone else needs a strictly higher rank.
export const canManageRole = (actorRole, targetRole) => actorRole === 'Admin' || ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
// Whether `actor` may activate/deactivate/edit, or reset the password of,
// `target`. Requires actor to outrank target (canManageRole) and, for every
// non-Admin actor, that target is actually their direct report (target's
// managerId/teamLeadId points back at actor).
//
// This used to be four different strictness levels hand-rolled across
// userController's activateUser/deactivateUser/updateUser/updateUserPassword
// — only activateUser required direct-report scoping for Manager, and only
// activateUser/updateUserPassword required it for Team Lead. Nothing
// suggested that spread was intentional (a Manager could edit/deactivate/
// reset the password of a user outside their team but not activate them),
// so this unifies on the strictest of the four.
export const canActOnUser = (actor, target) => {
    if (!canManageRole(actor.role, target.role))
        return false;
    if (actor.role === 'Admin')
        return true;
    if (actor.role === 'Manager')
        return target.managerId === actor.id;
    if (actor.role === 'Team Lead')
        return target.teamLeadId === actor.id;
    return false;
};
// Accepts one root id or many — batching multiple roots into the same
// frontier keeps this to one query per depth level total, instead of one
// full walk per root.
export const getDescendantIds = async (rootIds) => {
    const result = [];
    let frontier = Array.isArray(rootIds) ? rootIds : [rootIds];
    while (frontier.length) {
        const children = await prisma.department.findMany({
            where: { parentId: { in: frontier } },
            select: { id: true },
        });
        const ids = children.map((c) => c.id);
        result.push(...ids);
        frontier = ids;
    }
    return result;
};
// Admins see every department in their organization. Everyone else is
// scoped to the department(s) they've been assigned plus any sub-departments
// beneath those — never their siblings, ancestors, or unrelated branches.
// Returns null for Admins (no restriction beyond organization), otherwise an
// array of allowed ids.
export const getAccessibleDepartmentIds = async (user) => {
    if (user.role === 'Admin')
        return null;
    const withDepartments = await prisma.user.findUnique({
        where: { id: user.id },
        select: { departments: { select: { id: true } } },
    });
    const ownIds = withDepartments?.departments.map((d) => d.id) ?? [];
    if (!ownIds.length)
        return [];
    const descendantIds = await getDescendantIds(ownIds);
    return [...ownIds, ...descendantIds];
};
export const canAccessDepartment = (accessibleIds, departmentId) => accessibleIds === null || accessibleIds.includes(Number(departmentId));
// A Team Lead's direct reports — used both to scope which existing tasks
// they can reach (getTaskAccessLevel below) and to validate who they're
// allowed to assign a new/reassigned task to (taskController.js).
export const getTeamMemberIds = async (teamLeadId) => {
    const members = await prisma.user.findMany({ where: { teamLeadId, role: 'User' }, select: { id: true } });
    return members.map((m) => m.id);
};
// Centralizes Task's access predicate (previously duplicated identically
// across taskController.js's getTaskById/updateTask and attachmentController
// .js's canAccessTask) so a future share-link/task-sharing feature only
// needs one more branch here (returning 'view') instead of touching every
// call site again. Currently only ever returns 'edit' or null — there's no
// task-level view-only grant yet, since Task has no membership/role concept.
export const getTaskAccessLevel = async (task, user) => {
    if (task.organizationId !== user.organizationId)
        return null;
    if (user.role === 'Admin' || user.role === 'Manager')
        return 'edit';
    if (user.role === 'Team Lead') {
        const memberIds = await getTeamMemberIds(user.id);
        const allowed = [user.id, ...memberIds];
        return allowed.includes(task.assignedToId) ? 'edit' : null;
    }
    return task.assignedToId === user.id || task.createdById === user.id ? 'edit' : null;
};
//# sourceMappingURL=access.js.map