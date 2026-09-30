import http from 'http';
import { Server } from 'socket.io';
import makeStore from './store';
import { bootstrapDefaultSession, bootstrapHorrorSession } from './bootstrap';
import { seedAdmin, verifyAdminCredentials, generateAdminToken, verifyAdminToken } from './auth/admin';
import { registerVoter, validateVoterToken, canCastVote, recordVote, getVoterCount, releaseSessionVoters, tokensBySession } from './auth/voter';
import { createChallenge, verifyChallenge, isValidEmail, isValidUsername, cancelChallenge, escapeRegex } from './auth/otp.js';
import { sendOtpEmail } from './email/transport.js';
import {
  generateVoterToken,
  verifyVoterToken,
  buildVoterCookieHeader,
  buildClearVoterCookieHeader,
  getVoterTokenFromRequest,
  validateVoterJwtSecret
} from './auth/voterCookie.js';
import User from './db/models/User.js';
import SessionAllowlistEntry from './db/models/SessionAllowlistEntry.js';
import SessionJoinRequest from './db/models/SessionJoinRequest.js';
import VoteParticipation from './db/models/VoteParticipation.js';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { isConnected } from './db/connection';
import * as repository from './db/repository';
import { persistStateChanges } from './db/persistence';
import timerManager from './timer';
import roundManager from './roundManager';
import { generateJoinCode } from './utils/joinCode.js';
import { SINGLE_BALLOT_MAX } from './constants.js';
import Session from './db/models/Session.js';

/**
 * Protected action types requiring valid admin JWT authorization.
 */
export const ADMIN_ACTION_TYPES = new Set([
  'CREATE_SESSION',
  'START_SESSION',
  'ARCHIVE_SESSION',
  'SET_ENTRIES',
  'NEXT',
  'REFRESH_JOIN_CODE',
  'RESOLVE_TIE',
  'SET_ALLOWLIST',
  'APPROVE_PARTICIPANT',
  'REJECT_PARTICIPANT',
  'REMOVE_PARTICIPANT',
  'SET_WHO_CAN_JOIN'
]);

/**
 * Complete allowlist of action types a socket client may send over the 'action'
 * event. Everything else (internal types such as SET_ROUND_LIFECYCLE, plus any
 * unknown type) is rejected at ingress so untrusted clients can never dispatch
 * straight into the authoritative store.
 */
export const ALLOWED_ACTION_TYPES = new Set([
  ...ADMIN_ACTION_TYPES,
  'VOTE'
]);

/**
 * Parses the allowed CORS origins from environment configuration.
 * Comma separated list in CORS_ALLOWED_ORIGINS; defaults to the local dev client.
 * The wildcard '*' disables origin checking entirely (development only).
 */
export function getAllowedCorsOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS || process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.CLIENT_ORIGIN) {
    const co = process.env.CLIENT_ORIGIN.trim();
    if (co && !origins.includes(co)) {
      origins.push(co);
    }
  }
  return origins;
}

/**
 * Decides whether a request origin may receive credentialed CORS headers.
 */
export function isOriginAllowed(origin) {
  const allowed = getAllowedCorsOrigins();
  if (allowed.includes('*')) return true;
  if (!origin) return false;
  return allowed.includes(origin);
}

/**
 * Resolves the client address used to key the login throttle. When TRUST_PROXY
 * is set the first x-forwarded-for entry wins (the deployment sits behind a
 * trusted reverse proxy); otherwise the socket address is used directly,
 * because a client controlled x-forwarded-for header would let an attacker
 * rotate fake addresses and evade per IP throttling.
 *
 * @param {Object} headers - Request or handshake headers
 * @param {string} [remoteAddress] - Socket level peer address
 * @returns {string}
 */
export function resolveClientIp(headers, remoteAddress) {
  if (String(process.env.TRUST_PROXY || '').trim().toLowerCase() === 'true') {
    const forwarded = headers && headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const first = forwarded.split(',')[0].trim();
      if (first) return first;
    }
  }
  return remoteAddress || '';
}

/**
 * Parses HTTP cookie header string into key-value map.
 * @param {string} cookieHeader
 * @returns {Object}
 */
export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

/**
 * Extracts a client-facing summary list of all sessions from the store state.
 *
 * @param {Map} state - Immutable.js store state
 * @returns {Array<Object>} Array of session summary objects
 */
export function getSessionsSummary(state) {
  if (!state || typeof state.get !== 'function') {
    return [];
  }
  const sessions = state.get('sessions');
  if (!sessions || typeof sessions.valueSeq !== 'function') {
    return [];
  }
  return sessions.valueSeq().map((session) => {
    const sessionId = session.get('id');
    const rawEntries = session.get('entries');
    const activePair = session.getIn(['vote', 'pair']);
    const pairCount = (activePair && typeof activePair.size === 'number') ? activePair.size : 0;
    const queueCount = (rawEntries && typeof rawEntries.size === 'number')
      ? rawEntries.size
      : (Array.isArray(rawEntries) ? rawEntries.length : 0);
    const entryCount = pairCount + queueCount;

    const storedDuration = session.get('timerDuration');
    const timerDuration = (Number.isInteger(storedDuration) && storedDuration >= 5 && storedDuration <= 300)
      ? storedDuration
      : 30;

    const rawCandidateInfo = session.get('candidateInfo');
    const candidateInfo = rawCandidateInfo && typeof rawCandidateInfo.toJS === 'function'
      ? rawCandidateInfo.toJS()
      : (Array.isArray(rawCandidateInfo) ? rawCandidateInfo : []);

    const storedMode = session.get('votingMode');
    const votingMode = storedMode || (entryCount <= SINGLE_BALLOT_MAX ? 'single_ballot' : 'tournament');

    const presence = session.get('presence');
    let connectedCount = 0;
    if (presence && typeof presence.filter === 'function') {
      connectedCount = presence.filter(v => v.get('connected') === true).size;
    }

    const summary = {
      id: sessionId,
      sessionId: sessionId,
      title: session.get('title'),
      status: session.get('status'),
      entryCount: entryCount,
      voterCount: getVoterCount(sessionId),
      connectedCount: connectedCount,
      timerDuration: timerDuration,
      type: session.get('type') || 'public',
      votingMode: votingMode,
      joinCode: session.get('joinCode') || null,
      whoCanJoin: session.get('whoCanJoin') || 'public',
      candidateInfo: candidateInfo,
      publishResultsPublicly: session.get('publishResultsPublicly') !== undefined
        ? session.get('publishResultsPublicly')
        : true,
      pendingExpiresAt: session.get('pendingExpiresAt') || null
    };
    if (session.get('createdAt')) {
      summary.createdAt = session.get('createdAt');
    }
    if (session.get('winner')) {
      summary.winner = session.get('winner');
    }
    return summary;
  }).toJS();
}

/**
 * Shared AC-3 & AC-9 tally hiding guard, used by every surface that ships
 * session state or round history to a client (socket serialization, the
 * rounds REST endpoint). Keeping it in one place prevents the socket and
 * REST paths from drifting apart again.
 *
 * Rules:
 * - `rounds` is stripped unless the round is closed/revealed or the session is completed.
 * - `finalVote` (which carries the frozen tally) is stripped unless the round
 *   results are actively being revealed, or the session is completed. The
 *   reveal window still needs the tallies for the results view, so the guard
 *   only blocks the pre reveal states (VOTING, ROUND_CLOSED) and terminal
 *   lifecycle states where no reveal is running.
 *
 * @param {Object} sessionObj - Plain object form of the session (mutated in place)
 * @param {Object} [roundContext] - Optional round lifecycle context for REST reads
 * @param {string} [roundContext.roundLifecycle] - Lifecycle override; falls back to the session's own field
 * @returns {Object} The same object, guarded
 */
export function applyTallyVisibilityGuard(sessionObj, roundContext = {}) {
  if (!sessionObj || typeof sessionObj !== 'object') return sessionObj;
  const status = sessionObj.status;
  const roundLifecycle = roundContext.roundLifecycle || sessionObj.roundLifecycle;

  const sessionConcluded = status === 'completed';
  const revealActive = roundLifecycle === 'RESULTS_REVEALED';
  const tallyVisible = sessionConcluded || revealActive;

  if (!tallyVisible) {
    delete sessionObj.rounds;
    delete sessionObj.finalVote;
    // The live tally is also hidden while a round is active (AGENTS.md: tallies
    // stay hidden during an active round). Voters see their own vote confirmed
    // in the UI and the frozen tally appears at RESULTS_REVEALED or completion.
    if (sessionObj.vote && typeof sessionObj.vote === 'object') {
      sessionObj.vote = { ...sessionObj.vote, tally: {} };
    }
  }
  return sessionObj;
}

/**
 * Serializes a session state for client emission using an explicit allowlist.
 * Satisfies AC-8 and AC-10 by including connectedCount and totalVoters,
 * while removing presence records, snapshots, voter tokens, and secrets.
 *
 * @param {Map|Object} session - Immutable session map or object
 * @returns {Object} Plain JavaScript object safe for client consumption
 */
export function serializeSessionState(session) {
  if (!session) return null;
  const isMap = typeof session.get === 'function';
  const raw = typeof session.toJS === 'function' ? session.toJS() : { ...session };

  const sessionId = isMap ? session.get('id') : raw.id;
  const presence = isMap ? session.get('presence') : raw.presence;

  let connectedCount = 0;
  if (presence) {
    if (typeof presence.forEach === 'function') {
      presence.forEach((v) => {
        if (v && (typeof v.get === 'function' ? v.get('connected') === true : v.connected === true)) {
          connectedCount += 1;
        }
      });
    } else if (typeof presence === 'object') {
      for (const v of Object.values(presence)) {
        if (v && v.connected === true) {
          connectedCount += 1;
        }
      }
    }
  }

  const totalVoters = sessionId ? getVoterCount(sessionId) : (raw.voterCount || 0);

  const allowed = {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    entries: raw.entries,
    vote: raw.vote,
    winner: raw.winner,
    timerDuration: raw.timerDuration,
    type: raw.type,
    votingMode: raw.votingMode,
    joinCode: raw.joinCode,
    whoCanJoin: raw.whoCanJoin,
    candidateInfo: raw.candidateInfo,
    publishResultsPublicly: raw.publishResultsPublicly,
    pendingExpiresAt: raw.pendingExpiresAt,
    rounds: raw.rounds,
    roundLifecycle: raw.roundLifecycle,
    roundId: raw.roundId,
    roundIndex: raw.roundIndex,
    finalVote: raw.finalVote,
    revealTimer: raw.revealTimer,
    tiePending: raw.tiePending,
    tieCount: raw.tieCount,
    zeroVoteCount: raw.zeroVoteCount,
    createdAt: raw.createdAt,
    voterCount: totalVoters,
    totalVoters,
    connectedCount
  };

  for (const k of Object.keys(allowed)) {
    if (allowed[k] === undefined) {
      delete allowed[k];
    }
  }

  delete allowed.presence;
  delete allowed.snapshots;
  delete allowed.voterToken;
  delete allowed.token;
  delete allowed.jwt;
  delete allowed.password;
  delete allowed.secret;

  return applyTallyVisibilityGuard(allowed);
}

/**
 * Generates a unique 6-character join code, retrying up to 10 times on DB collision.
 * Only checks collisions against pending and open sessions.
 * Throws COLLISION_EXHAUSTION when 10 candidate codes all collide.
 *
 * @param {number} [maxAttempts=10]
 * @returns {Promise<string>} 6-character unique join code
 */
export async function getUniqueJoinCode(maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidateCode = generateJoinCode();
    if (!isConnected()) {
      return candidateCode;
    }
    try {
      const existing = await Session.findOne({
        joinCode: candidateCode,
        status: { $in: ['pending', 'open'] }
      }).lean();
      if (!existing) {
        return candidateCode;
      }
    } catch (err) {
      return candidateCode;
    }
  }
  throw new Error('COLLISION_EXHAUSTION');
}

