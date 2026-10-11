import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import socket from '../src/services/socket.js';
import { logoutVoter } from '../src/services/auth.js';

const realFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
  socket.close();
});

// Swaps the transport methods so a reconnect can be counted without a server,
// the same pattern the admin handshake suite uses.
function stubTransport() {
  const calls = { disconnect: 0, connect: 0 };
  const realDisconnect = socket.disconnect;
  const realConnect = socket.connect;
  socket.disconnect = function stubDisconnect() { calls.disconnect += 1; };
  socket.connect = function stubConnect() { calls.connect += 1; };
  return {
    calls,
    restore() {
      socket.disconnect = realDisconnect;
      socket.connect = realConnect;
    }
  };
}

describe('logoutVoter re-handshakes so the server drops the voter identity', () => {
  test('1. a successful logout forces one disconnect and reconnect', async () => {
    // The server read the vs_voter cookie during the original handshake, so the
    // cleared cookie only takes effect on a fresh connection. Without this the
    // server keeps treating a logged out voter as signed in.
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });

    const t = stubTransport();
    try {
      const res = await logoutVoter();
      assert.strictEqual(res.success, true);
      assert.strictEqual(t.calls.disconnect, 1, 'the cookie bearing handshake must be dropped');
      assert.strictEqual(t.calls.connect, 1, 'a fresh cookie less handshake must follow');
    } finally {
      t.restore();
    }
  });

  test('2. a rejected logout leaves the handshake alone and reports why', async () => {
    // The cookie is still set server side, so reconnecting would only re-adopt
    // the very identity the voter asked to leave.
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'UNAUTHORIZED', message: 'Authentication required' })
    });

    const t = stubTransport();
    try {
      const res = await logoutVoter();
      assert.strictEqual(res.success, false);
      assert.strictEqual(t.calls.disconnect, 0, 'no identity to drop when the logout failed');
      assert.strictEqual(t.calls.connect, 0);
      // The surface decides what to do from these, so a bare `success: false`
      // would leave the navbar unable to tell a dead session from a failure.
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.error, 'UNAUTHORIZED');
      assert.ok(res.message, 'the server message must reach the caller');
    } finally {
      t.restore();
    }
  });

  test('3. a network error during logout leaves the handshake alone and reports why', async () => {
    globalThis.fetch = async () => { throw new Error('connection refused'); };

    const t = stubTransport();
    try {
      const res = await logoutVoter();
      assert.strictEqual(res.success, false);
      assert.strictEqual(t.calls.disconnect, 0);
      assert.strictEqual(t.calls.connect, 0);
      // Status 0 marks "the request never landed": nothing is known about the
      // cookie, which is exactly why the caller must keep the local state.
      assert.strictEqual(res.status, 0);
      assert.strictEqual(res.error, 'NETWORK_ERROR');
      assert.match(res.message, /connection refused/);
    } finally {
      t.restore();
    }
  });

  test('5. a server error carries the code and message the surface shows', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred during logout.' })
    });

    const t = stubTransport();
    try {
      const res = await logoutVoter();
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.error, 'INTERNAL_SERVER_ERROR');
      assert.strictEqual(res.message, 'An unexpected error occurred during logout.');
      assert.strictEqual(t.calls.disconnect, 0, 'a failed logout must not drop the handshake');
    } finally {
      t.restore();
    }
  });

  test('4. the request still carries credentials so the server can clear the cookie', async () => {
    let seen = null;
    globalThis.fetch = async (url, options) => {
      seen = { url, options };
      return { ok: true, json: async () => ({ success: true }) };
    };

    const t = stubTransport();
    try {
      await logoutVoter();
      assert.ok(seen.url.includes('/api/auth/logout'));
      assert.strictEqual(seen.options.method, 'POST');
      assert.strictEqual(seen.options.credentials, 'include');
    } finally {
      t.restore();
    }
  });
});
