import mongoose from 'mongoose';

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
    required: true
  },
  completedAt: {
    type: Date,
    default: Date.now
  }
});

resultSchema.index({ completedAt: -1 });
resultSchema.index({ sessionId: 1, completedAt: -1 });

export const Result = mongoose.models.Result || mongoose.model('Result', resultSchema);
export default Result;
