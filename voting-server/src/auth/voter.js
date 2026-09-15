import crypto from 'crypto';

/**
 * In-memory repository of registered voters.
 * Keyed by sessionToken -> Voter object.
 */
const votersByToken = new Map();

/**
 * In-memory set of recorded vote keys to enforce server-side duplicate vote prevention:
 * Key format: `${sessionId}:::${sortedPairKey}:::${sessionToken}`
 */
const recordedVotes = new Set();

/**
 * In-memory index of sessionToken sets per sessionId.
 * Enables O(1) session-isolated voter headcount tracking without leaking tokens.
 */
const tokensBySession = new Map();

/**
 * Registers a new session-scoped voter identity.
 *
 * Rules:
 * - No password, email, or OTP.
 * - Requires valid session.
 * - Allows duplicate display names without deduplication.
 * - Generates cryptographically secure, random, session-scoped token.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.displayName
 * @param {Object} params.store - Redux store to check session validity
 * @returns {{ success: boolean, voter?: Object, error?: string, message?: string }}
 */
export function registerVoter({ sessionId, displayName, store }) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return {
      success: false,
      error: 'INVALID_SESSION',
      message: 'A valid session ID is required to join.'
    };
  }

  const normalizedSessionId = sessionId.trim();

  if (!displayName || typeof displayName !== 'string' || displayName.trim() === '') {
    return {
      success: false,
      error: 'INVALID_DISPLAY_NAME',
      message: 'A non-empty display name is required.'
    };
  }

  // Validate session exists in store registry
  if (store && typeof store.getState === 'function') {
    const state = store.getState();
    const sessions = state && typeof state.get === 'function'
      ? (state.get('sessions') || state.get('elections'))
      : null;

    if (!sessions || !sessions.has(normalizedSessionId)) {
      return {
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: `Session "${normalizedSessionId}" does not exist in registry.`
      };
    }

    const session = sessions.get(normalizedSessionId);
    if (session && session.get('status') === 'archived') {
      return {
        success: false,
        error: 'SESSION_ARCHIVED',
        message: 'Cannot join an archived session.'
      };
    }
  }

  // Issue random, unguessable session-scoped token
  const sessionToken = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(24).toString('hex');

  const voter = {
    sessionId: normalizedSessionId,
    displayName: displayName.trim(),
    sessionToken,
    joinedAt: new Date().toISOString()
  };

  votersByToken.set(sessionToken, voter);

  // Maintain isolated session token index for headcount queries
  if (!tokensBySession.has(normalizedSessionId)) {
    tokensBySession.set(normalizedSessionId, new Set());
  }
  tokensBySession.get(normalizedSessionId).add(sessionToken);

  return {
    success: true,
    voter
  };
}

/**
 * Validates whether a voter token is provided, known, and scoped to the target session.
 *
 * @param {string} sessionToken
 * @param {string} targetSessionId
 * @returns {{ valid: boolean, voter?: Object, error?: string, message?: string }}
 */
export function validateVoterToken(sessionToken, targetSessionId) {
  if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.trim() === '') {
    return {
      valid: false,
      error: 'VOTER_TOKEN_REQUIRED',
      message: 'A session voter token is required to cast a vote.'
    };
  }

  const voter = votersByToken.get(sessionToken.trim());
  if (!voter) {
    return {
      valid: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired voter token.'
    };
  }

  if (targetSessionId && voter.sessionId !== targetSessionId.trim()) {
    return {
      valid: false,
      error: 'SESSION_MISMATCH',
      message: `Voter token is scoped to session "${voter.sessionId}", not "${targetSessionId}".`
    };
  }

  return {
    valid: true,
    voter
  };
}

/**
 * Builds the unique duplicate-vote key for the specified session, round pair, and voter token.
 *
 * @param {string} sessionId
 * @param {Array<string>|string} pair
 * @param {string} sessionToken
 * @returns {string}
 */
export function buildVoteKey(sessionId, pair, sessionToken) {
  const pairKey = Array.isArray(pair)
    ? [...pair].sort().join(':::')
    : String(pair || '');
  return `${sessionId}:::${pairKey}:::${sessionToken}`;
}

/**
 * Server-side authorization check to verify if a voter can cast a vote.
 *
 * Enforces:
 * 1. Valid voter token.
 * 2. Token scoped to active session.
 * 3. Prevention of duplicate vote for the exact same session + pair/round.
 *
 * @param {Object} params
 * @param {string} params.sessionToken
 * @param {string} params.sessionId
 * @param {Array<string>} params.pair
 * @returns {{ allowed: boolean, voteKey?: string, voter?: Object, error?: string, message?: string }}
 */
export function canCastVote({ sessionToken, sessionId, pair }) {
  const tokenValidation = validateVoterToken(sessionToken, sessionId);
  if (!tokenValidation.valid) {
    return {
      allowed: false,
      error: tokenValidation.error,
      message: tokenValidation.message
    };
  }

  if (!pair || !Array.isArray(pair) || pair.length < 2) {
    return {
      allowed: false,
      error: 'NO_ACTIVE_PAIR',
      message: 'No active pair currently open for voting.'
    };
  }

  const voteKey = buildVoteKey(sessionId, pair, sessionToken.trim());
  if (recordedVotes.has(voteKey)) {
    return {
      allowed: false,
      error: 'DUPLICATE_VOTE',
      message: 'Voter has already cast a vote in this pairwise round.'
    };
  }

  return {
    allowed: true,
    voteKey,
    voter: tokenValidation.voter
  };
}

/**
 * Authoritatively marks a vote key as recorded, preventing any subsequent duplicate votes.
 *
 * @param {string} voteKey
 */
export function recordVote(voteKey) {
  if (voteKey && typeof voteKey === 'string') {
    recordedVotes.add(voteKey);
  }
}

/**
 * Retrieves voter by token.
 * @param {string} sessionToken
 * @returns {Object|null}
 */
export function getVoter(sessionToken) {
  return votersByToken.get(sessionToken) || null;
}

/**
 * Clears voters, recorded votes, and session headcount indices (for testing).
 */
export function clearVoters() {
  votersByToken.clear();
  recordedVotes.clear();
  tokensBySession.clear();
}

/**
 * Retrieves the count of joined voters for a specific session.
 * Strictly isolated per session in memory, without exposing tokens or identities.
 *
 * @param {string} sessionId - Target session ID
 * @returns {number} Non-negative voter count
 */
export function getVoterCount(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return 0;
  }
  const normalizedId = sessionId.trim();
  const sessionTokens = tokensBySession.get(normalizedId);
  return sessionTokens ? sessionTokens.size : 0;
}

