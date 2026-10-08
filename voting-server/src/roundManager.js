import crypto from 'crypto';
import { List } from 'immutable';
import { getVoterCount, validateVoterToken, votersByToken, tokensBySession } from './auth/voter.js';
import { isConnected } from './db/connection.js';
import * as repository from './db/repository.js';
import { GRACE_PERIOD_MS } from './constants.js';

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
  RESULTS_REVEALED: 'RESULTS_REVEALED',
  TIE_PENDING: 'TIE_PENDING'
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
 * Set of round IDs whose reveal has already expired.
 * Enforces strict idempotency across duplicate expireReveal callbacks.
 * @type {Set<string>}
 */
const expiredRevealRounds = new Set();

/**
 * Set of unique voter session tokens who submitted a valid vote in a specific round.
 * Maps: `${sessionId}:::${roundId}` -> Set<sessionToken>
 * @type {Map<string, Set<string>>}
 */
export const submissionsByRound = new Map();

/**
 * Frozen eligibility snapshot per round identifier.
 * Maps: `${sessionId}:::${roundId}` -> Array<voterToken>
 * @type {Map<string, Array<string>>}
 */
export const snapshotsByRound = new Map();

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

  const candidates = [...pair];
  const kind = options.kind || (candidates.length > 2 ? 'single_ballot' : 'pairwise');

  const roundId = generateRoundId(cleanSessionId, nextIndex);
  const roundObj = {
    sessionId: cleanSessionId,
    roundId,
    roundIndex: nextIndex,
    candidates,
    pair: candidates.slice(0, 2),
    kind,
    closed: false,
    lifecycle: ROUND_LIFECYCLE.VOTING,
    finalVote: null,
    revealTimer: null,
    revealExpired: false,
    revealDuration: options.revealDuration !== undefined ? options.revealDuration : undefined,
    pendingAction: null,
    createdAt: Date.now()
  };

  activeRounds.set(cleanSessionId, roundObj);
  submissionsByRound.set(`${cleanSessionId}:::${roundId}`, new Set());

  if (options.store && typeof options.store.dispatch === 'function') {
    snapshotRoundEligibility(cleanSessionId, roundId, options.store);
  }

  return roundObj;
}

/**
 * True when the session currently holds an open (not yet closed) round.
 * Used by the timer subscriber to avoid re-initializing a round identity that
 * a ladder advance already created (double inits used to discard identities
 * and leave holes in the persisted round history).
 *
 * @param {string} sessionId
 * @returns {boolean}
 */
