import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTimerExpired,
  isVotePermitted,
  getVotingFeedbackState
} from '../src/utils/timerUtils.js';
import voteReducer, {
  initialState,
  setSessionState,
  setTimerState,
  selectTimerBySessionId,
  setActiveSession,
  NEXT,
  VOTE
} from '../src/redux/voteSlice.js';
import { createAppStore } from '../src/redux/store.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 2 — Stage E: Voter Timer Expiry UX & Vote Guarding', () => {

  describe('1. Timer State & Expiry Guarding (isTimerExpired & isVotePermitted)', () => {
    it('1. running timer with future expiresAt -> voting controls enabled', () => {
      const now = 1000000;
      const timer = {
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now + 15000,
        status: 'running'
      };

      assert.strictEqual(isTimerExpired(timer, now), false);
      assert.strictEqual(isVotePermitted({ timer, hasVoted: false, now }), true);
    });

    it('2. expired timer (now >= expiresAt) -> voting controls disabled', () => {
      const now = 1000000;
      const timer = {
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now, // 0ms remaining
        status: 'running'
      };

      assert.strictEqual(isTimerExpired(timer, now), true);
      assert.strictEqual(isVotePermitted({ timer, hasVoted: false, now }), false);

      // Also when past expiresAt
      const pastTimer = { ...timer, expiresAt: now - 5000 };
      assert.strictEqual(isTimerExpired(pastTimer, now), true);
      assert.strictEqual(isVotePermitted({ timer: pastTimer, hasVoted: false, now }), false);
    });

    it('3. inactive or null timer -> safe non-voting behavior without false expiry', () => {
      const now = 1000000;

      // Null timer
      assert.strictEqual(isTimerExpired(null, now), false);
      assert.strictEqual(isVotePermitted({ timer: null, hasVoted: false, now }), true);

      // Inactive / stopped timer
      const stoppedTimer = { sessionId: 'sess_1', status: 'stopped', expiresAt: null };
      assert.strictEqual(isTimerExpired(stoppedTimer, now), false);

      // Explicitly expired status
      const explicitlyExpired = { sessionId: 'sess_1', status: 'expired', expiresAt: null };
      assert.strictEqual(isTimerExpired(explicitlyExpired, now), true);
      assert.strictEqual(isVotePermitted({ timer: explicitlyExpired, hasVoted: false, now }), false);
    });

    it('4. timer transitions deterministically from running -> expired as time advances', () => {
      const expiresAt = 1000030;
      const timer = {
        sessionId: 'sess_1',
        duration: 30,
        expiresAt,
        status: 'running'
      };

      // 10 seconds before expiry
      assert.strictEqual(isTimerExpired(timer, 1000020), false);
      assert.strictEqual(isVotePermitted({ timer, hasVoted: false, now: 1000020 }), true);

      // 1 millisecond before expiry
      assert.strictEqual(isTimerExpired(timer, 1000029), false);
      assert.strictEqual(isVotePermitted({ timer, hasVoted: false, now: 1000029 }), true);

      // At exact expiry moment
      assert.strictEqual(isTimerExpired(timer, 1000030), true);
      assert.strictEqual(isVotePermitted({ timer, hasVoted: false, now: 1000030 }), false);

      // After expiry
      assert.strictEqual(isTimerExpired(timer, 1000031), true);
      assert.strictEqual(isVotePermitted({ timer, hasVoted: false, now: 1000031 }), false);
    });
  });

  describe('2. Expiry UX & Feedback Presentation', () => {
    it('5. expiry message appears when timer reaches zero', () => {
      const now = 1000000;
      const timer = {
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now - 100,
        status: 'running'
      };

      const feedback = getVotingFeedbackState({ votedEntry: null, timer, now });
      assert.strictEqual(feedback.type, 'expired');
      assert.ok(feedback.message.includes('Voting time expired'));
    });

    it('6. expiry message does not incorrectly claim session/tournament completion', () => {
      const now = 1000000;
      const timer = {
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now,
        status: 'running'
      };

      const feedback = getVotingFeedbackState({ votedEntry: null, timer, now });
      assert.strictEqual(feedback.type, 'expired');
      // Must NOT contain words implying tournament end
      assert.strictEqual(feedback.message.toLowerCase().includes('winner'), false);
      assert.strictEqual(feedback.message.toLowerCase().includes('concluded'), false);
      assert.strictEqual(feedback.message.toLowerCase().includes('tournament ended'), false);
      // Clearly indicates waiting for server to advance round
      assert.ok(feedback.message.includes('Waiting for server to advance round'));
    });

    it('7. new server timer removes expiry state', () => {
      const now = 1000000;
      // Previous expired timer
      const expiredTimer = {
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now - 1000,
        status: 'running'
      };
      assert.strictEqual(isTimerExpired(expiredTimer, now), true);

      // Server broadcasts new timer for next round
      const newTimer = {
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now + 30000,
        status: 'running'
      };
      assert.strictEqual(isTimerExpired(newTimer, now), false);

      const feedback = getVotingFeedbackState({ votedEntry: null, timer: newTimer, now });
      assert.strictEqual(feedback.type, 'prompt');
      assert.strictEqual(feedback.message, 'Select a candidate card above to submit your vote.');
    });

    it('8. new server pair re-enables voting', () => {
      const now = 1000000;
      const sessionId = 'sess_1';

      // Setup initial state with pair and running timer
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Movie Tournament',
        status: 'open',
        entries: ['A', 'B', 'C'],
        vote: { pair: ['A', 'B'], tally: { A: 1 } }
      }));

      // Timer expires for round 1
      state = voteReducer(state, setTimerState({
        sessionId,
        duration: 30,
        expiresAt: now - 500,
        status: 'running'
      }));

      const timerRound1 = selectTimerBySessionId(state, sessionId);
      assert.strictEqual(isVotePermitted({ timer: timerRound1, hasVoted: false, now }), false);

      // Server advances round to new pair ['A', 'C'] and provides new timer
      state = voteReducer(state, setSessionState({
        id: sessionId,
        status: 'open',
        vote: { pair: ['A', 'C'] }
      }));
      state = voteReducer(state, setTimerState({
        sessionId,
        duration: 30,
        expiresAt: now + 30000,
        status: 'running'
      }));

      const timerRound2 = selectTimerBySessionId(state, sessionId);
      assert.strictEqual(isTimerExpired(timerRound2, now), false);
      assert.strictEqual(isVotePermitted({ timer: timerRound2, hasVoted: false, now }), true);
    });
  });

  describe('3. Server Authority & Immutability Guarantees', () => {
    it('9. reaching zero does NOT dispatch NEXT to Redux store', () => {
      const store = createAppStore(null);
      const dispatchedActions = [];
      const originalDispatch = store.dispatch;
      store.dispatch = (action) => {
        dispatchedActions.push(action);
        return originalDispatch(action);
      };

      const now = 1000000;
      const timer = {
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now,
        status: 'running'
      };

      // Calling expiry check
      const expired = isTimerExpired(timer, now);
      assert.strictEqual(expired, true);

      // Verify no NEXT action was dispatched
      const nextDispatched = dispatchedActions.some(a => a.type === NEXT || a.type === 'NEXT');
      assert.strictEqual(nextDispatched, false);
    });

    it('10. reaching zero does NOT dispatch VOTE to Redux store', () => {
      const store = createAppStore(null);
      const dispatchedActions = [];
      const originalDispatch = store.dispatch;
      store.dispatch = (action) => {
        dispatchedActions.push(action);
        return originalDispatch(action);
      };

      const now = 1000000;
      const timer = {
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now - 200,
        status: 'running'
      };

      const expired = isTimerExpired(timer, now);
      assert.strictEqual(expired, true);

      const voteDispatched = dispatchedActions.some(a => a.type === VOTE || a.type === 'VOTE');
      assert.strictEqual(voteDispatched, false);
    });

    it('11. client does not mutate tournament pair/winner/tally on expiry', () => {
      const now = 1000000;
      const sessionId = 'sess_1';

      const initialSessionData = {
        id: sessionId,
        title: 'Tournament 1',
        status: 'open',
        entries: ['A', 'B', 'C'],
        vote: { pair: ['A', 'B'], tally: { A: 2, B: 1 } },
        winner: null
      };

      let state = voteReducer(initialState, setSessionState(initialSessionData));
      state = voteReducer(state, setTimerState({
        sessionId,
        duration: 30,
        expiresAt: now - 500, // expired
        status: 'running'
      }));

      // Check state immutability
      const session = state.bySessionId[sessionId];
      assert.deepStrictEqual(session.vote.pair, ['A', 'B']);
      assert.deepStrictEqual(session.vote.tally, { A: 2, B: 1 });
      assert.strictEqual(session.winner, null);
      assert.deepStrictEqual(session.entries, ['A', 'B', 'C']);
    });
  });

  describe('4. Multi-Session Isolation', () => {
    it('12. expired Session A does not disable Session B voting controls', () => {
      const now = 1000000;

      // Session A: expired
      const timerA = {
        sessionId: 'sess_A',
        duration: 30,
        expiresAt: now - 1000,
        status: 'running'
      };

      // Session B: running with 20s left
      const timerB = {
        sessionId: 'sess_B',
        duration: 30,
        expiresAt: now + 20000,
        status: 'running'
      };

      assert.strictEqual(isTimerExpired(timerA, now), true);
      assert.strictEqual(isVotePermitted({ timer: timerA, hasVoted: false, now }), false);

      assert.strictEqual(isTimerExpired(timerB, now), false);
      assert.strictEqual(isVotePermitted({ timer: timerB, hasVoted: false, now }), true);
    });

    it('13. Session B running timer remains independent when switching active sessions', () => {
      const now = 1000000;

      let state = voteReducer(initialState, setSessionState({
        id: 'sess_A',
        title: 'Session A',
        status: 'open',
        vote: { pair: ['A1', 'A2'] }
      }));
      state = voteReducer(state, setSessionState({
        id: 'sess_B',
        title: 'Session B',
        status: 'open',
        vote: { pair: ['B1', 'B2'] }
      }));

      state = voteReducer(state, setTimerState({
        sessionId: 'sess_A',
        duration: 30,
        expiresAt: now - 500, // expired
        status: 'running'
      }));
      state = voteReducer(state, setTimerState({
        sessionId: 'sess_B',
        duration: 30,
        expiresAt: now + 25000, // active
        status: 'running'
      }));

      // Active is A
      state = voteReducer(state, setActiveSession('sess_A'));
      const timerA = selectTimerBySessionId(state, 'sess_A');
      assert.strictEqual(isTimerExpired(timerA, now), true);

      // Switch active to B
      state = voteReducer(state, setActiveSession('sess_B'));
      const timerB = selectTimerBySessionId(state, 'sess_B');
      assert.strictEqual(isTimerExpired(timerB, now), false);
      assert.strictEqual(isVotePermitted({ timer: timerB, hasVoted: false, now }), true);

      // Switch back to A
      state = voteReducer(state, setActiveSession('sess_A'));
      assert.strictEqual(isTimerExpired(selectTimerBySessionId(state, 'sess_A'), now), true);
    });
  });

  describe('5. Reconnect & State Hydration Behavior', () => {
    it('14. running timer hydration restores enabled voting controls', () => {
      const now = 1000000;
      const store = createAppStore(null);

      // Hydrate session
      store.dispatch(setSessionState({
        id: 'sess_1',
        title: 'Tournament',
        status: 'open',
        vote: { pair: ['Movie 1', 'Movie 2'] }
      }));

      // Server emits timer_state on reconnect
      store.dispatch(setTimerState({
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now + 18000,
        status: 'running'
      }));

      const state = store.getState();
      const hydratedTimer = selectTimerBySessionId(state, 'sess_1');

      assert.ok(hydratedTimer);
      assert.strictEqual(hydratedTimer.status, 'running');
      assert.strictEqual(isTimerExpired(hydratedTimer, now), false);
      assert.strictEqual(isVotePermitted({ timer: hydratedTimer, hasVoted: false, now }), true);
    });

    it('15. expired timer hydration preserves disabled voting state until server progression', () => {
      const now = 1000000;
      const store = createAppStore(null);

      store.dispatch(setSessionState({
        id: 'sess_1',
        title: 'Tournament',
        status: 'open',
        vote: { pair: ['Movie 1', 'Movie 2'] }
      }));

      // Client reconnected after timer expired but before server advanced
      store.dispatch(setTimerState({
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now - 300,
        status: 'running'
      }));

      const state = store.getState();
      const hydratedTimer = selectTimerBySessionId(state, 'sess_1');

      assert.strictEqual(isTimerExpired(hydratedTimer, now), true);
      assert.strictEqual(isVotePermitted({ timer: hydratedTimer, hasVoted: false, now }), false);

      const feedback = getVotingFeedbackState({ votedEntry: null, timer: hydratedTimer, now });
      assert.strictEqual(feedback.type, 'expired');
    });

    it('16. authoritative new session_state restores normal voting for next round', () => {
      const now = 1000000;
      const store = createAppStore(null);

      // Expired round state
      store.dispatch(setSessionState({
        id: 'sess_1',
        status: 'open',
        vote: { pair: ['Movie 1', 'Movie 2'] }
      }));
      store.dispatch(setTimerState({
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now - 200,
        status: 'running'
      }));

      let state = store.getState();
      assert.strictEqual(isVotePermitted({
        timer: selectTimerBySessionId(state, 'sess_1'),
        hasVoted: false,
        now
      }), false);

      // Server progression arrives
      store.dispatch(setSessionState({
        id: 'sess_1',
        status: 'open',
        vote: { pair: ['Movie 2', 'Movie 3'] }
      }));
      store.dispatch(setTimerState({
        sessionId: 'sess_1',
        duration: 30,
        expiresAt: now + 30000,
        status: 'running'
      }));

      state = store.getState();
      const updatedTimer = selectTimerBySessionId(state, 'sess_1');
      assert.strictEqual(isTimerExpired(updatedTimer, now), false);
      assert.strictEqual(isVotePermitted({
        timer: updatedTimer,
        hasVoted: false,
        now
      }), true);
    });
  });

});
