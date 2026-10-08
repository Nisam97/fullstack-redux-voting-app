import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert';
import socket, {
  ADMIN_TOKEN_KEY,
  applyAdminTokenToSocket,
  readStoredAdminToken
} from '../src/services/socket.js';
import {
  ADMIN_TOKEN_KEY as AUTH_TOKEN_KEY,
  getAdminToken,
  isAdminLoggedIn,
  loginAdmin,
  logoutAdmin
} from '../src/services/auth.js';

const realFetch = globalThis.fetch;

after(() => {
  socket.close();
});

// Minimal window stub matching the pattern used elsewhere in this suite.
function setupMockWindow(seed = {}) {
  const localMap = new Map(Object.entries(seed));
  globalThis.window = {
    localStorage: {
      getItem: (key) => (localMap.has(key) ? localMap.get(key) : null),
      setItem: (key, val) => localMap.set(key, String(val)),
      removeItem: (key) => localMap.delete(key),
      clear: () => localMap.clear()
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    }
  };
}

// Swaps the real transport methods so reconnects can be counted without a server.
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

// Builds a fetch stand in answering a single admin login shape.
function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  };
  return calls;
}

// A syntactically valid JWT whose payload is already expired.
function expiredJwt() {
  const payload = btoa(JSON.stringify({ username: 'admin', exp: Math.floor(Date.now() / 1000) - 60 }));
  return `header.${payload}.signature`;
}

describe('Admin socket handshake carries the admin JWT', () => {
  beforeEach(() => {
    setupMockWindow();
    // socket.auth starts undefined until something assigns it.
    socket.auth = socket.auth || {};
    delete socket.auth.token;
  });

  test('1. readStoredAdminToken returns the stored JWT, and null when there is none', () => {
    assert.strictEqual(readStoredAdminToken(), null);
    window.localStorage.setItem(ADMIN_TOKEN_KEY, 'stored.jwt.token');
    assert.strictEqual(readStoredAdminToken(), 'stored.jwt.token');
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    assert.strictEqual(readStoredAdminToken(), null);
  });

  test('2. applyAdminTokenToSocket puts the JWT on the handshake auth', () => {
    const t = stubTransport();
    try {
      const changed = applyAdminTokenToSocket('fresh.jwt.token');
      assert.strictEqual(changed, true, 'a new token must be reported as a change');
      assert.strictEqual(socket.auth.token, 'fresh.jwt.token');
    } finally {
      t.restore();
    }
  });

  test('3. a token change reconnects the socket, because auth is only sent during the handshake', () => {
    const t = stubTransport();
    try {
      applyAdminTokenToSocket('first.jwt.token');
      assert.strictEqual(t.calls.disconnect, 1, 'expected a disconnect before reconnecting');
      assert.strictEqual(t.calls.connect, 1, 'expected a reconnect carrying the new token');
    } finally {
      t.restore();
    }
  });

  test('4. applying the same token again does not reconnect', () => {
    applyAdminTokenToSocket('stable.jwt.token');
    const t = stubTransport();
    try {
      const changed = applyAdminTokenToSocket('stable.jwt.token');
      assert.strictEqual(changed, false, 'an unchanged token must not trigger a reconnect');
      assert.strictEqual(t.calls.disconnect, 0);
      assert.strictEqual(t.calls.connect, 0);
      assert.strictEqual(socket.auth.token, 'stable.jwt.token');
    } finally {
      t.restore();
    }
  });

  test('5. a null token clears the admin identity and reconnects, so logout drops admin privileges', () => {
    applyAdminTokenToSocket('admin.jwt.token');
    const t = stubTransport();
    try {
      const changed = applyAdminTokenToSocket(null);
      assert.strictEqual(changed, true);
      assert.strictEqual(socket.auth?.token, undefined, 'the token must be gone from handshake auth');
      assert.strictEqual(t.calls.disconnect, 1);
      assert.strictEqual(t.calls.connect, 1);
    } finally {
      t.restore();
    }
  });

  test('6. logoutAdmin clears the handshake token, not just localStorage', () => {
    applyAdminTokenToSocket('admin.jwt.token');
    const t = stubTransport();
    try {
      logoutAdmin();
      assert.strictEqual(socket.auth?.token, undefined);
      assert.strictEqual(t.calls.connect, 1, 'logout must reconnect so the server drops admin identity');
    } finally {
      t.restore();
    }
  });

  test('7. auth.js keeps exporting the same storage key it always has', () => {
    // auth.js re-exports the key from socket.js; importers must be unaffected.
    assert.strictEqual(AUTH_TOKEN_KEY, 'votesphere_admin_jwt');
    assert.strictEqual(AUTH_TOKEN_KEY, ADMIN_TOKEN_KEY);
  });

  test('8. a token present before socket.js loads is sent on the very first handshake', async () => {
    // socket.js reads localStorage at construction, which is the only way the
    // server ever sees an admin on the first connection.
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'preexisting.jwt.token' });
    const { readStoredAdminToken: fresh } = await import('../src/services/socket.js');
    assert.strictEqual(
      fresh(),
      'preexisting.jwt.token',
      'a JWT already in localStorage must be readable for the initial handshake'
    );
  });

  test('9. readStoredAdminToken returns null when there is no window at all', () => {
    // The socket module is imported in a bare Node process too, and SSR style
    // environments have no window. It must not throw on import.
    const saved = globalThis.window;
    delete globalThis.window;
    try {
      assert.strictEqual(readStoredAdminToken(), null, 'a missing window must yield no token');
    } finally {
      globalThis.window = saved;
    }
  });

  test('10. readStoredAdminToken returns null when localStorage access throws', () => {
    // Private browsing modes throw on getItem rather than returning null.
    setupMockWindow();
    window.localStorage.getItem = () => { throw new Error('SecurityError: storage disabled'); };
    assert.strictEqual(
      readStoredAdminToken(),
      null,
      'a throwing storage must degrade to no token, not crash the socket module'
    );
  });

  test('11. readStoredAdminToken treats a stored empty string as no token', () => {
    // An empty string is falsy, so it must not be handed to the handshake as
    // a truthy looking token the server would then try and fail to verify.
    setupMockWindow();
    window.localStorage.setItem(ADMIN_TOKEN_KEY, '');
    assert.strictEqual(readStoredAdminToken(), null);
  });
});

