import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  lobbyUpdate,
  setSessionState,
  selectSessionById,
  selectVoterCount,
  selectSessionStatus,
  selectHasLoaded,
  initialState
} from '../src/redux/voteSlice.js';
import {
  getVoterTokenKey,
  getVoterNameKey,
  getVoterToken,
  getVoterDisplayName,
  hasJoinedSession,
  clearVoterSession,
  joinVoterSession
} from '../src/services/auth.js';
import {
  subscribeSession,
  unsubscribeSession,
  getSubscribedSessions,
  clearSubscriptions,
  connectSocketToStore
} from '../src/services/socket.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

function setupMockWindow() {
  const localMap = new Map();
  const sessionMap = new Map();

  globalThis.window = {
    location: {
      origin: 'http://localhost:5173'
    },
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

describe('Stage E — Waiting Room Lobby UI & Live Headcount', () => {
  beforeEach(() => {
    setupMockWindow();
    clearSubscriptions();
  });

  afterEach(() => {
    clearSubscriptions();
  });

  // -------------------------------------------------------------
  // 1. Participant Display Name Join & Local Validation
  // -------------------------------------------------------------
  describe('1. Participant Display Name Join & Validation', () => {
    test('local validation: rejects empty or whitespace-only display name', async () => {
      const emptyRes = await joinVoterSession({ sessionId: 'sess_default', displayName: '' });
      assert.strictEqual(emptyRes.success, false);
      assert.strictEqual(emptyRes.error, 'INVALID_DISPLAY_NAME');

      const whitespaceRes = await joinVoterSession({ sessionId: 'sess_default', displayName: '   ' });
      assert.strictEqual(whitespaceRes.success, false);
      assert.strictEqual(whitespaceRes.error, 'INVALID_DISPLAY_NAME');
    });

    test('local validation: rejects missing sessionId', async () => {
      const missingSession = await joinVoterSession({ sessionId: '', displayName: 'Alice' });
      assert.strictEqual(missingSession.success, false);
      assert.strictEqual(missingSession.error, 'INVALID_SESSION');
    });

    test('successful join stores session-scoped voter token and display name without leakage', async () => {
      // Mock global fetch for join endpoint
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        assert.ok(url.includes('/api/sessions/sess_default/join'));
        const body = JSON.parse(options.body);
        assert.strictEqual(body.displayName, 'Alice');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            voterToken: 'voter_tok_abc123',
            displayName: 'Alice',
            sessionId: 'sess_default',
            voterCount: 3
          })
        };
      };

      try {
        const result = await joinVoterSession({ sessionId: 'sess_default', displayName: 'Alice' });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.voterToken, 'voter_tok_abc123');
        assert.strictEqual(result.displayName, 'Alice');
        assert.strictEqual(result.voterCount, 3);

        // Verify session-scoped storage
        assert.strictEqual(hasJoinedSession('sess_default'), true);
        assert.strictEqual(getVoterToken('sess_default'), 'voter_tok_abc123');
        assert.strictEqual(getVoterDisplayName('sess_default'), 'Alice');

        // Verify isolation: sess_horror has NOT been joined
        assert.strictEqual(hasJoinedSession('sess_horror'), false);
        assert.strictEqual(getVoterToken('sess_horror'), null);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('handles join errors from server gracefully (e.g. 404 or 409) with user-readable message', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          success: false,
          error: 'SESSION_ARCHIVED',
          message: 'Cannot join an archived session.'
        })
      });

      try {
        const result = await joinVoterSession({ sessionId: 'sess_archived', displayName: 'Bob' });
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, 'SESSION_ARCHIVED');
        assert.strictEqual(result.message, 'Cannot join an archived session.');
        assert.strictEqual(hasJoinedSession('sess_archived'), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // -------------------------------------------------------------
  // 2. Session-Scoped Voter Isolation
  // -------------------------------------------------------------
  describe('2. Session-Scoped Voter Isolation', () => {
    test('distinct sessions have independent voter token and display name keys', () => {
      window.sessionStorage.setItem(getVoterTokenKey('sess_default'), 'tok_default');
      window.sessionStorage.setItem(getVoterNameKey('sess_default'), 'Alice');

      window.sessionStorage.setItem(getVoterTokenKey('sess_horror'), 'tok_horror');
      window.sessionStorage.setItem(getVoterNameKey('sess_horror'), 'Bob');

      assert.strictEqual(getVoterToken('sess_default'), 'tok_default');
      assert.strictEqual(getVoterDisplayName('sess_default'), 'Alice');

      assert.strictEqual(getVoterToken('sess_horror'), 'tok_horror');
      assert.strictEqual(getVoterDisplayName('sess_horror'), 'Bob');

      // Clearing sess_default does not clear sess_horror
      clearVoterSession('sess_default');
      assert.strictEqual(hasJoinedSession('sess_default'), false);
      assert.strictEqual(hasJoinedSession('sess_horror'), true);
      assert.strictEqual(getVoterToken('sess_horror'), 'tok_horror');
    });
  });

  // -------------------------------------------------------------
  // 3. Waiting State & Live Headcount (lobby_update)
  // -------------------------------------------------------------
  describe('3. Waiting State & Live Headcount Updates', () => {
    test('pending session initializes with waiting state and reports voterCount', () => {
      const state = voteReducer(initialState, setSessionState({
        id: 'sess_pending',
        title: 'Spring Election',
        status: 'pending',
        voterCount: 5,
        entries: ['Option A', 'Option B']
      }));

      const session = selectSessionById(state, 'sess_pending');
      assert.strictEqual(session.status, 'pending');
      assert.strictEqual(selectSessionStatus(state, 'sess_pending'), 'pending');
      assert.strictEqual(selectVoterCount(state, 'sess_pending'), 5);
      assert.strictEqual(selectHasLoaded(state, 'sess_pending'), true);
    });

    test('lobby_update dynamically updates live headcount and status for the targeted session', () => {
      const baseState = voteReducer(initialState, setSessionState({
        id: 'sess_1',
        title: 'Movie Poll',
        status: 'pending',
        voterCount: 1
      }));

      assert.strictEqual(selectVoterCount(baseState, 'sess_1'), 1);

      // Incoming lobby update increments voter count
      const updatedState = voteReducer(baseState, lobbyUpdate({
        sessionId: 'sess_1',
        voterCount: 4
      }));

      assert.strictEqual(selectVoterCount(updatedState, 'sess_1'), 4);
    });

    test('Multi-Session Headcount Isolation: updates to sess_horror never affect sess_default', () => {
      let state = voteReducer(initialState, setSessionState({
        id: 'sess_default',
        title: 'Main Tournament',
        status: 'pending',
        voterCount: 5
      }));

      state = voteReducer(state, setSessionState({
        id: 'sess_horror',
        title: 'Horror Movies',
        status: 'pending',
        voterCount: 2
      }));

      assert.strictEqual(selectVoterCount(state, 'sess_default'), 5);
      assert.strictEqual(selectVoterCount(state, 'sess_horror'), 2);

      // Receive lobby update for sess_horror only
      state = voteReducer(state, lobbyUpdate({
        sessionId: 'sess_horror',
        voterCount: 7
      }));

      // sess_horror updated to 7, sess_default MUST remain 5
      assert.strictEqual(selectVoterCount(state, 'sess_horror'), 7);
      assert.strictEqual(selectVoterCount(state, 'sess_default'), 5);
    });
  });

  // -------------------------------------------------------------
  // 4. Lifecycle Transitions & State Navigation
  // -------------------------------------------------------------
  describe('4. Lifecycle State Transitions', () => {
    test('pending -> open transition updates status and is eligible for voting navigation', () => {
      const pendingState = voteReducer(initialState, setSessionState({
        id: 'sess_movie',
        status: 'pending',
        voterCount: 3
      }));
      assert.strictEqual(selectSessionStatus(pendingState, 'sess_movie'), 'pending');

      // Server emits session_state indicating session is now open
      const openState = voteReducer(pendingState, setSessionState({
        id: 'sess_movie',
        status: 'open',
        voterCount: 3,
        entries: ['Film 1', 'Film 2']
      }));
      assert.strictEqual(selectSessionStatus(openState, 'sess_movie'), 'open');
    });

    test('completed session displays winner and status correctly', () => {
      const state = voteReducer(initialState, setSessionState({
        id: 'sess_done',
        status: 'completed',
        winner: 'The Matrix',
        voterCount: 12
      }));

      const session = selectSessionById(state, 'sess_done');
      assert.strictEqual(session.status, 'completed');
      assert.strictEqual(session.winner, 'The Matrix');
      assert.strictEqual(selectVoterCount(state, 'sess_done'), 12);
    });

    test('archived session reflects archived status and isArchived: true', () => {
      const state = voteReducer(initialState, setSessionState({
        id: 'sess_archived',
        status: 'archived',
        isArchived: true,
        voterCount: 8
      }));

      const session = selectSessionById(state, 'sess_archived');
      assert.strictEqual(session.status, 'archived');
      assert.strictEqual(session.isArchived, true);
    });

    test('unknown session ID safely resolves without crashing', () => {
      const session = selectSessionById(initialState, 'does-not-exist');
      assert.strictEqual(session, null);
      assert.strictEqual(selectVoterCount(initialState, 'does-not-exist'), 0);
      assert.strictEqual(selectSessionStatus(initialState, 'does-not-exist'), null);
      assert.strictEqual(selectHasLoaded(initialState, 'does-not-exist'), false);
    });
  });

  // -------------------------------------------------------------
  // 5. Socket Room Subscription & Reconnection Behavior
  // -------------------------------------------------------------
  describe('5. Socket Subscription & Reconnection', () => {
    test('subscribeSession adds session to active subscription set and emits subscribe_session', () => {
      const emittedEvents = [];
      const mockSocket = {
        emit: (event, payload) => emittedEvents.push({ event, payload })
      };

      subscribeSession('sess_interactive', mockSocket);
      assert.ok(getSubscribedSessions().includes('sess_interactive'));
      assert.deepStrictEqual(emittedEvents[0], {
        event: 'subscribe_session',
        payload: { sessionId: 'sess_interactive' }
      });
    });

    test('unsubscribeSession removes session from active subscriptions', () => {
      const emittedEvents = [];
      const mockSocket = {
        emit: (event, payload) => emittedEvents.push({ event, payload })
      };

      subscribeSession('sess_interactive', mockSocket);
      assert.ok(getSubscribedSessions().includes('sess_interactive'));

      unsubscribeSession('sess_interactive', mockSocket);
      assert.ok(!getSubscribedSessions().includes('sess_interactive'));
      assert.deepStrictEqual(emittedEvents[1], {
        event: 'unsubscribe_session',
        payload: { sessionId: 'sess_interactive' }
      });
    });

    test('socket connect/reconnect restores room subscriptions and queries registry', () => {
      const emittedEvents = [];
      const handlers = {};
      const mockSocket = {
        on: (evt, fn) => { handlers[evt] = fn; },
        off: () => {},
        emit: (evt, payload) => { emittedEvents.push({ evt, payload }); }
      };

      const mockStore = {
        dispatch: () => {}
      };

      subscribeSession('sess_auto_reconnect', mockSocket);

      connectSocketToStore(mockStore, mockSocket);

      // Trigger 'connect' event (simulating reconnect)
      assert.ok(typeof handlers['connect'] === 'function');
      handlers['connect']();

      // Verify registry was queried
      assert.ok(emittedEvents.some(e => e.evt === 'sessions'));

      // Verify session room subscription was re-emitted
      assert.ok(emittedEvents.some(e => e.evt === 'subscribe_session' && e.payload?.sessionId === 'sess_auto_reconnect'));
    });
  });
});
