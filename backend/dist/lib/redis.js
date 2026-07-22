import { Redis } from 'ioredis';
// Shared connection for every BullMQ Queue/Worker in this app — BullMQ
// requires maxRetriesPerRequest: null on the connection it's handed (it does
// its own blocking-command retry logic and doesn't want ioredis racing it).
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
export default connection;
//# sourceMappingURL=redis.js.map