import mongoose from 'mongoose';
import { getNextSequence } from '../utils/counter.js';

const projectRoleSchema = new mongoose.Schema(
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
    rank: {
      type: Number,
      required: true,
      default: 0,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
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
  },
  { timestamps: true }
);

projectRoleSchema.index(
  { organization: 1, title: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

projectRoleSchema.pre('save', async function () {
  if (this.isNew && this.numericId == null) {
    this.numericId = await getNextSequence('projectRole');
  }
});

export default mongoose.model('ProjectRole', projectRoleSchema);
