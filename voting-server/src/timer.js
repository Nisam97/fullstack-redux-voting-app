/**
 * VoteSphere — Voting Timer Domain Module
 *
 * Implements server-authoritative countdown timers for pairwise voting rounds.
 * Manages per-session active timers in memory, dispatches NEXT on expiry,
 * and emits timer_state events to session rooms.
 */

import roundManager, {
  initRound,
  getCurrentRoundId,
  closeRoundOnce,
  expireReveal,
  endSessionRounds,
  ROUND_LIFECYCLE,
  DEFAULT_REVEAL_DURATION,
  resolveRevealDuration
} from './roundManager.js';

export const DEFAULT_TIMER_DURATION = 30; // seconds
export const MIN_TIMER_DURATION = 5;       // seconds
export const MAX_TIMER_DURATION = 300;     // seconds (5 minutes)
export { DEFAULT_REVEAL_DURATION, resolveRevealDuration };

/**
 * Resolves the timer duration based on precedence:
 * 1. Session-level override (if provided and valid)
 * 2. VOTE_TIMER_DURATION environment variable (if set and valid)
 * 3. DEFAULT_TIMER_DURATION (30 seconds)
 *
 * Values are validated to be integers between MIN_TIMER_DURATION and MAX_TIMER_DURATION.
 *
 * @param {number|undefined|null} overrideDuration
 * @returns {number} Resolved duration in seconds
 */
export function resolveDuration(overrideDuration) {
  if (typeof overrideDuration === 'number' && !Number.isNaN(overrideDuration)) {
    const clamped = Math.floor(overrideDuration);
    if (clamped >= MIN_TIMER_DURATION && clamped <= MAX_TIMER_DURATION) {
      return clamped;
    }
  }

  if (process.env.VOTE_TIMER_DURATION) {
    const envDuration = parseInt(process.env.VOTE_TIMER_DURATION, 10);
    if (!Number.isNaN(envDuration) && envDuration >= MIN_TIMER_DURATION && envDuration <= MAX_TIMER_DURATION) {
      return envDuration;
    }
  }

  return DEFAULT_TIMER_DURATION;
}

/**
 * TimerManager handles server-authoritative countdown timers for each voting session.
 */
export class TimerManager {
  constructor() {
    /**
     * Map of active timers keyed by sessionId.
     * @type {Map<string, { sessionId: string, roundId?: string, duration: number, startedAt: number, expiresAt: number, timeoutId: NodeJS.Timeout, status: string }>}
     */
    this.activeTimers = new Map();

    /**
     * Map of active results reveal timers keyed by sessionId.
     * @type {Map<string, { sessionId: string, roundId?: string, duration: number, startedAt: number, expiresAt: number, timeoutId: NodeJS.Timeout, status: string }>}
     */
    this.activeRevealTimers = new Map();
  }

  /**
   * Starts or restarts a timer for a given session.
   * Clears any existing timer for the session before starting a new one.
   *
   * @param {string} sessionId - ID of the session
   * @param {number} [duration] - Optional duration in seconds
   * @param {Object} [store] - Redux store instance (for dispatching NEXT on expiry)
   * @param {Object} [io] - Socket.io server instance (for broadcasting timer_state)
   * @returns {Object|null} The timer entry, or null if sessionId is invalid
   */
  startTimer(sessionId, duration, store = null, io = null) {
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      return null;
    }

    const cleanSessionId = sessionId.trim();

    // Clear any existing timer for this session
    if (this.activeTimers.has(cleanSessionId)) {
      this.clearTimer(cleanSessionId);
    }

    const finalDuration = resolveDuration(duration);
    const startedAt = Date.now();
    const expiresAt = startedAt + (finalDuration * 1000);
    const roundId = getCurrentRoundId(cleanSessionId, store);

    const timeoutId = setTimeout(() => {
      this.handleExpiry(cleanSessionId, roundId, store, io);
    }, finalDuration * 1000);

    // Prevent timer handle from keeping process alive if unref is available
    if (timeoutId && typeof timeoutId.unref === 'function') {
      timeoutId.unref();
    }

    const entry = {
      sessionId: cleanSessionId,
      roundId,
      duration: finalDuration,
      startedAt,
      expiresAt,
      timeoutId,
      status: 'running'
    };

    this.activeTimers.set(cleanSessionId, entry);

    if (io && typeof io.to === 'function') {
      io.to(`session:${cleanSessionId}`).emit('timer_state', {
        sessionId: cleanSessionId,
        duration: finalDuration,
        expiresAt,
        status: 'running'
      });
    }