describe('applyAdminTokenToSocket edge cases', () => {
  beforeEach(() => {
    setupMockWindow();
    socket.auth = socket.auth || {};
    delete socket.auth.token;
  });

  test('12. an empty string token is treated as a clear, not as a token', () => {
    applyAdminTokenToSocket('admin.jwt.token');
    const t = stubTransport();
    try {
      const changed = applyAdminTokenToSocket('');
      assert.strictEqual(changed, true, 'an empty string is not the same as a real token');
      assert.strictEqual(socket.auth?.token, undefined, 'an empty string must not be sent as a token');
      assert.strictEqual(t.calls.connect, 1);
    } finally {
      t.restore();
    }
  });

  test('13. clearing when no token is set changes nothing and does not reconnect', () => {
    const t = stubTransport();
    try {
      const changed = applyAdminTokenToSocket(null);
      assert.strictEqual(changed, false, 'logout with no admin session must be a no op');
      assert.strictEqual(t.calls.disconnect, 0);
      assert.strictEqual(t.calls.connect, 0);
    } finally {
      t.restore();
    }
  });

  test('14. applying a token preserves the other handshake auth fields', () => {
    // Spread semantics matter: a future auth field must survive a token change.
    socket.auth = { token: 'old.jwt', locale: 'en', deviceId: 'd-9' };
    const t = stubTransport();
    try {
      applyAdminTokenToSocket('new.jwt');
      assert.deepStrictEqual(
        socket.auth,
        { token: 'new.jwt', locale: 'en', deviceId: 'd-9' },
        'only the token may change; sibling auth fields must survive'
      );
    } finally {
      t.restore();
    }
  });

  test('15. the token is applied even when the transport throws while reconnecting', () => {
    const t = stubTransport();
    try {
      const realConnect = socket.connect;
      socket.connect = () => { throw new Error('transport is down'); };
      const changed = applyAdminTokenToSocket('admin.jwt.after.failure');
      socket.connect = realConnect;

      assert.strictEqual(changed, true, 'the token was changed regardless of the transport');
      assert.strictEqual(
        socket.auth.token,
        'admin.jwt.after.failure',
        'a transport failure must not lose the new admin token'
      );
    } finally {
      t.restore();
    }
  });
});

