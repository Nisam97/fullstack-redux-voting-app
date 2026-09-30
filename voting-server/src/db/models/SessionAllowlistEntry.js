import mongoose from 'mongoose';

const sessionAllowlistEntrySchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

sessionAllowlistEntrySchema.index({ sessionId: 1, email: 1 }, { unique: true });

export const SessionAllowlistEntry = mongoose.models.SessionAllowlistEntry || mongoose.model('SessionAllowlistEntry', sessionAllowlistEntrySchema);
export default SessionAllowlistEntry;
