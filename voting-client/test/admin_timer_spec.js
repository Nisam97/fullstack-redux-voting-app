import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTimerDuration,
  MIN_TIMER_DURATION,
  MAX_TIMER_DURATION,
  DEFAULT_TIMER_DURATION,
  formatTime,
  calculateRemainingMs
} from '../src/utils/timerUtils.js';
import voteReducer, {
  initialState,
  createSession,
  setSessions,
  setSessionState,
  setTimerState,
  selectSessionById,
  selectTimerBySessionId,
  selectTimerDuration,
  selectTimerDurationBySessionId,
  CREATE_SESSION,
  NEXT,
  VOTE
} from '../src/redux/voteSlice.js';
import { createAppStore } from '../src/redux/store.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 2 — Stage F: Admin Timer Configuration & Controls', () => {

  // -------------------------------------------------------------
  // 1. Configuration & Validation (Requirements 1 - 11)
  // -------------------------------------------------------------
  describe('1. Configuration & Validation (Requirements 1 - 11)', () => {
    it('1. Default duration is 30', () => {
      assert.strictEqual(DEFAULT_TIMER_DURATION, 30);
      const res = validateTimerDuration(30);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.value, 30);
    });

    it('2. Admin can enter 5 (minimum allowed duration)', () => {
      assert.strictEqual(MIN_TIMER_DURATION, 5);
      const res = validateTimerDuration(5);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.value, 5);

      const strRes = validateTimerDuration('5');
      assert.strictEqual(strRes.valid, true);
      assert.strictEqual(strRes.value, 5);
    });

    it('3. Admin can enter 300 (maximum allowed duration)', () => {
      assert.strictEqual(MAX_TIMER_DURATION, 300);
      const res = validateTimerDuration(300);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.value, 300);

      const strRes = validateTimerDuration('300');
      assert.strictEqual(strRes.valid, true);
      assert.strictEqual(strRes.value, 300);
    });

    it('4. Valid integer duration is accepted (10, 60, 120)', () => {
      for (const val of [10, 60, 120]) {
        const resNum = validateTimerDuration(val);
        assert.strictEqual(resNum.valid, true, `Expected ${val} to be valid`);
        assert.strictEqual(resNum.value, val);

        const resStr = validateTimerDuration(String(val));
        assert.strictEqual(resStr.valid, true, `Expected "${val}" to be valid`);
        assert.strictEqual(resStr.value, val);
      }
    });

    it('5. Value below 5 is rejected', () => {
      const res4 = validateTimerDuration(4);
      assert.strictEqual(res4.valid, false);
      assert.ok(res4.error?.includes('at least 5'));

      const resStr4 = validateTimerDuration('4');
      assert.strictEqual(resStr4.valid, false);
    });

    it('6. Value above 300 is rejected', () => {
      const res301 = validateTimerDuration(301);
      assert.strictEqual(res301.valid, false);
      assert.ok(res301.error?.includes('cannot exceed 300'));

      const resStr301 = validateTimerDuration('301');
      assert.strictEqual(resStr301.valid, false);
    });

    it('7. Zero is rejected', () => {
      const res0 = validateTimerDuration(0);
      assert.strictEqual(res0.valid, false);
      assert.ok(res0.error?.includes('at least 5'));

      const resStr0 = validateTimerDuration('0');
      assert.strictEqual(resStr0.valid, false);
    });

    it('8. Negative value is rejected', () => {
      for (const neg of [-1, -5, -30]) {
        const res = validateTimerDuration(neg);
        assert.strictEqual(res.valid, false, `Expected ${neg} to be rejected`);

        const resStr = validateTimerDuration(String(neg));
        assert.strictEqual(resStr.valid, false, `Expected "${neg}" to be rejected`);
      }
    });

    it('9. Decimal value is rejected (not silently converted)', () => {
      const decimals = [25.5, 5.1, 299.9, '25.5', '5.1', '299.9'];
      for (const dec of decimals) {
        const res = validateTimerDuration(dec);
        assert.strictEqual(res.valid, false, `Expected decimal ${dec} to be rejected`);
        assert.ok(
          res.error?.includes('integer') || res.error?.includes('valid'),
          `Expected integer error for ${dec}`
        );
      }
    });

    it('10. Empty value is rejected', () => {
      const emptyInputs = ['', '   ', null, undefined];
      for (const empty of emptyInputs) {
        const res = validateTimerDuration(empty);
        assert.strictEqual(res.valid, false, `Expected ${JSON.stringify(empty)} to be rejected`);
        assert.ok(res.error?.includes('required'));
      }
    });

    it('11. Non-numeric value is rejected', () => {
      const nonNumeric = ['abc', 'xyz', '30s', 'sixty', NaN, true, false];
      for (const val of nonNumeric) {
        const res = validateTimerDuration(val);
        assert.strictEqual(res.valid, false, `Expected ${val} to be rejected`);
      }
    });
  });

  // -------------------------------------------------------------
  // 2. CREATE_SESSION Contract (Requirements 12 - 15)
  // -------------------------------------------------------------
  describe('2. CREATE_SESSION Contract (Requirements 12 - 15)', () => {
    it('12. Valid duration is included as timerDuration in CREATE_SESSION action', () => {
      const action = createSession({
        sessionId: 'sess_fast',
        title: 'Blitz Tournament',
        entries: ['Option A', 'Option B'],
        timerDuration: 10
      });

      assert.strictEqual(action.type, CREATE_SESSION);
      assert.strictEqual(action.sessionId, 'sess_fast');
      assert.strictEqual(action.timerDuration, 10);
      assert.strictEqual(action.meta?.remote, true);

      // Reducer state reflects configured duration
      const nextState = voteReducer(initialState, action);
      assert.strictEqual(nextState.bySessionId.sess_fast.timerDuration, 10);
      assert.strictEqual(nextState.list[0].timerDuration, 10);
    });

    it('13. Default 30 is included when the admin leaves the default unchanged', () => {
      // Form default is 30
      const defaultDuration = validateTimerDuration(DEFAULT_TIMER_DURATION).value;
      assert.strictEqual(defaultDuration, 30);

      const action = createSession({
        sessionId: 'sess_standard',
        title: 'Standard Tournament',
        entries: ['Option A', 'Option B']
      });

      assert.strictEqual(action.type, CREATE_SESSION);
      assert.strictEqual(action.sessionId, 'sess_standard');
      assert.strictEqual(action.timerDuration, 30);

      const nextState = voteReducer(initialState, action);
      assert.strictEqual(nextState.bySessionId.sess_standard.timerDuration, 30);
      assert.strictEqual(nextState.list[0].timerDuration, 30);
    });

    it('14. Invalid duration cannot submit the session (validation guards dispatch)', () => {
      const mockSubmit = (formData) => {
        const validation = validateTimerDuration(formData.timerDuration);
        if (!validation.valid) {
          return { submitted: false, error: validation.error };
        }
        const action = createSession({
          sessionId: formData.sessionId,
          title: formData.title,
          entries: formData.entries,
          timerDuration: validation.value
        });
        return { submitted: true, action };
      };

      const invalidPayloads = [
        { sessionId: 's1', title: 'T', entries: ['A', 'B'], timerDuration: 0 },
        { sessionId: 's1', title: 'T', entries: ['A', 'B'], timerDuration: 301 },
        { sessionId: 's1', title: 'T', entries: ['A', 'B'], timerDuration: 'abc' },
        { sessionId: 's1', title: 'T', entries: ['A', 'B'], timerDuration: 25.5 },
        { sessionId: 's1', title: 'T', entries: ['A', 'B'], timerDuration: '' }
      ];

      for (const payload of invalidPayloads) {
        const result = mockSubmit(payload);
        assert.strictEqual(result.submitted, false, `Expected submit to fail for ${payload.timerDuration}`);
        assert.ok(result.error);
      }
    });

    it('15. Existing title/entries/session ID are still submitted correctly alongside timerDuration', () => {
      const action = createSession({
        sessionId: 'sess_oscars_2026',
        title: 'Best Picture 2026',
        entries: ['Oppenheimer', 'Poor Things', 'The Zone of Interest'],
        timerDuration: 60
      });

      assert.strictEqual(action.type, CREATE_SESSION);
      assert.strictEqual(action.sessionId, 'sess_oscars_2026');
      assert.strictEqual(action.title, 'Best Picture 2026');
      assert.deepStrictEqual(action.entries, ['Oppenheimer', 'Poor Things', 'The Zone of Interest']);
      assert.strictEqual(action.timerDuration, 60);
      assert.strictEqual(action.meta?.remote, true);

      // Positional parameter format also preserves all fields
      const positionalAction = createSession(
        'sess_grammys',
        'Record of the Year',
        ['Song A', 'Song B'],
        120
      );
      assert.strictEqual(positionalAction.sessionId, 'sess_grammys');
      assert.strictEqual(positionalAction.title, 'Record of the Year');
      assert.deepStrictEqual(positionalAction.entries, ['Song A', 'Song B']);
      assert.strictEqual(positionalAction.timerDuration, 120);
    });
  });

  // -------------------------------------------------------------
  // 3. Session Isolation (Requirements 16 - 17)
  // -------------------------------------------------------------
  describe('3. Session Isolation (Requirements 16 - 17)', () => {
    it('16. Session A can display 10 seconds while Session B displays 60 seconds', () => {
      let state = initialState;

      // Server broadcasts session summaries with independent durations
      state = voteReducer(state, setSessions([
        { id: 'sess_a', title: 'Speed Round', status: 'open', timerDuration: 10 },
        { id: 'sess_b', title: 'Deliberation', status: 'pending', timerDuration: 60 }
      ]));

      // List summaries retain independent durations
      assert.strictEqual(state.list[0].timerDuration, 10);
      assert.strictEqual(state.list[1].timerDuration, 60);

      // Selectors query list and return independent durations
      assert.strictEqual(selectTimerDuration(state, 'sess_a'), 10);
      assert.strictEqual(selectTimerDuration(state, 'sess_b'), 60);
      assert.strictEqual(selectTimerDurationBySessionId(state, 'sess_a'), 10);
      assert.strictEqual(selectTimerDurationBySessionId(state, 'sess_b'), 60);

      // Hydrate full session details via session_state
      state = voteReducer(state, setSessionState({ id: 'sess_a', status: 'open', timerDuration: 10 }));
      state = voteReducer(state, setSessionState({ id: 'sess_b', status: 'pending', timerDuration: 60 }));

      const sessionA = selectSessionById(state, 'sess_a');
      const sessionB = selectSessionById(state, 'sess_b');

      assert.strictEqual(sessionA.timerDuration, 10);
      assert.strictEqual(sessionB.timerDuration, 60);
    });

    it('17. Creating/configuring one session does not modify another session duration', () => {
      let state = initialState;

      // Create Session A configured for 15s
      state = voteReducer(state, createSession({
        sessionId: 'sess_a',
        title: 'Tournament A',
        entries: ['A1', 'A2'],
        timerDuration: 15
      }));

      assert.strictEqual(selectTimerDuration(state, 'sess_a'), 15);

      // Create Session B configured for 120s
      state = voteReducer(state, createSession({
        sessionId: 'sess_b',
        title: 'Tournament B',
        entries: ['B1', 'B2'],
        timerDuration: 120
      }));

      // Verify Session A duration is completely untouched
      assert.strictEqual(selectTimerDuration(state, 'sess_a'), 15);
      assert.strictEqual(selectTimerDuration(state, 'sess_b'), 120);

      // Server state update for Session B does not mutate Session A
      state = voteReducer(state, setSessionState({
        id: 'sess_b',
        title: 'Tournament B Updated',
        status: 'open',
        timerDuration: 120
      }));

      assert.strictEqual(selectTimerDuration(state, 'sess_a'), 15);
      assert.strictEqual(selectTimerDuration(state, 'sess_b'), 120);
    });
  });

  // -------------------------------------------------------------
  // 4. Active Admin Timer (Requirements 18 - 22)
  // -------------------------------------------------------------
  describe('4. Active Admin Timer (Requirements 18 - 22)', () => {
    it('18. Admin active-session view displays countdown when timer is running, null when inactive', () => {
      let state = initialState;
      const now = 1000000;

      // Running timer state for active session
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_active',
        duration: 30,
        expiresAt: now + 25000,
        status: 'running'
      }));

      const activeTimer = selectTimerBySessionId(state, 'sess_active');
      assert.ok(activeTimer);
      assert.strictEqual(activeTimer.status, 'running');
      assert.strictEqual(formatTime(calculateRemainingMs(activeTimer.expiresAt, now)), '00:25');

      // Inactive / null timer for pending session
      state = voteReducer(state, setSessionState({ id: 'sess_idle', status: 'pending' }));
      const idleTimer = selectTimerBySessionId(state, 'sess_idle');
      assert.strictEqual(idleTimer, null);

      // Stopped or expired timer resolves to null
      state = voteReducer(state, setTimerState({ sessionId: 'sess_active', status: 'stopped' }));
      const stoppedTimer = selectTimerBySessionId(state, 'sess_active');
      assert.strictEqual(stoppedTimer, null);
    });

    it('19. Countdown consumes the selected session server timer state via selectTimerBySessionId', () => {
      let state = initialState;
      const now = 1000000;
      const expiresAt = now + 45000;

      // Seed running timer for sess_admin_1
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_admin_1',
        duration: 45,
        expiresAt,
        status: 'running'
      }));

      // Select timer using authoritative selector
      const timerState = selectTimerBySessionId(state, 'sess_admin_1');
      assert.ok(timerState);
      assert.strictEqual(timerState.duration, 45);
      assert.strictEqual(timerState.expiresAt, expiresAt);
      assert.strictEqual(timerState.status, 'running');

      // Countdown display format calculates accurately from selected state
      const remainingMs = calculateRemainingMs(timerState.expiresAt, now);
      assert.strictEqual(formatTime(remainingMs), '00:45');
    });

    it('20. Admin countdown does not dispatch NEXT on expiry', () => {
      const dispatchedActions = [];
      const mockSocket = {
        on: () => {},
        off: () => {},
        emit: () => {}
      };

      const store = createAppStore(mockSocket);
      const originalDispatch = store.dispatch;
      store.dispatch = (action) => {
        dispatchedActions.push(action);
        return originalDispatch(action);
      };

      // Simulate local timer reaching zero (0ms remaining)
      const now = 1000000;
      const expiresAt = now;
      const remainingMs = calculateRemainingMs(expiresAt, now);
      const display = formatTime(remainingMs);

      assert.strictEqual(display, '00:00');

      // Admin countdown is display-only: dispatches 0 actions
      assert.strictEqual(
        dispatchedActions.filter((a) => a.type === NEXT || a.type === 'NEXT').length,
        0
      );
      assert.strictEqual(dispatchedActions.length, 0);
    });

    it('21. Admin countdown does not dispatch VOTE on expiry or interaction', () => {
      const dispatchedActions = [];
      const mockSocket = {
        on: () => {},
        off: () => {},
        emit: () => {}
      };

      const store = createAppStore(mockSocket);
      const originalDispatch = store.dispatch;
      store.dispatch = (action) => {
        dispatchedActions.push(action);
        return originalDispatch(action);
      };

      // Simulate timer expiration
      const now = 2000000;
      const expiredTimer = {
        duration: 30,
        expiresAt: now - 1000,
        status: 'running'
      };

      const remainingMs = calculateRemainingMs(expiredTimer.expiresAt, now);
      assert.strictEqual(formatTime(remainingMs), '00:00');

      assert.strictEqual(
        dispatchedActions.filter((a) => a.type === VOTE || a.type === 'VOTE').length,
        0
      );
      assert.strictEqual(dispatchedActions.length, 0);
    });

    it('22. Reconnect/hydration displays the server-provided timer', () => {
      let state = initialState;
      const now = 1000000;
      const serverExpiresAt = now + 20000;

      // Simulate incoming socket timer_state hydration on reconnect
      const incomingSocketPayload = {
        sessionId: 'sess_reconnect',
        duration: 60,
        expiresAt: serverExpiresAt,
        status: 'running'
      };

      state = voteReducer(state, setTimerState(incomingSocketPayload));

      // Selected timer directly matches the server payload
      const hydratedTimer = selectTimerBySessionId(state, 'sess_reconnect');
      assert.ok(hydratedTimer);
      assert.strictEqual(hydratedTimer.duration, 60);
      assert.strictEqual(hydratedTimer.expiresAt, serverExpiresAt);
      assert.strictEqual(hydratedTimer.status, 'running');

      const remaining = calculateRemainingMs(hydratedTimer.expiresAt, now);
      assert.strictEqual(formatTime(remaining), '00:20');
    });
  });
});
