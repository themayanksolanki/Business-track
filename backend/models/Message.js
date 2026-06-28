import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    sender:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content:  { type: String, default: '' },
    type:     { type: String, enum: ['text', 'image'], default: 'text' },
    fileUrl:  { type: String, default: null },
    read:     { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('Message', messageSchema);
