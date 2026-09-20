import { getVoterCount, validateVoterToken } from './auth/voter.js';

/**
 * VoteSphere — Round Lifecycle & Participation Domain Module
 *
 * Implements server-authoritative round identity tracking, voter participation accounting,
 * and an idempotent early round completion mechanism for pairwise voting tournaments.
 *
 * Invariant Guarantees:
 * 1. A particular round can be completed at most once.
 * 2. Timer expiry and final-vote events cannot both advance the same round.
 * 3. Stale timer callbacks cannot advance a newly started round.
 * 4. Multi-session and round-to-round isolation are strictly enforced in memory.
 * 5. 0 eligible voters cannot satisfy the completion condition (zero-voter protection).
 */

export const ROUND_LIFECYCLE = Object.freeze({
  VOTING: 'VOTING',
  ROUND_CLOSED: 'ROUND_CLOSED',
  RESULTS_REVEALED: 'RESULTS_REVEALED'
});

export const DEFAULT_REVEAL_DURATION = 1; // seconds
export const MIN_REVEAL_DURATION = 1;     // seconds
export const MAX_REVEAL_DURATION = 60;     // seconds

/**
 * Resolves the reveal duration based on precedence:
 * 1. Override duration (if valid number)
 * 2. ROUND_REVEAL_DURATION environment variable
 * 3. DEFAULT_REVEAL_DURATION (1 second)
 *
 * @param {number|undefined|null} overrideDuration
 * @returns {number}
 */
export function resolveRevealDuration(overrideDuration) {
  if (typeof overrideDuration === 'number' && !Number.isNaN(overrideDuration)) {
    const clamped = Math.floor(overrideDuration);
    if (clamped >= MIN_REVEAL_DURATION && clamped <= MAX_REVEAL_DURATION) {
      return clamped;
    }
  }

  if (process.env.ROUND_REVEAL_DURATION) {
    const envDuration = parseInt(process.env.ROUND_REVEAL_DURATION, 10);
    if (!Number.isNaN(envDuration) && envDuration >= MIN_REVEAL_DURATION && envDuration <= MAX_REVEAL_DURATION) {
      return envDuration;
    }
  }

  return DEFAULT_REVEAL_DURATION;
}

/**
 * Monotonic round index sequence per session.
 * Maps: sessionId -> number (1, 2, 3, ...)
 * @type {Map<string, number>}
 */
const roundIndexBySession = new Map();

/**
 * Currently active round descriptor per session.
 * Maps: sessionId -> RoundObject
 * @type {Map<string, Object>}
 */
const activeRounds = new Map();

/**
 * Set of closed round composite keys (`${sessionId}:::${roundId}`).
 * Enforces strict idempotency across all completion paths.
 * @type {Set<string>}
 */
const closedRounds = new Set();

/**
 * Set of unique voter session tokens who submitted a valid vote in a specific round.
 * Maps: `${sessionId}:::${roundId}` -> Set<sessionToken>
 * @type {Map<string, Set<string>>}
 */
const submissionsByRound = new Map();

/**
 * Generates a unique, round-isolated identifier string.
 *
 * @param {string} sessionId
 * @param {number} roundIndex
 * @returns {string}
 */
export function generateRoundId(sessionId, roundIndex) {
  return `${sessionId}:::r${roundIndex}`;
}

/**
 * Initializes and activates a fresh round for a given session and candidate pair.
 * Resets participation tracking for this new round and marks it as open.
 *
 * @param {string} sessionId
 * @param {Array<string>} pair
 * @param {Object} [options]
 * @param {number} [options.revealDuration]
 * @returns {Object|null} The created round object
 */
