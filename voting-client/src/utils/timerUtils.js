/**
 * VoteSphere — Countdown Timer Utility Functions
 *
 * Pure functions for countdown calculations, formatting, and urgency thresholds.
 */

/**
 * Calculates remaining milliseconds from authoritative expiresAt and given current time.
 * Returns 0 if expiresAt is missing, invalid, or already past.
 *
 * @param {number|null|undefined} expiresAt - Absolute UTC epoch milliseconds
 * @param {number} [now=Date.now()] - Current epoch milliseconds
 * @returns {number} Non-negative remaining milliseconds
 */
export function calculateRemainingMs(expiresAt, now = Date.now()) {
  if (!expiresAt || typeof expiresAt !== 'number' || Number.isNaN(expiresAt)) {
    return 0;
  }
  return Math.max(0, expiresAt - now);
}

/**
 * Formats remaining milliseconds into standard MM:SS display format.
 * Never displays negative values. Single-digit seconds and minutes are zero-padded.
 *
 * @param {number|null|undefined} remainingMs
 * @returns {string} Formatted string in "MM:SS"
 */
export function formatTime(remainingMs) {
  if (!remainingMs || typeof remainingMs !== 'number' || remainingMs <= 0 || Number.isNaN(remainingMs)) {
    return '00:00';
  }

  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');

  return `${paddedMinutes}:${paddedSeconds}`;
}

/**
 * Determines urgency presentation level based on remaining seconds.
 *
 * @param {number} remainingSeconds
 * @returns {'critical'|'warning'|'normal'|'expired'}
 */
export function getUrgencyState(remainingSeconds) {
  if (remainingSeconds <= 0) return 'expired';
  if (remainingSeconds <= 5) return 'critical';
  if (remainingSeconds <= 10) return 'warning';
  return 'normal';
}

/**
 * Determines whether a given timer is expired based on its status and expiresAt timestamp.
 *
 * A timer is expired if:
 * - timer.status is explicitly 'expired'
 * - timer.status is 'running' and remaining milliseconds <= 0
 *
 * Returns false if timer is null, undefined, inactive, or running with positive remaining time.
 *
 * @param {object|null|undefined} timer - Timer object ({ status, expiresAt, duration })
 * @param {number} [now=Date.now()] - Current epoch milliseconds
 * @returns {boolean}
 */
export function isTimerExpired(timer, now = Date.now()) {
  if (!timer || typeof timer !== 'object') {
    return false;
  }

  const { status, expiresAt } = timer;

  if (status === 'expired') {
    return true;
  }

  if (status === 'running') {
    if (typeof expiresAt !== 'number' || Number.isNaN(expiresAt)) {
      return false;
    }
    return calculateRemainingMs(expiresAt, now) <= 0;
  }

  return false;
}

/**
 * Determines if voting is permitted based on round timer state and voter vote status.
 *
 * Voting is disabled if:
 * - The voter has already cast a vote for the current pair
 * - The round timer has expired
 *
 * @param {object} params
 * @param {object|null|undefined} [params.timer]
 * @param {boolean} [params.hasVoted=false]
 * @param {number} [params.now=Date.now()]
 * @returns {boolean} True if voting is permitted
 */
export function isVotePermitted({ timer, hasVoted = false, now = Date.now() }) {
  if (hasVoted) return false;
  if (isTimerExpired(timer, now)) return false;
  return true;
}

/**
 * Returns user-facing round feedback type and text based on voting and timer state.
 *
 * @param {object} params
 * @param {string|null} [params.votedEntry=null]
 * @param {object|null} [params.timer=null]
 * @param {number} [params.now=Date.now()]
 * @returns {{ type: 'voted'|'expired'|'prompt', message: string }}
 */
export function getVotingFeedbackState({ votedEntry = null, timer = null, now = Date.now() }) {
  if (votedEntry) {
    return {
      type: 'voted',
      message: `Vote recorded for ${votedEntry}. Waiting for next round...`
    };
  }

  if (isTimerExpired(timer, now)) {
    return {
      type: 'expired',
      message: 'Voting time expired. Waiting for server to advance round...'
    };
  }

  return {
    type: 'prompt',
    message: 'Select a candidate card above to submit your vote.'
  };
}

/**
 * Authoritative voting timer duration boundary constants.
 * Must match backend contract in voting-server/src/timer.js.
 */
export const MIN_TIMER_DURATION = 5;
export const MAX_TIMER_DURATION = 300;
export const DEFAULT_TIMER_DURATION = 30;

/**
 * Validates admin session creation voting timer duration input.
 *
 * Rules:
 * - Must be an integer between MIN_TIMER_DURATION (5s) and MAX_TIMER_DURATION (300s) inclusive.
 * - Decimals (e.g. 25.5) are strictly rejected (not silently truncated).
 * - Empty, null, undefined, non-numeric strings, negative numbers, and zero are rejected.
 *
 * @param {string|number|null|undefined} value
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
export function validateTimerDuration(value) {
  if (value === undefined || value === null) {
    return { valid: false, error: 'Voting timer duration is required.' };
  }

  const strVal = typeof value === 'string' ? value.trim() : String(value).trim();
  if (strVal === '') {
    return { valid: false, error: 'Voting timer duration is required.' };
  }

  // Strictly reject strings or values containing decimal points, exponents, or non-digits
  if (!/^-?\d+$/.test(strVal)) {
    return { valid: false, error: 'Voting timer duration must be a valid integer.' };
  }

  const num = Number(strVal);
  if (!Number.isInteger(num)) {
    return { valid: false, error: 'Voting timer duration must be an integer.' };
  }

  if (num < MIN_TIMER_DURATION) {
    return { valid: false, error: `Voting timer duration must be at least ${MIN_TIMER_DURATION} seconds.` };
  }

  if (num > MAX_TIMER_DURATION) {
    return { valid: false, error: `Voting timer duration cannot exceed ${MAX_TIMER_DURATION} seconds.` };
  }

  return { valid: true, value: num };
}
