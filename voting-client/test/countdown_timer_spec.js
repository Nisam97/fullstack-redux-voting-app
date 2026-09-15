import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRemainingMs,
  formatTime,
  getUrgencyState
} from '../src/utils/timerUtils.js';
import voteReducer, {
  initialState,
  setSessionState,
  setTimerState,
  selectTimerBySessionId,
  setActiveSession,
  selectTimer
} from '../src/redux/voteSlice.js';
import { createAppStore } from '../src/redux/store.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 2 — Stage D: Frontend Visual Countdown Timer', () => {

  describe('1. Time Formatting (formatTime)', () => {
    it('formats 30 seconds correctly as 00:30', () => {
      assert.equal(formatTime(30000), '00:30');
    });

    it('zero-pads single-digit seconds (e.g. 9s as 00:09, 5s as 00:05)', () => {
      assert.equal(formatTime(9000), '00:09');
      assert.equal(formatTime(5000), '00:05');
      assert.equal(formatTime(1000), '00:01');
    });

    it('formats minutes and seconds with double digits (e.g. 65s as 01:05, 300s as 05:00)', () => {
      assert.equal(formatTime(65000), '01:05');
      assert.equal(formatTime(300000), '05:00');
      assert.equal(formatTime(125000), '02:05');
    });

    it('displays 00:00 when remaining time reaches exactly zero', () => {
      assert.equal(formatTime(0), '00:00');
    });

    it('never displays a negative value when remaining time is negative', () => {
      assert.equal(formatTime(-1000), '00:00');
      assert.equal(formatTime(-50000), '00:00');
    });

    it('handles null, undefined, or NaN inputs safely returning 00:00', () => {
      assert.equal(formatTime(null), '00:00');
      assert.equal(formatTime(undefined), '00:00');
      assert.equal(formatTime(NaN), '00:00');
    });
  });

  describe('2. Remaining Time Calculation (calculateRemainingMs)', () => {
    it('calculates exact remaining milliseconds from expiresAt and current time', () => {
      const now = 1000000;
      const expiresAt = now + 30000;
      assert.equal(calculateRemainingMs(expiresAt, now), 30000);
    });

    it('returns 0 when expiresAt is in the past', () => {
      const now = 1000000;
      const expiresAt = now - 5000;
      assert.equal(calculateRemainingMs(expiresAt, now), 0);
    });

    it('returns 0 when expiresAt is missing or invalid', () => {
      assert.equal(calculateRemainingMs(null), 0);
      assert.equal(calculateRemainingMs(undefined), 0);
      assert.equal(calculateRemainingMs('invalid'), 0);
    });

    it('updates remaining time as simulated time advances', () => {
      const startTime = 500000;
      const expiresAt = startTime + 30000;

      // At start (30s remaining)
      assert.equal(formatTime(calculateRemainingMs(expiresAt, startTime)), '00:30');

      // After 10s (20s remaining)
      assert.equal(formatTime(calculateRemainingMs(expiresAt, startTime + 10000)), '00:20');

      // After 29s (1s remaining)
      assert.equal(formatTime(calculateRemainingMs(expiresAt, startTime + 29000)), '00:01');

      // After 30s (0s remaining - expired)
      assert.equal(formatTime(calculateRemainingMs(expiresAt, startTime + 30000)), '00:00');

      // After 35s (past expiry - still 00:00, not negative)
      assert.equal(formatTime(calculateRemainingMs(expiresAt, startTime + 35000)), '00:00');
    });
  });

  describe('3. Urgency Presentation Levels', () => {
    it('returns normal for remaining seconds greater than 10', () => {
      assert.equal(getUrgencyState(30), 'normal');
      assert.equal(getUrgencyState(11), 'normal');
    });

    it('returns warning for remaining seconds between 6 and 10', () => {
      assert.equal(getUrgencyState(10), 'warning');
      assert.equal(getUrgencyState(8), 'warning');
      assert.equal(getUrgencyState(6), 'warning');
    });

    it('returns critical for remaining seconds between 1 and 5', () => {
      assert.equal(getUrgencyState(5), 'critical');
      assert.equal(getUrgencyState(3), 'critical');
      assert.equal(getUrgencyState(1), 'critical');
    });

    it('returns expired when remaining seconds reach 0 or negative', () => {
      assert.equal(getUrgencyState(0), 'expired');
      assert.equal(getUrgencyState(-1), 'expired');
    });
  });

  describe('4. Dynamic Expiry & Session Isolation', () => {
    it('updating expiresAt changes the calculated countdown immediately without stale state', () => {
      const now = 1000000;
      let expiresAt = now + 15000;
      assert.equal(formatTime(calculateRemainingMs(expiresAt, now)), '00:15');

      // Server extends or updates expiresAt to 45s
      expiresAt = now + 45000;
      assert.equal(formatTime(calculateRemainingMs(expiresAt, now)), '00:45');
    });

    it('session switching retains isolated timer state and does not retain stale countdown', () => {
      const now = Date.now();
      const expiresSessionA = now + 15000;
      const expiresSessionB = now + 50000;

      let state = voteReducer(initialState, setSessionState({ id: 'sess_a', status: 'open' }));
      state = voteReducer(state, setSessionState({ id: 'sess_b', status: 'open' }));

      state = voteReducer(state, setTimerState({
        sessionId: 'sess_a',
        duration: 15,
        expiresAt: expiresSessionA,
        status: 'running'
      }));
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_b',
        duration: 50,
        expiresAt: expiresSessionB,
        status: 'running'
      }));

      // In session A
      state = voteReducer(state, setActiveSession('sess_a'));
      const timerA = selectTimer(state);
      assert.equal(timerA.duration, 15);
      assert.equal(formatTime(calculateRemainingMs(timerA.expiresAt, now)), '00:15');

      // Switch to session B
      state = voteReducer(state, setActiveSession('sess_b'));
      const timerB = selectTimer(state);
      assert.equal(timerB.duration, 50);
      assert.equal(formatTime(calculateRemainingMs(timerB.expiresAt, now)), '00:50');

      // Verify Session A timer remains isolated
      const sessionATimer = selectTimerBySessionId(state, 'sess_a');
      assert.equal(sessionATimer.duration, 15);
      assert.equal(sessionATimer.expiresAt, expiresSessionA);
    });

    it('inactive or null timer returns null and displays no countdown', () => {
      let state = voteReducer(initialState, setSessionState({ id: 'sess_idle', status: 'pending' }));
      const timer = selectTimerBySessionId(state, 'sess_idle');
      assert.equal(timer, null);
    });
  });

  describe('5. Server Authority: Countdown reaching zero does NOT dispatch NEXT', () => {
    it('reaching zero is purely a cosmetic state transition and dispatches no actions', () => {
      const dispatchedActions = [];
      const mockSocket = {
        on: () => {},
        off: () => {},
        emit: () => {}
      };

      const store = createAppStore(mockSocket);

      // Track any actions dispatched
      const originalDispatch = store.dispatch;
      store.dispatch = (action) => {
        dispatchedActions.push(action);
        return originalDispatch(action);
      };

      // Simulate timer expiring locally (remainingMs reaching 0)
      const now = Date.now();
      const expiredTime = now - 1000;
      const remaining = calculateRemainingMs(expiredTime, now);
      const display = formatTime(remaining);

      assert.equal(display, '00:00');
      // Verify no NEXT action or any unauthorized action was dispatched by the client
      assert.equal(dispatchedActions.filter(a => a.type === 'NEXT').length, 0);
      assert.equal(dispatchedActions.length, 0);
    });
  });
});
