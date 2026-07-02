import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    sender:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content:      { type: String, default: '' },
    type:         { type: String, enum: ['text', 'image', 'call'], default: 'text' },
    fileUrl:      { type: String, default: null },
    read:         { type: Boolean, default: false },
    delivered:    { type: Boolean, default: false },
    callType:     { type: String, enum: ['audio', 'video'], default: null },
    callStatus:   { type: String, enum: ['completed', 'missed', 'rejected'], default: null },
    callDuration: { type: Number, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Message', messageSchema);
