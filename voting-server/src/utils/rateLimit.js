/**
 * Shared fixed window rate limit primitives.
 *
 * One in memory counter map per protected key space. A bucket holds a count and
 * the start of the window it belongs to. The first request in a fresh window
 * creates the bucket, later requests inside the window increment it, and a
 * request once the count has reached the ceiling is refused with the remaining
 * wait so the caller can send an honest Retry After.
 *
 * The counter is deliberately fixed window rather than sliding window: it costs
 * one Map lookup and no timers, which matters because every one of these calls
 * sits on the request path. The tradeoff is a caller can burst up to `max` twice
 * across a window boundary. For these routes (an emailed one time code and a
 * join code lookup) that is an acceptable ceiling.
 */

/**
 * Creates an empty counter store. Each protected key space gets its own store so
 * resetting one limiter can never disturb another.
 *
 * @returns {Map<string, { count: number, windowStart: number }>}
 */
export function createFixedWindowStore() {
  return new Map();
}

/**
 * Consumes one slot for `key` from a fixed window counter.
 *
 * Always counts the attempt, including an attempt made from an exhausted
 * bucket, so an attacker cannot keep a key permanently open by pacing requests.
 *
 * @param {Map} store - Counter store created by createFixedWindowStore
 * @param {string} key - Bucket key (client address, normalized email, ...)
 * @param {Object} options
 * @param {number} options.windowMs - Window length in milliseconds
 * @param {number} options.max - Maximum allowed attempts per window
 * @param {number} [options.now] - Injectable clock, for tests
 * @returns {{ allowed: boolean, retryAfterMs: number, remaining: number }}
 */
export function consumeFixedWindow(store, key, { windowMs, max, now = Date.now() }) {
  const bucketKey = key || 'unknown';
  const entry = store.get(bucketKey);

  if (!entry || (now - entry.windowStart) >= windowMs) {
    store.set(bucketKey, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, max - 1) };
  }

  if (entry.count >= max) {
    return {
      allowed: false,
      retryAfterMs: Math.max(1, windowMs - (now - entry.windowStart)),
      remaining: 0
    };
  }

  entry.count += 1;
  return { allowed: true, retryAfterMs: 0, remaining: max - entry.count };
}
