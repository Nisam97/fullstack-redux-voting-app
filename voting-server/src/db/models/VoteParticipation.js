import mongoose from 'mongoose';

const voteParticipationSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  roundId: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

voteParticipationSchema.index({ sessionId: 1, roundId: 1, userId: 1 }, { unique: true });

export const VoteParticipation = mongoose.models.VoteParticipation || mongoose.model('VoteParticipation', voteParticipationSchema);
export default VoteParticipation;
