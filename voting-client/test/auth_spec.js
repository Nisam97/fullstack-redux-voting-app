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
  getVoterNameKey,
  joinVoterSession,
  clearVoterSession,
  requestOtp,
  verifyOtp,
  getVoterProfile,
  updateVoterProfile,
  logoutVoter
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

  describe('Feature 7: Passwordless Voter Authentication Service Client APIs (AC-1, AC-2, AC-8, AC-9, AC-10)', () => {
    const originalFetch = globalThis.fetch;

    test.afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('8. joinVoterSession: stores token and name, emits subscribe_session on success', async () => {
      let emittedEvent = null;
      let emittedPayload = null;
      socket.emit = (event, payload) => {
        emittedEvent = event;
        emittedPayload = payload;
      };

      globalThis.fetch = async (url, options) => {
        assert.ok(url.includes('/api/sessions/sess_alpha/join'));
        assert.strictEqual(options.method, 'POST');
        assert.strictEqual(options.credentials, 'include');
        const body = JSON.parse(options.body);
        assert.strictEqual(body.displayName, 'Taylor');

        return {
          ok: true,
          json: async () => ({
            success: true,
            voterToken: 'token_alpha_123',
            displayName: 'Taylor',
            voterCount: 3
          })
        };
      };

      const result = await joinVoterSession({ sessionId: 'sess_alpha', displayName: 'Taylor' });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.voterToken, 'token_alpha_123');
      assert.strictEqual(result.displayName, 'Taylor');
      assert.strictEqual(getVoterToken('sess_alpha'), 'token_alpha_123');
      assert.strictEqual(getVoterDisplayName('sess_alpha'), 'Taylor');
      assert.strictEqual(emittedEvent, 'subscribe_session');
      assert.deepStrictEqual(emittedPayload, { sessionId: 'sess_alpha', voterToken: 'token_alpha_123' });

      clearVoterSession('sess_alpha');
      assert.strictEqual(getVoterToken('sess_alpha'), null);
      assert.strictEqual(getVoterDisplayName('sess_alpha'), null);
    });

    test('9. joinVoterSession: rejects empty inputs and handles network errors', async () => {
      const emptySession = await joinVoterSession({ sessionId: '', displayName: 'Taylor' });
      assert.strictEqual(emptySession.success, false);
      assert.strictEqual(emptySession.error, 'INVALID_SESSION');

      const emptyName = await joinVoterSession({ sessionId: 'sess_1', displayName: '   ' });
      assert.strictEqual(emptyName.success, false);
      assert.strictEqual(emptyName.error, 'INVALID_DISPLAY_NAME');

      globalThis.fetch = async () => {
        throw new Error('Connection refused');
      };

      const netErr = await joinVoterSession({ sessionId: 'sess_1', displayName: 'Taylor' });
      assert.strictEqual(netErr.success, false);
      assert.strictEqual(netErr.error, 'NETWORK_ERROR');
    });

    test('10. requestOtp: sends POST to /api/auth/otp/request and returns generic success (AC-1, AC-6)', async () => {
      let requestedUrl = null;
      let requestedOptions = null;

      globalThis.fetch = async (url, options) => {
        requestedUrl = url;
        requestedOptions = options;
        return {
          ok: true,
          json: async () => ({
            success: true,
            message: 'If an account exists or can be created, a code was sent.'
          })
        };
      };

      const res = await requestOtp({ email: 'voter@example.com', name: 'Sam', username: 'sam_v' });
      assert.strictEqual(res.success, true);
      assert.ok(requestedUrl.includes('/api/auth/otp/request'));
      assert.strictEqual(requestedOptions.method, 'POST');
      assert.strictEqual(requestedOptions.credentials, 'include');
      const body = JSON.parse(requestedOptions.body);
      assert.strictEqual(body.email, 'voter@example.com');
      assert.strictEqual(body.name, 'Sam');
      assert.strictEqual(body.username, 'sam_v');
    });

    test('11. requestOtp: handles cooldown and network error', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        json: async () => ({
          success: false,
          error: 'COOLDOWN_ACTIVE',
          retryAfterSeconds: 45
        })
      });

      const res = await requestOtp({ email: 'cooldown@example.com' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'COOLDOWN_ACTIVE');
      assert.strictEqual(res.retryAfterSeconds, 45);

      globalThis.fetch = async () => {
        throw new Error('Failed to fetch');
      };

      const netRes = await requestOtp({ email: 'test@example.com' });
      assert.strictEqual(netRes.success, false);
      assert.strictEqual(netRes.error, 'NETWORK_ERROR');
    });

    test('12. verifyOtp: sends POST to /api/auth/otp/verify and receives voter profile (AC-2, AC-5)', async () => {
      globalThis.fetch = async (url, options) => {
        assert.ok(url.includes('/api/auth/otp/verify'));
        assert.strictEqual(options.credentials, 'include');
        const body = JSON.parse(options.body);
        assert.strictEqual(body.code, '123456');

        return {
          ok: true,
          json: async () => ({
            success: true,
            user: { id: 'usr_verified', email: 'voter@example.com', name: 'Sam', username: 'sam_v' },
            isNewUser: true
          })
        };
      };

      const res = await verifyOtp({ email: 'voter@example.com', code: '123456' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.user.id, 'usr_verified');
      assert.strictEqual(res.isNewUser, true);
    });

    test('13. verifyOtp: handles invalid code and reports remainingAttempts', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        json: async () => ({
          success: false,
          error: 'INVALID_CODE',
          remainingAttempts: 4
        })
      });

      const res = await verifyOtp({ email: 'voter@example.com', code: '000000' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'INVALID_CODE');
      assert.strictEqual(res.remainingAttempts, 4);
    });

    test('14. getVoterProfile: calls /api/auth/voter/me with credentials include (AC-8)', async () => {
      globalThis.fetch = async (url, options) => {
        assert.ok(url.includes('/api/auth/voter/me'));
        assert.strictEqual(options.credentials, 'include');
        assert.strictEqual(options.method, 'GET');
        return {
          ok: true,
          json: async () => ({
            success: true,
            user: { id: 'usr_me', email: 'me@example.com', name: 'Me' }
          })
        };
      };

      const res = await getVoterProfile();
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.user.id, 'usr_me');

      globalThis.fetch = async () => ({
        ok: false,
        json: async () => ({ success: false, error: 'UNAUTHORIZED' })
      });

      const unauth = await getVoterProfile();
      assert.strictEqual(unauth.success, false);
      assert.strictEqual(unauth.error, 'UNAUTHORIZED');

      globalThis.fetch = async () => {
        throw new Error('Network failure');
      };

      const netErr = await getVoterProfile();
      assert.strictEqual(netErr.success, false);
      assert.strictEqual(netErr.error, 'NETWORK_ERROR');
    });

    test('15. updateVoterProfile: updates profile fields and handles conflict (AC-9)', async () => {
      globalThis.fetch = async (url, options) => {
        assert.ok(url.includes('/api/auth/profile'));
        assert.strictEqual(options.credentials, 'include');
        const body = JSON.parse(options.body);
        assert.strictEqual(body.name, 'New Name');

        return {
          ok: true,
          json: async () => ({
            success: true,
            user: { id: 'usr_me', name: 'New Name', username: 'sam_v' }
          })
        };
      };

      const res = await updateVoterProfile({ name: 'New Name' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.user.name, 'New Name');

      globalThis.fetch = async () => ({
        ok: false,
        json: async () => ({ success: false, error: 'USERNAME_TAKEN' })
      });

      const conflict = await updateVoterProfile({ username: 'taken' });
      assert.strictEqual(conflict.success, false);
      assert.strictEqual(conflict.error, 'USERNAME_TAKEN');
    });

    test('16. logoutVoter: posts to /api/auth/logout with credentials include (AC-10)', async () => {
      let loggedOut = false;
      globalThis.fetch = async (url, options) => {
        assert.ok(url.includes('/api/auth/logout'));
        assert.strictEqual(options.credentials, 'include');
        assert.strictEqual(options.method, 'POST');
        loggedOut = true;
        return {
          ok: true,
          json: async () => ({ success: true })
        };
      };

      const res = await logoutVoter();
      assert.strictEqual(res.success, true);
      assert.strictEqual(loggedOut, true);

      globalThis.fetch = async () => {
        throw new Error('Network error');
      };

      const failed = await logoutVoter();
      assert.strictEqual(failed.success, false);
    });
  });
});
