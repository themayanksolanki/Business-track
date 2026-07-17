import mongoose from 'mongoose';
import { getNextSequence } from '../utils/counter.js';

const taskSchema = new mongoose.Schema(
  {
    numericId: {
      type: Number,
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['todo', 'pending', 'completed'],
      default: 'todo',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    parentTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    tags: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Tag',
      default: [],
    },
  },
  { timestamps: true }
);

taskSchema.pre('save', async function () {
  if (this.isNew && this.numericId == null) {
    this.numericId = await getNextSequence('task');
  }
});

export default mongoose.model('Task', taskSchema);
