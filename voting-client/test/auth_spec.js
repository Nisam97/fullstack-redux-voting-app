import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  ADMIN_TOKEN_KEY,
  ADMIN_USER_KEY,
  getAdminToken,
  getAdminUser,
  isAdminLoggedIn,
  logoutAdmin,
  getVoterToken,
  getVoterDisplayName,
  hasJoinedSession,
  getVoterTokenKey,
  getVoterNameKey
} from '../src/services/auth.js';
import { createRemoteActionMiddleware } from '../src/redux/store.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

// Setup mock window environment for Node test runner
function setupMockWindow() {
  const localMap = new Map();
  const sessionMap = new Map();

  globalThis.window = {
    localStorage: {
      getItem: (key) => localMap.get(key) || null,
      setItem: (key, val) => localMap.set(key, String(val)),
      removeItem: (key) => localMap.delete(key),
      clear: () => localMap.clear()
    },
    sessionStorage: {
      getItem: (key) => sessionMap.get(key) || null,
      setItem: (key, val) => sessionMap.set(key, String(val)),
      removeItem: (key) => sessionMap.delete(key),
      clear: () => sessionMap.clear()
    }
  };
}

describe('Feature 1: Client Authentication & Voter Token Scoping', () => {
  beforeEach(() => {
    setupMockWindow();
  });

  test('1. Admin state: logged out by default when no token in localStorage', () => {
    assert.strictEqual(getAdminToken(), null);
    assert.strictEqual(getAdminUser(), null);
    assert.strictEqual(isAdminLoggedIn(), false);
  });

  test('2. Admin state: recognizes logged-in state when valid token is stored', () => {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, 'mock.jwt.token');
    window.localStorage.setItem(ADMIN_USER_KEY, JSON.stringify({ username: 'admin', email: 'admin@test.com' }));

    assert.strictEqual(getAdminToken(), 'mock.jwt.token');
    assert.deepStrictEqual(getAdminUser(), { username: 'admin', email: 'admin@test.com' });
    assert.strictEqual(isAdminLoggedIn(), true);
  });

  test('3. Admin logout: clears stored token and user profile', () => {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, 'mock.jwt.token');
    window.localStorage.setItem(ADMIN_USER_KEY, JSON.stringify({ username: 'admin' }));

    logoutAdmin();
    assert.strictEqual(getAdminToken(), null);
    assert.strictEqual(getAdminUser(), null);
    assert.strictEqual(isAdminLoggedIn(), false);
  });

  test('4. Voter tokens: null when not joined session', () => {
    assert.strictEqual(getVoterToken('sess_default'), null);
    assert.strictEqual(hasJoinedSession('sess_default'), false);
  });

  test('5. Voter tokens: retrieves session-scoped token and display name correctly', () => {
    window.sessionStorage.setItem(getVoterTokenKey('sess_default'), 'token-abc-123');
    window.sessionStorage.setItem(getVoterNameKey('sess_default'), 'Alex');

    assert.strictEqual(getVoterToken('sess_default'), 'token-abc-123');
    assert.strictEqual(getVoterDisplayName('sess_default'), 'Alex');
    assert.strictEqual(hasJoinedSession('sess_default'), true);

    // Completely isolated from other sessions
    assert.strictEqual(getVoterToken('sess_horror'), null);
    assert.strictEqual(hasJoinedSession('sess_horror'), false);
  });

  test('6. Remote action middleware: automatically enriches VOTE action with session voterToken', () => {
    window.sessionStorage.setItem(getVoterTokenKey('sess_default'), 'token-session-default');

    let emittedAction = null;
    const mockSocket = {
      emit: (event, payload) => {
        if (event === 'action') {
          emittedAction = payload;
        }
      }
    };

    const middleware = createRemoteActionMiddleware(mockSocket);
    const next = (act) => act;

    const action = {
      type: 'VOTE',
      sessionId: 'sess_default',
      entry: 'Trainspotting'
    };

    middleware({})(next)(action);

    assert.ok(emittedAction, 'Action was emitted over socket');
    assert.strictEqual(emittedAction.type, 'VOTE');
    assert.strictEqual(emittedAction.sessionId, 'sess_default');
    assert.strictEqual(emittedAction.voterToken, 'token-session-default');
    assert.strictEqual(emittedAction.meta?.voterToken, 'token-session-default');
  });

  test('7. Remote action middleware: automatically enriches NEXT action with admin JWT', () => {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, 'admin-secret-jwt-token');

    let emittedAction = null;
    const mockSocket = {
      emit: (event, payload) => {
        if (event === 'action') {
          emittedAction = payload;
        }
      }
    };

    const middleware = createRemoteActionMiddleware(mockSocket);
    const next = (act) => act;

    const action = {
      type: 'NEXT',
      sessionId: 'sess_default'
    };

    middleware({})(next)(action);

    assert.ok(emittedAction, 'Action was emitted over socket');
    assert.strictEqual(emittedAction.type, 'NEXT');
    assert.strictEqual(emittedAction.token, 'admin-secret-jwt-token');
  });
});
