import { Queue } from 'bullmq';
import connection from '../lib/redis.js';

export const USER_DEACTIVATION_QUEUE = 'user-deactivation';

// targetId: the user being deactivated. handlerId: who their open work
// (assigned tasks/items, owned projects, project memberships) is handed off
// to. actorId: the admin/manager who triggered this — who gets notified once
// the worker finishes (see userDeactivationWorker.js).
export interface DeactivationJobData {
  targetId: number;
  handlerId: number;
  actorId: number;
}

const userDeactivationQueue = new Queue<DeactivationJobData>(USER_DEACTIVATION_QUEUE, { connection });

export const enqueueUserDeactivation = ({ targetId, handlerId, actorId }: DeactivationJobData) =>
  userDeactivationQueue.add(
    'deactivate',
    { targetId, handlerId, actorId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    }
  );

export default userDeactivationQueue;
