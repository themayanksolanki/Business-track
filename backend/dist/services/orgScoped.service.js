import AppError from '../utils/AppError.js';
// Null-safe so a row with organizationId: null never accidentally matches a
// caller whose own organizationId happens to also be null/undefined in a
// different sense (e.g. not yet loaded) — both sides are normalized first.
export const sameOrg = (a, b) => (a ?? null) === (b ?? null);
// Fetches a row via `find` and 404s (rather than leaking existence via a
// 403) if it doesn't exist or belongs to another organization. This is the
// single shared version of a block that used to be copy-pasted — with two
// slightly different idioms — across user/department/category/tag (and
// others): `const x = await prisma.<model>.findUnique(...); if (!x || x.organizationId !== req.user!.organizationId) ...`.
export async function loadOrgScopedOrFail(find, organizationId, notFoundMessage = 'Not found') {
    const row = await find();
    if (!row || !sameOrg(row.organizationId, organizationId))
        throw new AppError(notFoundMessage, 404);
    return row;
}
//# sourceMappingURL=orgScoped.service.js.map