export function initRound(sessionId, pair, options = {}) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return null;
  }
  const cleanSessionId = sessionId.trim();

  if (!pair || !Array.isArray(pair) || pair.length < 2) {
    return null;
  }

  const nextIndex = (roundIndexBySession.get(cleanSessionId) || 0) + 1;
  roundIndexBySession.set(cleanSessionId, nextIndex);

  const roundId = generateRoundId(cleanSessionId, nextIndex);
  const roundObj = {
    sessionId: cleanSessionId,
    roundId,
    roundIndex: nextIndex,
    pair: [...pair],
    closed: false,
    lifecycle: ROUND_LIFECYCLE.VOTING,
    finalVote: null,
    revealTimer: null,
    revealExpired: false,
    revealDuration: options.revealDuration !== undefined ? options.revealDuration : undefined,
    createdAt: Date.now()
  };

  activeRounds.set(cleanSessionId, roundObj);
  submissionsByRound.set(`${cleanSessionId}:::${roundId}`, new Set());

  return roundObj;
}

/**
 * Retrieves the currently active round object for a session.
 * If not initialized yet but the Redux store has an active open session with a pair,
 * defensively initializes Round 1.
 *
 * @param {string} sessionId
 * @param {Object} [store]
 * @returns {Object|null}
 */
export function getCurrentRound(sessionId, store = null) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return null;
  }
  const cleanSessionId = sessionId.trim();

  const active = activeRounds.get(cleanSessionId);
  if (active && !active.closed) {
    return active;
  }

  // Defensive fallback: check store state if round was not initialized via subscriber
  if (store && typeof store.getState === 'function') {
    const state = store.getState();
    const session = state && typeof state.get === 'function'
      ? state.getIn(['sessions', cleanSessionId])
      : null;

    if (session && session.get('status') === 'open' && !session.get('winner')) {
      // Do NOT defensively initialize a new round if the session is in RESULTS_REVEALED.
      // A reveal timer is running and expireReveal needs the original round object.
      const sessionLifecycle = session.get('roundLifecycle');
      if (sessionLifecycle === ROUND_LIFECYCLE.RESULTS_REVEALED ||
          sessionLifecycle === ROUND_LIFECYCLE.ROUND_CLOSED) {
        return active || null;
      }

      const activePair = session.getIn(['vote', 'pair']);
      const pairArray = activePair && typeof activePair.toJS === 'function'
        ? activePair.toJS()
        : (Array.isArray(activePair) ? activePair : []);

      if (pairArray && pairArray.length >= 2) {
        return initRound(cleanSessionId, pairArray);
      }
    }
  }

  return active || null;
}

/**
 * Retrieves the currently active round identifier string for a session.
 *
 * @param {string} sessionId
 * @param {Object} [store]
 * @returns {string|null}
 */
export function getCurrentRoundId(sessionId, store = null) {
  const round = getCurrentRound(sessionId, store);
  return round ? round.roundId : null;
}

/**
 * Records a unique voter submission for the specified round.
 *
 * Validates:
 * 1. Required arguments presence.
 * 2. Voter token validity and session scoping.
 * 3. Round is currently open and not closed.
 *
 * Ensures each voter can only contribute exactly once to the round's count.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.roundId
 * @param {string} params.sessionToken
 * @returns {{ success: boolean, isNew?: boolean, submittedCount?: number, roundId?: string, error?: string }}
 */
