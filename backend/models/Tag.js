import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    textColor: {
      type: String,
      default: '#1f2937',
    },
    backgroundColor: {
      type: String,
      default: '#e5e7eb',
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

tagSchema.index(
  { organization: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

export default mongoose.model('Tag', tagSchema);
