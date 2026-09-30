import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  presenceUpdate,
  lobbyUpdate,
  setSessionState,
  selectConnectedCount,
  selectTotalVoters,
  selectSessionById,
  initialState
} from '../src/redux/voteSlice.js';
import {
  subscribeSession,
  connectSocketToStore,
  clearSubscriptions,
  disconnectSocket
} from '../src/services/socket.js';

after(() => {
  try {
    disconnectSocket();
  } catch {
    // harmless
  }
});

describe('Phase 5: Client Presence and Eligibility (AC-8, AC-10)', () => {
  describe('1. presenceUpdate Reducer Transitions and State Isolation (AC-8)', () => {
    it('initializes connectedCount and totalVoters on presenceUpdate', () => {
      // covers: AC-8
      const action = presenceUpdate('sess_1', {
        sessionId: 'sess_1',
        connectedCount: 3,
        totalVoters: 5
      });

      const state = voteReducer(initialState, action);
      const session = selectSessionById(state, 'sess_1');

      assert.equal(session.connectedCount, 3);
      assert.equal(session.totalVoters, 5);
      assert.equal(session.voterCount, 5);
    });

    it('updates connectedCount for existing session while preserving other fields', () => {
      // covers: AC-8
      let state = voteReducer(
        initialState,
        setSessionState('sess_1', {
          id: 'sess_1',
          title: 'Movie Night',
          status: 'open',
          entries: ['Alien', 'Predator'],
          connectedCount: 2,
          totalVoters: 4
        })
      );

      state = voteReducer(
        state,
        presenceUpdate('sess_1', {
          connectedCount: 1,
          totalVoters: 4
        })
      );

      const session = selectSessionById(state, 'sess_1');
      assert.equal(session.title, 'Movie Night');
      assert.equal(session.status, 'open');
      assert.equal(session.connectedCount, 1);
      assert.equal(session.totalVoters, 4);
    });

    it('guarantees multi-session isolation across presence updates', () => {
      // covers: AC-8
      let state = voteReducer(
        initialState,
        setSessionState('sess_A', { id: 'sess_A', title: 'Session A', connectedCount: 2 })
      );
      state = voteReducer(
        state,
        setSessionState('sess_B', { id: 'sess_B', title: 'Session B', connectedCount: 5 })
      );

      state = voteReducer(
        state,
        presenceUpdate('sess_A', {
          sessionId: 'sess_A',
          connectedCount: 1,
          totalVoters: 3
        })
      );

      assert.equal(selectConnectedCount(state, 'sess_A'), 1);
      assert.equal(selectConnectedCount(state, 'sess_B'), 5);
    });

    it('synchronizes connectedCount in state.list when summary item is present', () => {
      // covers: AC-8
      const stateWithList = {
        ...initialState,
        list: [
          { id: 'sess_1', title: 'Session 1', connectedCount: 0, voterCount: 2 }
        ],
        bySessionId: {}
      };

      const nextState = voteReducer(
        stateWithList,
        presenceUpdate('sess_1', {
          sessionId: 'sess_1',
          connectedCount: 4,
          totalVoters: 6
        })
      );

      assert.equal(nextState.list[0].connectedCount, 4);
      assert.equal(nextState.list[0].totalVoters, 6);
      assert.equal(nextState.list[0].voterCount, 6);
    });

    it('safely handles malformed presence update payloads without throwing', () => {
      // covers: AC-8
      const nullState = voteReducer(initialState, { type: 'PRESENCE_UPDATE', payload: null });
      assert.deepEqual(nullState, initialState);

      const emptyIdState = voteReducer(initialState, {
        type: 'PRESENCE_UPDATE',
        payload: { sessionId: '   ' }
      });
      assert.deepEqual(emptyIdState, initialState);
    });
  });

  describe('2. lobbyUpdate Reducer Connected Count Synchronization (AC-8)', () => {
    it('stores connectedCount from augmented lobby_update payload', () => {
      // covers: AC-8
      const action = lobbyUpdate('sess_lobby', {
        sessionId: 'sess_lobby',
        voterCount: 8,
        connectedCount: 3
      });

      const state = voteReducer(initialState, action);
      const session = selectSessionById(state, 'sess_lobby');

      assert.equal(session.voterCount, 8);
      assert.equal(session.connectedCount, 3);
    });

    it('preserves existing connectedCount or defaults safely to 0 when omitted', () => {
      // covers: AC-8
      const actionNew = lobbyUpdate('sess_legacy_new', {
        sessionId: 'sess_legacy_new',
        voterCount: 4
      });

      let state = voteReducer(initialState, actionNew);
      let session = selectSessionById(state, 'sess_legacy_new');
      assert.equal(session.voterCount, 4);
      assert.equal(session.connectedCount, 0);

      // Existing session with connectedCount: 2 receives update omitting connectedCount
      state = voteReducer(
        state,
        presenceUpdate('sess_legacy_new', { connectedCount: 2, totalVoters: 4 })
      );
      state = voteReducer(
        state,
        lobbyUpdate('sess_legacy_new', { sessionId: 'sess_legacy_new', voterCount: 5 })
      );
      session = selectSessionById(state, 'sess_legacy_new');
      assert.equal(session.voterCount, 5);
      assert.equal(session.connectedCount, 2);
    });
  });

  describe('3. Normalization Security Guard Against Leaked Secrets (AC-10)', () => {
    it('strips voterToken, token, jwt, password, and secret from session state', () => {
      // covers: AC-10
      const maliciousPayload = {
        id: 'sess_sec',
        title: 'Security Test Session',
        status: 'open',
        voterToken: 'secret_voter_token_abc123',
        token: 'secret_jwt_xyz789',
        jwt: 'header.payload.signature',
        password: 'raw_admin_password',
        secret: 'session_hmac_secret',
        connectedCount: 2,
        totalVoters: 2
      };

      const state = voteReducer(initialState, setSessionState('sess_sec', maliciousPayload));
      const session = selectSessionById(state, 'sess_sec');

      assert.equal(session.voterToken, undefined);
      assert.equal(session.token, undefined);
      assert.equal(session.jwt, undefined);
      assert.equal(session.password, undefined);
      assert.equal(session.secret, undefined);
      assert.equal(session.connectedCount, 2);
      assert.equal(session.totalVoters, 2);
    });

    it('strips raw presence and snapshot structures from session state', () => {
      // covers: AC-10
      const leakedStructuresPayload = {
        id: 'sess_leak',
        title: 'Leak Guard Session',
        status: 'open',
        presence: {
          tok_1: { socketIds: ['sock_1'], connected: true }
        },
        snapshots: {
          'sess_leak:::r1': { eligibleVoterKeys: ['tok_1'] }
        },
        connectedCount: 1,
        totalVoters: 1
      };

      const state = voteReducer(initialState, setSessionState('sess_leak', leakedStructuresPayload));
      const session = selectSessionById(state, 'sess_leak');

      assert.equal(session.presence, undefined);
      assert.equal(session.snapshots, undefined);
      assert.equal(session.connectedCount, 1);
    });
  });

  describe('4. Connected Count and Total Voters Selectors (AC-8)', () => {
    it('selectConnectedCount returns numeric value or defaults to 0', () => {
      // covers: AC-8
      const stateWithConnected = voteReducer(
        initialState,
        setSessionState('sess_sel', { id: 'sess_sel', connectedCount: 7 })
      );
      assert.equal(selectConnectedCount(stateWithConnected, 'sess_sel'), 7);

      const stateWithoutConnected = voteReducer(
        initialState,
        setSessionState('sess_sel2', { id: 'sess_sel2' })
      );
      assert.equal(selectConnectedCount(stateWithoutConnected, 'sess_sel2'), 0);
      assert.equal(selectConnectedCount(initialState, 'sess_nonexistent'), 0);
    });

    it('selectTotalVoters returns totalVoters or falls back to voterCount', () => {
      // covers: AC-8
      const stateWithTotal = voteReducer(
        initialState,
        setSessionState('sess_tot', { id: 'sess_tot', totalVoters: 12, voterCount: 10 })
      );
      assert.equal(selectTotalVoters(stateWithTotal, 'sess_tot'), 12);

      const stateWithFallback = voteReducer(
        initialState,
        setSessionState('sess_fb', { id: 'sess_fb', voterCount: 9 })
      );
      assert.equal(selectTotalVoters(stateWithFallback, 'sess_fb'), 9);
    });
  });

  describe('5. Client Socket Subscription Presence Token Wiring (Blocker 2, AC-2, AC-8)', () => {
    it('subscribeSession emits only sessionId when no voter token is stored', () => {
      // covers: AC-8, Blocker 2
      clearSubscriptions();
      const emitted = [];
      const mockSocket = {
        emit: (evt, data) => emitted.push({ evt, data })
      };

      subscribeSession('sess_anon', mockSocket);

      assert.equal(emitted.length, 1);
      assert.equal(emitted[0].evt, 'subscribe_session');
      assert.deepEqual(emitted[0].data, { sessionId: 'sess_anon' });
    });

    it('subscribeSession attaches voterToken from override or storage when present', () => {
      // covers: AC-2, AC-8, Blocker 2
      clearSubscriptions();
      const emitted = [];
      const mockSocket = {
        emit: (evt, data) => emitted.push({ evt, data })
      };

      subscribeSession('sess_voter', mockSocket, 'tok_override_123');

      assert.equal(emitted.length, 1);
      assert.equal(emitted[0].evt, 'subscribe_session');
      assert.deepEqual(emitted[0].data, {
        sessionId: 'sess_voter',
        voterToken: 'tok_override_123'
      });
    });

    it('subscribeSession attaches voterToken from window.sessionStorage automatically', () => {
      // covers: AC-2, AC-8, Blocker 2
      clearSubscriptions();
      const originalWindow = globalThis.window;
      const fakeStorage = new Map();
      fakeStorage.set('votesphere_voter_token_sess_storage', 'tok_from_session_storage');
      globalThis.window = {
        sessionStorage: {
          getItem: (key) => fakeStorage.get(key) || null
        }
      };

      try {
        const emitted = [];
        const mockSocket = {
          emit: (evt, data) => emitted.push({ evt, data })
        };

        subscribeSession('sess_storage', mockSocket);

        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].evt, 'subscribe_session');
        assert.deepEqual(emitted[0].data, {
          sessionId: 'sess_storage',
          voterToken: 'tok_from_session_storage'
        });
      } finally {
        globalThis.window = originalWindow;
      }
    });

    it('subscribeSession falls back to window.localStorage when sessionStorage has no token', () => {
      // covers: AC-2, AC-8, Blocker 2
      clearSubscriptions();
      const originalWindow = globalThis.window;
      const fakeLocalStorage = new Map();
      fakeLocalStorage.set('votesphere_voter_token_sess_local', 'tok_from_local_storage');
      globalThis.window = {
        sessionStorage: {
          getItem: () => null
        },
        localStorage: {
          getItem: (key) => fakeLocalStorage.get(key) || null
        }
      };

      try {
        const emitted = [];
        const mockSocket = {
          emit: (evt, data) => emitted.push({ evt, data })
        };

        subscribeSession('sess_local', mockSocket);

        assert.equal(emitted.length, 1);
        assert.equal(emitted[0].evt, 'subscribe_session');
        assert.deepEqual(emitted[0].data, {
          sessionId: 'sess_local',
          voterToken: 'tok_from_local_storage'
        });
      } finally {
        globalThis.window = originalWindow;
      }
    });

    it('reconnect in connectSocketToStore preserves session subscriptions and restores tokens', () => {
      // covers: AC-2, AC-8, Blocker 2
      clearSubscriptions();
      const originalWindow = globalThis.window;
      const fakeStorage = new Map();
      fakeStorage.set('votesphere_voter_token_sess_rec_1', 'tok_rec_restored');
      globalThis.window = {
        sessionStorage: {
          getItem: (key) => fakeStorage.get(key) || null
        }
      };

      try {
        const listeners = {};
        const emitted = [];
        const mockSocket = {
          on: (evt, fn) => { listeners[evt] = fn; },
          off: () => {},
          emit: (evt, data) => emitted.push({ evt, data })
        };
        const mockStore = {
          dispatch: () => {}
        };

        connectSocketToStore(mockStore, mockSocket);
        subscribeSession('sess_rec_1', mockSocket);

        // Trigger reconnect
        emitted.length = 0;
        listeners['connect']();

        const subEmits = emitted.filter(e => e.evt === 'subscribe_session');
        assert.equal(subEmits.length, 1);
        assert.deepEqual(subEmits[0].data, {
          sessionId: 'sess_rec_1',
          voterToken: 'tok_rec_restored'
        });
      } finally {
        globalThis.window = originalWindow;
      }
    });
  });
});
