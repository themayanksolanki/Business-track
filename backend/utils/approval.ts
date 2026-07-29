import prisma from '../lib/prisma.js';

// True when the item has no active approvers at all (existing completion
// workflow, unaffected), or when every active (non-cancelled) approver has
// approved. Shared by taskApprovalController.ts, projectItemController.ts's
// direct status-set path, and statusSync.service.ts's ancestor rollup — kept
// standalone (not in taskApprovalController.ts) to avoid a circular import
// with statusSync.service.ts, which projectItemController.ts also imports.
export async function isApprovalCompleteForItem(projectItemId: number): Promise<boolean> {
  const approvers = await prisma.taskApprover.findMany({
    where: { projectItemId, status: { not: 'cancelled' } },
    select: { status: true },
  });
  if (approvers.length === 0) return true;
  return approvers.every((a) => a.status === 'approved');
}