describe('loginAdmin puts the new JWT on the handshake (the bug this fixes)', () => {
  beforeEach(() => {
    setupMockWindow();
    socket.auth = socket.auth || {};
    delete socket.auth.token;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('16. a successful login applies the JWT to the socket and reconnects', async () => {
    const t = stubTransport();
    try {
      stubFetch(200, {
        success: true,
        token: 'fresh.login.jwt',
        user: { username: 'admin' }
      });

      const res = await loginAdmin({ username: 'admin', password: 'pw' });

      assert.strictEqual(res.success, true);
      assert.strictEqual(
        socket.auth.token,
        'fresh.login.jwt',
        'the server reads the admin JWT from the handshake, so login must set it there'
      );
      assert.strictEqual(t.calls.disconnect, 1, 'an already connected socket must be re handshaken');
      assert.strictEqual(t.calls.connect, 1);
      assert.strictEqual(getAdminToken(), 'fresh.login.jwt', 'the JWT must also be stored');
    } finally {
      t.restore();
    }
  });

  test('17. a successful login posts the credentials to the admin login endpoint', async () => {
    const t = stubTransport();
    try {
      const calls = stubFetch(200, { success: true, token: 'jwt.value' });
      await loginAdmin({ email: 'admin@example.com', password: 'secret' });
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].url.endsWith('/api/admin/login'), 'login must hit the admin login endpoint');
      assert.deepEqual(
        JSON.parse(calls[0].init.body),
        { username: 'admin@example.com', email: 'admin@example.com', password: 'secret' },
        'an email only login must fill in the username field too'
      );
    } finally {
      t.restore();
    }
  });

  test('18. a rejected login never puts a token on the handshake', async () => {
    // The important half of the security case: a bad password must not leave
    // the socket looking like an admin, nor persist anything.
    const t = stubTransport();
    try {
      stubFetch(401, { success: false, error: 'INVALID_CREDENTIALS', message: 'Bad password.' });

      const res = await loginAdmin({ username: 'admin', password: 'wrong' });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'INVALID_CREDENTIALS');
      assert.strictEqual(socket.auth?.token, undefined, 'a failed login must not authenticate the socket');
      assert.strictEqual(getAdminToken(), null, 'a failed login must not persist a token');
      assert.strictEqual(t.calls.connect, 0, 'a failed login must not reconnect as admin');
    } finally {
      t.restore();
    }
  });

  test('19. a network error during login is reported and leaves the socket alone', async () => {
    const t = stubTransport();
    try {
      globalThis.fetch = async () => { throw new Error('connection refused'); };

      const res = await loginAdmin({ username: 'admin', password: 'pw' });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'NETWORK_ERROR');
      assert.strictEqual(socket.auth?.token, undefined);
      assert.strictEqual(t.calls.connect, 0);
    } finally {
      t.restore();
    }
  });

  test('20. an expired stored token logs out and drops admin from the handshake', async () => {
    // isAdminLoggedIn calls logoutAdmin on expiry, which now also clears the
    // socket identity. Without this an expired JWT would keep admin rights on
    // the wire until the page reloaded.
    applyAdminTokenToSocket('valid.jwt');
    window.localStorage.setItem(ADMIN_TOKEN_KEY, expiredJwt());
    const t = stubTransport();
    try {
      assert.strictEqual(isAdminLoggedIn(), false, 'an expired JWT must not read as logged in');
      assert.strictEqual(socket.auth?.token, undefined, 'expiry must clear the handshake token');
      assert.strictEqual(t.calls.connect, 1, 'expiry must reconnect so the server drops admin identity');
    } finally {
      t.restore();
    }
  });
});