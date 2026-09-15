import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getAuthConfig } from './config';

/**
 * In-memory storage for the exactly one global admin account.
 * Plaintext password is NEVER stored.
 */
let singleAdmin = null;

/**
 * Seeds or updates the single global admin account.
 * Hashes password using bcrypt.
 *
 * @param {Object} [credentials]
 * @param {string} [credentials.username]
 * @param {string} [credentials.email]
 * @param {string} [credentials.password]
 * @returns {Object} Public admin profile (without passwordHash)
 */
export function seedAdmin(credentials = {}) {
  if (singleAdmin && (!credentials || Object.keys(credentials).length === 0)) {
    return getAdminProfile();
  }

  const config = getAuthConfig();
  const username = credentials.username || config.adminUsername;
  const email = credentials.email || config.adminEmail;
  const password = credentials.password || config.adminPassword;

  if (!username || typeof username !== 'string' || username.trim() === '') {
    throw new Error('Admin username is required for seeding.');
  }
  if (!email || typeof email !== 'string' || email.trim() === '') {
    throw new Error('Admin email is required for seeding.');
  }
  if (!password || typeof password !== 'string' || password.trim() === '') {
    throw new Error('Admin password is required for seeding.');
  }

  // Hash password using bcrypt — plaintext password is never stored
  const saltRounds = 10;
  const passwordHash = bcrypt.hashSync(password, saltRounds);

  singleAdmin = {
    username: username.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    seededAt: new Date().toISOString()
  };

  return getAdminProfile();
}

/**
 * Returns safe public admin profile without passwordHash.
 * @returns {Object|null}
 */
export function getAdminProfile() {
  if (!singleAdmin) {
    return null;
  }
  return {
    username: singleAdmin.username,
    email: singleAdmin.email,
    role: 'admin',
    seededAt: singleAdmin.seededAt
  };
}

/**
 * Clears the admin user from memory (for testing purposes).
 */
export function clearAdmin() {
  singleAdmin = null;
}

/**
 * Authenticates admin by comparing input against username or email,
 * then validating the password with bcrypt.
 *
 * Does NOT reveal whether username/email or password was the cause of failure.
 *
 * @param {string} identifier - Username or Email
 * @param {string} password - Plaintext password attempt
 * @returns {{ valid: boolean, admin?: Object, error?: string, message?: string }}
 */
export function verifyAdminCredentials(identifier, password) {
  if (!singleAdmin) {
    // Seed lazily with default environment config if not already seeded
    seedAdmin();
  }

  if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
    return {
      valid: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid username/email or password.'
    };
  }

  const normalizedIdentifier = identifier.trim().toLowerCase();
  const isUsernameMatch = singleAdmin.username.toLowerCase() === normalizedIdentifier;
  const isEmailMatch = singleAdmin.email.toLowerCase() === normalizedIdentifier;

  if (!isUsernameMatch && !isEmailMatch) {
    return {
      valid: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid username/email or password.'
    };
  }

  const isPasswordMatch = bcrypt.compareSync(password, singleAdmin.passwordHash);
  if (!isPasswordMatch) {
    return {
      valid: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid username/email or password.'
    };
  }

  return {
    valid: true,
    admin: getAdminProfile()
  };
}

/**
 * Generates a signed JWT for the authenticated admin.
 * Contains role and admin identity, but NEVER sensitive data like password or hash.
 *
 * @param {Object} adminUser - Admin profile
 * @param {Object} [options={}] - Optional jwt sign options (e.g. expiresIn)
 * @returns {string} Signed JWT
 */
export function generateAdminToken(adminUser, options = {}) {
  const config = getAuthConfig();
  const payload = {
    role: 'admin',
    username: adminUser.username,
    email: adminUser.email
  };

  const signOptions = {
    expiresIn: options.expiresIn || config.jwtExpiresIn || '24h',
    ...options
  };

  return jwt.sign(payload, config.jwtSecret, signOptions);
}

/**
 * Verifies and validates an admin JWT.
 * Rejects missing, expired, malformed, tampered, or non-admin tokens.
 *
 * @param {string} token
 * @returns {{ valid: boolean, admin?: Object, error?: string, message?: string }}
 */
export function verifyAdminToken(token) {
  if (!token || typeof token !== 'string' || token.trim() === '') {
    return {
      valid: false,
      error: 'UNAUTHORIZED',
      message: 'Authentication token is required.'
    };
  }

  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const config = getAuthConfig();

  try {
    const decoded = jwt.verify(cleanToken, config.jwtSecret);

    if (!decoded || decoded.role !== 'admin') {
      return {
        valid: false,
        error: 'FORBIDDEN',
        message: 'Admin authorization required.'
      };
    }

    if (!singleAdmin) {
      seedAdmin();
    }

    // Verify token identity corresponds to active seeded admin
    if (decoded.username !== singleAdmin.username) {
      return {
        valid: false,
        error: 'INVALID_TOKEN',
        message: 'Token identity does not match current admin.'
      };
    }

    return {
      valid: true,
      admin: {
        username: decoded.username,
        email: decoded.email,
        role: decoded.role
      }
    };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return {
        valid: false,
        error: 'INVALID_TOKEN',
        message: 'Authentication token has expired.'
      };
    }
    return {
      valid: false,
      error: 'INVALID_TOKEN',
      message: 'Malformed or invalid authentication token.'
    };
  }
}
