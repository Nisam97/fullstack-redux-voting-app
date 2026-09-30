import mongoose from 'mongoose';

const roundSnapshotSchema = new mongoose.Schema({
  roundIndex: {
    type: Number,
    required: true
  },
  kind: {
    type: String,
    enum: ['pairwise', 'single_ballot'],
    default: 'pairwise',
    required: true
  },
  candidates: {
    type: [String],
    required: true
  },
  tally: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: () => ({})
  },
  totalVotes: {
    type: Number,
    required: true,
    default: 0
  },
  closedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  resolution: {
    type: String,
    enum: ['majority_win', 'tie_advance', 'runoff', 'admin_pick', 'coin_flip', 'no_result', 'zero_vote_replay'],
    required: true
  },
  advanced: {
    type: [String],
    default: null
  }
}, { _id: false });

const resultSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
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
  winner: {
    type: String,
    required: function() {
      return this.winner === null ? false : true;
    }
  },
  completedAt: {
    type: Date,
    default: Date.now
  },
  rounds: {
    type: [roundSnapshotSchema],
    default: []
  }
});

resultSchema.index({ completedAt: -1 });
resultSchema.index({ sessionId: 1, completedAt: -1 });

export const Result = mongoose.models.Result || mongoose.model('Result', resultSchema);
export default Result;
