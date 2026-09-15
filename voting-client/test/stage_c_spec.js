import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  setSessions,
  lobbyUpdate,
  normalizeSession,
  selectSessionList,
  selectSessionById,
  selectVoterCount,
  selectEntryCount,
  selectVote,
  selectWinner,
  selectSessionStatus,
  selectHasLoaded,
  initialState,
  LOBBY_UPDATE,
  SET_LOBBY_UPDATE
} from '../src/redux/voteSlice.js';
import { createAppStore, LOCAL_ACTION_TYPES } from '../src/redux/store.js';
import {
  ADMIN_TOKEN_KEY,
  ADMIN_USER_KEY,
  isAdminLoggedIn,
  logoutAdmin
} from '../src/services/auth.js';
import socket from '../src/services/socket.js';

test.after(() => {
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

describe('Stage C — Frontend Redux, Auth Guards & Routing', () => {
  beforeEach(() => {
    setupMockWindow();
  });

  afterEach(() => {
    logoutAdmin();
  });

  // -------------------------------------------------------------
  // 1. Redux: Voter Count & Session Normalization
  // -------------------------------------------------------------
  describe('1. Redux: Voter Count & Session Normalization', () => {
    test('normalizeSession preserves voterCount and entryCount', () => {
      const raw = {
        id: 'sess_default',
        title: 'Film Poll',
        status: 'open',
        voterCount: 4,
        entryCount: 2,
        entries: ['Trainspotting', '28 Days Later']
      };

      const normalized = normalizeSession(raw, 'sess_default');
      assert.strictEqual(normalized.voterCount, 4);
      assert.strictEqual(normalized.entryCount, 2);
      assert.strictEqual(normalized.status, 'open');
      assert.strictEqual(normalized.hasLoaded, true);
    });

    test('normalizeSession sanitizes and strips sensitive auth credentials', () => {
      const raw = {
        id: 'sess_default',
        title: 'Film Poll',
        voterToken: 'voter-secret-token-xyz',
        token: 'admin-jwt-secret',
        password: 'admin-password',
        secret: 'mongodb-secret-uri'
      };

      const normalized = normalizeSession(raw, 'sess_default');
      assert.strictEqual(normalized.voterToken, undefined);
      assert.strictEqual(normalized.token, undefined);
      assert.strictEqual(normalized.password, undefined);
      assert.strictEqual(normalized.secret, undefined);
    });

    test('handleSetSessions preserves voterCount in list and syncs into existing bySessionId', () => {
      const preState = {
        list: [],
        activeSessionId: 'sess_default',
        bySessionId: {
          sess_default: {
            id: 'sess_default',
            title: 'Existing Session',
            status: 'open',
            voterCount: 1,
            entries: ['A', 'B'],
            vote: { pair: ['A', 'B'], tally: { A: 1 } },
            hasLoaded: true
          }
        }
      };

      const summaryList = [
        { id: 'sess_default', title: 'Updated Title', status: 'open', voterCount: 5, entryCount: 2 },
        { id: 'sess_horror', title: 'Horror Session', status: 'pending', voterCount: 2, entryCount: 3 }
      ];

      const nextState = voteReducer(preState, setSessions(summaryList));
      assert.strictEqual(nextState.list.length, 2);
      assert.strictEqual(nextState.list[0].voterCount, 5);
      assert.strictEqual(nextState.list[1].voterCount, 2);

      // bySessionId[sess_default] must have voterCount updated to 5 while preserving vote/entries
      assert.strictEqual(nextState.bySessionId.sess_default.voterCount, 5);
      assert.deepStrictEqual(nextState.bySessionId.sess_default.entries, ['A', 'B']);
      assert.deepStrictEqual(nextState.bySessionId.sess_default.vote, { pair: ['A', 'B'], tally: { A: 1 } });
    });

    test('selectVoterCount and selectEntryCount retrieve counts correctly', () => {
      const state = {
        sessions: {
          list: [],
          activeSessionId: 'sess_default',
          bySessionId: {
            sess_default: { id: 'sess_default', voterCount: 7, entryCount: 4, entries: ['A', 'B', 'C', 'D'] },
            sess_horror: { id: 'sess_horror', voterCount: 3, entryCount: 2, entries: ['X', 'Y'] }
          }
        }
      };

      assert.strictEqual(selectVoterCount(state, 'sess_default'), 7);
      assert.strictEqual(selectVoterCount(state, 'sess_horror'), 3);
      assert.strictEqual(selectEntryCount(state, 'sess_default'), 4);
      assert.strictEqual(selectEntryCount(state, 'sess_horror'), 2);

      // Defaults to activeSessionId if sessionId omitted
      assert.strictEqual(selectVoterCount(state), 7);
      assert.strictEqual(selectEntryCount(state), 4);
    });
  });

  // -------------------------------------------------------------
  // 2. Redux: lobby_update & Session Isolation
  // -------------------------------------------------------------
  describe('2. Redux: lobby_update & Session Isolation', () => {
    test('lobby_update updates voterCount and status on target session', () => {
      const preState = {
        list: [{ id: 'sess_default', title: 'Default', status: 'pending', voterCount: 0 }],
        activeSessionId: 'sess_default',
        bySessionId: {
          sess_default: {
            id: 'sess_default',
            title: 'Default',
            status: 'pending',
            voterCount: 0,
            hasLoaded: true
          }
        }
      };

      const updateAction = lobbyUpdate({
        sessionId: 'sess_default',
        voterCount: 3,
        status: 'open',
        entryCount: 4,
        title: 'Default Live'
      });

      const nextState = voteReducer(preState, updateAction);

      assert.strictEqual(nextState.bySessionId.sess_default.voterCount, 3);
      assert.strictEqual(nextState.bySessionId.sess_default.status, 'open');
      assert.strictEqual(nextState.bySessionId.sess_default.title, 'Default Live');
      assert.strictEqual(nextState.list[0].voterCount, 3);
      assert.strictEqual(nextState.list[0].status, 'open');
    });

    test('Session Isolation: lobby_update for Session A NEVER mutates Session B', () => {
      const preState = {
        list: [
          { id: 'sess_default', title: 'Default', status: 'open', voterCount: 1 },
          { id: 'sess_horror', title: 'Horror', status: 'pending', voterCount: 10 }
        ],
        activeSessionId: 'sess_default',
        bySessionId: {
          sess_default: {
            id: 'sess_default',
            title: 'Default',
            status: 'open',
            voterCount: 1,
            entries: ['A', 'B'],
            hasLoaded: true
          },
          sess_horror: {
            id: 'sess_horror',
            title: 'Horror',
            status: 'pending',
            voterCount: 10,
            entries: ['H1', 'H2', 'H3'],
            hasLoaded: true
          }
        }
      };

      // Dispatched for sess_default ONLY
      const action = lobbyUpdate('sess_default', {
        voterCount: 2,
        status: 'open',
        entryCount: 2
      });

      const nextState = voteReducer(preState, action);

      // Session A updated
      assert.strictEqual(nextState.bySessionId.sess_default.voterCount, 2);

      // Session B MUST REMAIN COMPLETELY UNTOUCHED
      assert.strictEqual(nextState.bySessionId.sess_horror.voterCount, 10);
      assert.strictEqual(nextState.bySessionId.sess_horror.status, 'pending');
      assert.deepStrictEqual(nextState.bySessionId.sess_horror.entries, ['H1', 'H2', 'H3']);
      assert.strictEqual(nextState.list[1].voterCount, 10);
    });

    test('lobby_update with invalid/empty sessionId safely acts as no-op', () => {
      const preState = { ...initialState };
      const nextState1 = voteReducer(preState, lobbyUpdate(null));
      const nextState2 = voteReducer(preState, lobbyUpdate('', { voterCount: 5 }));

      assert.deepStrictEqual(nextState1, preState);
      assert.deepStrictEqual(nextState2, preState);
    });
  });

  // -------------------------------------------------------------
  // 3. Unknown Sessions Safety
  // -------------------------------------------------------------
  describe('3. Unknown Sessions Safety', () => {
    test('Selectors safely return defaults on unknown session IDs without throwing', () => {
      const state = {
        sessions: {
          list: [],
          activeSessionId: null,
          bySessionId: {}
        }
      };

      const unknownId = 'does-not-exist';

      assert.doesNotThrow(() => {
        assert.strictEqual(selectSessionById(state, unknownId), null);
        assert.strictEqual(selectVoterCount(state, unknownId), 0);
        assert.strictEqual(selectEntryCount(state, unknownId), 0);
        assert.strictEqual(selectVote(state, unknownId), null);
        assert.strictEqual(selectWinner(state, unknownId), null);
        assert.strictEqual(selectSessionStatus(state, unknownId), null);
        assert.strictEqual(selectHasLoaded(state, unknownId), false);
      });
    });

    test('Malformed/undefined root state safely resolves without error', () => {
      assert.doesNotThrow(() => {
        assert.deepStrictEqual(selectSessionList(null), []);
        assert.strictEqual(selectSessionById(null, 'any'), null);
        assert.strictEqual(selectVoterCount(null, 'any'), 0);
        assert.strictEqual(selectHasLoaded(null, 'any'), false);
      });
    });
  });

  // -------------------------------------------------------------
  // 4. Authentication Guard Logic
  // -------------------------------------------------------------
  describe('4. Authentication Guard Logic', () => {
    test('Unauthenticated user cannot pass admin check', () => {
      assert.strictEqual(isAdminLoggedIn(), false);
    });

    test('Authenticated admin passes admin check when valid token is stored', () => {
      window.localStorage.setItem(ADMIN_TOKEN_KEY, 'mock.admin.jwt');
      window.localStorage.setItem(ADMIN_USER_KEY, JSON.stringify({ username: 'admin' }));

      assert.strictEqual(isAdminLoggedIn(), true);
    });

    test('Admin logout revokes admin credentials immediately', () => {
      window.localStorage.setItem(ADMIN_TOKEN_KEY, 'mock.admin.jwt');
      assert.strictEqual(isAdminLoggedIn(), true);

      logoutAdmin();
      assert.strictEqual(isAdminLoggedIn(), false);
    });
  });

  // -------------------------------------------------------------
  // 5. Socket.io lobby_update Integration & Echo Loop Prevention
  // -------------------------------------------------------------
  describe('5. Socket.io Integration & Echo Loop Prevention', () => {
    test('LOCAL_ACTION_TYPES includes LOBBY_UPDATE and SET_LOBBY_UPDATE', () => {
      assert.ok(LOCAL_ACTION_TYPES.has(LOBBY_UPDATE));
      assert.ok(LOCAL_ACTION_TYPES.has(SET_LOBBY_UPDATE));
      assert.ok(LOCAL_ACTION_TYPES.has('sessions/lobbyUpdate'));
      assert.ok(LOCAL_ACTION_TYPES.has('sessions/setLobbyUpdate'));
    });

    test('connectSocketToStore binds lobby_update event to Redux dispatch', () => {
      let registeredHandler = null;
      let registeredOffHandler = null;

      const mockSocket = {
        on: (event, handler) => {
          if (event === 'lobby_update') registeredHandler = handler;
        },
        off: (event) => {
          if (event === 'lobby_update') registeredOffHandler = event;
        },
        emit: () => {}
      };

      const store = createAppStore(mockSocket);

      // Verify off called to prevent duplicates
      assert.strictEqual(registeredOffHandler, 'lobby_update');
      assert.ok(typeof registeredHandler === 'function');

      // Trigger incoming server lobby_update
      registeredHandler({
        sessionId: 'sess_default',
        voterCount: 8,
        status: 'open',
        entryCount: 4,
        title: 'Live Tournament'
      });

      const updatedState = store.getState();
      assert.strictEqual(selectVoterCount(updatedState, 'sess_default'), 8);
      assert.strictEqual(selectSessionById(updatedState, 'sess_default').title, 'Live Tournament');
    });
  });
});
