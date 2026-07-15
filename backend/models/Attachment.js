import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
      index: true,
    },
    projectItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectItem',
      default: null,
      index: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    gridFsId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

attachmentSchema.pre('validate', function () {
  if (!!this.task === !!this.projectItem) {
    throw new Error('Attachment must reference exactly one of task or projectItem');
  }
});

export default mongoose.model('Attachment', attachmentSchema);