export function recordRoundSubmission({ sessionId, roundId, sessionToken }) {
  if (!sessionId || typeof sessionId !== 'string' || !roundId || typeof roundId !== 'string' || !sessionToken || typeof sessionToken !== 'string') {
    return { success: false, error: 'MISSING_ARGUMENTS' };
  }

  const cleanSessionId = sessionId.trim();
  const cleanRoundId = roundId.trim();
  const cleanToken = sessionToken.trim();

  // Validate voter token exists and is scoped to target session
  const validation = validateVoterToken(cleanToken, cleanSessionId);
  if (!validation.valid) {
    return { success: false, error: validation.error || 'INVALID_TOKEN' };
  }

  const key = `${cleanSessionId}:::${cleanRoundId}`;
  if (closedRounds.has(key)) {
    return { success: false, error: 'ROUND_CLOSED' };
  }

  const active = activeRounds.get(cleanSessionId);
  if (active && active.roundId === cleanRoundId) {
    if (active.closed || active.lifecycle === ROUND_LIFECYCLE.ROUND_CLOSED || active.lifecycle === ROUND_LIFECYCLE.RESULTS_REVEALED) {
      return { success: false, error: 'ROUND_CLOSED' };
    }
  }

  if (!submissionsByRound.has(key)) {
    submissionsByRound.set(key, new Set());
  }

  const submissions = submissionsByRound.get(key);
  const isNew = !submissions.has(cleanToken);
  submissions.add(cleanToken);

  return {
    success: true,
    isNew,
    submittedCount: submissions.size,
    roundId: cleanRoundId
  };
}

/**
 * Retrieves the count of unique valid voter submissions for a specific round.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.roundId
 * @returns {number}
 */
export function getRoundSubmissionCount({ sessionId, roundId }) {
  if (!sessionId || !roundId) return 0;
  const key = `${sessionId.trim()}:::${roundId.trim()}`;
  const submissions = submissionsByRound.get(key);
  return submissions ? submissions.size : 0;
}

/**
 * Returns a list of all voter tokens that submitted a vote for the specified round (copy).
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.roundId
 * @returns {Array<string>}
 */
export function getRoundSubmissions({ sessionId, roundId }) {
  if (!sessionId || !roundId) return [];
  const key = `${sessionId.trim()}:::${roundId.trim()}`;
  const submissions = submissionsByRound.get(key);
  return submissions ? Array.from(submissions) : [];
}

/**
 * Determines whether all eligible voters have submitted a valid vote for the round.
 *
 * Evaluation Rules:
 * - 0 eligible voters -> false (Zero-voter protection: empty session cannot auto-complete)
 * - submittedCount < eligibleCount -> false
 * - submittedCount >= eligibleCount (where eligibleCount >= 1) -> true
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.roundId
 * @param {number} [params.eligibleVoterCount] - Optional override count (defaults to getVoterCount(sessionId))
 * @returns {boolean}
 */
export function hasAllVotersVoted({ sessionId, roundId, eligibleVoterCount }) {
  if (!sessionId || !roundId) return false;
  const cleanSessionId = sessionId.trim();
  const cleanRoundId = roundId.trim();

  const eligibleCount = typeof eligibleVoterCount === 'number'
    ? eligibleVoterCount
    : getVoterCount(cleanSessionId);

  // Zero-voter protection
  if (eligibleCount <= 0) {
    return false;
  }

  const submittedCount = getRoundSubmissionCount({ sessionId: cleanSessionId, roundId: cleanRoundId });
  return submittedCount >= eligibleCount;
}

/**
 * Determines whether the active round can complete early authoritatively.
 *
 * Rules:
 * - Requires at least minEligibleVoters (default 2) registered in the session.
 *   (Protects single-voter or zero-voter sessions from premature early advancement
 *    before other participants have joined).
 * - Requires all eligible voters to have cast a unique valid vote for the current round.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.roundId
 * @param {number} [params.minEligibleVoters=2]
 * @returns {boolean}
 */
export function canCompleteEarly({ sessionId, roundId, minEligibleVoters = 2 }) {
  if (!sessionId || !roundId) return false;
  const cleanSessionId = sessionId.trim();
  const eligibleCount = getVoterCount(cleanSessionId);

  if (eligibleCount < minEligibleVoters) {
    return false;
  }

  return hasAllVotersVoted({
    sessionId: cleanSessionId,
    roundId: roundId.trim(),
    eligibleVoterCount: eligibleCount
  });
}

/**
 * Checks whether a specific round has been marked as closed.
 *
 * @param {string} sessionId
 * @param {string} roundId
 * @returns {boolean}
 */
