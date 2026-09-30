import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getAuthConfig } from './config.js';

/**
 * In-memory storage for the exactly one global admin account.
 * Plaintext password is NEVER stored.
 */
let singleAdmin = null;

/**
 * Login attempt throttle state, keyed by client IP so rotating identifiers cannot
 * evade the limit, plus one shared bucket for unknown identifiers so rotating IPs
 * cannot evade it either (every failure against a non existent identifier pools
 * into the same global counter, and that counter gates all unknown identifier
 * attempts regardless of address). The shared bucket can never lock out the real
 * admin: it only gates attempts whose presented identifier is unknown, and only
 * correct credentials can clear it.
 *
 * After MAX_FAILURES within a bucket, attempts are rejected until the backoff
 * (exponential, capped) has elapsed. A successful login resets the client's IP
 * bucket and the shared bucket. Entries are tiny and never cleaned eagerly; they
 * only grow with distinct addresses that fail logins.
 */
const MAX_FAILURES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;
const UNKNOWN_BUCKET_KEY = 'shared:unknown-identifiers';
const attemptState = new Map();

/**
 * Normalizes a client address into a stable bucket key. Handles IPv4 mapped
 * IPv6 forms and a trailing port on plain IPv4 only (IPv6 strings keep their
 * colons). Empty or unusable input collapses into one shared bucket so tests
 * and direct calls without an address still throttle coherently.
 *
 * @param {string} rawIp
 * @returns {string}
 */
export function normalizeClientIp(rawIp) {
  let value = String(rawIp || '').trim().toLowerCase();
  if (!value) return 'unknown-client';
  // IPv4 mapped IPv6: ::ffff:127.0.0.1 (or the hex form ::ffff:7f00:1)
  if (value.startsWith('::ffff:')) {
    value = value.slice('::ffff:'.length);
  }
  // Strip a port only from plain IPv4 (exactly one colon, digits after it)
  const singleColon = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
  if (singleColon) {
    value = singleColon[1];
  }
  return value || 'unknown-client';
}

function bucketWaitMs(entry) {
  if (!entry || entry.failures < MAX_FAILURES) return 0;
  const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, entry.failures - MAX_FAILURES), MAX_BACKOFF_MS);
  const elapsed = Date.now() - entry.lastFailureAt;
  return Math.max(0, backoff - elapsed);
}

/**
 * Returns the remaining wait in ms before this client IP may retry, 0 if allowed.
 */
export function getIpThrottleWaitMs(clientIp) {
  return bucketWaitMs(attemptState.get(normalizeClientIp(clientIp)));
}

/**
 * Returns the remaining wait in ms before ANY unknown identifier may retry,
 * regardless of address, 0 if allowed.
 */
export function getUnknownIdentifierThrottleWaitMs() {
  return bucketWaitMs(attemptState.get(UNKNOWN_BUCKET_KEY));
}

/**
 * Records a failed login attempt: always against the client's IP bucket, and
 * additionally against the shared unknown identifier bucket when the presented
 * identifier does not match the admin.
 */
export function recordFailedLogin({ clientIp, identifierIsKnown }) {
  const bump = (key) => {
    const entry = attemptState.get(key) || { failures: 0, lastFailureAt: 0 };
    entry.failures += 1;
    entry.lastFailureAt = Date.now();
    attemptState.set(key, entry);
  };
  bump(normalizeClientIp(clientIp));
  if (!identifierIsKnown) {
    bump(UNKNOWN_BUCKET_KEY);
  }
}

/**
 * Clears throttle state after a successful login: the client's IP bucket and
 * the shared unknown identifier bucket (only correct credentials can reach
 * this, so clearing is self healing and cannot be triggered by an attacker).
 */
export function resetAttempts(clientIp) {
  attemptState.delete(normalizeClientIp(clientIp));
  attemptState.delete(UNKNOWN_BUCKET_KEY);
}

/**
 * Clears all throttle state (for testing).
 */
export function clearAttemptThrottle() {
  attemptState.clear();
}

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

  // Hash password using bcrypt — plaintext password is never stored.
  // Sync hashing is acceptable here: seeding runs once at startup, not per request.
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
 * Async so the bcrypt cost runs off the event loop and a burst of login
 * attempts cannot freeze timers, broadcasts, or round closure for everyone.
 *
 * Does NOT reveal whether username/email or password was the cause of failure.
 *
 * Throttling is keyed by client IP with a shared pool for unknown identifiers:
 * each address owns a bucket, and failures against unknown identifiers also
 * bump a global bucket that gates every unknown identifier regardless of
 * address. The shared pool can never lock out the real admin identifier.
 *
 * @param {string} identifier - Username or Email
 * @param {string} password - Plaintext password attempt
 * @param {Object} [options]
 * @param {string} [options.clientIp] - Client address for throttle keying
 * @returns {Promise<{ valid: boolean, admin?: Object, error?: string, message?: string, throttled?: boolean, retryAfterMs?: number }>}
 */
export async function verifyAdminCredentials(identifier, password, { clientIp } = {}) {
  if (!singleAdmin) {
    // Seed lazily with default environment config if not already seeded
    seedAdmin();
  }

  if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
    recordFailedLogin({ clientIp, identifierIsKnown: false });
    return {
      valid: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid username/email or password.'
    };
  }

  const waitMs = Math.max(
    getIpThrottleWaitMs(clientIp),
    getUnknownIdentifierThrottleWaitMs()
  );
  if (waitMs > 0) {
    const normalizedForGate = identifier.trim().toLowerCase();
    const presentedIsKnown = normalizedForGate === singleAdmin.username.toLowerCase()
      || normalizedForGate === singleAdmin.email.toLowerCase();
    // The shared unknown identifier pool never gates the real admin identifier;
    // the IP bucket always gates its own address.
    const blockedByIp = getIpThrottleWaitMs(clientIp) > 0;
    if (blockedByIp || !presentedIsKnown) {
      return {
        valid: false,
        throttled: true,
        retryAfterMs: waitMs,
        error: 'TOO_MANY_ATTEMPTS',
        message: `Too many failed login attempts. Try again in ${Math.ceil(waitMs / 1000)} seconds.`
      };
    }
  }

  const normalizedIdentifier = identifier.trim().toLowerCase();
  const isUsernameMatch = singleAdmin.username.toLowerCase() === normalizedIdentifier;
  const isEmailMatch = singleAdmin.email.toLowerCase() === normalizedIdentifier;
  const identifierIsKnown = isUsernameMatch || isEmailMatch;

  if (!identifierIsKnown) {
    recordFailedLogin({ clientIp, identifierIsKnown: false });
    return {
      valid: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid username/email or password.'
    };
  }

  const isPasswordMatch = await bcrypt.compare(password, singleAdmin.passwordHash);
  if (!isPasswordMatch) {
    recordFailedLogin({ clientIp, identifierIsKnown: true });
    return {
      valid: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid username/email or password.'
    };
  }

  resetAttempts(clientIp);
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
