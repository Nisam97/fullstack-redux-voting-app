/**
 * Response timing parity helper.
 *
 * Two routes answer a question whose answer is a secret: the OTP request route
 * reveals whether the submitted address already belongs to an account (the
 * registration path runs one more lookup than the login path), and the join
 * code resolver reveals whether a code exists. In both cases the response body
 * is already identical for a hit and a miss, so the wall clock is the remaining
 * signal. Measuring the response time turns the generic body back into an
 * oracle.
 *
 * The mitigation is a floor: hold every response on these routes open until a
 * minimum duration has elapsed, so the natural spread of the work (a couple of
 * indexed lookups, on the order of a millisecond) is buried under a constant.
 * The floor is applied to the whole handler, so a slow optional stage such as
 * an SMTP send is inside it rather than after it.
 *
 * The floor cannot make a genuinely slow path fast; if the underlying work
 * outruns the floor the timing signal returns. That is the honest limit of the
 * technique, and the reason the value is generous relative to a database read
 * on a warm connection.
 */

/**
 * Default floor in milliseconds. Chosen to sit well above the spread of two
 * indexed lookups while staying imperceptible to a person waiting on a form.
 */
export const DEFAULT_MIN_RESPONSE_MS = 100;

/**
 * Resolves the active floor. `API_MIN_RESPONSE_MS` overrides it; a value of 0
 * disables the floor, and any other value is taken verbatim.
 *
 * @param {Object} [env] - Environment object, for tests
 * @returns {number}
 */
export function getMinResponseMs(env = process.env) {
  const raw = parseInt(env && env.API_MIN_RESPONSE_MS, 10);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_MIN_RESPONSE_MS;
}

/**
 * Milliseconds still owed before the floor is met. Zero once the floor has
 * already elapsed, so a slow handler is never delayed further.
 *
 * @param {number} startedAt - `Date.now()` captured at the start of the handler
 * @param {number} [minMs] - Floor; defaults to the configured value
 * @param {number} [now] - Injectable clock, for tests
 * @returns {number}
 */
export function remainingResponsePadMs(startedAt, minMs = getMinResponseMs(), now = Date.now()) {
  const elapsed = now - startedAt;
  return elapsed >= minMs ? 0 : minMs - elapsed;
}

/**
 * Holds the current request open until the response floor has elapsed.
 *
 * @param {number} startedAt - `Date.now()` captured at the start of the handler
 * @param {number} [minMs] - Floor; defaults to the configured value
 * @returns {Promise<void>}
 */
export async function padToMinimumDuration(startedAt, minMs = getMinResponseMs()) {
  const remaining = remainingResponsePadMs(startedAt, minMs);
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, remaining));
}
