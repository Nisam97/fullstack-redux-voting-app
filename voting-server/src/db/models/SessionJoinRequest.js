import mongoose from 'mongoose';

const sessionJoinRequestSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  displayName: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  decidedAt: {
    type: Date,
    default: null
  }
});

sessionJoinRequestSchema.index({ sessionId: 1, userId: 1 }, { unique: true });

export const SessionJoinRequest = mongoose.models.SessionJoinRequest || mongoose.model('SessionJoinRequest', sessionJoinRequestSchema);
export default SessionJoinRequest;
