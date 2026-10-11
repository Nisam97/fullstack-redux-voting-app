import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, REQUEST_TIMEOUT_MS } from '../src/services/api.js';
import { disconnectSocket } from '../src/services/socket.js';

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  // api.js imports socket.js, which opens a live connection at module load.
  // Without this the spec's own process never exits and `node --test` hangs.
  disconnectSocket();
});

function setupMockWindow() {
  globalThis.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    }
  };
}

const abortError = () => new DOMException('This operation was aborted', 'AbortError');

/**
 * A fetch stand in that models a hung server the way the real one behaves: the
 * promise never settles unless the signal it was handed is aborted. A stub that
 * ignored `init.signal` would make the timeout untestable, because only a fetch
 * that honours the abort actually rejects when the controller trips.
 */
function stubHungServer() {
  const calls = [];
  globalThis.fetch = (url, init) =>
    new Promise((_resolve, reject) => {
      calls.push({ url, init });
      const signal = init?.signal;
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });
  return calls;
}

function stubJsonResponse(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return calls;
}

describe('apiRequest request timeout and AbortController', () => {
  beforeEach(() => {
    setupMockWindow();
  });

  test('1. a hung server is cut off by the request timeout instead of loading forever', async () => {
    const calls = stubHungServer();
    const startedAt = Date.now();

    const res = await apiRequest('/api/auth/logout', { method: 'POST', timeoutMs: 40 });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 0);
    assert.strictEqual(res.data, null);
    assert.strictEqual(res.networkError, true);
    assert.strictEqual(res.error, 'NETWORK_ERROR');
    assert.strictEqual(res.message, 'The voting server did not respond in time.');
    assert.strictEqual(calls.length, 1, 'the request must still have been sent');
    assert.strictEqual(calls[0].init.signal.aborted, true, 'fetch must be handed an aborted signal');
    assert.ok(
      Date.now() - startedAt < 2000,
      'a hung server must be abandoned at the timeout, not when the server eventually answers'
    );
  });

  test('2. the default timeout is a real, finite bound', async () => {
    assert.strictEqual(typeof REQUEST_TIMEOUT_MS, 'number');
    assert.ok(REQUEST_TIMEOUT_MS > 0, 'a zero timeout would fail every request');
    assert.ok(REQUEST_TIMEOUT_MS <= 60000, 'the default must be short enough to notice as a failure');
  });

  test('3. a caller supplied signal cancels the request immediately', async () => {
    const calls = stubHungServer();
    const controller = new AbortController();
    const startedAt = Date.now();

    const pending = apiRequest('/api/auth/logout', {
      method: 'POST',
      signal: controller.signal,
      timeoutMs: 30000
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const res = await pending;

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.networkError, true);
    assert.strictEqual(res.error, 'NETWORK_ERROR');
    assert.strictEqual(res.message, 'The request was cancelled before the voting server answered.');
    assert.strictEqual(calls[0].init.signal.aborted, true);
    assert.ok(Date.now() - startedAt < 2000, 'cancelling must not wait the 30s timeout out');
  });

  test('4. a caller signal does not replace the timeout, so a hung server is still cut off', async () => {
    // The regression this guards: wiring `signal || controller.signal` into
    // fetch silently disables the timeout for every caller that passes one.
    stubHungServer();
    const controller = new AbortController();

    const res = await apiRequest('/api/join/ABCD', {
      signal: controller.signal,
      timeoutMs: 40
    });

    assert.strictEqual(res.networkError, true);
    assert.strictEqual(res.message, 'The voting server did not respond in time.');
    assert.strictEqual(controller.signal.aborted, false, 'the caller signal must not be aborted by us');
  });

  test('5. an already aborted signal fails fast without leaving the request pending', async () => {
    const calls = stubHungServer();
    const controller = new AbortController();
    controller.abort();

    const res = await apiRequest('/api/join/ABCD', { signal: controller.signal, timeoutMs: 30000 });

    assert.strictEqual(res.networkError, true);
    assert.strictEqual(res.message, 'The request was cancelled before the voting server answered.');
    assert.strictEqual(calls.length, 1);
  });

  test('6. a settled request clears its timeout, so nothing keeps the page or the process alive', async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const scheduled = [];
    const cleared = [];
    const LONG_TIMEOUT = 600000;

    globalThis.setTimeout = (fn, delay, ...rest) => {
      const id = realSetTimeout(fn, delay, ...rest);
      if (delay === LONG_TIMEOUT) scheduled.push(id);
      return id;
    };
    globalThis.clearTimeout = (id) => {
      if (scheduled.includes(id)) cleared.push(id);
      return realClearTimeout(id);
    };

    try {
      stubJsonResponse(200, { success: true });
      const res = await apiRequest('/api/auth/logout', { method: 'POST', timeoutMs: LONG_TIMEOUT });

      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.data.success, true);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }

    assert.strictEqual(scheduled.length, 1, 'a request must arm exactly one timeout');
    assert.strictEqual(cleared.length, 1, 'a response that landed must clear the timeout it armed');
  });

  test('7. a non abort transport failure keeps its own message', async () => {
    globalThis.fetch = async () => {
      throw new Error('connection refused');
    };

    const res = await apiRequest('/api/sessions/history');

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.networkError, true);
    assert.strictEqual(res.message, 'connection refused');
  });
});
