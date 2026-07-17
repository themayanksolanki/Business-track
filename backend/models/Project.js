import mongoose from 'mongoose';
import { getNextSequence } from '../utils/counter.js';

const projectSchema = new mongoose.Schema(
  {
    numericId: {
      type: Number,
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
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
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['active', 'completed'],
      default: 'active',
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    detailsText: {
      type: String,
      default: '',
    },
    effort: {
      type: Number,
      min: 1,
      max: 10,
      default: 5,
    },
    plan: {
      type: new mongoose.Schema(
        {
          fileName: { type: String, required: true },
          gridFsId: { type: mongoose.Schema.Types.ObjectId, required: true },
          mimeType: { type: String, required: true },
          size: { type: Number, required: true },
          uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          uploadedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
      default: null,
    },
    links: {
      type: [
        {
          title: { type: String, trim: true, required: true },
          url: { type: String, trim: true, required: true },
        },
      ],
      default: [],
    },
    tags: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Tag',
      default: [],
    },
  },
  { timestamps: true }
);

projectSchema.pre('save', async function () {
  if (this.isNew && this.numericId == null) {
    this.numericId = await getNextSequence('project');
  }
});

export default mongoose.model('Project', projectSchema);