export function isRoundClosed(sessionId, roundId) {
  if (!sessionId || !roundId) return true;
  return closedRounds.has(`${sessionId.trim()}:::${roundId.trim()}`);
}

/**
 * Authoritative, idempotent round closure executor.
 *
 * Guarantees that a particular roundId is advanced AT MOST ONCE.
 * Both early completion (last voter) and timer expiry converge through this function.
 *
 * Actions:
 * 1. Validates roundId is active and not yet closed. If already closed, returns harmless no-op.
 * 2. Marks roundId as closed in closedRounds set and sets lifecycle to ROUND_CLOSED.
 * 3. Stops/cancels running voting timer via timerManager.clearTimer(sessionId).
 * 4. Freezes final round vote tally snapshot.
 * 5. If revealDuration > 0 and timerManager capable, transitions to RESULTS_REVEALED and starts reveal timer.
 * 6. If revealDuration === 0, dispatches NEXT immediately (direct advance).
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.roundId
 * @param {Object} [params.store] - Redux store to dispatch NEXT or SET_ROUND_LIFECYCLE
 * @param {Object} [params.timerManager] - TimerManager to stop timer / start reveal timer
 * @param {Object} [params.io] - Optional Socket.io server instance
 * @param {number} [params.revealDuration] - Optional reveal duration override
 * @returns {{ success: boolean, advanced?: boolean, closed?: boolean, revealing?: boolean, reason?: string, roundId?: string, sessionId?: string, revealDuration?: number }}
 */
export function closeRoundOnce({
  sessionId,
  roundId,
  store = null,
  timerManager = null,
  io = null,
  revealDuration = undefined
}) {
  if (!sessionId || !roundId) {
    return { success: false, reason: 'INVALID_ARGUMENTS' };
  }

  const cleanSessionId = sessionId.trim();
  const cleanRoundId = roundId.trim();
  const key = `${cleanSessionId}:::${cleanRoundId}`;

  // Idempotency Guard (Invariant 1 & 14): Round cannot be closed more than once
  if (closedRounds.has(key)) {
    return { success: false, reason: 'ALREADY_CLOSED', roundId: cleanRoundId };
  }

  // Stale Round Guard (Invariant 4): Stale callback cannot close a different active round
  const active = activeRounds.get(cleanSessionId);
  if (active && active.roundId !== cleanRoundId) {
    return {
      success: false,
      reason: 'STALE_ROUND',
      roundId: cleanRoundId,
      activeRoundId: active.roundId
    };
  }

  // Mark closed authoritatively
  closedRounds.add(key);
  if (active) {
    active.closed = true;
    active.lifecycle = ROUND_LIFECYCLE.ROUND_CLOSED;
  }

  // Disarm/cancel the running voting timer
  if (timerManager && typeof timerManager.clearTimer === 'function') {
    timerManager.clearTimer(cleanSessionId);
  }

  // Extract frozen vote tally from store
  let finalVote = null;
  if (store && typeof store.getState === 'function') {
    const state = store.getState();
    const session = state && typeof state.get === 'function'
      ? state.getIn(['sessions', cleanSessionId])
      : null;
    if (session) {
      const voteState = session.get('vote');
      const activePair = active ? active.pair : (voteState && voteState.get('pair') ? voteState.get('pair').toJS() : []);
      const activeTally = voteState && voteState.get('tally') ? voteState.get('tally').toJS() : {};
      finalVote = {
        pair: activePair,
        tally: activeTally,
        closedAt: Date.now()
      };
      if (active) {
        active.finalVote = finalVote;
      }
    }
  }

  // Resolve reveal duration:
  let resolvedDuration = 0;
  if (revealDuration !== undefined) {
    resolvedDuration = resolveRevealDuration(revealDuration);
  } else if (active && active.revealDuration !== undefined) {
    resolvedDuration = resolveRevealDuration(active.revealDuration);
  } else if (store && typeof store.getState === 'function') {
    const state = store.getState();
    const session = state && typeof state.get === 'function'
      ? state.getIn(['sessions', cleanSessionId])
      : null;
    if (session && session.get('revealDuration') !== undefined) {
      resolvedDuration = resolveRevealDuration(session.get('revealDuration'));
    } else {
      resolvedDuration = resolveRevealDuration();
    }
  } else {
    resolvedDuration = resolveRevealDuration();
  }

  // If revealDuration is configured (> 0) and timerManager has startRevealTimer
  if (resolvedDuration > 0 && timerManager && typeof timerManager.startRevealTimer === 'function') {
    if (active) {
      active.lifecycle = ROUND_LIFECYCLE.RESULTS_REVEALED;
    }

    const timerEntry = timerManager.startRevealTimer(
      cleanSessionId,
      cleanRoundId,
      resolvedDuration,
      store,
      io
    );

    if (active && timerEntry) {
      active.revealTimer = {
        duration: timerEntry.duration,
        startedAt: timerEntry.startedAt,
        expiresAt: timerEntry.expiresAt,
        status: 'revealing'
      };
    }

    // Update Redux store session state with lifecycle
    if (store && typeof store.dispatch === 'function') {
      store.dispatch({
        type: 'SET_ROUND_LIFECYCLE',
        sessionId: cleanSessionId,
        lifecycle: ROUND_LIFECYCLE.RESULTS_REVEALED,
        roundId: cleanRoundId,
        roundIndex: active ? active.roundIndex : undefined,
        finalVote,
        revealTimer: active ? active.revealTimer : null
      });
    }

    return {
      success: true,
      closed: true,
      revealing: true,
      advanced: false,
      sessionId: cleanSessionId,
      roundId: cleanRoundId,
      revealDuration: resolvedDuration
    };
  }

  // Direct advance (Feature 7 mode or revealDuration === 0)
  if (store && typeof store.dispatch === 'function') {
    try {
      store.dispatch({
        type: 'NEXT',
        sessionId: cleanSessionId
      });
    } catch (err) {
      console.error(`[RoundManager] Error dispatching NEXT for session ${cleanSessionId}:`, err);
    }
  }

  return {
    success: true,
    advanced: true,
    closed: true,
    sessionId: cleanSessionId,
    roundId: cleanRoundId
  };
}

