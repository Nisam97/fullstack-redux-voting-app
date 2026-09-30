/**
 * VoteSphere server constants
 *
 * Import named exports from this file wherever a constant is needed.
 * Never hard-code these values inline; future phases extend this file.
 */

/**
 * Maximum candidate count for single-ballot mode.
 * 2–SINGLE_BALLOT_MAX candidates  → single_ballot
 * SINGLE_BALLOT_MAX + 1 or more  → tournament (pairwise)
 * Used by the session model, the create-session handler, and ballot.js (Phase 4).
 */
export const SINGLE_BALLOT_MAX = 6;

/**
 * Disconnect grace window in milliseconds.
 * A voter disconnected for more than this duration is excluded from early close checks.
 * Mirrors Spec 0005 AC-3.
 */
export const GRACE_PERIOD_MS = 10000;
