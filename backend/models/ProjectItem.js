import mongoose from 'mongoose';
import { getNextSequence } from '../utils/counter.js';

const projectItemSchema = new mongoose.Schema(
  {
    numericId: {
      type: Number,
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectItem',
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ['group', 'task', 'subtask'],
      required: true,
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
      enum: ['todo', 'doing', 'completed'],
      default: 'todo',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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
    depth: {
      type: Number,
      required: true,
    },
    order: {
      type: Number,
      required: true,
      default: 0,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    tags: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Tag',
      default: [],
    },
  },
  { timestamps: true }
);

projectItemSchema.index({ project: 1, parentId: 1, order: 1 });

projectItemSchema.pre('save', async function () {
  if (this.isNew && this.numericId == null) {
    this.numericId = await getNextSequence('projectItem');
  }
});

export default mongoose.model('ProjectItem', projectItemSchema);
