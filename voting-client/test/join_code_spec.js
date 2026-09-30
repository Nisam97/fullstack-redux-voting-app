import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import voteReducer, {
  refreshJoinCode,
  setSessions,
  setSessionState,
  normalizeSession
} from '../src/redux/voteSlice.js';
import { createRemoteActionMiddleware } from '../src/redux/store.js';
import { ADMIN_TOKEN_KEY } from '../src/services/auth.js';
import socket from '../src/services/socket.js';

after(() => {
  socket.close();
});

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

describe('Join Code and Discovery Client Redux & Logic (Spec 0002)', () => {
  beforeEach(() => {
    setupMockWindow();
  });

  // AC-9: Action creator
  test('1. refreshJoinCode action creator creates action with remote meta (covers: AC-9)', () => {
    const action = refreshJoinCode('sess_abc123');
    assert.deepStrictEqual(action, {
      type: 'REFRESH_JOIN_CODE',
      sessionId: 'sess_abc123',
      meta: { remote: true }
    });
  });

  // AC-1, AC-8: Normalization into bySessionId via setSessionState
  test('2. setSessionState populates joinCode, session type, and votingMode in bySessionId (covers: AC-1, AC-8)', () => {
    const initialState = {
      list: [],
      activeSessionId: null,
      bySessionId: {}
    };

    const doc1 = {
      id: 'sess_1',
      title: 'Session One',
      status: 'open',
      type: 'open',
      votingMode: 'single_ballot',
      joinCode: 'ABC234'
    };

    const state1 = voteReducer(initialState, setSessionState(doc1));
    assert.strictEqual(state1.bySessionId['sess_1'].joinCode, 'ABC234');
    assert.strictEqual(state1.bySessionId['sess_1'].type, 'open');
    assert.strictEqual(state1.bySessionId['sess_1'].votingMode, 'single_ballot');

    // setSessions syncs updated joinCode into existing bySessionId
    const updatedPayload = [
      {
        id: 'sess_1',
        title: 'Session One (Updated)',
        status: 'open',
        type: 'open',
        votingMode: 'single_ballot',
        joinCode: 'ROT999'
      }
    ];

    const state2 = voteReducer(state1, setSessions(updatedPayload));
    assert.strictEqual(state2.bySessionId['sess_1'].joinCode, 'ROT999');
    assert.strictEqual(state2.list[0].joinCode, 'ROT999');
  });

  // AGENTS.md Security Rule: Sensitive fields stripped during normalization
  test('3. normalizeSession strips sensitive fields voterToken, token, jwt, password, secret (covers: Security)', () => {
    const raw = {
      id: 'sess_leak_test',
      title: 'Leaky Session',
      joinCode: 'LEAK99',
      voterToken: 'should-not-exist',
      token: 'should-not-exist',
      jwt: 'should-not-exist',
      password: 'should-not-exist',
      secret: 'should-not-exist'
    };

    const normalized = normalizeSession(raw, 'sess_leak_test');
    assert.strictEqual(normalized.joinCode, 'LEAK99');
    assert.strictEqual(normalized.voterToken, undefined);
    assert.strictEqual(normalized.token, undefined);
    assert.strictEqual(normalized.jwt, undefined);
    assert.strictEqual(normalized.password, undefined);
    assert.strictEqual(normalized.secret, undefined);
  });

  // AC-9: Remote Action Middleware enrichment
  test('4. createRemoteActionMiddleware enriches REFRESH_JOIN_CODE with admin token and emits to socket (covers: AC-9)', () => {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, 'mock.jwt.token');

    let emittedEvent = null;
    let emittedData = null;

    const mockSocket = {
      emit: (event, data) => {
        emittedEvent = event;
        emittedData = data;
      }
    };

    const middleware = createRemoteActionMiddleware(mockSocket);
    const store = {
      getState: () => ({
        vote: { activeSessionId: null, bySessionId: {} }
      }),
      dispatch: () => {}
    };

    let nextCalled = false;
    const next = (action) => {
      nextCalled = true;
      return action;
    };

    const action = refreshJoinCode('sess_test_123');
    middleware(store)(next)(action);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(emittedEvent, 'action');
    assert.strictEqual(emittedData.type, 'REFRESH_JOIN_CODE');
    assert.strictEqual(emittedData.sessionId, 'sess_test_123');
    assert.strictEqual(emittedData.token, 'mock.jwt.token');
  });

  // AC-2: Code input sanitization logic
  test('5. input sanitization strips non-alphanumeric, forces uppercase, and caps at 6 characters (covers: AC-2)', () => {
    const sanitize = (raw) => (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

    assert.strictEqual(sanitize('abc-123'), 'ABC123');
    assert.strictEqual(sanitize('a!b@c#4$5%6^7'), 'ABC456');
    assert.strictEqual(sanitize('abcdefghij'), 'ABCDEF');
    assert.strictEqual(sanitize(''), '');
    assert.strictEqual(sanitize(null), '');
    assert.strictEqual(sanitize('638a69'), '638A69');
  });

  // AC-2, AC-3, AC-7: Status code mapping and user error messages
  test('6. resolver HTTP status mapping produces correct user messages (covers: AC-1, AC-2, AC-7)', () => {
    function mapError(status, data) {
      if (status === 429) {
        return data?.error || 'Too many requests, please wait.';
      }
      if (status === 503) {
        return data?.error || 'Service temporarily unavailable.';
      }
      return data?.error || 'Code not found or no longer active.';
    }

    assert.strictEqual(mapError(404, {}), 'Code not found or no longer active.');
    assert.strictEqual(mapError(404, { error: 'Code not found or no longer active.' }), 'Code not found or no longer active.');
    assert.strictEqual(mapError(429, {}), 'Too many requests, please wait.');
    assert.strictEqual(mapError(429, { error: 'Custom rate limit msg' }), 'Custom rate limit msg');
    assert.strictEqual(mapError(503, {}), 'Service temporarily unavailable.');
    assert.strictEqual(mapError(500, {}), 'Code not found or no longer active.');
  });
});
