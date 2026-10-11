import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import socket, { reattachVoterIdentityToSocket } from '../src/services/socket.js';

// The socket auto-connects on import and never finds a server in this suite.
after(() => {
  socket.close();
});

// Swaps the transport methods so a reconnect can be counted without a server,
// the same pattern the admin handshake suite uses.
function stubTransport({ connectThrows = false } = {}) {
  const calls = { disconnect: 0, connect: 0 };
  const realDisconnect = socket.disconnect;
  const realConnect = socket.connect;
  socket.disconnect = function stubDisconnect() { calls.disconnect += 1; };
  socket.connect = function stubConnect() {
    calls.connect += 1;
    if (connectThrows) throw new Error('transport is down');
  };
  return {
    calls,
    restore() {
      socket.disconnect = realDisconnect;
      socket.connect = realConnect;
    }
  };
}

describe('reattachVoterIdentityToSocket re-handshakes for the vs_voter cookie', () => {
  test('1. forces exactly one disconnect and reconnect so the cookie is re-sent', () => {
    const t = stubTransport();
    try {
      const triggered = reattachVoterIdentityToSocket();
      assert.strictEqual(triggered, true, 'a reconnect must be reported so callers can rely on it');
      assert.strictEqual(t.calls.disconnect, 1, 'the old cookie-less handshake must be dropped');
      assert.strictEqual(t.calls.connect, 1, 'a fresh handshake must carry the new cookie');
    } finally {
      t.restore();
    }
  });

  test('2. still reports success and the attempt when the transport throws', () => {
    // A transport failure must not crash the sign in path; the reconnect retries
    // through Socket.io's own reconnect logic.
    const t = stubTransport({ connectThrows: true });
    try {
      const triggered = reattachVoterIdentityToSocket();
      assert.strictEqual(triggered, true, 'a transport failure must not surface as a failed re-handshake');
      assert.strictEqual(t.calls.disconnect, 1);
      assert.strictEqual(t.calls.connect, 1, 'the reconnect must still have been attempted');
    } finally {
      t.restore();
    }
  });

  test('3. leaves the admin handshake auth untouched', () => {
    // Voter identity lives in the cookie, not in the handshake auth, so a voter
    // re-handshake must not disturb an admin token that is already set.
    socket.auth = { token: 'admin.jwt.kept' };
    const t = stubTransport();
    try {
      reattachVoterIdentityToSocket();
      assert.deepStrictEqual(
        socket.auth,
        { token: 'admin.jwt.kept' },
        'the admin JWT on the handshake must survive a voter re-handshake'
      );
    } finally {
      t.restore();
      socket.auth = {};
      delete socket.auth.token;
    }
  });
});
