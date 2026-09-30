import crypto from 'crypto';

/**
 * In-memory repository of registered voters.
 * Keyed by sessionToken -> Voter object.
 */
export const votersByToken = new Map();

/**
 * In-memory set of recorded vote keys to enforce server-side duplicate vote prevention:
 * Key format: `${sessionId}:::${sortedPairKey}:::${sessionToken}`
 */
export const recordedVotes = new Set();

/**
 * In-memory index of sessionToken sets per sessionId.
 * Enables O(1) session-isolated voter headcount tracking without leaking tokens.
 */
export const tokensBySession = new Map();

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
export function registerVoter({ sessionId, displayName, store, userId }) {
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

  // Use synthetic user:userId key for signed in voters (AC-12), or random token for anonymous
  const sessionToken = userId
    ? `user:${userId}`
    : (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(24).toString('hex'));

  const voter = {
    sessionId: normalizedSessionId,
    displayName: displayName.trim(),
    sessionToken,
    userId: userId || null,
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

  const token = sessionToken.trim();
  const voter = votersByToken.get(token);
  if (!voter) {
    return {
      valid: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired voter token.'
    };
  }

  if (targetSessionId) {
    const normSession = targetSessionId.trim();
    const hasJoined = (voter.sessionId === normSession) ||
      Boolean(tokensBySession.get(normSession) && tokensBySession.get(normSession).has(token));
    if (!hasJoined) {
      return {
        valid: false,
        error: 'SESSION_MISMATCH',
        message: `Voter token is scoped to session "${voter.sessionId}", not "${targetSessionId}".`
      };
    }
  }

  return {
    valid: true,
    voter
  };
}

/**
 * Builds the unique duplicate-vote key for the specified session, round, pair, and voter token.
 *
 * The round id scopes the key so a pair that meets again in a later round (possible
 * after ties) accepts fresh votes. When roundId is omitted the key falls back to the
 * legacy pair scoped shape for backwards compatibility.
 *
 * @param {string} sessionId
 * @param {Array<string>|string} pair
 * @param {string} sessionToken
 * @param {string} [roundId]
 * @returns {string}
 */
export function buildVoteKey(sessionId, pair, sessionToken, roundId) {
  const pairKey = Array.isArray(pair)
    ? [...pair].sort().join(':::')
    : String(pair || '');
  const roundPart = roundId ? `${roundId}:::` : '';
  return `${sessionId}:::${roundPart}${pairKey}:::${sessionToken}`;
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
 * @param {string} [params.roundId] - Current round id; scopes the duplicate key per round
 * @returns {{ allowed: boolean, voteKey?: string, voter?: Object, error?: string, message?: string }}
 */
export function canCastVote({ sessionToken, sessionId, pair, roundId }) {
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

  const voteKey = buildVoteKey(sessionId, pair, sessionToken.trim(), roundId);
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
 * Drops one session's voter registry: tokens, headcount index, and recorded vote
 * keys. Called when a session completes or is archived (both terminal states that
 * can no longer accept votes) so a long running server does not accumulate voter
 * memory forever.
 *
 * @param {string} sessionId
 * @returns {{ removedTokens: number, removedVoteKeys: number }}
 */
export function releaseSessionVoters(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { removedTokens: 0, removedVoteKeys: 0 };
  }

  const normalizedId = sessionId.trim();
  let removedTokens = 0;
  let removedVoteKeys = 0;

  const tokens = tokensBySession.get(normalizedId);
  if (tokens) {
    for (const token of tokens) {
      if (token.startsWith('user:')) {
        let inOtherSession = false;
        for (const [sId, tokenSet] of tokensBySession.entries()) {
          if (sId !== normalizedId && tokenSet.has(token)) {
            inOtherSession = true;
            break;
          }
        }
        if (!inOtherSession) {
          if (votersByToken.delete(token)) {
            removedTokens += 1;
          }
        }
      } else {
        if (votersByToken.delete(token)) {
          removedTokens += 1;
        }
      }
    }
    tokensBySession.delete(normalizedId);
  }

  // Vote keys always start with `${sessionId}:::`, in both the round scoped and
  // the legacy pair scoped shape, so a prefix match is exact session isolation.
  const prefix = `${normalizedId}:::`;
  for (const key of recordedVotes) {
    if (key.startsWith(prefix)) {
      recordedVotes.delete(key);
      removedVoteKeys += 1;
    }
  }

  return { removedTokens, removedVoteKeys };
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

