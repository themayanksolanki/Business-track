/**
 * Run once: node backend/scripts/migrateTaskStatus.js
 *
 * This schema never used a boolean `completed` field, so no boolean→string
 * migration is required. Existing 'pending' and 'completed' strings are already
 * valid in the new enum. This script only re-defaults any document that somehow
 * has a null/undefined/invalid status to 'todo'.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI!);
const Task = mongoose.model('Task', new mongoose.Schema({ status: String }, { strict: false }));

const VALID = ['todo', 'pending', 'completed'];

const result = await Task.updateMany(
  { status: { $nin: VALID } },
  { $set: { status: 'todo' } },
);

console.log(`Migrated ${result.modifiedCount} document(s) with invalid/missing status → 'todo'.`);
await mongoose.disconnect();
