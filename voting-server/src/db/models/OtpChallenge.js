import mongoose from 'mongoose';

const otpChallengeSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    index: true,
    lowercase: true,
    trim: true
  },
  codeHash: {
    type: String,
    required: true
  },
  salt: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  attempts: {
    type: Number,
    default: 0,
    min: 0
  },
  lastSentAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  consumedAt: {
    type: Date,
    default: null
  },
  pendingName: {
    type: String,
    default: null,
    trim: true
  },
  pendingUsername: {
    type: String,
    default: null,
    trim: true
  }
}, {
  timestamps: true
});

otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpChallenge = mongoose.models.OtpChallenge || mongoose.model('OtpChallenge', otpChallengeSchema);
export default OtpChallenge;
