import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema(
  {
    projectItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectItem',
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Comment', commentSchema);
