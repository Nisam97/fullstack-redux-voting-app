import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  initialState,
  setSessionState,
  setActiveSession,
  setTimerState,
  selectTimer,
  selectTimerBySessionId,
  TIMER_STATE,
  SET_TIMER_STATE
} from '../src/redux/voteSlice.js';
import { createAppStore, LOCAL_ACTION_TYPES, isRemoteAction } from '../src/redux/store.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 2 — Stage C: Frontend Redux Timer State', () => {

  describe('1. Timer State Model & Reducer Transitions', () => {
    it('initializes sessions with timer: null by default', () => {
      const state = voteReducer(initialState, setSessionState({
        id: 'sess_1',
        title: 'Session 1',
        status: 'open',
        entries: ['A', 'B']
      }));

      const session = state.bySessionId['sess_1'];
      assert.ok(session);
      assert.equal(session.timer, null);
    });

    it('stores running timer data strictly under bySessionId[sessionId].timer', () => {
      const expiresAt = Date.now() + 30000;
      const action = setTimerState({
        sessionId: 'sess_1',
        duration: 30,
        expiresAt,
        status: 'running'
      });

      const state = voteReducer(initialState, action);
      const session = state.bySessionId['sess_1'];

      assert.ok(session);
      assert.deepEqual(session.timer, {
        duration: 30,
        expiresAt,
        status: 'running'
      });
    });

    it('clears timer when status: null arrives for a session', () => {
      // Setup running timer
      let state = voteReducer(initialState, setTimerState({
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: Date.now() + 30000,
        status: 'running'
      }));
      assert.ok(state.bySessionId['sess_1'].timer);

      // Incoming cleared timer event
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_1',
        duration: null,
        expiresAt: null,
        status: null
      }));

      assert.equal(state.bySessionId['sess_1'].timer, null);
    });

    it('clears timer when status is stopped or expired', () => {
      let state = voteReducer(initialState, setTimerState({
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: Date.now() + 30000,
        status: 'running'
      }));

      state = voteReducer(state, setTimerState({
        sessionId: 'sess_1',
        status: 'stopped'
      }));

      assert.equal(state.bySessionId['sess_1'].timer, null);
    });

    it('safely handles missing or invalid sessionId without mutating state', () => {
      const before = { ...initialState };
      const afterNull = voteReducer(before, setTimerState({ sessionId: null, status: 'running' }));
      const afterEmpty = voteReducer(before, setTimerState({ sessionId: '   ', status: 'running' }));

      assert.deepEqual(afterNull, before);
      assert.deepEqual(afterEmpty, before);
    });
  });

  describe('2. Multi-Session Isolation', () => {
    it('updates timer for session A without altering session B', () => {
      let state = voteReducer(initialState, setSessionState({
        id: 'sess_a',
        title: 'Session A',
        status: 'open'
      }));
      state = voteReducer(state, setSessionState({
        id: 'sess_b',
        title: 'Session B',
        status: 'open'
      }));

      const expiresA = Date.now() + 20000;
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_a',
        duration: 20,
        expiresAt: expiresA,
        status: 'running'
      }));

      // Session A has timer
      assert.deepEqual(state.bySessionId['sess_a'].timer, {
        duration: 20,
        expiresAt: expiresA,
        status: 'running'
      });

      // Session B timer remains null
      assert.equal(state.bySessionId['sess_b'].timer, null);

      // Now set session B timer
      const expiresB = Date.now() + 45000;
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_b',
        duration: 45,
        expiresAt: expiresB,
        status: 'running'
      }));

      // Both retain independent timers
      assert.equal(state.bySessionId['sess_a'].timer.duration, 20);
      assert.equal(state.bySessionId['sess_b'].timer.duration, 45);
      assert.equal(state.bySessionId['sess_a'].timer.expiresAt, expiresA);
      assert.equal(state.bySessionId['sess_b'].timer.expiresAt, expiresB);

      // Clearing session A leaves session B untouched
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_a',
        status: null
      }));

      assert.equal(state.bySessionId['sess_a'].timer, null);
      assert.ok(state.bySessionId['sess_b'].timer);
      assert.equal(state.bySessionId['sess_b'].timer.duration, 45);
    });
  });

  describe('3. Session Switching', () => {
    it('switching activeSessionId preserves all session timer states', () => {
      let state = voteReducer(initialState, setSessionState({ id: 'sess_1', status: 'open' }));
      state = voteReducer(state, setSessionState({ id: 'sess_2', status: 'open' }));

      state = voteReducer(state, setTimerState({
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: 1000,
        status: 'running'
      }));
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_2',
        duration: 60,
        expiresAt: 2000,
        status: 'running'
      }));

      // Set active to sess_1
      state = voteReducer(state, setActiveSession('sess_1'));
      assert.equal(state.activeSessionId, 'sess_1');
      assert.equal(selectTimer(state)?.duration, 30);

      // Switch active to sess_2
      state = voteReducer(state, setActiveSession('sess_2'));
      assert.equal(state.activeSessionId, 'sess_2');
      assert.equal(selectTimer(state)?.duration, 60);

      // sess_1 timer record is preserved
      assert.equal(selectTimerBySessionId(state, 'sess_1')?.duration, 30);
    });
  });

  describe('4. Lifecycle & Completion Cleanup', () => {
    it('clears timer when session transitions to completed or winner is determined', () => {
      let state = voteReducer(initialState, setTimerState({
        sessionId: 'sess_comp',
        duration: 30,
        expiresAt: 5000,
        status: 'running'
      }));
      assert.ok(state.bySessionId['sess_comp'].timer);

      // Session completes with winner
      state = voteReducer(state, setSessionState({
        id: 'sess_comp',
        status: 'completed',
        winner: 'Winner A'
      }));

      assert.equal(state.bySessionId['sess_comp'].timer, null);
    });

    it('clears timer when session is archived', () => {
      let state = voteReducer(initialState, setTimerState({
        sessionId: 'sess_arch',
        duration: 30,
        expiresAt: 5000,
        status: 'running'
      }));

      state = voteReducer(state, setSessionState({
        id: 'sess_arch',
        status: 'archived',
        isArchived: true
      }));

      assert.equal(state.bySessionId['sess_arch'].timer, null);
    });
  });

  describe('5. Socket.io Integration & Reconnect Hydration', () => {
    it('binds timer_state socket event and hydrates Redux store', () => {
      const listeners = {};
      const mockSocket = {
        on: (event, handler) => { listeners[event] = handler; },
        off: () => {},
        emit: () => {}
      };

      const store = createAppStore(mockSocket);

      // Simulate incoming timer_state from server hydration
      assert.ok(typeof listeners['timer_state'] === 'function');

      const expiresAt = Date.now() + 25000;
      listeners['timer_state']({
        sessionId: 'sess_reconnect',
        duration: 25,
        expiresAt,
        status: 'running'
      });

      const session = store.getState().sessions.bySessionId['sess_reconnect'];
      assert.ok(session);
      assert.deepEqual(session.timer, {
        duration: 25,
        expiresAt,
        status: 'running'
      });
    });

    it('clears timer on socket timer_state with status null upon round completion', () => {
      const listeners = {};
      const mockSocket = {
        on: (event, handler) => { listeners[event] = handler; },
        off: () => {},
        emit: () => {}
      };

      const store = createAppStore(mockSocket);

      // Initial active timer
      listeners['timer_state']({
        sessionId: 'sess_reconnect',
        duration: 30,
        expiresAt: Date.now() + 30000,
        status: 'running'
      });
      assert.ok(store.getState().sessions.bySessionId['sess_reconnect'].timer);

      // Server emits null timer_state
      listeners['timer_state']({
        sessionId: 'sess_reconnect',
        duration: null,
        expiresAt: null,
        status: null
      });

      assert.equal(store.getState().sessions.bySessionId['sess_reconnect'].timer, null);
    });
  });

  describe('6. Echo Prevention & Remote Action Guard', () => {
    it('LOCAL_ACTION_TYPES contains timer actions and never re-emits to socket', () => {
      assert.ok(LOCAL_ACTION_TYPES.has(TIMER_STATE));
      assert.ok(LOCAL_ACTION_TYPES.has(SET_TIMER_STATE));
      assert.ok(LOCAL_ACTION_TYPES.has('sessions/timerState'));
      assert.ok(LOCAL_ACTION_TYPES.has('sessions/setTimerState'));

      assert.equal(isRemoteAction({ type: TIMER_STATE }), false);
      assert.equal(isRemoteAction({ type: SET_TIMER_STATE }), false);
      assert.equal(isRemoteAction({ type: 'sessions/timerState' }), false);
      assert.equal(isRemoteAction({ type: 'sessions/setTimerState' }), false);
    });
  });

  describe('7. Selectors', () => {
    it('selectTimer and selectTimerBySessionId accurately return timer or null', () => {
      let state = voteReducer(initialState, setSessionState({ id: 'sess_active', status: 'open' }));
      state = voteReducer(state, setActiveSession('sess_active'));

      // No timer initially
      assert.equal(selectTimer(state), null);
      assert.equal(selectTimerBySessionId(state, 'sess_active'), null);
      assert.equal(selectTimerBySessionId(state, 'unknown_id'), null);

      // With active timer
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_active',
        duration: 30,
        expiresAt: 9999,
        status: 'running'
      }));

      assert.deepEqual(selectTimer(state), {
        duration: 30,
        expiresAt: 9999,
        status: 'running'
      });
      assert.deepEqual(selectTimerBySessionId(state, 'sess_active'), {
        duration: 30,
        expiresAt: 9999,
        status: 'running'
      });
    });
  });
});
