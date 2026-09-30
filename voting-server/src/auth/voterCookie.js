import jwt from 'jsonwebtoken';
import { parseCookies } from '../server.js';

let warnedMissingSecret = false;

export function resetVoterSecretWarning() {
  warnedMissingSecret = false;
}

export function validateVoterJwtSecret(env = process.env) {
  const secret = env.VOTER_JWT_SECRET;
  if (!secret) {
    if (env.NODE_ENV === 'production') {
      throw new Error('[Security] VOTER_JWT_SECRET environment variable is required in production');
    }
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn('[Security Warning] VOTER_JWT_SECRET is not set. Using fallback secret. Please set VOTER_JWT_SECRET in production.');
    }
    return false;
  }
  return true;
}

export function getVoterJwtSecret() {
  validateVoterJwtSecret();
  return process.env.VOTER_JWT_SECRET || 'votesphere_voter_jwt_secret_fallback';
}

export function getVoterSessionDays() {
  return parseInt(process.env.VOTER_SESSION_DAYS, 10) || 7;
}

/**
 * Generates signed JWT for a voter user.
 *
 * @param {Object} user
 * @param {string|Object} user._id
 * @param {string} user.email
 * @returns {string} JWT token string
 */
export function generateVoterToken(user) {
  const secret = getVoterJwtSecret();
  const days = getVoterSessionDays();
  const payload = {
    userId: String(user._id || user.id),
    email: user.email,
    role: 'voter'
  };

  return jwt.sign(payload, secret, {
    expiresIn: `${days}d`
  });
}

/**
 * Verifies a voter JWT token.
 *
 * @param {string} token
 * @returns {{ valid: boolean, payload?: Object, error?: string }}
 */
export function verifyVoterToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'NO_TOKEN' };
  }

  try {
    const secret = getVoterJwtSecret();
    const payload = jwt.verify(token, secret);
    if (!payload || !payload.userId || payload.role !== 'voter') {
      return { valid: false, error: 'INVALID_TOKEN' };
    }
    return { valid: true, payload };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, error: 'TOKEN_EXPIRED' };
    }
    return { valid: false, error: 'INVALID_TOKEN' };
  }
}

/**
 * Formats Set-Cookie header for vs_voter cookie.
 *
 * @param {string} token
 * @param {Object} [req]
 * @returns {string}
 */
export function buildVoterCookieHeader(token, req) {
  const maxAgeSeconds = getVoterSessionDays() * 86400;
  const isSecure = process.env.COOKIE_SECURE === 'true' ||
    (req && (req.socket?.encrypted === true ||
      String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'));

  return `vs_voter=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`;
}

/**
 * Formats Set-Cookie header to clear vs_voter cookie.
 *
 * @param {Object} [req]
 * @returns {string}
 */
export function buildClearVoterCookieHeader(req) {
  const isSecure = process.env.COOKIE_SECURE === 'true' ||
    (req && (req.socket?.encrypted === true ||
      String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'));

  return `vs_voter=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`;
}

/**
 * Extracts voter token from HTTP request cookie header.
 *
 * @param {Object} req
 * @returns {string|null}
 */
export function getVoterTokenFromRequest(req) {
  if (!req || !req.headers) return null;
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  return cookies.vs_voter || null;
}