export function hasOpenRound(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return false;
  const active = activeRounds.get(sessionId.trim());
  return Boolean(active && !active.closed);
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
      // Do NOT defensively initialize a new round if the session is in RESULTS_REVEALED or TIE_PENDING.
      // A reveal timer is running and expireReveal needs the original round object.
      const sessionLifecycle = session.get('roundLifecycle');
      if (sessionLifecycle === ROUND_LIFECYCLE.RESULTS_REVEALED ||
          sessionLifecycle === ROUND_LIFECYCLE.ROUND_CLOSED ||
          sessionLifecycle === ROUND_LIFECYCLE.TIE_PENDING) {
        return active || null;
      }

      const votingMode = session.get('votingMode');
      const activeCandidates = session.getIn(['vote', 'candidates']) || session.getIn(['vote', 'pair']);
      const candidatesArray = activeCandidates && typeof activeCandidates.toJS === 'function'
        ? activeCandidates.toJS()
        : (Array.isArray(activeCandidates) ? activeCandidates : []);

      if (candidatesArray && candidatesArray.length >= 2) {
        return initRound(cleanSessionId, candidatesArray, {
          kind: votingMode === 'single_ballot' ? 'single_ballot' : 'pairwise',
          store
        });
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
 * Evaluates snapshot relative eligibility and quorum for a round.
 *
 * @param {Object} paramsOrSnapshot
 * @param {Array|Set|Object} [presenceArg]
 * @param {Array|Set|Object} [submittedTokensArg]
 * @param {number} [nowArg]
 * @param {number} [graceMsArg]
 * @returns {{ hasQuorum: boolean, eligibleSnapshotVoters: Array, activeSnapshotVoters: Array, activeCount: number, votedCount: number }}
 */
export function computeEligibility(paramsOrSnapshot, presenceArg, submittedTokensArg, nowArg, graceMsArg) {
  let snapshot;
  let presence;
  let submittedTokens;
  let now;
  let graceMs;
  let sessionId;
  let roundId;

  if (
    paramsOrSnapshot &&
    typeof paramsOrSnapshot === 'object' &&
    !Array.isArray(paramsOrSnapshot) &&
    !(paramsOrSnapshot instanceof Set) &&
    typeof paramsOrSnapshot.has !== 'function' &&
    ('snapshot' in paramsOrSnapshot || 'presence' in paramsOrSnapshot || 'submittedTokens' in paramsOrSnapshot)
  ) {
    ({ snapshot, presence, submittedTokens, now, graceMs, sessionId, roundId } = paramsOrSnapshot);
  } else {
    snapshot = paramsOrSnapshot;
    presence = presenceArg;
    submittedTokens = submittedTokensArg;
    now = nowArg;
    graceMs = graceMsArg;
  }

  const effectiveGraceMs = typeof graceMs === 'number' ? graceMs : GRACE_PERIOD_MS;
  const effectiveNow = typeof now === 'number' ? now : Number(process.hrtime.bigint() / 1000000n);

  let rawSnapshot = [];
  if (Array.isArray(snapshot)) {
    rawSnapshot = snapshot;
  } else if (snapshot && typeof snapshot.toJS === 'function') {
    const js = snapshot.toJS();
    rawSnapshot = Array.isArray(js) ? js : Object.keys(js);
  } else if (snapshot && typeof snapshot[Symbol.iterator] === 'function') {
    rawSnapshot = Array.from(snapshot);
  } else if (snapshot && typeof snapshot === 'object') {
    rawSnapshot = Object.keys(snapshot);
  }

  const submittedSet = new Set();
  if (Array.isArray(submittedTokens)) {
    for (const t of submittedTokens) submittedSet.add(t);
  } else if (submittedTokens && typeof submittedTokens.toJS === 'function') {
    const js = submittedTokens.toJS();
    if (Array.isArray(js)) {
      for (const t of js) submittedSet.add(t);
    } else if (typeof js === 'object') {
      for (const k of Object.keys(js)) submittedSet.add(k);
    }
  } else if (submittedTokens && typeof submittedTokens[Symbol.iterator] === 'function') {
    for (const t of submittedTokens) submittedSet.add(t);
  }

  const checkVoted = (key) => {
    return submittedSet.has(key);
  };

  const getPresenceRecord = (key) => {
    if (!presence) return null;
    if (typeof presence.voter === 'function') {
      const rec = presence.voter(key);
      if (rec) return rec;
    }
    if (presence.presence && typeof presence.presence.get === 'function') {
      const rec = presence.presence.get(key);
      if (rec) return rec;
    }
    if (typeof presence.get === 'function') {
      const rec = presence.get(key);
      if (rec) return rec;
    }
    return null;
  };

  const activeSnapshotVoters = [];
  const eligibleSnapshotVoters = [...rawSnapshot];

  for (const voterKey of eligibleSnapshotVoters) {
    const hasVoted = checkVoted(voterKey);
    const pRec = getPresenceRecord(voterKey);

    let isConnected = false;
    let disconnectedAt = null;

    if (pRec) {
      if (typeof pRec.get === 'function') {
        isConnected = Boolean(pRec.get('connected'));
        disconnectedAt = pRec.get('disconnectedAt');
      } else {
        isConnected = Boolean(pRec.connected);
        disconnectedAt = pRec.disconnectedAt;
      }
    }

    let isInsideGrace = false;
    if (!isConnected && typeof disconnectedAt === 'number') {
      const elapsed = effectiveNow - disconnectedAt;
      if (elapsed <= effectiveGraceMs) {
        isInsideGrace = true;
      }
    }

    const isActive = isConnected || isInsideGrace || hasVoted;

    if (isActive) {
      activeSnapshotVoters.push({
        voterKey,
        hasVoted,
        isConnected,
        isInsideGrace
      });
    }
  }

  const hasQuorum =
    activeSnapshotVoters.length >= 1 &&
    activeSnapshotVoters.every((v) => v.hasVoted);

  return {
    hasQuorum,
    eligibleSnapshotVoters,
    activeSnapshotVoters,
    activeCount: activeSnapshotVoters.length,
    votedCount: activeSnapshotVoters.filter((v) => v.hasVoted).length
  };
}

/**
 * Determines whether the active round can complete early authoritatively.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.roundId
 * @param {Object} [params.presence]
 * @param {Array|Set} [params.snapshot]
 * @param {number} [params.now]
 * @param {number} [params.graceMs]
 * @param {number} [params.minEligibleVoters]
 * @param {Object} [params.store]
 * @returns {boolean}
 */
export function canCompleteEarly({
  sessionId,
  roundId,
  presence = null,
  snapshot = null,
  now = undefined,
  graceMs = undefined,
  minEligibleVoters = undefined,
  store = null
} = {}) {
  if (!sessionId || !roundId) return false;
  const cleanSessionId = sessionId.trim();
  const cleanRoundId = roundId.trim();
  const roundKey = `${cleanSessionId}:::${cleanRoundId}`;

  let storeHasPresence = false;
  if (store && typeof store.getState === 'function') {
    const s = store.getState()?.getIn ? store.getState().getIn(['sessions', cleanSessionId]) : null;
    const p = s?.get ? s.get('presence') : null;
    if (p && p.size > 0) {
      storeHasPresence = true;
    }
  }

  if (!presence && !storeHasPresence) {
    const eligibleCount = getVoterCount(cleanSessionId);
    const minFloor = typeof minEligibleVoters === 'number' ? minEligibleVoters : 2;
    if (eligibleCount < minFloor) {
      return false;
    }
    return hasAllVotersVoted({
      sessionId: cleanSessionId,
      roundId: cleanRoundId,
      eligibleVoterCount: eligibleCount
    });
  }

  let resolvedSnapshot = snapshot;
  if (!resolvedSnapshot) {
    if (snapshotsByRound.has(roundKey)) {
      resolvedSnapshot = snapshotsByRound.get(roundKey);
    } else if (store && typeof store.getState === 'function') {
      const state = store.getState();
      const session = state?.getIn ? state.getIn(['sessions', cleanSessionId]) : null;
      const snap = session?.getIn ? session.getIn(['snapshots', cleanRoundId]) : null;
      if (snap) {
        const keys = snap.get('eligibleVoterKeys');
        resolvedSnapshot = keys ? (keys.toJS ? keys.toJS() : Array.from(keys)) : [];
        snapshotsByRound.set(roundKey, resolvedSnapshot);
      }
    }
  }

  if (!resolvedSnapshot) {
    console.error(`[RoundManager] Missing snapshot for round ${roundKey}. Ordering violation (AC-9); cannot complete early.`);
    return false;
  }

  let resolvedPresence = presence;
  if (!resolvedPresence && store && typeof store.getState === 'function') {
    const state = store.getState();
    const session = state?.getIn ? state.getIn(['sessions', cleanSessionId]) : null;
    resolvedPresence = session?.get ? session.get('presence') : null;
  }

  const submitted = submissionsByRound.get(roundKey) || new Set();

  const result = computeEligibility({
    snapshot: resolvedSnapshot,
    presence: resolvedPresence,
    submittedTokens: submitted,
    now,
    graceMs,
    sessionId: cleanSessionId,
    roundId: cleanRoundId
  });

  return result.hasQuorum;
}

/**
 * Freezes and returns the round eligibility snapshot.
 *
 * @param {string} sessionId
 * @param {string} roundId
 * @param {Object} [store]
 * @param {Object} [options]
 * @returns {Array<string>|null}
 */
export function snapshotRoundEligibility(sessionId, roundId, store = null, options = {}) {
  if (!sessionId || !roundId) return null;
  const cleanSessionId = sessionId.trim();
  const cleanRoundId = roundId.trim();
  const key = `${cleanSessionId}:::${cleanRoundId}`;

  if (snapshotsByRound.has(key)) {
    return snapshotsByRound.get(key);
  }

  // Pre-seed immediately to guarantee re-entrancy safety during store dispatches
  snapshotsByRound.set(key, []);

  if (store && typeof store.dispatch === 'function') {
    store.dispatch({
      type: 'SNAPSHOT_ROUND_ELIGIBILITY',
      sessionId: cleanSessionId,
      roundId: cleanRoundId,
      timestamp: Date.now()
    });
  }

  let snapKeys = [];
  if (store && typeof store.getState === 'function') {
    const session = store.getState()?.getIn ? store.getState().getIn(['sessions', cleanSessionId]) : null;
    const snap = session?.getIn ? session.getIn(['snapshots', cleanRoundId]) : null;
    if (snap && snap.get('eligibleVoterKeys')) {
      const k = snap.get('eligibleVoterKeys');
      snapKeys = k.toJS ? k.toJS() : Array.from(k);
    }
  }

  snapshotsByRound.set(key, snapKeys);
  return snapKeys;
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
/**
 * Helper shared with closeRoundOnce's post NEXT derivation: who advanced.
 * Reads the authoritative winners from the frozen tally using the same
 * logic as core.getWinners, and returns null when the tournament just
 * concluded (the winner field is already set by NEXT).
 *
 * @param {Object} tally - Frozen tally from the closed round
 * @param {Array<string>} candidates - The two candidates that faced off
 * @param {string|null} postNextWinner - Winner observed in the store after NEXT, if any
 * @returns {Array<string>|null}
 */
function resolveAdvanced(tally, candidates, postNextWinner) {
  if (postNextWinner) return null;
  const [a, b] = candidates;
  const aVotes = typeof tally[a] === 'number' ? tally[a] : 0;
  const bVotes = typeof tally[b] === 'number' ? tally[b] : 0;
  if (aVotes > bVotes) return [a];
  if (bVotes > aVotes) return [b];
  return candidates.length === 2 ? [a, b] : [];
}

/**
 * Derives a frozen round snapshot from the session and finalVote.
 *
 * Spec 0003 value sourcing: `advanced` is derived from the post NEXT session
 * state, not from a speculative entry count. When the post NEXT store state
 * is not available (pure unit tests, recovery replay), callers may pass
 * `prospectiveAdvanced` which must be precomputed with the same resolveAdvanced
 * contract; the derivation inside this function remains purely mechanical.
 *
 * @param {Map|Object} session - Immutable session map or object
 * @param {Object} [active] - Active round descriptor
 * @param {Object} finalVote - Frozen final vote { pair, tally, closedAt }
 * @param {Object} [options]
 * @param {string|null} [options.postNextWinner] - Winner observed in the store after NEXT; non null marks the final round
 * @param {Array<string>|null} [options.prospectiveAdvanced] - Explicit advanced list when no post NEXT state exists (unit tests, recovery)
 * @returns {Object}
 */
export function deriveRoundSnapshot(session, active, finalVote, options = {}) {
  const roundIndex = (active && typeof active.roundIndex === 'number')
    ? active.roundIndex
    : (session && typeof session.get === 'function' ? (session.get('roundIndex') || 1) : 1);
  const votingMode = (session && typeof session.get === 'function')
    ? session.get('votingMode')
    : (active && active.kind ? active.kind : 'pairwise');
  const kind = (options.kind)
    ? options.kind
    : (votingMode === 'single_ballot' || (active && active.kind === 'single_ballot') ? 'single_ballot' : 'pairwise');
  const candidates = finalVote && (Array.isArray(finalVote.candidates) || Array.isArray(finalVote.pair))
    ? (finalVote.candidates || finalVote.pair)
    : (active && Array.isArray(active.candidates) ? active.candidates : (active && Array.isArray(active.pair) ? active.pair : []));
  const tally = finalVote && typeof finalVote.tally === 'object' ? finalVote.tally : {};
  const totalVotes = Object.values(tally).reduce((sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0);
  const closedAt = finalVote && finalVote.closedAt ? new Date(finalVote.closedAt) : new Date();

  let resolution = options.resolution;
  let advanced = options.advanced !== undefined ? options.advanced : null;

  if (!resolution) {
    if (totalVotes === 0) {
      resolution = (session && typeof session.get === 'function' && (session.get('zeroVoteCount') || 0) >= 1)
        ? 'no_result'
        : 'zero_vote_replay';
      advanced = null;
    } else {
      let maxVotes = -1;
      let leaders = [];
      candidates.forEach(c => {
        const v = typeof tally[c] === 'number' ? tally[c] : 0;
        if (v > maxVotes) {
          maxVotes = v;
          leaders = [c];
        } else if (v === maxVotes) {
          leaders.push(c);
        }
      });

      if (leaders.length === 1) {
        resolution = 'majority_win';
        if (options.postNextWinner !== undefined) {
          advanced = options.postNextWinner ? null : leaders;
        } else {
          advanced = kind === 'single_ballot'
            ? null
            : resolveAdvanced(tally, candidates, session && typeof session.get === 'function' ? session.get('winner') : null);
        }
      } else {
        const tieCount = (session && typeof session.get === 'function') ? (session.get('tieCount') || 0) : 0;
        resolution = (kind === 'single_ballot' && tieCount === 0) ? 'runoff' : 'tie_advance';
        advanced = leaders;
      }
    }
  }

  if (advanced === null && options.postNextWinner === null && resolution === 'majority_win' && kind === 'pairwise') {
    advanced = resolveAdvanced(tally, candidates, null);
  }

  return {
    roundIndex,
    kind,
    candidates,
    tally,
    totalVotes,
    closedAt,
    resolution,
    advanced
  };
}

/**
 * Authoritatively closes a round for a session exactly once.
 * Disarms active voting timers, freezes the final vote tally snapshot,
 * dispatches APPEND_ROUND_RESULT and pushes round to Result, and either
 * initiates the reveal period or directly advances the tournament.
 *
 * @param {Object} params
 * @param {string} params.sessionId - Target session ID
 * @param {string} params.roundId - Target round ID
 * @param {Object} [params.store] - Redux store to dispatch NEXT or SET_ROUND_LIFECYCLE
 * @param {Object} [params.timerManager] - TimerManager to stop timer / start reveal timer
 * @param {Object} [params.io] - Optional Socket.io server instance
 * @param {number} [params.revealDuration] - Optional reveal duration override
 * @returns {{ success: boolean, advanced?: boolean, closed?: boolean, revealing?: boolean, reason?: string, roundId?: string, sessionId?: string, revealDuration?: number, roundSnapshot?: Object }}
 */
export function closeRoundOnce({
  sessionId,
  roundId,
  store = null,
  timerManager = null,
  io = null,
  revealDuration = undefined,
  isTimerExpiry = false,
  presence = null,
  snapshot = null,
  now = undefined,
  graceMs = undefined
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

  // Zero active voters guard (AC-7)
  // Early close is inhibited when no active snapshot voter exists.
  // Timer expiry is the natural close and is exempt (allows abandoned rooms to advance or terminate per tie ladder).
  let resolvedSnapshot = snapshot;
  if (!resolvedSnapshot) {
    if (snapshotsByRound.has(key)) {
      resolvedSnapshot = snapshotsByRound.get(key);
    } else if (store && typeof store.getState === 'function') {
      const s = store.getState()?.getIn ? store.getState().getIn(['sessions', cleanSessionId]) : null;
      const snap = s?.getIn ? s.getIn(['snapshots', cleanRoundId]) : null;
      if (snap) {
        const keys = snap.get('eligibleVoterKeys');
        resolvedSnapshot = keys ? (keys.toJS ? keys.toJS() : Array.from(keys)) : [];
      }
    }
  }

  let resolvedPresence = presence;
  if (!resolvedPresence && store && typeof store.getState === 'function') {
    const s = store.getState()?.getIn ? store.getState().getIn(['sessions', cleanSessionId]) : null;
    resolvedPresence = s?.get ? s.get('presence') : null;
  }

  const submitted = submissionsByRound.get(key) || new Set();
  const roundSubmissionsCount = submitted.size;

  let preCheckTotalVotes = 0;
  if (store && typeof store.getState === 'function') {
    const s = store.getState()?.getIn ? store.getState().getIn(['sessions', cleanSessionId]) : null;
    const voteState = s?.get ? s.get('vote') : null;
    const tally = voteState?.get ? voteState.get('tally') : null;
    if (tally) {
      const tallyObj = typeof tally.toJS === 'function' ? tally.toJS() : tally;
      preCheckTotalVotes = Object.values(tallyObj).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
    }
  }

  const effectiveTimerExpiry = isTimerExpiry !== false && (isTimerExpiry === true || Boolean(timerManager));

  if (!effectiveTimerExpiry && resolvedSnapshot && resolvedSnapshot.length > 0) {
    const eligibility = computeEligibility({
      snapshot: resolvedSnapshot,
      presence: resolvedPresence,
      submittedTokens: submitted,
      now,
      graceMs
    });
    if (eligibility.activeCount === 0) {
      return {
        success: false,
        reason: 'ZERO_ACTIVE_VOTERS',
        roundId: cleanRoundId
      };
    }
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

  // Extract session and frozen vote tally from store
  let finalVote = null;
  let roundSnapshot = null;
  let sessionMeta = null;
  let session = null;
  let isSingleBallot = false;
  let totalVotes = 0;
  let tieCount = 0;
  let zeroVoteCount = 0;
  let activeCandidates = [];
  let activeTally = {};

  if (store && typeof store.getState === 'function') {
    const state = store.getState();
    session = state && typeof state.get === 'function'
      ? state.getIn(['sessions', cleanSessionId])
      : null;
    if (session) {
      isSingleBallot = session.get('votingMode') === 'single_ballot';
      tieCount = session.get('tieCount') || 0;
      zeroVoteCount = session.get('zeroVoteCount') || 0;

      const voteState = session.get('vote');
      const rawCandidates = active && active.candidates
        ? active.candidates
        : (voteState ? (voteState.get('candidates') || voteState.get('pair')) : (active ? active.pair : []));
      activeCandidates = Array.isArray(rawCandidates)
        ? rawCandidates
        : (rawCandidates && typeof rawCandidates.toJS === 'function' ? rawCandidates.toJS() : []);

      activeTally = voteState && voteState.get('tally') ? voteState.get('tally').toJS() : {};
      finalVote = {
        candidates: activeCandidates,
        pair: activeCandidates.slice(0, 2),
        tally: activeTally,
        closedAt: Date.now()
      };
      if (active) {
        active.finalVote = finalVote;
      }

      totalVotes = activeCandidates.reduce((sum, c) => sum + (typeof activeTally[c] === 'number' ? activeTally[c] : 0), 0);

      const title = session.get('title') || '';
      const rawEntries = session.get('entries');
      const entries = List.isList(rawEntries)
        ? rawEntries.toJS()
        : (Array.isArray(rawEntries) ? rawEntries : []);
      sessionMeta = { title, entries };
    }
  }

  // Opens the authoritative TIE_PENDING admin window for a second consecutive
  // tie. Shared by the voted tie path and the zero vote tournament path (an
  // empty round is a 0:0 tie between the active pair).
  const enterTiePendingWindow = (leaders, nextTieCount) => {
    if (active) {
      active.lifecycle = ROUND_LIFECYCLE.TIE_PENDING;
      active.finalVote = finalVote;
    }

    const tiePendingData = {
      roundId: cleanRoundId,
      candidates: leaders,
      duration: 30,
      startedAt: Date.now(),
      expiresAt: Date.now() + 30000
    };

    // One atomic dispatch: the lifecycle flip, the tie ladder counter bump,
    // and the tie pending data land in a single store transition. Dispatching
    // the counter first used to wake the timer subscriber while the lifecycle
    // still read VOTING, which armed a stray round identity and a new voting
    // timer in the middle of the admin window (holes and lost tallies in the
    // persisted rounds ledger).
    if (store && typeof store.dispatch === 'function') {
      store.dispatch({
        type: 'SET_ROUND_LIFECYCLE',
        sessionId: cleanSessionId,
        lifecycle: ROUND_LIFECYCLE.TIE_PENDING,
        roundId: cleanRoundId,
        roundIndex: active ? active.roundIndex : undefined,
        tieCount: nextTieCount,
        tiePending: tiePendingData,
        finalVote
      });
    }

    if (timerManager && typeof timerManager.startTiePendingTimer === 'function') {
      timerManager.startTiePendingTimer(cleanSessionId, cleanRoundId, 30, store, io);
    }

    if (io && typeof io.to === 'function') {
      io.to(`session:${cleanSessionId}`).emit('tie_pending', {
        sessionId: cleanSessionId,
        roundId: cleanRoundId,
        candidates: leaders,
        duration: 30,
        expiresAt: tiePendingData.expiresAt
      });
    }

    return {
      success: true,
      closed: true,
      tiePending: true,
      sessionId: cleanSessionId,
      roundId: cleanRoundId,
      candidates: leaders
    };
  };

  // Evaluate tie ladder outcome
  let resolution = 'majority_win';
  let advanced = null;
  let pendingAction = null;

  if (totalVotes === 0) {
    if (isSingleBallot) {
      // AC-4: Zero vote round in single ballot mode
      if (zeroVoteCount === 0) {
        resolution = 'zero_vote_replay';
        advanced = null;
        pendingAction = { type: 'REPLAY_ZERO_VOTE', candidates: activeCandidates };
      } else {
        resolution = 'no_result';
        advanced = null;
        pendingAction = { type: 'TERMINATE_NO_RESULT' };
      }
    } else {
      // Tournament mode with 0 votes: an empty round is a 0:0 tie between the
      // active pair, so it travels the same tie ladder as a voted tie. Sending
      // it through core.next with an empty tally requeues the same pair
      // forever, which used to spin unbounded tie_advance snapshots.
      const tieCandidates = activeCandidates.slice(0, 2);
      if (zeroVoteCount >= 1) {
        // The ladder already ran once for this run (rematch armed, or a window
        // resolved) and the round is STILL empty: terminate as no_result so a
        // dead session cannot cycle rematch and admin windows forever.
        resolution = 'no_result';
        advanced = null;
        pendingAction = { type: 'TERMINATE_NO_RESULT' };
      } else if (tieCount >= 1) {
        // AC-6: second consecutive tie (this round counts as one) opens the
        // admin window with the active pair as the tied leaders.
        return enterTiePendingWindow(tieCandidates, tieCount + 1);
      } else {
        // First tie: requeue the tied pair for an immediate rematch. The
        // reducer counts this empty round in zeroVoteCount so a follow up
        // empty round terminates instead of looping.
        resolution = 'tie_advance';
        advanced = tieCandidates;
        pendingAction = { type: 'START_REMATCH', tiedCandidates: tieCandidates, emptyRound: true };
      }
    }
  } else {
    // Plurality evaluation
    let maxVotes = -1;
    let leaders = [];
    for (const c of activeCandidates) {
      const v = typeof activeTally[c] === 'number' ? activeTally[c] : 0;
      if (v > maxVotes) {
        maxVotes = v;
        leaders = [c];
      } else if (v === maxVotes) {
        leaders.push(c);
      }
    }

    if (leaders.length === 1) {
      // Decisive winner
      resolution = 'majority_win';
      if (isSingleBallot) {
        advanced = null;
        pendingAction = { type: 'COMPLETE_SINGLE_BALLOT', winner: leaders[0] };
      } else {
        advanced = resolveAdvanced(activeTally, activeCandidates, null);
        pendingAction = { type: 'NEXT_TOURNAMENT' };
      }
    } else {
      // Tie for first place
      if (tieCount === 0) {
        // AC-5: First tie
        if (isSingleBallot) {
          resolution = 'runoff';
          advanced = leaders;
          pendingAction = { type: 'START_RUNOFF', tiedCandidates: leaders };
        } else {
          // AC-5: Tournament mode requeues the tied pair for an immediate
          // rematch through the ladder. The rematch round uses the same two
          // candidates; the queue is untouched. On a second consecutive tie
          // the round below enters TIE_PENDING for the admin window.
          resolution = 'tie_advance';
          advanced = leaders;
          pendingAction = { type: 'START_REMATCH', tiedCandidates: leaders };
        }
      } else {
        // AC-6: Second consecutive tie -> enter TIE_PENDING. The second tie
        // itself counts, so a fresh ladder can never start from a stale count.
        return enterTiePendingWindow(leaders, tieCount + 1);
      }
    }
  }

  // Derive snapshot
  roundSnapshot = deriveRoundSnapshot(session, active, finalVote, {
    kind: isSingleBallot ? 'single_ballot' : 'pairwise',
    resolution,
    advanced
  });

  if (active) {
    active.roundSnapshot = roundSnapshot;
    active.pendingAction = pendingAction;
  }

  // Resolve reveal duration:
  let resolvedDuration = 0;
  if (revealDuration !== undefined) {
    resolvedDuration = resolveRevealDuration(revealDuration);
  } else if (active && active.revealDuration !== undefined) {
    resolvedDuration = resolveRevealDuration(active.revealDuration);
  } else if (session && session.get('revealDuration') !== undefined) {
    resolvedDuration = resolveRevealDuration(session.get('revealDuration'));
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

      if (roundSnapshot) {
        store.dispatch({
          type: 'APPEND_ROUND_RESULT',
          sessionId: cleanSessionId,
          round: roundSnapshot
        });
      }
    }

    if (isConnected() && roundSnapshot && sessionMeta) {
      repository.pushRoundToResult(cleanSessionId, roundSnapshot, sessionMeta).catch(err => {
        console.error(`[RoundManager] Failed to persist round snapshot for "${cleanSessionId}":`, err.message);
      });
    }

    return {
      success: true,
      closed: true,
      revealing: true,
      advanced: false,
      sessionId: cleanSessionId,
      roundId: cleanRoundId,
      revealDuration: resolvedDuration,
      roundSnapshot
    };
  }

  // Direct advance (revealDuration === 0)
  executePendingRoundAdvance({
    sessionId: cleanSessionId,
    roundId: cleanRoundId,
    pendingAction,
    roundSnapshot,
    session,
    active,
    finalVote,
    store,
    timerManager,
    io
  });

  return {
    success: true,
    advanced: true,
    closed: true,
    sessionId: cleanSessionId,
    roundId: cleanRoundId,
    roundSnapshot
  };
}

/**
 * Executes round advancement based on pendingAction.
 * Shared between direct advance (revealDuration === 0) and expireReveal.
 */
export function executePendingRoundAdvance({
  sessionId,
  roundId,
  pendingAction,
  roundSnapshot,
  session,
  active,
  finalVote,
  store,
  timerManager,
  io
}) {
  if (!store || typeof store.dispatch !== 'function') return;

  const actionType = pendingAction ? pendingAction.type : 'NEXT_TOURNAMENT';

  // Single round identity owner: any branch that starts a new matchup
  // initializes the round identity BEFORE the store dispatch, so the store
  // subscriber (timer onStateChange) sees an already open round and never
  // creates a second, discarded identity for the same matchup.
  if (actionType === 'REPLAY_ZERO_VOTE' || actionType === 'START_RUNOFF' || actionType === 'START_REMATCH') {
    const candidatesForIdentity = actionType === 'REPLAY_ZERO_VOTE'
      ? (pendingAction.candidates || [])
      : (pendingAction.tiedCandidates || []);
    if (candidatesForIdentity.length >= 2) {
      initRound(sessionId, candidatesForIdentity, {
        kind: actionType === 'START_REMATCH' ? 'pairwise' : (active && active.kind ? active.kind : 'single_ballot'),
        store
      });
    }
  }

  if (actionType === 'COMPLETE_SINGLE_BALLOT') {
    const winner = pendingAction.winner;
    store.dispatch({
      type: 'RESOLVE_TIE',
      sessionId,
      roundId,
      winner,
      resolution: 'majority_win'
    });
    const correctedSnapshot = { ...roundSnapshot, advanced: null };
    const currentRounds = store.getState().getIn(['sessions', sessionId, 'rounds']) || List();
    const alreadyAppended = currentRounds.some(r => r.get('roundIndex') === correctedSnapshot.roundIndex);
    if (alreadyAppended) {
      store.dispatch({
        type: 'CORRECT_ROUND_RESULT',
        sessionId,
        roundIndex: correctedSnapshot.roundIndex,
        round: correctedSnapshot
      });
    } else {
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId,
        round: correctedSnapshot
      });
    }
    if (isConnected()) {
      const title = session ? session.get('title') : '';
      const rawEntries = session ? session.get('entries') : [];
      const entries = List.isList(rawEntries) ? rawEntries.toJS() : (Array.isArray(rawEntries) ? rawEntries : []);
      repository.pushRoundToResult(sessionId, correctedSnapshot, { title, entries }).catch(err => {
        console.error(`[RoundManager] Failed to persist round snapshot for "${sessionId}":`, err.message);
      });
      // Completion persistence for a decisive single ballot finish is owned by
      // the store subscriber's status transition (open to completed), so a
      // Result document is written exactly once from one place.
    }
    // Re-arm the next round identity so a fresh matchup on the same session
    // id (a new START_SESSION after completion) begins a new round rather
    // than reusing this closed round id.
    const rearmCandidates = session ? session.get('entries') : null;
    const rearmList = rearmCandidates && typeof rearmCandidates.toJS === 'function'
      ? rearmCandidates.toJS()
      : (Array.isArray(rearmCandidates) ? rearmCandidates : []);
    if (rearmList.length >= 2) {
      initRound(sessionId, rearmList, { kind: 'single_ballot', store });
    }
  } else if (actionType === 'TERMINATE_NO_RESULT') {
    store.dispatch({
      type: 'TERMINATE_NO_RESULT',
      sessionId,
      roundId
    });
    const correctedSnapshot = { ...roundSnapshot, advanced: null, resolution: 'no_result' };
    const currentRounds = store.getState().getIn(['sessions', sessionId, 'rounds']) || List();
    const alreadyAppended = currentRounds.some(r => r.get('roundIndex') === correctedSnapshot.roundIndex);
    if (alreadyAppended) {
      store.dispatch({
        type: 'CORRECT_ROUND_RESULT',
        sessionId,
        roundIndex: correctedSnapshot.roundIndex,
        round: correctedSnapshot
      });
    } else {
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId,
        round: correctedSnapshot
      });
    }
    if (isConnected()) {
      const title = session ? session.get('title') : '';
      const rawEntries = session ? session.get('entries') : [];
      const entries = List.isList(rawEntries) ? rawEntries.toJS() : (Array.isArray(rawEntries) ? rawEntries : []);
      repository.pushRoundToResult(sessionId, correctedSnapshot, { title, entries }).catch(err => {
        console.error(`[RoundManager] Failed to persist round snapshot for "${sessionId}":`, err.message);
      });
      const noResultType = session ? (session.get('type') || 'public') : 'public';
      const noResultPublishRaw = session ? session.get('publishResultsPublicly') : undefined;
      repository.saveResult({
        sessionId,
        title,
        entries,
        winner: null,
        completedAt: new Date(),
        type: noResultType,
        publishResultsPublicly: noResultPublishRaw !== undefined
          ? Boolean(noResultPublishRaw)
          : noResultType !== 'secured'
      }).catch(err => {
        console.error(`[RoundManager] Failed to save no_result result for "${sessionId}":`, err.message);
      });
    }
  } else if (actionType === 'REPLAY_ZERO_VOTE') {
    store.dispatch({
      type: 'REPLAY_ZERO_VOTE',
      sessionId,
      roundId
    });
    const currentRounds = store.getState().getIn(['sessions', sessionId, 'rounds']) || List();
    const alreadyAppended = currentRounds.some(r => r.get('roundIndex') === roundSnapshot.roundIndex);
    if (!alreadyAppended) {
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId,
        round: roundSnapshot
      });
    }
    if (isConnected()) {
      const title = session ? session.get('title') : '';
      const rawEntries = session ? session.get('entries') : [];
      const entries = List.isList(rawEntries) ? rawEntries.toJS() : (Array.isArray(rawEntries) ? rawEntries : []);
      repository.pushRoundToResult(sessionId, roundSnapshot, { title, entries }).catch(err => {
        console.error(`[RoundManager] Failed to persist round snapshot for "${sessionId}":`, err.message);
      });
    }
    const candidates = pendingAction.candidates || [];
    if (candidates.length >= 2 && !hasOpenRound(sessionId)) {
      initRound(sessionId, candidates, {
        kind: active ? active.kind : 'single_ballot',
        store
      });
    }
    const currentRoundId = getCurrentRoundId(sessionId, store);
    if (currentRoundId) {
      snapshotRoundEligibility(sessionId, currentRoundId, store);
    }
    if (timerManager && typeof timerManager.startTimer === 'function') {
      const duration = session ? session.get('timerDuration') : undefined;
      timerManager.startTimer(sessionId, duration, store, io);
    }
  } else if (actionType === 'START_RUNOFF') {
    const tiedCandidates = pendingAction.tiedCandidates || [];
    store.dispatch({
      type: 'START_RUNOFF',
      sessionId,
      roundId,
      tiedCandidates
    });
    const currentRounds = store.getState().getIn(['sessions', sessionId, 'rounds']) || List();
    const alreadyAppended = currentRounds.some(r => r.get('roundIndex') === roundSnapshot.roundIndex);
    if (!alreadyAppended) {
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId,
        round: roundSnapshot
      });
    }
    if (isConnected()) {
      const title = session ? session.get('title') : '';
      const rawEntries = session ? session.get('entries') : [];
      const entries = List.isList(rawEntries) ? rawEntries.toJS() : (Array.isArray(rawEntries) ? rawEntries : []);
      repository.pushRoundToResult(sessionId, roundSnapshot, { title, entries }).catch(err => {
        console.error(`[RoundManager] Failed to persist round snapshot for "${sessionId}":`, err.message);
      });
    }
    if (tiedCandidates.length >= 2 && !hasOpenRound(sessionId)) {
      initRound(sessionId, tiedCandidates, {
        kind: 'single_ballot',
        store
      });
    }
    const currentRoundId = getCurrentRoundId(sessionId, store);
    if (currentRoundId) {
      snapshotRoundEligibility(sessionId, currentRoundId, store);
    }
    if (timerManager && typeof timerManager.startTimer === 'function') {
      const duration = session ? session.get('timerDuration') : undefined;
      timerManager.startTimer(sessionId, duration, store, io);
    }
  } else if (actionType === 'START_REMATCH') {
    const tiedCandidates = pendingAction.tiedCandidates || [];
    store.dispatch({
      type: 'START_RUNOFF',
      sessionId,
      roundId,
      tiedCandidates,
      // Tournament rematches started by an EMPTY round must count that empty
      // round in zeroVoteCount so a dead session terminates as no_result
      // instead of cycling rematches forever. Voted rematches reset the
      // counter, exactly as before.
      emptyRound: pendingAction.emptyRound === true
    });
    const currentRounds = store.getState().getIn(['sessions', sessionId, 'rounds']) || List();
    const alreadyAppended = currentRounds.some(r => r.get('roundIndex') === roundSnapshot.roundIndex);
    if (!alreadyAppended) {
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId,
        round: roundSnapshot
      });
    }
    if (isConnected()) {
      const title = session ? session.get('title') : '';
      const rawEntries = session ? session.get('entries') : [];
      const entries = List.isList(rawEntries) ? rawEntries.toJS() : (Array.isArray(rawEntries) ? rawEntries : []);
      repository.pushRoundToResult(sessionId, roundSnapshot, { title, entries }).catch(err => {
        console.error(`[RoundManager] Failed to persist round snapshot for "${sessionId}":`, err.message);
      });
    }
    if (tiedCandidates.length >= 2 && !hasOpenRound(sessionId)) {
      initRound(sessionId, tiedCandidates, {
        kind: 'pairwise',
        store
      });
    }
    const currentRoundId = getCurrentRoundId(sessionId, store);
    if (currentRoundId) {
      snapshotRoundEligibility(sessionId, currentRoundId, store);
    }
    if (timerManager && typeof timerManager.startTimer === 'function') {
      const duration = session ? session.get('timerDuration') : undefined;
      timerManager.startTimer(sessionId, duration, store, io);
    }
  } else {
    // NEXT_TOURNAMENT
    store.dispatch({
      type: 'NEXT',
      sessionId
    });
    const postState = store.getState();
    const postSession = postState && typeof postState.get === 'function'
      ? postState.getIn(['sessions', sessionId])
      : null;
    const postNextWinner = postSession ? (postSession.get('winner') || null) : null;
    const corrected = deriveRoundSnapshot(
      postSession || null,
      active,
      finalVote,
      { postNextWinner }
    );
    if (active) {
      active.roundSnapshot = corrected;
    }
    const currentRounds = postSession ? postSession.get('rounds') : null;
    const isAlreadyAppended = currentRounds && currentRounds.some(r => r.get('roundIndex') === corrected.roundIndex);
    if (isAlreadyAppended) {
      store.dispatch({
        type: 'CORRECT_ROUND_RESULT',
        sessionId,
        roundIndex: corrected.roundIndex,
        round: corrected
      });
    } else {
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId,
        round: corrected
      });
    }
    if (isConnected()) {
      const title = session ? session.get('title') : '';
      const rawEntries = session ? session.get('entries') : [];
      const entries = List.isList(rawEntries)
        ? rawEntries.toJS()
        : (Array.isArray(rawEntries) ? rawEntries : []);
      repository.pushRoundToResult(sessionId, corrected, { title, entries }).catch(err => {
        console.error(`[RoundManager] Failed to persist round snapshot for "${sessionId}":`, err.message);
      });
    }
  }
}

