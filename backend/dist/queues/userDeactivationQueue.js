import { Queue } from 'bullmq';
import connection from '../lib/redis.js';
export const USER_DEACTIVATION_QUEUE = 'user-deactivation';
const userDeactivationQueue = new Queue(USER_DEACTIVATION_QUEUE, { connection });
export const enqueueUserDeactivation = ({ targetId, handlerId, actorId }) => userDeactivationQueue.add('deactivate', { targetId, handlerId, actorId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
});
export default userDeactivationQueue;
//# sourceMappingURL=userDeactivationQueue.js.map