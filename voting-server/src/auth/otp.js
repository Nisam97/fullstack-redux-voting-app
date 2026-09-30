import crypto from 'crypto';
import User from '../db/models/User.js';
import OtpChallenge from '../db/models/OtpChallenge.js';

export const COOLDOWN_SECONDS = 60;
export const MAX_ATTEMPTS = 5;

/**
 * Generates a 6 digit zero padded OTP string using crypto.randomInt.
 */
export function generateOtpCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

/**
 * Generates a 16 byte random hex salt.
 */
export function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hashes OTP code with salt using SHA-256.
 */
export function hashOtpCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/**
 * Checks if challenge cooldown is currently active (within 60s of lastSentAt).
 */
export function isCooldownActive(challenge, now = Date.now()) {
  if (!challenge || !challenge.lastSentAt) return false;
  const elapsedMs = now - new Date(challenge.lastSentAt).getTime();
  return elapsedMs < COOLDOWN_SECONDS * 1000;
}

/**
 * Checks if challenge has reached or exceeded max attempts (5).
 */
export function isChallengeLocked(challenge) {
  return !challenge || challenge.attempts >= MAX_ATTEMPTS;
}

/**
 * Validates email format.
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(trimmed);
}

/**
 * Validates username format: 3 to 20 chars, alphanumeric and underscore.
 */
export function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  return /^[a-zA-Z0-9_]{3,20}$/.test(username.trim());
}

/**
 * Safely escapes regular expression characters in a string.
 */
export function escapeRegex(string) {
  if (typeof string !== 'string') return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Creates an OTP challenge for registration or login.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} [params.name]
 * @param {string} [params.username]
 * @returns {Promise<{ success: boolean, code?: string, error?: string, message?: string, retryAfterSeconds?: number }>}
 */