export const JOIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const JOIN_RATE_LIMIT_MAX = 30;
export const joinRateLimitMap = new Map();

/**
 * In memory reverse index resolving socket ID to session and voter token.
 * Maps: socketId -> { sessionId, voterToken }
 * Used for O(1) disconnect resolution per Spec 0005 AC-2.
 */
export const socketToVoter = new Map();

/**
 * Checks in-memory fixed-window rate limit for join code resolver.
 * Enforces 30 requests per minute per IP address.
 *
 * @param {string} clientIp
 * @returns {boolean}
 */
export function checkJoinRateLimit(clientIp) {
  const ipKey = clientIp || 'unknown';
  const now = Date.now();
  const entry = joinRateLimitMap.get(ipKey);

  if (!entry || (now - entry.windowStart) >= JOIN_RATE_LIMIT_WINDOW_MS) {
    joinRateLimitMap.set(ipKey, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= JOIN_RATE_LIMIT_MAX) {
    return false;
  }

  entry.count += 1;
  return true;
}

/**
 * Resets join code rate limiter tracking map.
 */
export function resetJoinRateLimit() {
  joinRateLimitMap.clear();
}

/**
 * Checks whether a connected socket holds a valid admin identity.
 *
 * @param {Object} socket - Socket.io socket instance
 * @returns {boolean}
 */
export function isSocketAdmin(socket) {
  if (!socket) return false;
  if (socket.data?.isAdmin) return true;
  const token = socket.data?.adminToken ||
    socket.handshake?.auth?.token ||
    (socket.handshake?.headers?.authorization && socket.handshake.headers.authorization.startsWith('Bearer ')
      ? socket.handshake.headers.authorization.slice(7)
      : socket.handshake?.headers?.authorization);
  if (token) {
    const v = verifyAdminToken(token);
    if (v.valid) {
      socket.data = socket.data || {};
      socket.data.isAdmin = true;
      socket.data.adminToken = token;
      return true;
    }
  }
  return false;
}

/**
 * Returns filtered sessions summary for a specific socket connection.
 * Voter sockets omit sessions where type === 'secured'.
 * Admin sockets receive the full unfiltered registry.
 *
 * @param {Object} socket - Socket.io socket instance
 * @param {Map} state - Redux store state
 * @returns {Array<Object>}
 */
export function getSocketSessionsSummary(socket, state) {
  const summary = getSessionsSummary(state);
  if (isSocketAdmin(socket)) {
    return summary;
  }
  return summary.filter((s) => s.type !== 'secured');
}

/**
 * Broadcasts sessions summary to all connected sockets.
 * Voter sockets omit secured sessions; admin sockets receive the full registry.
 *
 * @param {Object} ioInstance - Socket.io server instance
 * @param {Array<Object>|Map} summaryOrState - Precomputed summary or store state
 */
export function broadcastSessions(ioInstance, summaryOrState) {
  if (!ioInstance) return;
  const fullSummary = Array.isArray(summaryOrState) ? summaryOrState : getSessionsSummary(summaryOrState);
  const publicSummary = fullSummary.filter((s) => s.type !== 'secured');

  const sockets = ioInstance.sockets?.sockets;
  if (sockets && typeof sockets.values === 'function') {
    for (const socket of sockets.values()) {
      if (isSocketAdmin(socket)) {
        socket.emit('sessions', fullSummary);
      } else {
        socket.emit('sessions', publicSummary);
      }
    }
  } else {
    ioInstance.emit('sessions', publicSummary);
  }
}

/**
 * Tracks voter tokens pending deferred removal at the conclusion of an active round.
 * Map<sessionId, Set<voterToken>>
 */
export const pendingRemovalsBySession = new Map();

/**
 * Emits real-time participant roster and headcount metrics to authorized admin sockets.
 *
 * @param {string} sessionId
 * @param {Object} target - Socket instance or io room (e.g. io.to('participants:sess_id'))
 */
export async function emitSessionParticipants(sessionId, target) {
  if (!sessionId || !target) return;
  try {
    const cleanSessionId = sessionId.trim();
    let whoCanJoin = 'allowlist';
    if (isConnected()) {
      const sessionDoc = await Session.findOne({ sessionId: cleanSessionId }).lean();
      if (sessionDoc && sessionDoc.whoCanJoin) {
        whoCanJoin = sessionDoc.whoCanJoin;
      }
    }

    let entries = [];
    let counts = {};

    if (whoCanJoin === 'allowlist') {
      const allowlistDocs = isConnected()
        ? await SessionAllowlistEntry.find({ sessionId: cleanSessionId }).lean()
        : [];
      const joinedTokens = tokensBySession.get(cleanSessionId) || new Set();
      const joinedUserIds = [];
      for (const tok of joinedTokens) {
        if (typeof tok === 'string' && tok.startsWith('user:')) {
          joinedUserIds.push(tok.slice(5));
        }
      }
      let joinedEmails = new Set();
      if (joinedUserIds.length > 0 && isConnected()) {
        const users = await User.find({ _id: { $in: joinedUserIds } }).lean();
        joinedEmails = new Set(users.map((u) => u.email.toLowerCase()));
      }

      entries = allowlistDocs.map((doc) => {
        const isJoined = joinedEmails.has(doc.email.toLowerCase());
        return {
          email: doc.email,
          status: isJoined ? 'joined' : 'allowlisted',
          addedAt: doc.addedAt
        };
      });

      counts = {
        allowlistedCount: allowlistDocs.length,
        joinedCount: entries.filter((e) => e.status === 'joined').length
      };
    } else if (whoCanJoin === 'approval') {
      const requests = isConnected()
        ? await SessionJoinRequest.find({ sessionId: cleanSessionId }).sort({ requestedAt: 1 }).lean()
        : [];
      entries = requests.map((req) => ({
        id: String(req._id),
        userId: String(req.userId),
        email: req.email,
        displayName: req.displayName || '',
        status: req.status,
        requestedAt: req.requestedAt,
        decidedAt: req.decidedAt
      }));

      counts = {
        approvedCount: entries.filter((e) => e.status === 'approved').length,
        pendingCount: entries.filter((e) => e.status === 'pending').length,
        rejectedCount: entries.filter((e) => e.status === 'rejected').length
      };
    }

    target.emit('session_participants', {
      sessionId: cleanSessionId,
      mode: whoCanJoin,
      entries,
      counts
    });
  } catch (err) {
    console.error('[SessionParticipants] Error emitting participants:', err.message);
  }
}

/**
 * Reads JSON payload from an incoming HTTP request stream.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Sends a JSON HTTP response.
 */
function sendJson(res, statusCode, data, headers = {}) {
  if (!res || res.headersSent) return;
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
}

/**
 * Sets CORS response headers. The origin is only reflected when it appears in
 * the configured allowlist (CORS_ALLOWED_ORIGINS), and credentials are only
 * sent for allowed origins, so arbitrary sites cannot read credentialed responses.
 */
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

/**
 * Starts the authoritative voting server with Socket.io and HTTP API endpoints.
 *
 * @param {Object|number} [store] (Redux store instance or port number if store omitted)
 * @param {number} [port=8090] (Port number to listen on, 0 for ephemeral)
 * @returns {Server} Socket.io server instance
 */
export default function startServer(store, port = 8090) {
  let actualStore = store;
  let actualPort = port;

  if (typeof store === 'number') {
    actualPort = store;
    actualStore = null;
  }

  if (!actualStore) {
    actualStore = makeStore();
    bootstrapDefaultSession(actualStore);
    bootstrapHorrorSession(actualStore);
  }

  // Ensure single admin is seeded from environment
  seedAdmin();

  // Validate voter JWT secret configuration
  validateVoterJwtSecret();

  // Guard against unhandled promise rejections crashing the process
  if (!process._votesphereRejectionGuarded) {
    process._votesphereRejectionGuarded = true;
    process.on('unhandledRejection', (reason) => {
      console.error('[Server] Unhandled promise rejection:', reason);
    });
  }

  let io;

  // Create native HTTP server for REST endpoints
  const httpServer = http.createServer(async (req, res) => {
    try {
      setCorsHeaders(req, res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      // 1. POST /api/admin/login
      if (pathname === '/api/admin/login' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const identifier = body.username || body.email;
        const password = body.password;

        const authResult = await verifyAdminCredentials(identifier, password, {
          clientIp: resolveClientIp(req.headers, req.socket && req.socket.remoteAddress)
        });
        if (!authResult.valid) {
          const throttled = Boolean(authResult.throttled);
          sendJson(res, throttled ? 429 : 401, {
            success: false,
            error: authResult.error || 'INVALID_CREDENTIALS',
            message: authResult.message || 'Invalid credentials',
            ...(throttled ? { retryAfterMs: authResult.retryAfterMs } : {})
          });
          return;
        }

        const token = generateAdminToken(authResult.admin);
        sendJson(res, 200, {
          success: true,
          token,
          user: authResult.admin
        });
        return;
      }

      // 2. GET /api/auth/me
      if (pathname === '/api/auth/me' && req.method === 'GET') {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        const verifyResult = verifyAdminToken(token);
        if (!verifyResult.valid) {
          sendJson(res, 401, {
            success: false,
            error: verifyResult.error,
            message: verifyResult.message
          });
          return;
        }
        sendJson(res, 200, {
          success: true,
          admin: verifyResult.admin
        });
        return;
      }

      // 2a. POST /api/auth/otp/request (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-14)
      if (pathname === '/api/auth/otp/request' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const email = body.email;
          const name = body.name;
          const username = body.username;

          if (!isValidEmail(email)) {
            sendJson(res, 400, {
              success: false,
              error: 'INVALID_EMAIL',
              message: 'A valid email address is required.'
            });
            return;
          }

          const challengeResult = await createChallenge({ email, name, username });
          if (!challengeResult.success) {
            if (challengeResult.error === 'COOLDOWN_ACTIVE') {
              sendJson(res, 429, {
                success: false,
                error: challengeResult.error,
                message: challengeResult.message,
                retryAfterSeconds: challengeResult.retryAfterSeconds
              });
              return;
            }
            if (challengeResult.error === 'USERNAME_TAKEN' || challengeResult.error === 'INVALID_USERNAME') {
              sendJson(res, 400, {
                success: false,
                error: challengeResult.error,
                message: challengeResult.message
              });
              return;
            }
            sendJson(res, 400, {
              success: false,
              error: challengeResult.error || 'BAD_REQUEST',
              message: challengeResult.message || 'Unable to request code.'
            });
            return;
          }

          // Send OTP email (or dev console fallback)
          const emailResult = await sendOtpEmail(email.trim().toLowerCase(), challengeResult.code);
          if (!emailResult || !emailResult.success) {
            if (challengeResult.challengeId) {
              await cancelChallenge(challengeResult.challengeId);
            }
            sendJson(res, 502, {
              success: false,
              error: 'EMAIL_DELIVERY_FAILED',
              message: 'Failed to deliver verification code email. Please try again later.'
            });
            return;
          }

          // AC-5: Response is always generic and never reveals whether email is registered
          // AC-6: OTP never appears in response body
          sendJson(res, 200, {
            success: true,
            message: 'If an account exists or can be created, a code was sent.'
          });
        } catch (err) {
          console.error('[Auth API] OTP request error:', err.message || err);
          sendJson(res, 500, {
            success: false,
            error: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred while processing your request.'
          });
        }
        return;
      }

      // 2b. POST /api/auth/otp/verify (AC-1, AC-2, AC-3, AC-7)
      if (pathname === '/api/auth/otp/verify' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const email = body.email;
          const code = body.code;

          if (!isValidEmail(email)) {
            sendJson(res, 400, {
              success: false,
              error: 'INVALID_EMAIL',
              message: 'A valid email address is required.'
            });
            return;
          }

          if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
            sendJson(res, 400, {
              success: false,
              error: 'INVALID_CODE_FORMAT',
              message: 'A 6-digit verification code is required.'
            });
            return;
          }

          const verifyResult = await verifyChallenge({ email, code });
          if (!verifyResult.success) {
            if (verifyResult.error === 'CHALLENGE_LOCKED') {
              sendJson(res, 423, {
                success: false,
                error: verifyResult.error,
                message: verifyResult.message
              });
              return;
            }
            sendJson(res, 401, {
              success: false,
              error: verifyResult.error,
              message: verifyResult.message,
              ...(verifyResult.remainingAttempts !== undefined ? { remainingAttempts: verifyResult.remainingAttempts } : {})
            });
            return;
          }

          const user = verifyResult.user;
          const token = generateVoterToken(user);
          const cookieHeader = buildVoterCookieHeader(token, req);

          sendJson(res, 200, {
            success: true,
            user: {
              id: user._id,
              email: user.email,
              name: user.name,
              username: user.username,
              createdAt: user.createdAt
            },
            isNewUser: Boolean(verifyResult.isNewUser)
          }, {
            'Set-Cookie': cookieHeader
          });
        } catch (err) {
          console.error('[Auth API] OTP verify error:', err.message || err);
          sendJson(res, 500, {
            success: false,
            error: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred while verifying your code.'
          });
        }
        return;
      }

      // 2c. GET /api/auth/voter/me (AC-8)
      if (pathname === '/api/auth/voter/me' && req.method === 'GET') {
        try {
          const token = getVoterTokenFromRequest(req);
          const auth = verifyVoterToken(token);
          if (!auth.valid) {
            sendJson(res, 401, {
              success: false,
              error: auth.error || 'UNAUTHORIZED',
              message: 'Authentication required'
            });
            return;
          }

          const user = await User.findById(auth.payload.userId);
          if (!user) {
            sendJson(res, 401, {
              success: false,
              error: 'USER_NOT_FOUND',
              message: 'Voter account not found'
            });
            return;
          }

          sendJson(res, 200, {
            success: true,
            user: {
              id: user._id,
              email: user.email,
              name: user.name,
              username: user.username,
              createdAt: user.createdAt
            }
          });
        } catch (err) {
          console.error('[Auth API] Voter me error:', err.message || err);
          sendJson(res, 500, {
            success: false,
            error: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred while retrieving voter profile.'
          });
        }
        return;
      }

      // 2d. POST /api/auth/profile (AC-9)
      if (pathname === '/api/auth/profile' && req.method === 'POST') {
        try {
          const token = getVoterTokenFromRequest(req);
          const auth = verifyVoterToken(token);
          if (!auth.valid) {
            sendJson(res, 401, {
              success: false,
              error: auth.error || 'UNAUTHORIZED',
              message: 'Authentication required'
            });
            return;
          }

          const body = await readJsonBody(req);
          const name = body.name;
          const username = body.username;

          const user = await User.findById(auth.payload.userId);
          if (!user) {
            sendJson(res, 401, {
              success: false,
              error: 'USER_NOT_FOUND',
              message: 'Voter account not found'
            });
            return;
          }

          if (username !== undefined && username !== null && String(username).trim() !== '') {
            const trimmedUsername = String(username).trim();
            if (!isValidUsername(trimmedUsername)) {
              sendJson(res, 400, {
                success: false,
                error: 'INVALID_USERNAME',
                message: 'Username must be 3 to 20 alphanumeric characters or underscores.'
              });
              return;
            }
            const escaped = escapeRegex(trimmedUsername);
            const existing = await User.findOne({
              username: new RegExp(`^${escaped}$`, 'i'),
              _id: { $ne: user._id }
            });
            if (existing) {
              sendJson(res, 409, {
                success: false,
                error: 'USERNAME_TAKEN',
                message: 'This username is already taken.'
              });
              return;
            }
            user.username = trimmedUsername;
          }

          if (name !== undefined && name !== null && String(name).trim() !== '') {
            const trimmedName = String(name).trim();
            if (trimmedName.length > 80) {
              sendJson(res, 400, {
                success: false,
                error: 'INVALID_DISPLAY_NAME',
                message: 'Display name must be between 1 and 80 characters.'
              });
              return;
            }
            user.name = trimmedName;
          }

          await user.save();

          sendJson(res, 200, {
            success: true,
            user: {
              id: user._id,
              email: user.email,
              name: user.name,
              username: user.username,
              createdAt: user.createdAt
            }
          });
        } catch (err) {
          console.error('[Auth API] Profile update error:', err.message || err);
          sendJson(res, 500, {
            success: false,
            error: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred while updating profile.'
          });
        }
        return;
      }

      // 2e. POST /api/auth/logout (AC-10)
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        try {
          const token = getVoterTokenFromRequest(req);
          const auth = verifyVoterToken(token);
          if (!auth.valid) {
            sendJson(res, 401, {
              success: false,
              error: auth.error || 'UNAUTHORIZED',
              message: 'Authentication required'
            });
            return;
          }

          const clearCookie = buildClearVoterCookieHeader(req);
          sendJson(res, 200, {
            success: true,
            message: 'Logged out successfully'
          }, {
            'Set-Cookie': clearCookie
          });
        } catch (err) {
          console.error('[Auth API] Logout error:', err.message || err);
          sendJson(res, 500, {
            success: false,
            error: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred during logout.'
          });
        }
        return;
      }

      // 3. POST /api/sessions/:sessionId/join (AC-12)
      const joinMatch = pathname.match(/^\/api\/sessions\/([^/?]+)\/join$/);
      if (joinMatch && req.method === 'POST') {
        const sessionId = decodeURIComponent(joinMatch[1]);
        const body = await readJsonBody(req);
        let displayName = body.displayName;

        // Check session type and whoCanJoin mode
        const state = actualStore.getState();
        const currentSession = state?.getIn ? state.getIn(['sessions', sessionId]) : null;
        let sessionDoc = null;
        if (isConnected()) {
          try {
            sessionDoc = await Session.findOne({ sessionId }).lean();
          } catch {
            // DB lookup best effort
          }
        }
        const isSecured = (currentSession && currentSession.get('type') === 'secured') || (sessionDoc && sessionDoc.type === 'secured');
        const whoCanJoin = (currentSession && currentSession.get('whoCanJoin')) || (sessionDoc && sessionDoc.whoCanJoin) || 'public';

        // AC-12: Check if voter has signed in vs_voter cookie
        const vsVoterToken = getVoterTokenFromRequest(req);
        let signedInUser = null;
        if (vsVoterToken) {
          const voterAuth = verifyVoterToken(vsVoterToken);
          if (voterAuth.valid && voterAuth.payload?.userId) {
            try {
              signedInUser = await User.findById(voterAuth.payload.userId);
            } catch (err) {
              console.error('[Server] User lookup error during join:', err.message);
            }
          }
        }

        // AC-4 & AC-5: Secured session eligibility gating
        if (isSecured) {
          if (!vsVoterToken) {
            sendJson(res, 401, {
              success: false,
              error: 'AUTHENTICATION_REQUIRED',
              message: 'Sign in to join this secured session.'
            });
            return;
          }

          const voterAuth = verifyVoterToken(vsVoterToken);
          if (!voterAuth.valid || !voterAuth.payload?.userId) {
            sendJson(res, 401, {
              success: false,
              error: 'AUTHENTICATION_REQUIRED',
              message: 'Sign in to join this secured session.'
            });
            return;
          }

          if (!signedInUser && isConnected()) {
            try {
              signedInUser = await User.findById(voterAuth.payload.userId);
            } catch (err) {
              console.error('[Server] User lookup error during secured join:', err.message);
            }
          }

          if (!signedInUser) {
            sendJson(res, 401, {
              success: false,
              error: 'USER_NOT_FOUND',
              message: 'Voter account not found'
            });
            return;
          }

          const userEmail = signedInUser.email.toLowerCase().trim();

          if (whoCanJoin === 'allowlist') {
            const allowEntry = isConnected()
              ? await SessionAllowlistEntry.findOne({ sessionId, email: userEmail })
              : null;
            if (!allowEntry) {
              sendJson(res, 403, {
                success: false,
                error: 'NOT_ON_ALLOWLIST',
                message: 'You are not on the allowlist for this session.'
              });
              return;
            }
          } else if (whoCanJoin === 'approval') {
            const existingRequest = isConnected()
              ? await SessionJoinRequest.findOne({ sessionId, userId: signedInUser._id })
              : null;

            if (!existingRequest) {
              let newDoc = null;
              if (isConnected()) {
                newDoc = await SessionJoinRequest.create({
                  sessionId,
                  userId: signedInUser._id,
                  email: userEmail,
                  displayName: displayName || signedInUser.name,
                  status: 'pending'
                });
                if (io) {
                  await emitSessionParticipants(sessionId, io.to(`participants:${sessionId}`));
                }
              }
              sendJson(res, 202, {
                success: true,
                status: 'pending_approval',
                requestId: newDoc ? String(newDoc._id) : undefined,
                message: 'Join request awaiting admin approval'
              });
              return;
            }

            if (existingRequest.status === 'pending') {
              sendJson(res, 202, {
                success: true,
                status: 'pending_approval',
                requestId: String(existingRequest._id),
                message: 'Join request awaiting admin approval'
              });
              return;
            }

            if (existingRequest.status === 'rejected') {
              sendJson(res, 403, {
                success: false,
                error: 'REQUEST_REJECTED',
                message: 'Your join request was rejected.'
              });
              return;
            }
            // If approved, proceed to registerVoter below
          }
        }

        let displayNameSource = 'anonymous';
        if (signedInUser) {
          if (!displayName || !displayName.trim()) {
            displayName = signedInUser.name;
            displayNameSource = 'profile';
          } else {
            displayNameSource = 'custom';
          }
        }

        const result = registerVoter({
          sessionId,
          displayName,
          store: actualStore,
          userId: signedInUser ? String(signedInUser._id) : undefined
        });

        if (!result.success) {
          const statusCode = result.error === 'SESSION_NOT_FOUND' ? 404 : 400;
          sendJson(res, statusCode, {
            success: false,
            error: result.error,
            message: result.message
          });
          return;
        }

        const voterCount = getVoterCount(result.voter.sessionId);

        // Broadcast real-time lobby_update to session room
        if (io) {
          io.to(`session:${result.voter.sessionId}`).emit('lobby_update', {
            sessionId: result.voter.sessionId,
            voterCount
          });
          broadcastSessions(io, actualStore.getState());
          if (isSecured) {
            await emitSessionParticipants(result.voter.sessionId, io.to(`participants:${result.voter.sessionId}`));
          }
        }

        const responsePayload = {
          success: true,
          sessionId: result.voter.sessionId,
          displayName: result.voter.displayName,
          displayNameSource,
          voterToken: result.voter.sessionToken,
          voterCount,
          isRegisteredUser: Boolean(signedInUser)
        };

        // AC-12: No per session cookie set for signed in voters. Anonymous voters continue with per session cookie.
        if (signedInUser) {
          sendJson(res, 200, responsePayload);
        } else {
          const isHttpsReq = req.socket?.encrypted === true ||
            String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
          const cookieValue = `voter_token_${result.voter.sessionId}=${encodeURIComponent(result.voter.sessionToken)}; Path=/; SameSite=Lax; HttpOnly${isHttpsReq ? '; Secure' : ''}`;
          sendJson(res, 200, responsePayload, {
            'Set-Cookie': cookieValue
          });
        }
        return;
      }

      // 3b. GET /api/join/:code (Join Code Resolver with rate limiting)
      const joinCodeMatch = pathname.match(/^\/api\/join\/([^/?]+)$/);
      if (joinCodeMatch && req.method === 'GET') {
        const clientIp = resolveClientIp(req.headers, req.socket && req.socket.remoteAddress);
        if (!checkJoinRateLimit(clientIp)) {
          sendJson(res, 429, { error: 'Too many requests, please wait.' });
          return;
        }

        const rawCode = decodeURIComponent(joinCodeMatch[1] || '');
        const normalizedCode = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');

        if (normalizedCode.length !== 6) {
          sendJson(res, 404, { error: 'Code not found or no longer active.' });
          return;
        }

        if (!isConnected()) {
          sendJson(res, 503, { error: 'Service temporarily unavailable.' });
          return;
        }

        try {
          const sessionDoc = await Session.findOne({
            joinCode: normalizedCode
          }).lean();

          if (!sessionDoc) {
            sendJson(res, 404, { error: 'Code not found or no longer active.' });
            return;
          }

          if (sessionDoc.status !== 'pending' && sessionDoc.status !== 'open') {
            sendJson(res, 404, { error: 'Code not found or no longer active.' });
            return;
          }

          if (sessionDoc.pendingExpiresAt && new Date(sessionDoc.pendingExpiresAt).getTime() <= Date.now()) {
            sendJson(res, 404, { error: 'Code not found or no longer active.' });
            return;
          }

          sendJson(res, 200, {
            sessionId: sessionDoc.sessionId,
            name: sessionDoc.title || '',
            status: sessionDoc.status,
            sessionType: sessionDoc.type || 'public',
            votingMode: sessionDoc.votingMode || 'tournament'
          });
          return;
        } catch (err) {
          sendJson(res, 503, { error: 'Service temporarily unavailable.' });
          return;
        }
      }

      // 4. GET /api/sessions (Session Discovery)
      if (pathname === '/api/sessions' && req.method === 'GET') {
        const summaries = getSessionsSummary(actualStore.getState());
        sendJson(res, 200, {
          success: true,
          sessions: summaries,
          count: summaries.length
        });
        return;
      }

      // 5. GET /api/sessions/:sessionId/lobby (Waiting Room & Lobby Metadata)
      const lobbyMatch = pathname.match(/^\/api\/sessions\/([^/?]+)\/lobby$/);
      if (lobbyMatch && req.method === 'GET') {
        const sessionId = decodeURIComponent(lobbyMatch[1]);
        const state = actualStore.getState();
        const sessions = state && typeof state.get === 'function' ? state.get('sessions') : null;
        const session = sessions ? sessions.get(sessionId) : null;

        if (session) {
          const status = session.get('status');
          const title = session.get('title') || '';
          const rawEntries = session.get('entries');
          const activePair = session.getIn(['vote', 'pair']);
          const pairCount = (activePair && typeof activePair.size === 'number') ? activePair.size : 0;
          const queueCount = (rawEntries && typeof rawEntries.size === 'number')
            ? rawEntries.size
            : (Array.isArray(rawEntries) ? rawEntries.length : 0);
          const entryCount = pairCount + queueCount;
          const voterCount = getVoterCount(sessionId);
          const winner = session.get('winner') || null;

          const sessionType = session.get('type') || session.get('sessionType') || 'open';
          const whoCanJoin = session.get('whoCanJoin') || (sessionType === 'secured' ? 'allowlist' : 'public');

          const lobbyData = {
            sessionId,
            title,
            status,
            type: sessionType,
            sessionType,
            whoCanJoin,
            entryCount,
            voterCount,
            winner,
            votingStarted: status === 'open' || status === 'completed',
            isArchived: status === 'archived'
          };

          sendJson(res, 200, {
            success: true,
            ...lobbyData,
            session: lobbyData
          });
          return;
        }

        // If not in memory, check MongoDB (for archived sessions not loaded into Redux)
        if (isConnected()) {
          try {
            const dbSession = await repository.getSessionBySessionId(sessionId);
            if (dbSession) {
              const sessionType = dbSession.type || dbSession.sessionType || 'open';
              const whoCanJoin = dbSession.whoCanJoin || (sessionType === 'secured' ? 'allowlist' : 'public');
              const lobbyData = {
                sessionId: dbSession.sessionId,
                title: dbSession.title || '',
                status: dbSession.status,
                type: sessionType,
                sessionType,
                whoCanJoin,
                entryCount: Array.isArray(dbSession.entries) ? dbSession.entries.length : 0,
                voterCount: getVoterCount(sessionId),
                winner: dbSession.winner || null,
                votingStarted: dbSession.status === 'open' || dbSession.status === 'completed',
                isArchived: dbSession.status === 'archived'
              };
              sendJson(res, 200, {
                success: true,
                ...lobbyData,
                session: lobbyData
              });
              return;
            }
          } catch (dbErr) {
            console.error('[Server] Lobby DB lookup error:', dbErr.message);
          }
        }

        sendJson(res, 404, {
          success: false,
          error: 'SESSION_NOT_FOUND',
          message: `Session "${sessionId}" was not found.`
        });
        return;
      }

      // 4. GET /api/sessions/history
      if (pathname === '/api/sessions/history' && req.method === 'GET') {
        if (!isConnected()) {
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Database connection is unavailable'
          });
          return;
        }

        try {
          const limit = url.searchParams.get('limit') || 50;
          const results = await repository.getCompletedResults(limit);
          const formattedResults = results.map(r => ({
            sessionId: r.sessionId,
            title: r.title || '',
            winner: r.winner,
            entries: r.entries,
            completedAt: r.completedAt
          }));

          sendJson(res, 200, {
            success: true,
            results: formattedResults,
            count: formattedResults.length
          });
        } catch (dbErr) {
          console.error('[Server] History query error:', dbErr.message);
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Failed to retrieve results history'
          });
        }
        return;
      }

      // 5. GET /api/sessions/:sessionId/result (or /api/sessions/:sessionId/history)
      const sessionResultMatch = pathname.match(/^\/api\/sessions\/([^/?]+)\/(result|history)$/);
      if (sessionResultMatch && req.method === 'GET') {
        const sessionId = decodeURIComponent(sessionResultMatch[1]);
        if (!isConnected()) {
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Database connection is unavailable'
          });
          return;
        }

        try {
          const resultDoc = await repository.getResultBySessionId(sessionId);
          if (!resultDoc) {
            sendJson(res, 404, {
              success: false,
              error: 'RESULT_NOT_FOUND',
              message: `No completed result found for session "${sessionId}"`
            });
            return;
          }

          const resultPayload = {
            sessionId: resultDoc.sessionId,
            title: resultDoc.title || '',
            winner: resultDoc.winner,
            entries: resultDoc.entries,
            completedAt: resultDoc.completedAt
          };
          if (resultDoc.rounds && resultDoc.rounds.length > 0) {
            resultPayload.rounds = resultDoc.rounds;
          }

          sendJson(res, 200, {
            success: true,
            result: resultPayload
          });
        } catch (dbErr) {
          console.error('[Server] Result query error:', dbErr.message);
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Failed to retrieve result for session'
          });
        }
        return;
      }

      // 6. GET /api/sessions/:sessionId/rounds (AC-7)
      const sessionRoundsMatch = pathname.match(/^\/api\/sessions\/([^/?]+)\/rounds$/);
      if (sessionRoundsMatch && req.method === 'GET') {
        const sessionId = decodeURIComponent(sessionRoundsMatch[1]);
        const state = actualStore.getState();
        const session = state && typeof state.get === 'function' ? state.getIn(['sessions', sessionId]) : null;
        if (session) {
          const rawRounds = session.get('rounds');
          const rounds = rawRounds && typeof rawRounds.toJS === 'function'
            ? rawRounds.toJS()
            : (Array.isArray(rawRounds) ? rawRounds : []);
          // AC-9: same shared guard as the socket payload, so a live round's
          // tallies never leave the server through the REST path either. The
          // store's roundLifecycle is the broadcast authority (matching
          // serializeSessionState); the round manager is only a fallback for
          // sessions whose active round was never mirrored into the store.
          const guardContext = {
            roundLifecycle: session.get('roundLifecycle') || roundManager.getRoundLifecycle(sessionId)
          };
          const guardedPayload = applyTallyVisibilityGuard({ status: session.get('status'), rounds }, guardContext);
          sendJson(res, 200, {
            success: true,
            sessionId,
            rounds: guardedPayload.rounds || []
          });
          return;
        }

        if (!isConnected()) {
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Database connection is unavailable'
          });
          return;
        }

        try {
          const resultDoc = await repository.getResultBySessionId(sessionId);
          if (!resultDoc) {
            sendJson(res, 404, {
              success: false,
              error: 'RESULT_NOT_FOUND',
              message: `No result found for session "${sessionId}"`
            });
            return;
          }

          sendJson(res, 200, {
            success: true,
            sessionId,
            rounds: resultDoc.rounds || []
          });
        } catch (dbErr) {
          console.error('[Server] Rounds query error:', dbErr.message);
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Failed to retrieve rounds for session'
          });
        }
        return;
      }

      // Default: 404 for unhandled API endpoints
      sendJson(res, 404, {
        error: 'NOT_FOUND',
        message: 'Endpoint not found'
      });
    } catch (err) {
      console.error('[Server] HTTP error:', err);
      sendJson(res, 500, {
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected server error occurred.'
      });
    }
  });

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST']
    }
  });

  httpServer.on('error', (err) => {
    console.error(`[Server] Failed to start on port ${actualPort}: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${actualPort} is already in use. Stop the other process or set PORT to a free port.`);
    }
    process.exit(1);
  });

  httpServer.listen(actualPort);

  let prevState = actualStore.getState();

  // Initialize round timers for any sessions already open with an active pair
  timerManager.onStateChange(null, prevState, actualStore, io);

  // Broadcast state changes
  actualStore.subscribe(() => {
    const currentState = actualStore.getState();
    if (currentState === prevState) {
      return;
    }

    const prevSessions = prevState && typeof prevState.get === 'function'
      ? prevState.get('sessions')
      : null;
    const currSessions = currentState && typeof currentState.get === 'function'
      ? currentState.get('sessions')
      : null;

    if (currSessions && typeof currSessions.forEach === 'function') {
      currSessions.forEach((session, sessionId) => {
        const prevSession = prevSessions ? prevSessions.get(sessionId) : null;
        if (session !== prevSession) {
          const prevSerialized = serializeSessionState(prevSession);
          const currSerialized = serializeSessionState(session);
          if (JSON.stringify(prevSerialized) !== JSON.stringify(currSerialized)) {
            io.to(`session:${sessionId}`).emit('session_state', currSerialized);
          }
        }
      });

      const prevSummary = getSessionsSummary(prevState);
      const currSummary = getSessionsSummary(currentState);
      if (JSON.stringify(prevSummary) !== JSON.stringify(currSummary)) {
        broadcastSessions(io, currSummary);
      }
    }

    // Persist session lifecycle changes to MongoDB (fire-and-forget)
    persistStateChanges(prevState, currentState);

    // Memory hygiene: when a session reaches a terminal state (completed or
    // archived) it can no longer accept votes or joins, so drop its voter
    // tokens, headcount index, and recorded vote keys instead of holding them
    // for the lifetime of the process.
    if (currSessions && typeof currSessions.forEach === 'function') {
      currSessions.forEach((session, sessionId) => {
        const prevSession = prevSessions ? prevSessions.get(sessionId) : null;
        if (prevSession === session) {
          return;
        }
        const status = session.get('status');
        const wasTerminal = prevSession
          ? (prevSession.get('winner') || prevSession.get('status') === 'completed' || prevSession.get('status') === 'archived')
          : false;
        const isTerminal = Boolean(session.get('winner')) || status === 'completed' || status === 'archived';
        if (isTerminal && !wasTerminal) {
          const freed = releaseSessionVoters(sessionId);
          for (const [sockId, mapping] of socketToVoter.entries()) {
            if (mapping.sessionId === sessionId) {
              socketToVoter.delete(sockId);
            }
          }
          if (freed.removedTokens > 0 || freed.removedVoteKeys > 0) {
            console.log(`[Memory] Released ${freed.removedTokens} voter token(s) and ${freed.removedVoteKeys} recorded vote key(s) for session "${sessionId}"`);
          }
          if (session.has('presence') || session.has('snapshots')) {
            queueMicrotask(() => {
              actualStore.dispatch({ type: 'PURGE_SESSION_PRESENCE', sessionId });
            });
          }
        }
      });
    }

    const previousState = prevState;
    prevState = currentState;

    // Synchronize round timer state transitions
    timerManager.onStateChange(previousState, currentState, actualStore, io);
  });

  io.on('connection', (socket) => {
    socket.data = socket.data || {};
    socket.data.voterTokens = socket.data.voterTokens || {};

    // AC-12: Parse vs_voter cookie from handshake headers
    const handshakeCookies = parseCookies(socket.handshake?.headers?.cookie);
    if (handshakeCookies && handshakeCookies.vs_voter) {
      const auth = verifyVoterToken(handshakeCookies.vs_voter);
      if (auth.valid && auth.payload?.userId) {
        socket.data.userId = auth.payload.userId;
        socket.data.email = auth.payload.email;
        socket.data.isRegisteredVoter = true;
      }
    }

    // Initial registry delivery
    socket.emit('sessions', getSocketSessionsSummary(socket, actualStore.getState()));

    // On-demand registry query
    socket.on('sessions', () => {
      socket.emit('sessions', getSocketSessionsSummary(socket, actualStore.getState()));
    });

    // Socket-based admin login
    socket.on('admin_login', async (credentials, callback) => {
      try {
        const identifier = credentials?.username || credentials?.email;
        const password = credentials?.password;
        const authResult = await verifyAdminCredentials(identifier, password, {
          clientIp: resolveClientIp(socket.handshake && socket.handshake.headers, socket.handshake && socket.handshake.address)
        });
        if (!authResult.valid) {
          if (typeof callback === 'function') {
            callback({
              success: false,
              error: authResult.error,
              message: authResult.message,
              ...(authResult.throttled ? { retryAfterMs: authResult.retryAfterMs } : {})
            });
          }
          return;
        }

        const token = generateAdminToken(authResult.admin);
        socket.data.adminToken = token;
        socket.data.isAdmin = true;

        // Immediately update socket with unfiltered admin session registry
        socket.emit('sessions', getSessionsSummary(actualStore.getState()));

        if (typeof callback === 'function') {
          callback({ success: true, token, user: authResult.admin });
        }
      } catch (err) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'INTERNAL_ERROR', message: err.message });
        }
      }
    });

    // Socket-based voter session join
    socket.on('join_session', (payload, callback) => {
      try {
        const sessionId = payload?.sessionId;
        const displayName = payload?.displayName;
        // User identity is server derived from verified handshake cookie only; never trust client payload
        const userId = socket.data?.userId || undefined;
        const result = registerVoter({ sessionId, displayName, store: actualStore, userId });
        if (!result.success) {
          if (typeof callback === 'function') {
            callback({ success: false, error: result.error, message: result.message });
          }
          return;
        }

        const voterToken = result.voter.sessionToken;
        socket.data.voterTokens[result.voter.sessionId] = voterToken;
        socketToVoter.set(socket.id, { sessionId: result.voter.sessionId, voterToken });

        actualStore.dispatch({
          type: 'RECORD_PRESENCE_CONNECT',
          sessionId: result.voter.sessionId,
          voterToken,
          socketId: socket.id,
          timestamp: Date.now()
        });

        const voterCount = getVoterCount(result.voter.sessionId);
        const updatedState = actualStore.getState();
        const sessionMap = updatedState && typeof updatedState.getIn === 'function'
          ? updatedState.getIn(['sessions', result.voter.sessionId])
          : null;
        const presence = sessionMap && typeof sessionMap.get === 'function'
          ? sessionMap.get('presence')
          : null;
        let connectedCount = 1;
        if (presence && typeof presence.filter === 'function') {
          connectedCount = presence.filter(v => v.get('connected') === true).size;
        }

        // Broadcast real time presence_update and augmented lobby_update to session room
        io.to(`session:${result.voter.sessionId}`).emit('presence_update', {
          sessionId: result.voter.sessionId,
          connectedCount,
          totalVoters: voterCount
        });
        io.to(`session:${result.voter.sessionId}`).emit('lobby_update', {
          sessionId: result.voter.sessionId,
          voterCount,
          connectedCount
        });
        broadcastSessions(io, actualStore.getState());

        const displayNameSource = userId
          ? ((displayName && String(displayName).trim() !== '') ? 'custom' : 'profile')
          : 'anonymous';

        if (typeof callback === 'function') {
          callback({
            success: true,
            sessionId: result.voter.sessionId,
            displayName: result.voter.displayName,
            displayNameSource,
            voterToken: result.voter.sessionToken,
            voterCount
          });
        }
      } catch (err) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'INTERNAL_ERROR', message: err.message });
        }
      }
    });

    // Subscribe to a session room
    socket.on('subscribe_session', (payload) => {
      try {
        let sessionId;
        let voterTokenCandidate = null;
        if (typeof payload === 'string') {
          sessionId = payload;
        } else if (payload && typeof payload === 'object' && typeof payload.sessionId === 'string') {
          sessionId = payload.sessionId;
          if (typeof payload.voterToken === 'string' && payload.voterToken.trim() !== '') {
            voterTokenCandidate = payload.voterToken.trim();
          }
        }

        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
          return;
        }

        const cleanSessionId = sessionId.trim();
        const state = actualStore.getState();
        const sessions = state && typeof state.get === 'function' ? state.get('sessions') : null;
        if (!sessions || !sessions.has(cleanSessionId)) {
          return;
        }

        const roomName = `session:${cleanSessionId}`;
        socket.join(roomName);

        let tokenToCheck = voterTokenCandidate || (socket.data?.voterTokens && socket.data.voterTokens[cleanSessionId]);
        if (tokenToCheck && typeof tokenToCheck === 'string' && tokenToCheck.startsWith('user:')) {
          if (!socket.data?.userId || tokenToCheck !== `user:${socket.data.userId}`) {
            tokenToCheck = null;
          }
        }
        if (!tokenToCheck && socket.data?.userId) {
          const userTokenCandidate = `user:${socket.data.userId}`;
          const validation = validateVoterToken(userTokenCandidate, cleanSessionId);
          if (validation.valid) {
            tokenToCheck = userTokenCandidate;
          }
        }
        if (tokenToCheck && typeof tokenToCheck === 'string') {
          const validation = validateVoterToken(tokenToCheck, cleanSessionId);
          if (validation.valid) {
            socketToVoter.set(socket.id, { sessionId: cleanSessionId, voterToken: tokenToCheck });
            actualStore.dispatch({
              type: 'RECORD_PRESENCE_CONNECT',
              sessionId: cleanSessionId,
              voterToken: tokenToCheck,
              socketId: socket.id,
              timestamp: Date.now()
            });

            const refreshedState = actualStore.getState();
            const currSession = refreshedState && typeof refreshedState.getIn === 'function'
              ? refreshedState.getIn(['sessions', cleanSessionId])
              : null;
            const currPresence = currSession && typeof currSession.get === 'function'
              ? currSession.get('presence')
              : null;
            let currentConnected = 1;
            if (currPresence && typeof currPresence.filter === 'function') {
              currentConnected = currPresence.filter(v => v.get('connected') === true).size;
            }
            const totalVoters = getVoterCount(cleanSessionId);

            io.to(roomName).emit('presence_update', {
              sessionId: cleanSessionId,
              connectedCount: currentConnected,
              totalVoters
            });
            io.to(roomName).emit('lobby_update', {
              sessionId: cleanSessionId,
              voterCount: totalVoters,
              connectedCount: currentConnected
            });
          }
        }

        const session = sessions.get(cleanSessionId);
        socket.emit('session_state', serializeSessionState(session));

        // Hydrate current timer state for the session
        const revealTimer = timerManager.getRevealTimer(cleanSessionId);
        const tiePendingTimer = timerManager.getTiePendingTimer(cleanSessionId);
        const timer = timerManager.getTimer(cleanSessionId);
        if (tiePendingTimer && tiePendingTimer.status === 'tie_pending') {
          socket.emit('timer_state', {
            sessionId,
            roundId: tiePendingTimer.roundId,
            duration: tiePendingTimer.duration,
            expiresAt: tiePendingTimer.expiresAt,
            status: 'tie_pending'
          });
        } else if (revealTimer && revealTimer.status === 'revealing') {
          socket.emit('timer_state', {
            sessionId,
            roundId: revealTimer.roundId,
            duration: revealTimer.duration,
            expiresAt: revealTimer.expiresAt,
            status: 'revealing'
          });
        } else if (timer && timer.status === 'running') {
          socket.emit('timer_state', {
            sessionId,
            roundId: timer.roundId,
            duration: timer.duration,
            expiresAt: timer.expiresAt,
            status: 'running'
          });
        } else {
          socket.emit('timer_state', {
            sessionId,
            duration: null,
            expiresAt: null,
            status: null
          });
        }
      } catch (err) {
        console.error('Error handling subscribe_session:', err);
      }
    });

    // Unsubscribe from a session room
    socket.on('unsubscribe_session', (payload) => {
      try {
        let sessionId;
        if (typeof payload === 'string') {
          sessionId = payload;
        } else if (payload && typeof payload === 'object' && typeof payload.sessionId === 'string') {
          sessionId = payload.sessionId;
        }

        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
          return;
        }

        const roomName = `session:${sessionId}`;
        socket.leave(roomName);
      } catch (err) {
        console.error('Error handling unsubscribe_session:', err);
      }
    });

    // Admin subscription to participant management roster (AC-10, AC-14)
    socket.on('subscribe_participants', async (payload) => {
      try {
        let sessionId;
        let tokenCandidate = null;
        if (typeof payload === 'string') {
          sessionId = payload;
        } else if (payload && typeof payload === 'object') {
          sessionId = payload.sessionId;
          tokenCandidate = payload.token || payload.adminToken;
        }

        if (tokenCandidate) {
          const v = verifyAdminToken(tokenCandidate);
          if (v.valid) {
            socket.data = socket.data || {};
            socket.data.isAdmin = true;
            socket.data.adminToken = tokenCandidate;
          }
        }

        if (!isSocketAdmin(socket)) {
          socket.emit('action_error', {
            action: 'subscribe_participants',
            error: 'UNAUTHORIZED',
            message: 'Admin authorization required to subscribe to participants.'
          });
          return;
        }

        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
          return;
        }

        const cleanSessionId = sessionId.trim();
        const roomName = `participants:${cleanSessionId}`;
        socket.join(roomName);

        await emitSessionParticipants(cleanSessionId, socket);
      } catch (err) {
        console.error('Error handling subscribe_participants:', err);
      }
    });

    // Admin un-subscription from participant management roster
    socket.on('unsubscribe_participants', (payload) => {
      try {
        let sessionId;
        if (typeof payload === 'string') {
          sessionId = payload;
        } else if (payload && typeof payload === 'object' && typeof payload.sessionId === 'string') {
          sessionId = payload.sessionId;
        }
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
          return;
        }
        socket.leave(`participants:${sessionId.trim()}`);
      } catch (err) {
        console.error('Error handling unsubscribe_participants:', err);
      }
    });

    // Handle socket disconnect and record presence transition
    socket.on('disconnect', () => {
      try {
        if (socketToVoter.has(socket.id)) {
          const { sessionId, voterToken } = socketToVoter.get(socket.id);
          socketToVoter.delete(socket.id);

          const monotonicNow = Math.round(Number(process.hrtime.bigint()) / 1e6);
          actualStore.dispatch({
            type: 'RECORD_PRESENCE_DISCONNECT',
            sessionId,
            voterToken,
            socketId: socket.id,
            timestamp: monotonicNow
          });

          const updatedState = actualStore.getState();
          const sessionMap = updatedState && typeof updatedState.getIn === 'function'
            ? updatedState.getIn(['sessions', sessionId])
            : null;
          const presence = sessionMap && typeof sessionMap.get === 'function'
            ? sessionMap.get('presence')
            : null;
          let currentConnected = 0;
          if (presence && typeof presence.filter === 'function') {
            currentConnected = presence.filter(v => v.get('connected') === true).size;
          }
          const totalVoters = getVoterCount(sessionId);

          io.to(`session:${sessionId}`).emit('presence_update', {
            sessionId,
            connectedCount: currentConnected,
            totalVoters
          });
          io.to(`session:${sessionId}`).emit('lobby_update', {
            sessionId,
            voterCount: totalVoters,
            connectedCount: currentConnected
          });
        }
      } catch (err) {
        console.error('Error handling socket disconnect:', err);
      }
    });

    // Authoritative Action Ingress Handler
    socket.on('action', async (action, callback) => {
      try {
        if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
          return;
        }

        const actionType = action.type;
        const respond = (data) => {
          if (typeof callback === 'function') {
            callback(data);
          }
          if (!data.success) {
            socket.emit('action_error', {
              action: actionType,
              error: data.error,
              message: data.message
            });
          }
        };

        // 0. ALLOWLIST: only known client facing action types are accepted.
        // Internal action types (for example SET_ROUND_LIFECYCLE) and unknown
        // types are rejected here so they can never reach the store.
        if (!ALLOWED_ACTION_TYPES.has(actionType)) {
          socket.emit('action_error', {
            action: actionType,
            error: 'FORBIDDEN_ACTION',
            message: `Action type "${actionType}" is not accepted from clients.`
          });
          return;
        }

        // 1. PROTECT ADMIN ACTIONS
        if (ADMIN_ACTION_TYPES.has(actionType)) {
          const authHeader = socket.handshake?.headers?.authorization;
          const headerToken = authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : authHeader;

          const adminToken = action.token ||
            action.meta?.token ||
            socket.data?.adminToken ||
            socket.handshake?.auth?.token ||
            headerToken;

          const verification = verifyAdminToken(adminToken);
          if (!verification.valid) {
            socket.emit('action_error', {
              action: actionType,
              error: verification.error || 'UNAUTHORIZED',
              message: verification.message || 'Admin authorization required.'
            });
            return;
          }

          // Authoritative validation for CREATE_SESSION
          if (actionType === 'CREATE_SESSION') {
            const sessionId = action.sessionId || action.electionId;
            if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INVALID_SESSION_ID',
                message: 'Session ID is required and must be a non-empty string.'
              });
              return;
            }

            const state = actualStore.getState();
            const sessionsMap = state && typeof state.get === 'function' ? state.get('sessions') : null;
            if (sessionsMap && typeof sessionsMap.has === 'function' && sessionsMap.has(sessionId)) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'DUPLICATE_SESSION_ID',
                message: `Session with ID "${sessionId}" already exists.`
              });
              return;
            }

            const title = action.title;
            if (!title || typeof title !== 'string' || title.trim() === '') {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INVALID_TITLE',
                message: 'Session title is required and cannot be blank.'
              });
              return;
            }

            const entries = action.entries;
            if (!entries || !Array.isArray(entries) || entries.length < 2) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INSUFFICIENT_ENTRIES',
                message: 'At least 2 entries are required to create a tournament session.'
              });
              return;
            }

            const hasInvalidEntry = entries.some(e => typeof e !== 'string' || e.trim() === '');
            if (hasInvalidEntry) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INVALID_ENTRIES',
                message: 'All entries must be non-empty strings.'
              });
              return;
            }

            const distinctEntries = new Set(entries.map(e => e.trim()));
            if (distinctEntries.size < 2) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INSUFFICIENT_ENTRIES',
                message: 'At least 2 distinct entries are required for pairwise voting tournament.'
              });
              return;
            }

            // Validate session type
            const sessionType = action.sessionType || (action.type !== 'CREATE_SESSION' ? action.type : null) || 'public';
            if (sessionType !== 'public' && sessionType !== 'secured') {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'VALIDATION_ERROR',
                message: 'Session type must be either "public" or "secured".'
              });
              return;
            }

            // Validate whoCanJoin against the schema enum so a bad value is
            // rejected before dispatch instead of failing Mongoose validation
            // silently at persistence time.
            const WHO_CAN_JOIN_VALUES = ['public', 'allowlist', 'approval'];
            if (action.whoCanJoin !== undefined && !WHO_CAN_JOIN_VALUES.includes(action.whoCanJoin)) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'VALIDATION_ERROR',
                message: 'Who can join must be one of "public", "allowlist", or "approval".'
              });
              return;
            }

            // AC-1: Secured sessions must require allowlist or approval, rejecting public
            if (sessionType === 'secured' && action.whoCanJoin === 'public') {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'VALIDATION_ERROR',
                message: 'Secured sessions must have whoCanJoin set to either "allowlist" or "approval".'
              });
              return;
            }

            // publishResultsPublicly must be a real boolean; Mongoose would
            // coerce anything else unpredictably.
            if (action.publishResultsPublicly !== undefined && typeof action.publishResultsPublicly !== 'boolean') {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'VALIDATION_ERROR',
                message: 'Publish results publicly must be a boolean.'
              });
              return;
            }

            // Validate candidateInfo if provided
            if (action.candidateInfo !== undefined) {
              if (!Array.isArray(action.candidateInfo)) {
                socket.emit('action_error', {
                  action: 'CREATE_SESSION',
                  error: 'VALIDATION_ERROR',
                  message: 'Candidate info must be an array.'
                });
                return;
              }
              for (const item of action.candidateInfo) {
                if (!item || typeof item !== 'object') {
                  socket.emit('action_error', {
                    action: 'CREATE_SESSION',
                    error: 'VALIDATION_ERROR',
                    message: 'Each candidate info item must be an object.'
                  });
                  return;
                }
                if (item.name !== undefined && (typeof item.name !== 'string' || item.name.length > 80)) {
                  socket.emit('action_error', {
                    action: 'CREATE_SESSION',
                    error: 'VALIDATION_ERROR',
                    message: 'Candidate name must be a string up to 80 characters.'
                  });
                  return;
                }
                if (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 80)) {
                  socket.emit('action_error', {
                    action: 'CREATE_SESSION',
                    error: 'VALIDATION_ERROR',
                    message: 'Candidate description must be a string up to 80 characters.'
                  });
                  return;
                }
              }
            }

            const rawDuration = action.timerDuration !== undefined
              ? action.timerDuration
              : action.duration;

            if (rawDuration !== undefined) {
              if (typeof rawDuration !== 'number' || !Number.isInteger(rawDuration)) {
                socket.emit('action_error', {
                  action: 'CREATE_SESSION',
                  error: 'INVALID_TIMER_DURATION_TYPE',
                  code: 'VALIDATION_ERROR',
                  message: 'Timer duration must be an integer.'
                });
                return;
              }

              if (rawDuration < 5 || rawDuration > 300) {
                socket.emit('action_error', {
                  action: 'CREATE_SESSION',
                  error: 'INVALID_TIMER_DURATION',
                  code: 'VALIDATION_ERROR',
                  message: 'Timer duration must be between 5 and 300 seconds.'
                });
                return;
              }
            }

            // Value derivations
            const votingMode = entries.length <= SINGLE_BALLOT_MAX ? 'single_ballot' : 'tournament';
            let joinCode;
            try {
              joinCode = await getUniqueJoinCode();
            } catch (err) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'COLLISION_EXHAUSTION',
                message: 'Could not generate a unique join code.'
              });
              return;
            }
            const pendingExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            const publishResultsPublicly = action.publishResultsPublicly !== undefined
              ? action.publishResultsPublicly
              : (sessionType !== 'secured');
            const whoCanJoin = action.whoCanJoin || (sessionType === 'secured' ? 'allowlist' : 'public');
            const candidateInfo = action.candidateInfo || [];

            actualStore.dispatch({
              ...action,
              type: 'CREATE_SESSION',
              sessionType,
              votingMode,
              joinCode,
              whoCanJoin,
              candidateInfo,
              publishResultsPublicly,
              pendingExpiresAt
            });
            return;
          }

          // Authoritative validation and execution for REFRESH_JOIN_CODE
          if (actionType === 'REFRESH_JOIN_CODE') {
            const sessionId = action.sessionId || action.electionId;
            if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
              socket.emit('action_error', {
                action: 'REFRESH_JOIN_CODE',
                error: 'INVALID_SESSION',
                message: 'Session ID is required.'
              });
              return;
            }

            const cleanSessionId = sessionId.trim();
            const state = actualStore.getState();
            const sessionsMap = state && typeof state.get === 'function' ? state.get('sessions') : null;
            const session = sessionsMap ? sessionsMap.get(cleanSessionId) : null;

            if (!session || session.get('status') === 'archived') {
              socket.emit('action_error', {
                action: 'REFRESH_JOIN_CODE',
                error: 'INVALID_SESSION',
                message: 'Session does not exist or is archived.'
              });
              return;
            }

            let newJoinCode;
            try {
              newJoinCode = await getUniqueJoinCode(10);
            } catch (err) {
              socket.emit('action_error', {
                action: 'REFRESH_JOIN_CODE',
                error: 'COLLISION_EXHAUSTION',
                message: 'Could not generate a unique join code after 10 attempts.'
              });
              return;
            }

            if (isConnected()) {
              try {
                await Session.findOneAndUpdate(
                  { sessionId: cleanSessionId },
                  { $set: { joinCode: newJoinCode } },
                  { runValidators: true }
                );
              } catch (dbErr) {
                socket.emit('action_error', {
                  action: 'REFRESH_JOIN_CODE',
                  error: 'DATABASE_ERROR',
                  message: 'Failed to persist refreshed join code.'
                });
                return;
              }
            }

            actualStore.dispatch({
              type: 'REFRESH_JOIN_CODE',
              sessionId: cleanSessionId,
              joinCode: newJoinCode
            });

            if (io) {
              broadcastSessions(io, actualStore.getState());
            }
            return;
          }

          // Authoritative validation and execution for RESOLVE_TIE
          if (actionType === 'RESOLVE_TIE') {
            const sessionId = action.sessionId || action.electionId;
            if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
              socket.emit('action_error', {
                action: 'RESOLVE_TIE',
                error: 'INVALID_SESSION',
                message: 'Session ID is required.'
              });
              return;
            }

            const cleanSessionId = sessionId.trim();
            const choice = action.choice;
            if (choice !== 'pick' && choice !== 'coin_flip') {
              socket.emit('action_error', {
                action: 'RESOLVE_TIE',
                error: 'INVALID_CHOICE',
                message: 'Choice must be either "pick" or "coin_flip".'
              });
              return;
            }

            if (choice === 'pick' && (!action.winner || typeof action.winner !== 'string' || action.winner.trim() === '')) {
              socket.emit('action_error', {
                action: 'RESOLVE_TIE',
                error: 'WINNER_REQUIRED',
                message: 'Winner is required when choice is "pick".'
              });
              return;
            }

            const resolveResult = roundManager.resolveTieAuthoritative({
              sessionId: cleanSessionId,
              roundId: action.roundId,
              choice,
              winner: action.winner ? action.winner.trim() : null,
              store: actualStore,
              timerManager,
              io
            });

            if (!resolveResult.success) {
              socket.emit('action_error', {
                action: 'RESOLVE_TIE',
                error: resolveResult.reason || 'RESOLUTION_FAILED',
                message: 'Failed to resolve tie.'
              });
              return;
            }

            return;
          }

          // Authoritative validation and execution for SET_ALLOWLIST (AC-3)
          if (actionType === 'SET_ALLOWLIST') {
            const sessionId = action.sessionId || action.electionId;
            if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
              respond({ success: false, error: 'INVALID_SESSION_ID', message: 'Session ID is required.' });
              return;
            }
            const cleanSessionId = sessionId.trim();
            const state = actualStore.getState();
            const session = state?.getIn ? state.getIn(['sessions', cleanSessionId]) : null;
            if (!session) {
              respond({ success: false, error: 'SESSION_NOT_FOUND', message: 'Session not found.' });
              return;
            }
            if (session.get('type') !== 'secured') {
              respond({ success: false, error: 'INVALID_SESSION_TYPE', message: 'Allowlist is only valid for secured sessions.' });
              return;
            }
            if (session.get('status') !== 'pending') {
              respond({ success: false, error: 'SESSION_STARTED', message: 'Allowlist can only be modified while session is pending.' });
              return;
            }

            let lines = [];
            if (Array.isArray(action.emails)) {
              lines = action.emails.map((e) => String(e));
            } else if (typeof action.emails === 'string') {
              lines = action.emails.split(/\r?\n/);
            }
            const validEmails = new Set();
            const invalid = [];

            for (let idx = 0; idx < lines.length; idx++) {
              const line = lines[idx].trim();
              if (!line) continue;
              const lineNum = idx + 1;

              let items = [];
              try {
                const parsed = parseCsvSync(line, { relax_column_count: true, trim: true });
                if (Array.isArray(parsed) && parsed.length > 0) {
                  items = parsed[0];
                }
              } catch {
                items = line.split(',').map((s) => s.trim());
              }

              for (const item of items) {
                const candidate = String(item).trim().toLowerCase();
                if (!candidate) continue;
                if (isValidEmail(candidate)) {
                  validEmails.add(candidate);
                } else {
                  invalid.push({ line: lineNum, email: item, reason: 'Invalid email format' });
                }
              }
            }

            if (validEmails.size === 0 && invalid.length > 0) {
              respond({ success: false, error: 'ALL_INVALID', message: 'All email entries are invalid.', invalid });
              return;
            }

            let addedCount = 0;
            let removedCount = 0;

            if (isConnected()) {
              const existingDocs = await SessionAllowlistEntry.find({ sessionId: cleanSessionId });
              const existingSet = new Set(existingDocs.map((e) => e.email.toLowerCase()));

              const toAdd = [...validEmails].filter((e) => !existingSet.has(e));
              const toRemove = existingDocs.filter((e) => !validEmails.has(e.email.toLowerCase()));

              if (toAdd.length > 0) {
                await SessionAllowlistEntry.insertMany(toAdd.map((email) => ({ sessionId: cleanSessionId, email })));
              }
              if (toRemove.length > 0) {
                await SessionAllowlistEntry.deleteMany({
                  sessionId: cleanSessionId,
                  email: { $in: toRemove.map((e) => e.email) }
                });
              }
              addedCount = toAdd.length;
              removedCount = toRemove.length;
            }

            if (io) {
              await emitSessionParticipants(cleanSessionId, io.to(`participants:${cleanSessionId}`));
            }

            respond({
              success: true,
              added: addedCount,
              removed: removedCount,
              invalid
            });
            return;
          }

          // Authoritative execution for APPROVE_PARTICIPANT (AC-6)
          if (actionType === 'APPROVE_PARTICIPANT') {
            const sessionId = action.sessionId || action.electionId;
            const requestId = action.requestId;
            if (!sessionId || !requestId) {
              respond({ success: false, error: 'INVALID_PARAMETERS', message: 'sessionId and requestId are required.' });
              return;
            }
            const cleanSessionId = sessionId.trim();
            if (!isConnected()) {
              respond({ success: false, error: 'DATABASE_ERROR', message: 'Database connection unavailable.' });
              return;
            }

            const request = await SessionJoinRequest.findOne({ sessionId: cleanSessionId, _id: requestId });
            if (!request) {
              respond({ success: false, error: 'REQUEST_NOT_FOUND', message: 'Join request not found.' });
              return;
            }
            if (request.status !== 'pending') {
              respond({ success: false, error: 'ALREADY_DECIDED', message: `Request is already ${request.status}.` });
              return;
            }

            request.status = 'approved';
            request.decidedAt = new Date();
            await request.save();

            // Register approved participant as session voter
            registerVoter({
              sessionId: cleanSessionId,
              displayName: request.displayName,
              store: actualStore,
              userId: String(request.userId)
            });

            // Notify voter's socket
            const targetToken = `user:${request.userId}`;
            const sockets = io?.sockets?.sockets;
            if (sockets) {
              for (const s of sockets.values()) {
                const sVoter = socketToVoter.get(s.id);
                if (String(s.data?.userId) === String(request.userId) || sVoter?.voterToken === targetToken) {
                  s.emit('participant_status', {
                    sessionId: cleanSessionId,
                    status: 'approved',
                    voterToken: targetToken,
                    displayName: request.displayName,
                    message: 'Your join request was approved.'
                  });
                }
              }
            }

            if (io) {
              await emitSessionParticipants(cleanSessionId, io.to(`participants:${cleanSessionId}`));
            }

            respond({ success: true, participant: request.toObject() });
            return;
          }

          // Authoritative execution for REJECT_PARTICIPANT (AC-6)
          if (actionType === 'REJECT_PARTICIPANT') {
            const sessionId = action.sessionId || action.electionId;
            const requestId = action.requestId;
            if (!sessionId || !requestId) {
              respond({ success: false, error: 'INVALID_PARAMETERS', message: 'sessionId and requestId are required.' });
              return;
            }
            const cleanSessionId = sessionId.trim();
            if (!isConnected()) {
              respond({ success: false, error: 'DATABASE_ERROR', message: 'Database connection unavailable.' });
              return;
            }

            const request = await SessionJoinRequest.findOne({ sessionId: cleanSessionId, _id: requestId });
            if (!request) {
              respond({ success: false, error: 'REQUEST_NOT_FOUND', message: 'Join request not found.' });
              return;
            }
            if (request.status !== 'pending') {
              respond({ success: false, error: 'ALREADY_DECIDED', message: `Request is already ${request.status}.` });
              return;
            }

            request.status = 'rejected';
            request.decidedAt = new Date();
            await request.save();

            // Notify voter's socket
            const targetToken = `user:${request.userId}`;
            const sockets = io?.sockets?.sockets;
            if (sockets) {
              for (const s of sockets.values()) {
                const sVoter = socketToVoter.get(s.id);
                if (String(s.data?.userId) === String(request.userId) || sVoter?.voterToken === targetToken) {
                  s.emit('participant_status', {
                    sessionId: cleanSessionId,
                    status: 'rejected',
                    message: 'Your join request was rejected.'
                  });
                }
              }
            }

            if (io) {
              await emitSessionParticipants(cleanSessionId, io.to(`participants:${cleanSessionId}`));
            }

            respond({ success: true, participant: request.toObject() });
            return;
          }

          // Authoritative execution for REMOVE_PARTICIPANT (AC-7)
          if (actionType === 'REMOVE_PARTICIPANT') {
            const sessionId = action.sessionId || action.electionId;
            const email = action.email ? action.email.toLowerCase().trim() : null;
            const requestId = action.requestId;
            const voterToken = action.voterToken;
            if (!sessionId || (!email && !requestId && !voterToken)) {
              respond({ success: false, error: 'MISSING_IDENTIFIER', message: 'Email, requestId, or voterToken is required.' });
              return;
            }
            const cleanSessionId = sessionId.trim();
            const state = actualStore.getState();
            const session = state?.getIn ? state.getIn(['sessions', cleanSessionId]) : null;
            if (!session) {
              respond({ success: false, error: 'SESSION_NOT_FOUND', message: 'Session not found.' });
              return;
            }

            let targetUserId = null;
            let targetEmail = email;

            if (voterToken && typeof voterToken === 'string' && voterToken.startsWith('user:')) {
              targetUserId = voterToken.slice(5);
            }

            if (isConnected()) {
              if (requestId) {
                const reqDoc = await SessionJoinRequest.findOne({ sessionId: cleanSessionId, _id: requestId });
                if (reqDoc) {
                  targetUserId = String(reqDoc.userId);
                  targetEmail = reqDoc.email;
                  await SessionJoinRequest.deleteOne({ _id: reqDoc._id });
                }
              }
              if (targetUserId && !targetEmail) {
                const u = await User.findById(targetUserId);
                if (u) targetEmail = u.email;
              }
              if (targetEmail) {
                await SessionAllowlistEntry.deleteOne({ sessionId: cleanSessionId, email: targetEmail });
                if (!targetUserId) {
                  const u = await User.findOne({ email: targetEmail });
                  if (u) targetUserId = String(u._id);
                }
              }
            }

            const sessionStatus = session.get('status');
            const targetToken = targetUserId ? `user:${targetUserId}` : null;

            if (sessionStatus === 'pending') {
              // Lobby: immediately disconnect and notify voter
              const sockets = io?.sockets?.sockets;
              if (sockets) {
                for (const s of sockets.values()) {
                  const sVoter = socketToVoter.get(s.id);
                  if ((targetUserId && String(s.data?.userId) === targetUserId) || (targetToken && sVoter?.voterToken === targetToken)) {
                    s.emit('participant_status', {
                      sessionId: cleanSessionId,
                      status: 'removed',
                      message: 'You have been removed from this session.'
                    });
                    if (sVoter) {
                      socketToVoter.delete(s.id);
                      actualStore.dispatch({
                        type: 'RECORD_PRESENCE_DISCONNECT',
                        sessionId: cleanSessionId,
                        voterToken: sVoter.voterToken,
                        socketId: s.id,
                        timestamp: Date.now()
                      });
                    }
                    s.leave(`session:${cleanSessionId}`);
                  }
                }
              }
              if (targetToken) {
                const sessionTokens = tokensBySession.get(cleanSessionId);
                if (sessionTokens) {
                  sessionTokens.delete(targetToken);
                }
              }
            } else if (sessionStatus === 'open') {
              // During voting: defer removal to end of current round
              if (targetToken) {
                if (!pendingRemovalsBySession.has(cleanSessionId)) {
                  pendingRemovalsBySession.set(cleanSessionId, new Set());
                }
                pendingRemovalsBySession.get(cleanSessionId).add(targetToken);
              }
            }

            if (io) {
              await emitSessionParticipants(cleanSessionId, io.to(`participants:${cleanSessionId}`));
            }

            respond({ success: true });
            return;
          }

          // Authoritative execution for SET_WHO_CAN_JOIN (AC-2)
          if (actionType === 'SET_WHO_CAN_JOIN') {
            const sessionId = action.sessionId || action.electionId;
            const whoCanJoin = action.whoCanJoin;
            if (!sessionId || typeof sessionId !== 'string') {
              respond({ success: false, error: 'INVALID_SESSION_ID', message: 'Session ID is required.' });
              return;
            }
            const cleanSessionId = sessionId.trim();
            const state = actualStore.getState();
            const session = state?.getIn ? state.getIn(['sessions', cleanSessionId]) : null;
            if (!session) {
              respond({ success: false, error: 'SESSION_NOT_FOUND', message: 'Session not found.' });
              return;
            }
            if (session.get('type') !== 'secured') {
              respond({ success: false, error: 'INVALID_SESSION_TYPE', message: 'Session is not a secured session.' });
              return;
            }
            if (session.get('status') !== 'pending') {
              respond({ success: false, error: 'INVALID_STATUS', message: 'Who can join can only be changed while session is pending.' });
              return;
            }
            if (whoCanJoin !== 'allowlist' && whoCanJoin !== 'approval') {
              respond({ success: false, error: 'INVALID_MODE', message: 'whoCanJoin must be either "allowlist" or "approval".' });
              return;
            }

            let clearedCount = 0;
            if (isConnected()) {
              const delAllow = await SessionAllowlistEntry.deleteMany({ sessionId: cleanSessionId });
              const delJoin = await SessionJoinRequest.deleteMany({ sessionId: cleanSessionId });
              clearedCount = (delAllow.deletedCount || 0) + (delJoin.deletedCount || 0);

              await Session.updateOne({ sessionId: cleanSessionId }, { $set: { whoCanJoin } });
            }

            actualStore.dispatch({
              type: 'SET_WHO_CAN_JOIN',
              sessionId: cleanSessionId,
              whoCanJoin
            });

            if (io) {
              broadcastSessions(io, actualStore.getState());
              await emitSessionParticipants(cleanSessionId, io.to(`participants:${cleanSessionId}`));
            }

            respond({ success: true, whoCanJoin, clearedCount });
            return;
          }

          // Authoritative pre-check and auto-reject for START_SESSION (AC-8)
          if (actionType === 'START_SESSION') {
            const sessionId = action.sessionId || action.electionId;
            if (!sessionId || typeof sessionId !== 'string') {
              socket.emit('action_error', {
                action: 'START_SESSION',
                error: 'INVALID_SESSION',
                message: 'Session ID is required.'
              });
              return;
            }
            const cleanSessionId = sessionId.trim();
            const state = actualStore.getState();
            const session = state?.getIn ? state.getIn(['sessions', cleanSessionId]) : null;
            if (!session) {
              socket.emit('action_error', {
                action: 'START_SESSION',
                error: 'SESSION_NOT_FOUND',
                message: 'Session does not exist.'
              });
              return;
            }

            if (session.get('type') === 'secured') {
              const voterCount = getVoterCount(cleanSessionId);
              if (voterCount < 1) {
                socket.emit('action_error', {
                  action: 'START_SESSION',
                  error: 'NO_ELIGIBLE_PARTICIPANTS',
                  message: 'At least one eligible voter must join before starting a secured session.'
                });
                return;
              }

              if (session.get('whoCanJoin') === 'approval' && isConnected()) {
                const pendingRequests = await SessionJoinRequest.find({ sessionId: cleanSessionId, status: 'pending' });
                if (pendingRequests.length > 0) {
                  await SessionJoinRequest.updateMany(
                    { sessionId: cleanSessionId, status: 'pending' },
                    { $set: { status: 'rejected', decidedAt: new Date() } }
                  );

                  const sockets = io?.sockets?.sockets;
                  for (const req of pendingRequests) {
                    const targetToken = `user:${req.userId}`;
                    if (sockets) {
                      for (const s of sockets.values()) {
                        const sVoter = socketToVoter.get(s.id);
                        if (String(s.data?.userId) === String(req.userId) || sVoter?.voterToken === targetToken) {
                          s.emit('participant_status', {
                            sessionId: cleanSessionId,
                            status: 'rejected',
                            message: 'Your join request was rejected at session start.'
                          });
                        }
                      }
                    }
                  }

                  if (io) {
                    await emitSessionParticipants(cleanSessionId, io.to(`participants:${cleanSessionId}`));
                  }
                }
              }
            }

            actualStore.dispatch(action);
            return;
          }

          // Authoritative handling for NEXT with deferred removal cleanup (AC-7)
          if (actionType === 'NEXT') {
            const sessionId = action.sessionId || action.electionId;
            if (sessionId && pendingRemovalsBySession.has(sessionId)) {
              const pendingTokens = pendingRemovalsBySession.get(sessionId);
              if (pendingTokens && pendingTokens.size > 0) {
                const sockets = io?.sockets?.sockets;
                for (const targetToken of pendingTokens) {
                  if (sockets) {
                    for (const s of sockets.values()) {
                      const sVoter = socketToVoter.get(s.id);
                      if (sVoter?.voterToken === targetToken || (s.data?.userId && targetToken === `user:${s.data.userId}`)) {
                        s.emit('participant_status', {
                          sessionId,
                          status: 'removed',
                          message: 'You have been removed from this session.'
                        });
                        socketToVoter.delete(s.id);
                        s.leave(`session:${sessionId}`);
                      }
                    }
                  }
                  actualStore.dispatch({
                    type: 'RECORD_PRESENCE_DISCONNECT',
                    sessionId,
                    voterToken: targetToken,
                    socketId: 'admin_removed',
                    timestamp: Date.now()
                  });
                  const sessionTokens = tokensBySession.get(sessionId);
                  if (sessionTokens) {
                    sessionTokens.delete(targetToken);
                  }
                }
                pendingRemovalsBySession.delete(sessionId);
              }
            }

            actualStore.dispatch(action);
            return;
          }

          // Authorized admin action — forward to Redux store
          actualStore.dispatch(action);
          return;
        }

        // 2. PROTECT VOTE ACTION
        if (actionType === 'VOTE') {
          const sessionId = action.sessionId || action.electionId;
          if (!sessionId || typeof sessionId !== 'string') {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'SESSION_REQUIRED',
              message: 'Session ID is required to vote.'
            });
            return;
          }

          // Parse cookies from socket handshake
          const cookies = parseCookies(socket.handshake?.headers?.cookie);
          const sessionCookieToken = cookies[`voter_token_${sessionId}`] || cookies['voter_token'];

          // Security: tokens starting with 'user:' must be server derived from verified credentials only.
          // Untrusted client payloads must not claim arbitrary user tokens.
          const clientSuppliedToken = action.voterToken || action.meta?.voterToken || socket.handshake?.auth?.voterToken;
          if (typeof clientSuppliedToken === 'string' && clientSuppliedToken.startsWith('user:')) {
            if (!socket.data?.userId || clientSuppliedToken !== `user:${socket.data.userId}`) {
              socket.emit('action_error', {
                action: 'VOTE',
                error: 'FORBIDDEN_VOTER_TOKEN',
                message: 'User identity tokens cannot be forged or claimed without valid credentials.'
              });
              return;
            }
          }

          let voterToken = null;
          if (socket.data?.userId) {
            voterToken = `user:${socket.data.userId}`;
          } else {
            voterToken = action.voterToken ||
              action.meta?.voterToken ||
              socket.data?.voterTokens?.[sessionId] ||
              socket.handshake?.auth?.voterToken ||
              sessionCookieToken;
          }

          // Anonymous voting is strictly rejected
          if (!voterToken) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'VOTER_TOKEN_REQUIRED',
              message: 'A session voter token is required to cast a vote.'
            });
            return;
          }

          // Validate token and session match
          const tokenValidation = validateVoterToken(voterToken, sessionId);
          if (!tokenValidation.valid) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: tokenValidation.error,
              message: tokenValidation.message
            });
            return;
          }

          // Check current active candidates in tournament / single ballot
          const state = actualStore.getState();
          const session = state && typeof state.get === 'function'
            ? state.getIn(['sessions', sessionId])
            : null;

          if (!session || session.get('status') !== 'open') {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'SESSION_NOT_OPEN',
              message: 'Voting is not open for this session.'
            });
            return;
          }

          const activeCandidates = session.getIn(['vote', 'candidates']) || session.getIn(['vote', 'pair']);
          const candidatesArray = activeCandidates && typeof activeCandidates.toJS === 'function'
            ? activeCandidates.toJS()
            : (Array.isArray(activeCandidates) ? activeCandidates : []);

          if (!candidatesArray || candidatesArray.length < 2) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'NO_ACTIVE_PAIR',
              message: 'No active candidates currently open for voting.'
            });
            return;
          }

          const entry = action.entry;
          if (!entry || typeof entry !== 'string' || !candidatesArray.includes(entry)) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'INVALID_ENTRY',
              message: `Vote entry "${entry}" is not part of the active candidates.`
            });
            return;
          }

          // Feature 8 — Reject votes if the round is closed or revealing or tie pending
          const roundLifecycle = session.get('roundLifecycle');
          const currentRound = roundManager.getCurrentRound(sessionId, actualStore);
          const isClosed = roundLifecycle === 'ROUND_CLOSED' ||
                           roundLifecycle === 'RESULTS_REVEALED' ||
                           roundLifecycle === 'TIE_PENDING' ||
                           (currentRound && currentRound.closed && currentRound.lifecycle !== 'VOTING');
          if (isClosed) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'ROUND_CLOSED',
              message: 'Voting is closed for this round.'
            });
            return;
          }

          // Feature 7 — Resolve the current round id first so the duplicate vote
          // key can be scoped per round (a pair may meet again after ties).
          const currentRoundId = roundManager.getCurrentRoundId(sessionId, actualStore);

          // AC-13: Pre-check persisted VoteParticipation for signed-in voters across restarts
          const voterUserId = socket.data?.userId || (voterToken && voterToken.startsWith('user:') ? voterToken.slice(5) : null);
          if (isConnected() && voterUserId && currentRoundId) {
            try {
              const prevVote = await VoteParticipation.findOne({
                sessionId,
                roundId: currentRoundId,
                userId: voterUserId
              });
              if (prevVote) {
                socket.emit('action_error', {
                  action: 'VOTE',
                  error: 'DUPLICATE_VOTE',
                  message: 'Voter has already cast a vote in this pairwise round.'
                });
                return;
              }
            } catch (err) {
              console.error('[VoteParticipation] Check error:', err.message);
            }
          }

          // Server-side duplicate vote prevention, scoped to the current round
          const voteCheck = canCastVote({
            sessionToken: voterToken,
            sessionId,
            pair: candidatesArray,
            roundId: currentRoundId
          });

          if (!voteCheck.allowed) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: voteCheck.error,
              message: voteCheck.message
            });
            return;
          }

          // Authorize and record vote key
          recordVote(voteCheck.voteKey);

          // Feature 7 — Record current-round voter participation
          if (currentRoundId) {
            roundManager.recordRoundSubmission({
              sessionId,
              roundId: currentRoundId,
              sessionToken: voterToken
            });
          }

          // Authoritative vote dispatch
          actualStore.dispatch(action);

          // AC-12: Record VoteParticipation audit trail for signed-in voters (fire-and-forget, stores NO vote choice)
          if (isConnected() && voterUserId && currentRoundId) {
            VoteParticipation.create({
              sessionId,
              roundId: currentRoundId,
              userId: voterUserId
            }).catch((err) => {
              if (err.code !== 11000) {
                console.error('[VoteParticipation] Create error:', err.message);
              }
            });
          }

          // Feature 7 — Idempotent early round completion check
          if (currentRoundId && roundManager.canCompleteEarly({
            sessionId,
            roundId: currentRoundId,
            store: actualStore
          })) {
            roundManager.closeRoundOnce({
              sessionId,
              roundId: currentRoundId,
              store: actualStore,
              timerManager,
              io,
              isTimerExpiry: false
            });
          }
          return;
        }

        // 3. Other actions (e.g. unknown or internal)
        actualStore.dispatch(action);
      } catch (err) {
        console.error('Error handling socket action:', err);
      }
    });
  });

  io.timerManager = timerManager;
  io.roundManager = roundManager;
  io.socketToVoter = socketToVoter;

  const originalClose = io.close.bind(io);
  io.close = (callback) => {
    socketToVoter.clear();
    timerManager.clearAllTimers();
    roundManager.resetRounds();
    return originalClose(callback);
  };

  return io;
}