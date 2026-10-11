import { SERVER_URL, readStoredAdminToken } from './socket.js';

export const REQUEST_TIMEOUT_MS = 20000;

/**
 * The one place the client talks to its own voting server.
 *
 * Every request used to assemble its own fetch options, which meant three
 * decisions were repeated (and could drift) per call site:
 *
 *  - `credentials: 'include'`, so the HttpOnly `vs_voter` cookie rides along.
 *    A single fetch that forgot it looked anonymous server side, which is how
 *    the socket handshake and the lobby read were broken before (spec 0007 and
 *    0008 AC-15).
 *  - the admin `Authorization: Bearer` header, built from the stored admin
 *    token. It is attached here for every own-server request, where the server
 *    ignores it on the routes that do not read it; no call site decides.
 *  - transport and parse handling. A thrown fetch, a non 2xx status, an empty
 *    body and a non JSON body all come back through one envelope instead of a
 *    try/catch and a `response.json()` per function.
 *
 * A transport failure or an unparseable body comes back through this same
 * envelope rather than a throw, so callers do not each need a try/catch. The
 * only way to throw is a programming error before the send (a bad `path` type),
 * which should surface loudly rather than be flattened into a network error.
 *
 * A hung server is treated the same way: every request carries its own
 * AbortController that the `REQUEST_TIMEOUT_MS` timer trips, so a server that
 * accepts the connection and then never answers cannot leave a page stuck on a
 * spinner forever. The controller, not the caller's signal, is what fetch is
 * handed, which is what makes the two cancellations compose:
 *
 *  - a caller supplied `signal` (a page unmounting its read, say) is linked to
 *    the controller, so aborting it cancels the request immediately;
 *  - linking rather than substituting means that signal can never *replace* the
 *    timeout, which is the failure this guards against. A caller that passes a
 *    signal still gets cut off by the timeout if the server goes quiet.
 *
 * The timer is cleared in a `finally`, so it covers reading the body too and a
 * settled request never leaves a pending timer behind.
 *
 * Callers read the envelope:
 *
 * @param {string} path Path starting with `/api/...`, appended to SERVER_URL.
 * @param {Object} [options]
 * @param {string} [options.method='GET']
 * @param {Object|string} [options.body] Serialized as JSON unless already a string.
 * @param {Object} [options.headers] Extra headers, merged over `Accept`.
 * @param {AbortSignal} [options.signal] Cancels the request; the timeout still applies.
 * @param {number} [options.timeoutMs=REQUEST_TIMEOUT_MS] Overrides the request timeout.
 * @returns {Promise<{
 *   ok: boolean,            // true only for a 2xx response
 *   status: number,         // HTTP status, or 0 when the request never landed
 *   data: Object|null,      // parsed JSON body, or null when absent/invalid
 *   networkError: boolean,  // fetch itself failed, so the status is unknown
 *   error: string|null,     // server error code, or 'NETWORK_ERROR'
 *   message: string|null    // server message, or the transport error message
 * }>}
 */
export async function apiRequest(
  path,
  { method = 'GET', body, headers = {}, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  const url = /^https?:\/\//i.test(path) ? path : `${SERVER_URL}${path}`;

  const requestHeaders = { Accept: 'application/json', ...headers };
  const hasBody = body !== undefined && body !== null;
  if (hasBody) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  const adminToken = readStoredAdminToken();
  if (adminToken) {
    requestHeaders.Authorization = `Bearer ${adminToken}`;
  }

  // One controller carries every cancellation into fetch. `timedOut` is what
  // lets the catch below tell "the server never answered" apart from "the
  // caller walked away", which are different messages to a user staring at a
  // spinner.
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const cancelOnExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', cancelOnExternalAbort, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      credentials: 'include',
      ...(hasBody ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      signal: controller.signal
    });

    let data = null;
    if (response && typeof response.json === 'function') {
      // A 204 or an HTML error page must not become a thrown parse error at the
      // call site. An absent body is simply null. Some endpoints (join, logout)
      // are reached through the same helper, so a body that is not JSON is
      // handled once, here, rather than by `.catch(() => ({}))` per caller.
      data = await response.json().catch(() => null);
    }

    return {
      ok: Boolean(response && response.ok),
      status: response && response.status !== undefined ? response.status : 0,
      data,
      networkError: false,
      error: (data && data.error) || null,
      message: (data && data.message) || null
    };
  } catch (err) {
    const aborted = controller.signal.aborted;

    return {
      ok: false,
      status: 0,
      data: null,
      networkError: true,
      error: 'NETWORK_ERROR',
      message: aborted
        ? timedOut
          ? 'The voting server did not respond in time.'
          : 'The request was cancelled before the voting server answered.'
        : (err && err.message) || 'Unable to reach the voting server.'
    };
  } finally {
    // Also covers the body read above: a request that settled must not leave a
    // timer pending, which would keep a `node --test` process alive and keep a
    // real page's event loop busy.
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', cancelOnExternalAbort);
  }
}