/**
 * Authoritatively resolves a tie during TIE_PENDING lifecycle.
 * Dispatched by administrator RESOLVE_TIE action or automatic coin flip on 30s timeout.
 */
export function resolveTieAuthoritative({
  sessionId,
  roundId,
  choice,
  winner = null,
  store = null,
  timerManager = null,
  io = null
}) {
  if (!sessionId) {
    return { success: false, reason: 'INVALID_ARGUMENTS' };
  }
  const cleanSessionId = sessionId.trim();
  const state = store && typeof store.getState === 'function' ? store.getState() : null;
  const session = state && typeof state.get === 'function' ? state.getIn(['sessions', cleanSessionId]) : null;

  if (!session) {
    return { success: false, reason: 'SESSION_NOT_FOUND' };
  }

  if (session.get('roundLifecycle') !== ROUND_LIFECYCLE.TIE_PENDING) {
    return { success: false, reason: 'NOT_TIE_PENDING' };
  }

  const tiePending = session.get('tiePending');
  if (roundId && tiePending && tiePending.get('roundId') && tiePending.get('roundId') !== roundId) {
    return { success: false, reason: 'STALE_ROUND' };
  }

  const rawCandidates = tiePending ? tiePending.get('candidates') : null;
  const tiedCandidates = rawCandidates
    ? (typeof rawCandidates.toJS === 'function' ? rawCandidates.toJS() : (Array.isArray(rawCandidates) ? rawCandidates : []))
    : [];

  let chosenWinner = null;
  let resolution = null;

  if (choice === 'pick') {
    if (!winner || !tiedCandidates.includes(winner)) {
      return { success: false, reason: 'INVALID_WINNER' };
    }
    chosenWinner = winner;
    resolution = 'admin_pick';
  } else if (choice === 'coin_flip') {
    if (!tiedCandidates || tiedCandidates.length === 0) {
      return { success: false, reason: 'NO_TIED_CANDIDATES' };
    }
    const randIdx = crypto.randomInt(0, tiedCandidates.length);
    chosenWinner = tiedCandidates[randIdx];
    resolution = 'coin_flip';
  } else {
    return { success: false, reason: 'INVALID_CHOICE' };
  }

  const activeBefore = activeRounds.get(cleanSessionId) || null;
  const finalVoteBefore = activeBefore ? activeBefore.finalVote : null;

  if (timerManager && typeof timerManager.clearTiePendingTimer === 'function') {
    timerManager.clearTiePendingTimer(cleanSessionId);
  }

  if (store && typeof store.dispatch === 'function') {
    const votingMode = session.get('votingMode');
    const roundSnapshot = deriveRoundSnapshot(session, activeBefore, finalVoteBefore, {
      kind: votingMode === 'single_ballot' ? 'single_ballot' : 'pairwise',
      resolution,
      advanced: [chosenWinner]
    });

    store.dispatch({
      type: 'RESOLVE_TIE',
      sessionId: cleanSessionId,
      roundId,
      winner: chosenWinner,
      choice,
      resolution
    });

    if (activeBefore) {
      activeBefore.roundSnapshot = roundSnapshot;
      activeBefore.lifecycle = ROUND_LIFECYCLE.ROUND_CLOSED;
      activeBefore.closed = true;
    }

    const currentRounds = store.getState().getIn(['sessions', cleanSessionId, 'rounds']) || List();
    const alreadyAppended = currentRounds.some(r => r.get('roundIndex') === roundSnapshot.roundIndex);
    if (alreadyAppended) {
      store.dispatch({
        type: 'CORRECT_ROUND_RESULT',
        sessionId: cleanSessionId,
        roundIndex: roundSnapshot.roundIndex,
        round: roundSnapshot
      });
    } else {
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId: cleanSessionId,
        round: roundSnapshot
      });
    }

    if (isConnected()) {
      const title = session.get('title') || '';
      const rawEntries = session.get('entries');
      const entries = List.isList(rawEntries)
        ? rawEntries.toJS()
        : (Array.isArray(rawEntries) ? rawEntries : []);
      repository.pushRoundToResult(cleanSessionId, roundSnapshot, { title, entries }).catch(err => {
        console.error(`[RoundManager] Failed to persist tie resolution for "${cleanSessionId}":`, err.message);
      });
      // For single ballot the completion Result document is owned by the store
      // subscriber's status transition (open to completed). Tournament mode
      // continues the bracket, so there is nothing to conclude here.
    }

    // Single ballot: the resolution completed the session, so re-arm the next
    // round identity for a potential new matchup on the same session id.
    // Tournament: the winner advances and voting continues with the same
    // round stream, so the next identity comes from the state subscriber.
    if (votingMode === 'single_ballot') {
      const postState = store.getState();
      const postSession = postState && typeof postState.get === 'function'
        ? postState.getIn(['sessions', cleanSessionId])
        : null;
      const rawEntries = postSession ? postSession.get('entries') : null;
      const entryList = rawEntries && typeof rawEntries.toJS === 'function'
        ? rawEntries.toJS()
        : (Array.isArray(rawEntries) ? rawEntries : []);
      if (entryList.length >= 2) {
        initRound(cleanSessionId, entryList, { kind: 'single_ballot', store });
      }
    }
  }

  return {
    success: true,
    winner: chosenWinner,
    resolution,
    sessionId: cleanSessionId,
    roundId
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

  // Guard against duplicate reveal expiration
  if (expiredRevealRounds.has(cleanRoundId)) {
    return { success: false, reason: 'ALREADY_EXPIRED', roundId: cleanRoundId };
  }

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

  expiredRevealRounds.add(cleanRoundId);

  if (store && typeof store.getState === 'function') {
    const state = store.getState();
    const session = state && typeof state.get === 'function'
      ? state.getIn(['sessions', cleanSessionId])
      : null;
    if (session) {
      if (session.get('winner') || session.get('status') === 'completed') {
        return { success: false, reason: 'ALREADY_ADVANCED', roundId: cleanRoundId };
      }
      const currentPair = session.getIn(['vote', 'pair']);
      const currentCandidates = session.getIn(['vote', 'candidates']);
      if (active && active.candidates && currentPair) {
        const activeCandidates = active.candidates;
        const currentList = currentCandidates ? currentCandidates.toJS() : currentPair.toJS();
        const same = activeCandidates.length === currentList.length && activeCandidates.every((c, i) => c === currentList[i]);
        if (!same) {
          return { success: false, reason: 'ALREADY_ADVANCED', roundId: cleanRoundId };
        }
      }
    }
  }

  active.revealExpired = true;
  active.lifecycle = ROUND_LIFECYCLE.ROUND_CLOSED;

  // Clear any running reveal timer
  if (timerManager && typeof timerManager.clearRevealTimer === 'function') {
    timerManager.clearRevealTimer(cleanSessionId, io);
  }

  const pendingAction = active.pendingAction;
  const roundSnapshot = active.roundSnapshot;
  const finalVote = active.finalVote;
  const session = store && store.getState ? store.getState().getIn(['sessions', cleanSessionId]) : null;

  executePendingRoundAdvance({
    sessionId: cleanSessionId,
    roundId: cleanRoundId,
    pendingAction,
    roundSnapshot,
    session,
    active,
    finalVote,
    store,
    timerManager,
    io
  });

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
  snapshotsByRound.delete(key);
}

/**
 * Resets all in-memory round tracking, submissions, and idempotency state.
 * Used for test isolation and clean server resets.
 */
export function resetRounds() {
  roundIndexBySession.clear();
  activeRounds.clear();
  closedRounds.clear();
  expiredRevealRounds.clear();
  submissionsByRound.clear();
  snapshotsByRound.clear();
}

/**
 * Retrieves the frozen round snapshot for a session's closed round.
 * @param {string} sessionId
 * @returns {Object|null}
 */
export function getRoundSnapshot(sessionId) {
  if (!sessionId) return null;
  const active = activeRounds.get(sessionId.trim());
  return active ? active.roundSnapshot : null;
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
  computeEligibility,
  canCompleteEarly,
  snapshotRoundEligibility,
  isRoundClosed,
  closeRoundOnce,
  expireReveal,
  getRoundLifecycle,
  getRoundFinalVote,
  getRoundSnapshot,
  deriveRoundSnapshot,
  canAcceptVotes,
  endSessionRounds,
  clearRoundData,
  resetRounds,
  resolveTieAuthoritative,
  executePendingRoundAdvance
};
