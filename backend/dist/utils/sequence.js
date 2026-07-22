// Assigns the next per-organization sequence number for a given entity type
// (User/Project/Task/ProjectItem/ProjectRole each start their own count at 1
// per organization). Must be called with a transaction client (`tx`), never
// the top-level `prisma`, so the counter bump and the row create it backs
// commit or roll back together. Prisma compiles `upsert` on Postgres to
// INSERT ... ON CONFLICT DO UPDATE, so this is atomic under concurrent
// creates in the same org — they serialize on the row lock instead of
// racing to the same number.
export const nextSequenceId = (tx, organizationId, entity) => organizationId == null
    ? Promise.resolve(null)
    : tx.orgSequence
        .upsert({
        where: { organizationId_entity: { organizationId, entity } },
        create: { organizationId, entity, value: 1 },
        update: { value: { increment: 1 } },
    })
        .then((seq) => seq.value);
//# sourceMappingURL=sequence.js.map