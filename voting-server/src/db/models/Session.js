import mongoose from 'mongoose';

const candidateInfoSchema = new mongoose.Schema({
  name: {
    type: String,
    maxlength: 80,
    default: ''
  },
  description: {
    type: String,
    maxlength: 80,
    default: ''
  }
}, { _id: false });

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
  type: {
    type: String,
    required: true,
    enum: ['public', 'secured'],
    default: 'public'
  },
  votingMode: {
    type: String,
    required: true,
    enum: ['single_ballot', 'tournament'],
    default: 'tournament'
  },
  joinCode: {
    type: String
  },
  whoCanJoin: {
    type: String,
    enum: ['public', 'allowlist', 'approval'],
    default: 'public'
  },
  candidateInfo: {
    type: [candidateInfoSchema],
    default: []
  },
  publishResultsPublicly: {
    type: Boolean,
    required: true,
    default: true
  },
  pendingExpiresAt: {
    type: Date,
    default: null
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

// The joinCode uniqueness guard matches the spec invariant and the collision
// check in getUniqueJoinCode (server.js): codes must be unique across pending
// and open sessions only. Completed and archived sessions may reuse a code, so
// those documents stay out of the index entirely via the partial filter.
sessionSchema.index(
  { joinCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      joinCode: { $exists: true },
      status: { $in: ['pending', 'open'] }
    }
  }
);

sessionSchema.index(
  { pendingExpiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { status: 'pending' } }
);

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
export default Session;