    return {
      sessionId: entry.sessionId,
      roundId: entry.roundId,
      duration: entry.duration,
      startedAt: entry.startedAt,
      expiresAt: entry.expiresAt,
      status: entry.status
    };
  }

  /**
   * Handles timer expiration by closing the round idempotently through roundManager.
   * Protects against stale timer callbacks from prior rounds.
   *
   * @param {string} sessionId
   * @param {string|Object} [expectedRoundId] - Expected roundId or store if called with legacy signature
   * @param {Object} [store]
   * @param {Object} [io]
   */
  handleExpiry(sessionId, expectedRoundId = null, store = null, io = null) {
    let targetRoundId = expectedRoundId;
    let actualStore = store;
    let actualIo = io;

    // Backwards compatibility if called as handleExpiry(sessionId, store, io)
    if (typeof expectedRoundId === 'object' && expectedRoundId !== null && (expectedRoundId.getState || expectedRoundId.dispatch)) {
      actualIo = store;
      actualStore = expectedRoundId;
      targetRoundId = null;
    }

    const timerEntry = this.activeTimers.get(sessionId);

    // If this expiry callback has an associated roundId:
    if (targetRoundId) {
      // If active timer belongs to a different round (or no active timer for this round),
      // this callback is stale! It must NOT cancel the new round's timer or advance it.
      if (!timerEntry || timerEntry.roundId !== targetRoundId) {
        closeRoundOnce({
          sessionId,
          roundId: targetRoundId,
          store: actualStore,
          timerManager: this,
          io: actualIo
        });
        return;
      }
    } else {
      if (!this.activeTimers.has(sessionId)) {
        return;
      }
    }

    const roundId = targetRoundId || (timerEntry ? timerEntry.roundId : null);

    // Remove timer entry upon expiry
    this.activeTimers.delete(sessionId);

    // If roundId is present, close authoritatively and idempotently through closeRoundOnce
    if (roundId) {
      closeRoundOnce({
        sessionId,
        roundId,
        store: actualStore,
        timerManager: this,
        io: actualIo
      });
      return;
    }

    // Dispatch NEXT action to advance tournament via reducer/core.next
    if (actualStore && typeof actualStore.dispatch === 'function') {
      actualStore.dispatch({
        type: 'NEXT',
        sessionId
      });
    }
  }

  /**
   * Cancels and clears the active timer for a session.
   *
   * @param {string} sessionId - ID of the session
   * @param {Object} [io] - Optional Socket.io instance to emit cleared state
   * @returns {Object|null} The cleared timer entry or null if none existed
   */
  clearTimer(sessionId, io = null) {
    if (!sessionId || !this.activeTimers.has(sessionId)) {
      return null;
    }

    const entry = this.activeTimers.get(sessionId);
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    this.activeTimers.delete(sessionId);

    if (io && typeof io.to === 'function') {
      io.to(`session:${sessionId}`).emit('timer_state', {
        sessionId,
        duration: null,
        expiresAt: null,
        status: null
      });
    }

    return {
      sessionId: entry.sessionId,
      duration: entry.duration,
      startedAt: entry.startedAt,
      expiresAt: entry.expiresAt,
      status: 'stopped'
    };
  }

  /**
   * Gets the public timer state for a session.
   *
   * @param {string} sessionId - ID of the session
   * @returns {Object|null} Timer state object or null if not running
   */
  getTimer(sessionId) {
    if (!sessionId || !this.activeTimers.has(sessionId)) {
      return null;
    }

    const entry = this.activeTimers.get(sessionId);
    return {
      sessionId: entry.sessionId,
      roundId: entry.roundId,
      duration: entry.duration,
      startedAt: entry.startedAt,
      expiresAt: entry.expiresAt,
      status: entry.status
    };
  }

  /**
   * Starts a reveal timer for a session after round closure.
   * Clears any active voting timer first.
   *
   * @param {string} sessionId
   * @param {string} roundId
   * @param {number} [duration]
   * @param {Object} [store]
   * @param {Object} [io]
   * @returns {Object|null}
   */
  startRevealTimer(sessionId, roundId, duration, store = null, io = null) {
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      return null;
    }

    const cleanSessionId = sessionId.trim();

    // Clear any existing voting timer or reveal timer for this session
    if (this.activeTimers.has(cleanSessionId)) {
      this.clearTimer(cleanSessionId);
    }
    if (this.activeRevealTimers.has(cleanSessionId)) {
      this.clearRevealTimer(cleanSessionId);
    }

    const finalDuration = resolveRevealDuration(duration);
    const startedAt = Date.now();
    const expiresAt = startedAt + (finalDuration * 1000);

    const timeoutId = setTimeout(() => {
      this.handleRevealExpiry(cleanSessionId, roundId, store, io);
    }, finalDuration * 1000);

    if (timeoutId && typeof timeoutId.unref === 'function') {
      timeoutId.unref();
    }

    const entry = {
      sessionId: cleanSessionId,
      roundId,
      duration: finalDuration,
      startedAt,
      expiresAt,
      timeoutId,
      status: 'revealing'
    };

    this.activeRevealTimers.set(cleanSessionId, entry);

    if (io && typeof io.to === 'function') {
      io.to(`session:${cleanSessionId}`).emit('timer_state', {
        sessionId: cleanSessionId,
        roundId,
        duration: finalDuration,
        expiresAt,
        status: 'revealing'
      });
    }

    return {
      sessionId: entry.sessionId,
      roundId: entry.roundId,
      duration: entry.duration,
      startedAt: entry.startedAt,
      expiresAt: entry.expiresAt,
      status: entry.status
    };
  }

  /**
   * Handles reveal timer expiration by invoking roundManager.expireReveal.
   * Protects against stale callbacks.
   *
   * @param {string} sessionId
   * @param {string} roundId
   * @param {Object} [store]
   * @param {Object} [io]
   */
  handleRevealExpiry(sessionId, roundId, store = null, io = null) {
    const entry = this.activeRevealTimers.get(sessionId);

    // Stale timer guard
    if (roundId && entry && entry.roundId !== roundId) {
      return;
    }

    this.activeRevealTimers.delete(sessionId);

    expireReveal({
      sessionId,
      roundId,
      store,
      timerManager: this,
      io
    });
  }

  /**
   * Clears an active reveal timer for a session.
   *
   * @param {string} sessionId
   * @param {Object} [io]
   * @returns {Object|null}
   */
  clearRevealTimer(sessionId, io = null) {
    if (!sessionId || !this.activeRevealTimers.has(sessionId)) {
      return null;
    }

    const entry = this.activeRevealTimers.get(sessionId);
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    this.activeRevealTimers.delete(sessionId);

    if (io && typeof io.to === 'function') {
      io.to(`session:${sessionId}`).emit('timer_state', {
        sessionId,
        duration: null,
        expiresAt: null,
        status: null
      });
    }

    return {
      sessionId: entry.sessionId,
      roundId: entry.roundId,
      duration: entry.duration,
      startedAt: entry.startedAt,
      expiresAt: entry.expiresAt,
      status: 'stopped'
    };
  }

  /**
   * Gets the active reveal timer for a session.
   *
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getRevealTimer(sessionId) {
    if (!sessionId || !this.activeRevealTimers.has(sessionId)) {
      return null;
    }

    const entry = this.activeRevealTimers.get(sessionId);
    return {
      sessionId: entry.sessionId,
      roundId: entry.roundId,
      duration: entry.duration,
      startedAt: entry.startedAt,
      expiresAt: entry.expiresAt,
      status: entry.status
    };
  }

  /**
   * Clears all active timers across all sessions (both voting and reveal).
   *
   * @param {Object} [io] - Optional Socket.io instance
   */
  clearAllTimers(io = null) {
    for (const [sessionId, entry] of this.activeTimers.entries()) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      if (io && typeof io.to === 'function') {
        io.to(`session:${sessionId}`).emit('timer_state', {
          sessionId,
          duration: null,
          expiresAt: null,
          status: null
        });
      }
    }
    this.activeTimers.clear();

    for (const [sessionId, entry] of this.activeRevealTimers.entries()) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      if (io && typeof io.to === 'function') {
        io.to(`session:${sessionId}`).emit('timer_state', {
          sessionId,
          duration: null,
          expiresAt: null,
          status: null
        });
      }
    }
    this.activeRevealTimers.clear();
  }

  /**
   * Observes Redux store state transitions to start, restart, or clear timers.
   * Designed to be called inside store.subscribe().
   *
   * @param {Map} prevState - Previous Redux store state (Immutable.js Map)
   * @param {Map} currentState - Current Redux store state (Immutable.js Map)
   * @param {Object} store - Redux store instance
   * @param {Object} io - Socket.io server instance
   */
  onStateChange(prevState, currentState, store = null, io = null) {
    if (!currentState || typeof currentState.get !== 'function') {
      return;
    }

    const prevSessions = prevState && typeof prevState.get === 'function'
      ? prevState.get('sessions')
      : null;
    const currSessions = currentState.get('sessions');

    if (!currSessions || typeof currSessions.forEach !== 'function') {
      return;
    }

    currSessions.forEach((session, sessionId) => {
      const prevSession = prevSessions && typeof prevSessions.get === 'function'
        ? prevSessions.get(sessionId)
        : null;

      const status = session.get('status');
      const prevStatus = prevSession ? prevSession.get('status') : null;
      const winner = session.get('winner');

      // 1. Session completed, archived, or winner determined -> clear timer
      const isInactive = status === 'completed' || status === 'archived' || Boolean(winner);
      const wasActive = prevStatus === 'open' || this.activeTimers.has(sessionId) || this.activeRevealTimers.has(sessionId);

      if (isInactive) {
        endSessionRounds(sessionId);
        let emitted = false;
        if (this.activeTimers.has(sessionId)) {
          this.clearTimer(sessionId, io);
          emitted = true;
        }
        if (this.activeRevealTimers.has(sessionId)) {
          this.clearRevealTimer(sessionId, io);
          emitted = true;
        }
        if (!emitted && wasActive && io && typeof io.to === 'function') {
          io.to(`session:${sessionId}`).emit('timer_state', {
            sessionId,
            duration: null,
            expiresAt: null,
            status: null
          });
        }
        return;
      }

      // 2. Open session with an active pair -> manage round timer
      if (status === 'open') {
        const activePair = session.getIn(['vote', 'pair']);
        const hasPair = activePair && (
          typeof activePair.isEmpty === 'function' ? !activePair.isEmpty() : activePair.length > 0
        );

        if (!hasPair) {
          if (this.activeTimers.has(sessionId)) {
            this.clearTimer(sessionId, io);
          }
          if (this.activeRevealTimers.has(sessionId)) {
            this.clearRevealTimer(sessionId, io);
          }
          return;
        }

        const prevPair = prevSession ? prevSession.getIn(['vote', 'pair']) : null;
        const pairChanged = !prevPair || (
          typeof prevPair.equals === 'function'
            ? !prevPair.equals(activePair)
            : JSON.stringify(prevPair) !== JSON.stringify(activePair)
        );
        const statusChangedToOpen = prevStatus !== 'open';

        // Check round lifecycle state
        const roundLifecycle = session.get('roundLifecycle') || roundManager.getRoundLifecycle(sessionId);
        const isRoundClosedOrRevealing = roundLifecycle === ROUND_LIFECYCLE.ROUND_CLOSED ||
                                         roundLifecycle === ROUND_LIFECYCLE.RESULTS_REVEALED ||
                                         this.activeRevealTimers.has(sessionId);

        // If round is currently closed or in results reveal, do NOT start/restart voting timer
        if (isRoundClosedOrRevealing) {
          return;
        }

        // If pair changed, make sure any lingering reveal timer from previous round is cleared
        if (pairChanged && this.activeRevealTimers.has(sessionId)) {
          this.clearRevealTimer(sessionId, io);
        }

        // Start timer if:
        // - Pair changed (new round)
        // - Session just opened
        // - Or timer is not running yet for this active pair
        if (pairChanged || statusChangedToOpen || !this.activeTimers.has(sessionId)) {
          const pairArray = activePair && typeof activePair.toJS === 'function'
            ? activePair.toJS()
            : (Array.isArray(activePair) ? activePair : []);
          if (pairArray && pairArray.length >= 2) {
            initRound(sessionId, pairArray);
          }
          const customDuration = session.get('timerDuration');
          this.startTimer(sessionId, customDuration, store, io);
        }
      } else if (status === 'pending') {
        // Pending session has no active timer
        if (this.activeTimers.has(sessionId)) {
          this.clearTimer(sessionId, io);
        }
        if (this.activeRevealTimers.has(sessionId)) {
          this.clearRevealTimer(sessionId, io);
        }
      }
    });

    // Clean up timers for sessions removed from registry
    if (prevSessions && typeof prevSessions.forEach === 'function') {
      prevSessions.forEach((prevSession, sessionId) => {
        if (!currSessions.has(sessionId)) {
          if (this.activeTimers.has(sessionId)) {
            this.clearTimer(sessionId, io);
          }
          if (this.activeRevealTimers.has(sessionId)) {
            this.clearRevealTimer(sessionId, io);
          }
        }
      });
    }
  }
}

export const defaultTimerManager = new TimerManager();
export default defaultTimerManager;
