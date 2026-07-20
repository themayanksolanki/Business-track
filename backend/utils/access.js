import prisma from '../lib/prisma.js';

export const ROLE_RANK = { Admin: 4, Manager: 3, 'Team Lead': 2, User: 1 };

// true if `actorRole` is allowed to manage/act on a user/resource owned by
// `targetRole`. Admins outrank (and can manage) everyone, including other
// Admins; everyone else needs a strictly higher rank.
export const canManageRole = (actorRole, targetRole) =>
  actorRole === 'Admin' || ROLE_RANK[actorRole] > ROLE_RANK[targetRole];

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
  if (user.role === 'Admin') return null;

  const withDepartments = await prisma.user.findUnique({
    where: { id: user.id },
    select: { departments: { select: { id: true } } },
  });
  const ownIds = withDepartments?.departments.map((d) => d.id) ?? [];
  if (!ownIds.length) return [];

  const descendantIds = await getDescendantIds(ownIds);
  return [...ownIds, ...descendantIds];
};

export const canAccessDepartment = (accessibleIds, departmentId) =>
  accessibleIds === null || accessibleIds.includes(Number(departmentId));