/**
 * Authoritatively expires the reveal period and advances to the next round via NEXT.
 * Protects against duplicate expirations and stale callbacks.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.roundId
 * @param {Object} [params.store]
 * @param {Object} [params.timerManager]
 * @param {Object} [params.io]
 * @returns {{ success: boolean, advanced?: boolean, reason?: string, sessionId?: string, roundId?: string }}
 */
export function expireReveal({ sessionId, roundId, store = null, timerManager = null, io = null }) {
  if (!sessionId || !roundId) {
    return { success: false, reason: 'INVALID_ARGUMENTS' };
  }

  const cleanSessionId = sessionId.trim();
  const cleanRoundId = roundId.trim();

  // Validate active round
  const active = activeRounds.get(cleanSessionId);
  if (!active || active.roundId !== cleanRoundId) {
    return {
      success: false,
      reason: 'STALE_ROUND',
      roundId: cleanRoundId,
      activeRoundId: active ? active.roundId : null
    };
  }

  // Guard against duplicate reveal expiration
  if (active.revealExpired) {
    return { success: false, reason: 'ALREADY_EXPIRED', roundId: cleanRoundId };
  }

  active.revealExpired = true;
  active.lifecycle = ROUND_LIFECYCLE.ROUND_CLOSED;

  // Clear any running reveal timer
  if (timerManager && typeof timerManager.clearRevealTimer === 'function') {
    timerManager.clearRevealTimer(cleanSessionId, io);
  }

  // Authoritatively advance tournament round in Redux store
  if (store && typeof store.dispatch === 'function') {
    try {
      store.dispatch({
        type: 'NEXT',
        sessionId: cleanSessionId
      });
    } catch (err) {
      console.error(`[RoundManager] Error dispatching NEXT after reveal for ${cleanSessionId}:`, err);
    }
  }

  return {
    success: true,
    advanced: true,
    sessionId: cleanSessionId,
    roundId: cleanRoundId
  };
}

