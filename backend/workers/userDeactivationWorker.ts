import { Worker, type Job } from 'bullmq';
import connection from '../lib/redis.js';
import prisma from '../lib/prisma.js';
import { notifyUser } from '../utils/notifications.js';
import { USER_DEACTIVATION_QUEUE, type DeactivationJobData } from '../queues/userDeactivationQueue.js';

// Moved verbatim from userController.js's deactivateUser (not duplicated) —
// the only difference is that `target`/`handler` are now just ids off the
// job payload rather than already-loaded Prisma rows, since job data is
// plain JSON round-tripped through Redis.
async function processDeactivation(job: Job<DeactivationJobData>) {
  const { targetId, handlerId } = job.data;

  return prisma.$transaction(async (tx) => {
    await tx.task.updateMany({ where: { assignedToId: targetId }, data: { assignedToId: handlerId } });
    await tx.projectItem.updateMany({ where: { assignedToId: targetId }, data: { assignedToId: handlerId } });
    await tx.project.updateMany({ where: { ownerId: targetId }, data: { ownerId: handlerId } });

    // Same ProjectMember unique-constraint handling as before: drop the
    // target's row wherever the handler is already a member of that
    // project, otherwise hand the row itself to the handler.
    const memberships = await tx.projectMember.findMany({ where: { userId: targetId } });
    if (memberships.length) {
      const projectIds = memberships.map((m) => m.projectId);
      const handlerMemberships = await tx.projectMember.findMany({
        where: { userId: handlerId, projectId: { in: projectIds } },
        select: { projectId: true },
      });
      const handlerProjectIds = new Set(handlerMemberships.map((m) => m.projectId));

      for (const membership of memberships) {
        if (handlerProjectIds.has(membership.projectId)) {
          await tx.projectMember.delete({ where: { id: membership.id } });
        } else {
          await tx.projectMember.update({ where: { id: membership.id }, data: { userId: handlerId } });
        }
      }
    }

    return tx.user.update({
      where: { id: targetId },
      data: { isActive: false },
      omit: { password: true },
    });
  });
}

const worker = new Worker<DeactivationJobData>(USER_DEACTIVATION_QUEUE, processDeactivation, { connection });

// job.data.actorId is the admin who triggered the deactivation — the
// recipient of this completion notice, not the notifyUser "actor" param
// (which means "who else caused this for the recipient"); there is no such
// third party here, so that stays null.
worker.on('completed', async (job, result) => {
  const { actorId } = job.data;
  try {
    await notifyUser(actorId, null, {
      type: 'userDeactivated',
      title: 'Deactivation complete',
      message: `${result.username} has been deactivated and their work reassigned.`,
    });
  } catch (err: any) {
    console.error('Failed to send deactivation-complete notification:', err.message);
  }
});

worker.on('failed', async (job, err) => {
  if (!job) return;
  // Only notify once all retries are exhausted — earlier attempts just retry
  // silently via BullMQ's backoff.
  if (job.attemptsMade < (job.opts.attempts ?? 0)) return;

  const { actorId, targetId } = job.data;
  try {
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { username: true } });
    await notifyUser(actorId, null, {
      type: 'userDeactivated',
      title: 'Deactivation failed',
      message: `Failed to deactivate ${target?.username ?? 'user'} after multiple attempts: ${err.message}`,
    });
  } catch (notifyErr: any) {
    console.error('Failed to send deactivation-failure notification:', notifyErr.message);
  }
});

export default worker;