export async function createChallenge({ email, name, username }) {
  if (!isValidEmail(email)) {
    return {
      success: false,
      error: 'INVALID_EMAIL',
      message: 'A valid email address is required.'
    };
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Check existing challenge cooldown first (AC-4)
  // Ensures active cooldown is checked before evaluating username uniqueness,
  // preventing resend requests from getting confusing errors during the cooldown window
  const existingChallenge = await OtpChallenge.findOne({
    email: normalizedEmail,
    consumedAt: null
  }).sort({ createdAt: -1 });

  if (existingChallenge && isCooldownActive(existingChallenge)) {
    const elapsed = Date.now() - new Date(existingChallenge.lastSentAt).getTime();
    const remainingSeconds = Math.max(1, Math.ceil((COOLDOWN_SECONDS * 1000 - elapsed) / 1000));
    return {
      success: false,
      error: 'COOLDOWN_ACTIVE',
      message: `Please wait ${remainingSeconds} seconds before requesting a new code.`,
      retryAfterSeconds: remainingSeconds
    };
  }

  // If username is provided (registration intent)
  if (username !== undefined && username !== null && username !== '') {
    const trimmedUsername = String(username).trim();
    if (!isValidUsername(trimmedUsername)) {
      return {
        success: false,
        error: 'INVALID_USERNAME',
        message: 'Username must be 3 to 20 alphanumeric characters or underscores.'
      };
    }

    // Check if username is already taken by another user with safe regex escaping
    const escapedUsername = escapeRegex(trimmedUsername);
    const existingUserWithUsername = await User.findOne({
      username: new RegExp(`^${escapedUsername}$`, 'i')
    });
    if (existingUserWithUsername) {
      // If the email matches the existing user, this is acceptable, but if different, reject
      if (existingUserWithUsername.email !== normalizedEmail) {
        return {
          success: false,
          error: 'USERNAME_TAKEN',
          message: 'This username is already taken. Please choose another.'
        };
      }
    }
  }

  // Clean up any unconsumed old challenges for this email
  await OtpChallenge.deleteMany({
    email: normalizedEmail,
    consumedAt: null
  });

  const existingUser = await User.findOne({ email: normalizedEmail });

  // AC-5: If register request is made for an already registered email,
  // pending fields are silently discarded and a normal login OTP is sent.
  let pendingName = null;
  let pendingUsername = null;
  if (!existingUser) {
    if (name && typeof name === 'string' && name.trim()) {
      pendingName = name.trim().slice(0, 80);
    }
    if (username && typeof username === 'string' && username.trim()) {
      pendingUsername = username.trim();
    }
  }

  const code = generateOtpCode();
  const salt = generateSalt();
  const codeHash = hashOtpCode(code, salt);

  const ttlMinutes = parseInt(process.env.OTP_TTL_MINUTES, 10) || 10;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const challenge = await OtpChallenge.create({
    email: normalizedEmail,
    codeHash,
    salt,
    expiresAt,
    attempts: 0,
    lastSentAt: new Date(),
    pendingName,
    pendingUsername
  });

  return {
    success: true,
    code,
    challengeId: challenge._id
  };
}

/**
 * Cancels and deletes an unconsumed challenge by ID so cooldown is not burned on delivery failure.
 */
export async function cancelChallenge(challengeId) {
  if (!challengeId) return;
  await OtpChallenge.deleteOne({ _id: challengeId });
}

/**
 * Verifies an OTP code and either finds or creates the User document.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.code
 * @returns {Promise<{ success: boolean, user?: Object, isNewUser?: boolean, error?: string, message?: string, remainingAttempts?: number }>}
 */
export async function verifyChallenge({ email, code }) {
  if (!isValidEmail(email)) {
    return {
      success: false,
      error: 'INVALID_EMAIL',
      message: 'A valid email address is required.'
    };
  }

  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return {
      success: false,
      error: 'INVALID_CODE_FORMAT',
      message: 'Verification code must be 6 digits.'
    };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const trimmedCode = code.trim();

  const challenge = await OtpChallenge.findOne({
    email: normalizedEmail
  }).sort({ createdAt: -1 });

  if (!challenge) {
    return {
      success: false,
      error: 'INVALID_OR_EXPIRED_CODE',
      message: 'No verification code found for this email. Please request a new code.'
    };
  }

  if (challenge.consumedAt) {
    return {
      success: false,
      error: 'CODE_ALREADY_USED',
      message: 'This verification code has already been used. Please request a new one.'
    };
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    return {
      success: false,
      error: 'CODE_EXPIRED',
      message: 'This verification code has expired. Please request a new one.'
    };
  }

  if (challenge.attempts >= MAX_ATTEMPTS) {
    return {
      success: false,
      error: 'CHALLENGE_LOCKED',
      message: 'Too many incorrect attempts. This code is locked. Please request a new one.'
    };
  }

  const testHash = hashOtpCode(trimmedCode, challenge.salt);
  let isMatch = false;
  try {
    const testBuf = Buffer.from(testHash, 'hex');
    const targetBuf = Buffer.from(challenge.codeHash, 'hex');
    isMatch = testBuf.length === targetBuf.length && crypto.timingSafeEqual(testBuf, targetBuf);
  } catch {
    isMatch = false;
  }

  if (!isMatch) {
    challenge.attempts += 1;
    await challenge.save();

    if (challenge.attempts >= MAX_ATTEMPTS) {
      return {
        success: false,
        error: 'CHALLENGE_LOCKED',
        message: 'Too many incorrect attempts. This code is now locked. Please request a new one.'
      };
    }

    return {
      success: false,
      error: 'INVALID_CODE',
      message: 'Invalid verification code.',
      remainingAttempts: MAX_ATTEMPTS - challenge.attempts
    };
  }

  // Code matches! Mark consumed immediately
  challenge.consumedAt = new Date();
  await challenge.save();

  // Find or create User
  let user = await User.findOne({ email: normalizedEmail });
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    let finalName = challenge.pendingName;
    if (!finalName) {
      finalName = normalizedEmail.split('@')[0];
    }
    const pendingUsername = challenge.pendingUsername;
    if (pendingUsername) {
      user = await User.create({
        email: normalizedEmail,
        name: finalName,
        username: pendingUsername
      });
    } else {
      const baseHandle = normalizedEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12);
      let created = false;
      let attempts = 0;
      while (!created && attempts < 5) {
        attempts += 1;
        const candidateUsername = `${baseHandle || 'user'}_${crypto.randomBytes(3).toString('hex')}`;
        try {
          user = await User.create({
            email: normalizedEmail,
            name: finalName,
            username: candidateUsername
          });
          created = true;
        } catch (err) {
          if (err && err.code === 11000 && (err.keyPattern?.username || String(err.message || '').includes('username'))) {
            continue;
          }
          throw err;
        }
      }

      if (!created && !user) {
        const timestampSuffix = Date.now().toString(36).slice(-6);
        user = await User.create({
          email: normalizedEmail,
          name: finalName,
          username: `${baseHandle || 'user'}_${timestampSuffix}`
        });
      }
    }
  }

  return {
    success: true,
    user,
    isNewUser
  };
}
