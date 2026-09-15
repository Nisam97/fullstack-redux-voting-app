import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    default: ''
  },
  entries: {
    type: [String],
    required: true,
    default: undefined
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'open', 'completed', 'archived'],
    default: 'pending',
    index: true
  },
  winner: {
    type: String,
    default: null
  },
  timerDuration: {
    type: Number,
    default: 30,
    min: 5,
    max: 300
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null
  },
  archivedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
export default Session;