/**
 * Retrieves the current round lifecycle phase for a session.
 * @param {string} sessionId
 * @returns {string|null} 'VOTING' | 'ROUND_CLOSED' | 'RESULTS_REVEALED' | null
 */
export function getRoundLifecycle(sessionId) {
  if (!sessionId) return null;
  const active = activeRounds.get(sessionId.trim());
  return active ? active.lifecycle : null;
}

/**
 * Retrieves the frozen final vote snapshot for a session's closed round.
 * @param {string} sessionId
 * @returns {Object|null}
 */
export function getRoundFinalVote(sessionId) {
  if (!sessionId) return null;
  const active = activeRounds.get(sessionId.trim());
  return active ? active.finalVote : null;
}

/**
 * Checks whether votes can currently be accepted for the active round.
 * @param {string|Object} params
 * @param {string} [roundIdArg]
 * @returns {boolean}
 */
export function canAcceptVotes(params, roundIdArg = null) {
  let sessionId;
  let roundId = roundIdArg;

  if (typeof params === 'string') {
    sessionId = params;
  } else if (params && typeof params === 'object') {
    sessionId = params.sessionId;
    roundId = params.roundId || roundId;
  }

  if (!sessionId) return true;
  const cleanSessionId = sessionId.trim();
  const active = activeRounds.get(cleanSessionId);
  if (!active) return true;
  if (roundId && active.roundId !== roundId.trim()) return false;
  if (active.closed || isRoundClosed(cleanSessionId, active.roundId)) return false;
  if (active.lifecycle === ROUND_LIFECYCLE.ROUND_CLOSED || active.lifecycle === ROUND_LIFECYCLE.RESULTS_REVEALED) return false;
  return active.lifecycle === ROUND_LIFECYCLE.VOTING;
}

/**
 * Marks current active round for session as finished when session is completed or archived.
 *
 * @param {string} sessionId
 */
export function endSessionRounds(sessionId) {
  if (!sessionId) return;
  const cleanSessionId = sessionId.trim();
  const active = activeRounds.get(cleanSessionId);
  if (active) {
    active.closed = true;
    active.lifecycle = ROUND_LIFECYCLE.ROUND_CLOSED;
    closedRounds.add(`${cleanSessionId}:::${active.roundId}`);
  }
}

/**
 * Clears participation data for a specific round.
 *
 * @param {string} sessionId
 * @param {string} roundId
 */
export function clearRoundData(sessionId, roundId) {
  if (!sessionId || !roundId) return;
  const key = `${sessionId.trim()}:::${roundId.trim()}`;
  submissionsByRound.delete(key);
}

/**
 * Resets all in-memory round tracking, submissions, and idempotency state.
 * Used for test isolation and clean server resets.
 */
export function resetRounds() {
  roundIndexBySession.clear();
  activeRounds.clear();
  closedRounds.clear();
  submissionsByRound.clear();
}

export default {
  ROUND_LIFECYCLE,
  DEFAULT_REVEAL_DURATION,
  MIN_REVEAL_DURATION,
  MAX_REVEAL_DURATION,
  resolveRevealDuration,
  generateRoundId,
  initRound,
  getCurrentRound,
  getCurrentRoundId,
  recordRoundSubmission,
  getRoundSubmissionCount,
  getRoundSubmissions,
  hasAllVotersVoted,
  canCompleteEarly,
  isRoundClosed,
  closeRoundOnce,
  expireReveal,
  getRoundLifecycle,
  getRoundFinalVote,
  canAcceptVotes,
  endSessionRounds,
  clearRoundData,
  resetRounds
};
