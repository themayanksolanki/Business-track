import mongoose from 'mongoose';
import { getNextSequence } from '../utils/counter.js';

const userSchema = new mongoose.Schema(
  {
    numericId: {
      type: Number,
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['Admin', 'Manager', 'Team Lead', 'User'],
      required: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    teamLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    profileImage: {
      type: String,
      default: null,
    },
    resetOtp: {
      type: String,
      default: null,
    },
    resetOtpExpiry: {
      type: Date,
      default: null,
    },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    mutedContacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (this.isNew && this.numericId == null) {
    this.numericId = await getNextSequence('user');
  }
});

export default mongoose.model('User', userSchema);
