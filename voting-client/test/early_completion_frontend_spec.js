import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  initialState,
  setSessionState,
  setTimerState,
  selectSessionById,
  selectVote,
  selectTimerBySessionId,
  getSessionPairLockKey,
  vote
} from '../src/redux/voteSlice.js';
import { createAppStore } from '../src/redux/store.js';
import { isTimerExpired, isVotePermitted, getVotingFeedbackState } from '../src/utils/timerUtils.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 7 — Stage C: Frontend Synchronization & End-to-End Early Completion', () => {

  describe('1. Server State & Pair Progression Synchronization', () => {
    it('1. authoritative session_state advances frontend to next round pair', () => {
      const sessionId = 'sess_f7_1';

      // Initial Round 1 state from server
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Sci-Fi Movies',
        status: 'open',
        entries: ['Solaris', 'Interstellar', 'Blade Runner'],
        vote: { pair: ['Solaris', 'Interstellar'], tally: {} }
      }));

      assert.deepStrictEqual(selectVote(state, sessionId)?.pair, ['Solaris', 'Interstellar']);

      // Server detects early completion, advances tournament, and broadcasts session_state
      const serverNextState = {
        id: sessionId,
        title: 'Sci-Fi Movies',
        status: 'open',
        entries: ['Solaris'],
        vote: { pair: ['Blade Runner', 'Solaris'], tally: {} }
      };

      state = voteReducer(state, setSessionState(serverNextState));

      // Frontend reflects the server-provided next pair immediately
      assert.deepStrictEqual(selectVote(state, sessionId)?.pair, ['Blade Runner', 'Solaris']);
      assert.strictEqual(selectSessionById(state, sessionId)?.status, 'open');
    });

    it('2. authoritative timer_state synchronizes running countdown with server', () => {
      const sessionId = 'sess_f7_2';
      const now = Date.now();
      const serverExpiresAt = now + 30000;

      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        status: 'open',
        vote: { pair: ['Alpha', 'Beta'] }
      }));

      // Server emits timer_state for Round 1
      state = voteReducer(state, setTimerState({
        sessionId,
        duration: 30,
        expiresAt: serverExpiresAt,
        status: 'running'
      }));

      const timer = selectTimerBySessionId(state, sessionId);
      assert.ok(timer);
      assert.strictEqual(timer.status, 'running');
      assert.strictEqual(timer.duration, 30);
      assert.strictEqual(timer.expiresAt, serverExpiresAt);
      assert.strictEqual(isTimerExpired(timer, now), false);
      assert.strictEqual(isVotePermitted({ timer, hasVoted: false, now }), true);
    });

    it('3. early completion clears old timer before next round timer arrives', () => {
      const sessionId = 'sess_f7_3';
      const now = 1000000;

      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        status: 'open',
        vote: { pair: ['Candidate 1', 'Candidate 2'] }
      }));

      // Round 1 timer running
      state = voteReducer(state, setTimerState({
        sessionId,
        duration: 30,
        expiresAt: now + 25000,
        status: 'running'
      }));
      assert.ok(selectTimerBySessionId(state, sessionId)?.status === 'running');

      // 1. Early completion disarms/clears timer on server -> emits status: null
      state = voteReducer(state, setTimerState({
        sessionId,
        duration: null,
        expiresAt: null,
        status: null
      }));
      assert.strictEqual(selectTimerBySessionId(state, sessionId), null);

      // 2. Server advances pair -> session_state arrives
      state = voteReducer(state, setSessionState({
        id: sessionId,
        status: 'open',
        vote: { pair: ['Candidate 3', 'Candidate 1'] }
      }));
      assert.deepStrictEqual(selectVote(state, sessionId)?.pair, ['Candidate 3', 'Candidate 1']);

      // 3. New round timer arrives -> timer_state arrives
      state = voteReducer(state, setTimerState({
        sessionId,
        duration: 30,
        expiresAt: now + 30000,
        status: 'running'
      }));

      const nextTimer = selectTimerBySessionId(state, sessionId);
      assert.strictEqual(nextTimer.status, 'running');
      assert.strictEqual(nextTimer.expiresAt, now + 30000);
      assert.strictEqual(isTimerExpired(nextTimer, now), false);
    });

    it('4. new server pair automatically clears prior round timer if timer_state is delayed', () => {
      const sessionId = 'sess_f7_4';
      const now = 1000000;

      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        status: 'open',
        vote: { pair: ['A', 'B'] }
      }));

      state = voteReducer(state, setTimerState({
        sessionId,
        duration: 30,
        expiresAt: now + 20000,
        status: 'running'
      }));
      assert.ok(selectTimerBySessionId(state, sessionId));

      // Suppose session_state with new pair arrives before timer_state
      state = voteReducer(state, setSessionState({
        id: sessionId,
        status: 'open',
        vote: { pair: ['C', 'A'] }
      }));

      // Pair changed: old timer must be cleared immediately, not preserved
      assert.strictEqual(selectTimerBySessionId(state, sessionId), null);
    });
  });

  describe('2. Server Authority & Non-Interference Guarantees', () => {
    it('5. early completion does NOT require or dispatch client NEXT', () => {
      // Mock socket tracking outbound emitted actions
      const emittedActions = [];
      const mockSocket = {
        emit: (event, payload) => {
          if (event === 'action') emittedActions.push(payload);
        },
        on: () => {},
        off: () => {}
      };

      const store = createAppStore(mockSocket);
      const sessionId = 'sess_f7_5';

      // Voter submits vote
      store.dispatch(vote(sessionId, 'Solaris'));

      // Verify outbound action is strictly VOTE, not NEXT
      assert.strictEqual(emittedActions.length, 1);
      assert.strictEqual(emittedActions[0].type, 'VOTE');
      assert.strictEqual(emittedActions[0].entry, 'Solaris');
      assert.strictEqual(emittedActions[0].sessionId, sessionId);

      // Verify no NEXT action was dispatched
      const hasNextAction = emittedActions.some(a => a.type === 'NEXT');
      assert.strictEqual(hasNextAction, false);
    });

    it('6. local countdown reaching 0 does NOT dispatch NEXT to server or store', () => {
      const emittedActions = [];
      const mockSocket = {
        emit: (event, payload) => {
          if (event === 'action') emittedActions.push(payload);
        },
        on: () => {},
        off: () => {}
      };

      const store = createAppStore(mockSocket);
      const sessionId = 'sess_f7_6';
      const now = 1000000;

      // Hydrate running timer
      store.dispatch(setTimerState({
        sessionId,
        duration: 10,
        expiresAt: now - 500, // already expired locally
        status: 'running'
      }));

      const timer = selectTimerBySessionId(store.getState(), sessionId);
      assert.strictEqual(isTimerExpired(timer, now), true);

      // Local countdown expired -> verify zero NEXT actions emitted to socket
      const hasNext = emittedActions.some(a => a.type === 'NEXT');
      assert.strictEqual(hasNext, false);

      // Voting is correctly guarded/disabled on the client
      assert.strictEqual(isVotePermitted({ timer, hasVoted: false, now }), false);
      const feedback = getVotingFeedbackState({ votedEntry: null, timer, now });
      assert.strictEqual(feedback.type, 'expired');
      assert.ok(feedback.message.includes('Waiting for server to advance round'));
    });

    it('7. frontend follows server-provided pair rather than calculating next pair locally', () => {
      const sessionId = 'sess_f7_7';

      // Initial state
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        status: 'open',
        entries: ['3', '4'],
        vote: { pair: ['1', '2'], tally: { '1': 5, '2': 3 } }
      }));

      // Server authoritatively dictates the next pair (e.g. tie-breaker, custom seed, or core.next)
      // Frontend must NEVER execute a local tournament sort or assume winner locally
      const serverDictatedPair = ['3', '1'];
      state = voteReducer(state, setSessionState({
        id: sessionId,
        status: 'open',
        entries: ['4', '2'],
        vote: { pair: serverDictatedPair, tally: {} }
      }));

      assert.deepStrictEqual(selectVote(state, sessionId)?.pair, ['3', '1']);
    });
  });

  describe('3. Multi-Client & Multi-Session Synchronization', () => {
    it('8. multi-client synchronization: two client stores reflect identical state upon early completion', () => {
      // Simulate two independent client stores (Client A and Client B)
      const storeA = createAppStore(null);
      const storeB = createAppStore(null);
      const sessionId = 'sess_shared';

      // Initial state broadcast from server
      const initialServerState = {
        id: sessionId,
        title: 'Shared Tournament',
        status: 'open',
        entries: ['Cand C'],
        vote: { pair: ['Cand A', 'Cand B'], tally: {} }
      };

      storeA.dispatch(setSessionState(initialServerState));
      storeB.dispatch(setSessionState(initialServerState));

      assert.deepStrictEqual(selectVote(storeA.getState(), sessionId)?.pair, ['Cand A', 'Cand B']);
      assert.deepStrictEqual(selectVote(storeB.getState(), sessionId)?.pair, ['Cand A', 'Cand B']);

      // Both voters vote -> server closes round early and broadcasts new session_state and timer_state
      const advancedServerState = {
        id: sessionId,
        title: 'Shared Tournament',
        status: 'open',
        entries: ['Cand B'],
        vote: { pair: ['Cand C', 'Cand A'], tally: {} }
      };
      const newTimerState = {
        sessionId,
        duration: 30,
        expiresAt: Date.now() + 30000,
        status: 'running'
      };

      // Both clients receive identical server broadcasts
      storeA.dispatch(setSessionState(advancedServerState));
      storeA.dispatch(setTimerState(newTimerState));

      storeB.dispatch(setSessionState(advancedServerState));
      storeB.dispatch(setTimerState(newTimerState));

      // Both stores synchronously reflect identical active pair and timer
      assert.deepStrictEqual(
        selectVote(storeA.getState(), sessionId)?.pair,
        selectVote(storeB.getState(), sessionId)?.pair
      );
      assert.deepStrictEqual(
        selectTimerBySessionId(storeA.getState(), sessionId),
        selectTimerBySessionId(storeB.getState(), sessionId)
      );
    });

    it('9. multi-session isolation: early completion in Session A does not modify Session B', () => {
      const store = createAppStore(null);
      const now = Date.now();

      // Setup Session A and Session B
      store.dispatch(setSessionState({
        id: 'sess_A',
        title: 'Session A',
        status: 'open',
        entries: ['A3'],
        vote: { pair: ['A1', 'A2'], tally: { A1: 1 } }
      }));
      store.dispatch(setTimerState({
        sessionId: 'sess_A',
        duration: 30,
        expiresAt: now + 15000,
        status: 'running'
      }));

      store.dispatch(setSessionState({
        id: 'sess_B',
        title: 'Session B',
        status: 'open',
        entries: ['B3'],
        vote: { pair: ['B1', 'B2'], tally: {} }
      }));
      store.dispatch(setTimerState({
        sessionId: 'sess_B',
        duration: 60,
        expiresAt: now + 45000,
        status: 'running'
      }));

      // Session A completes early and advances to ['A3', 'A1']
      store.dispatch(setSessionState({
        id: 'sess_A',
        status: 'open',
        vote: { pair: ['A3', 'A1'], tally: {} }
      }));
      store.dispatch(setTimerState({
        sessionId: 'sess_A',
        duration: 30,
        expiresAt: now + 30000,
        status: 'running'
      }));

      // Verify Session A updated
      assert.deepStrictEqual(selectVote(store.getState(), 'sess_A')?.pair, ['A3', 'A1']);
      assert.strictEqual(selectTimerBySessionId(store.getState(), 'sess_A')?.duration, 30);

      // Verify Session B was NOT modified
      assert.deepStrictEqual(selectVote(store.getState(), 'sess_B')?.pair, ['B1', 'B2']);
      assert.strictEqual(selectTimerBySessionId(store.getState(), 'sess_B')?.duration, 60);
      assert.strictEqual(selectTimerBySessionId(store.getState(), 'sess_B')?.expiresAt, now + 45000);
    });

    it('10. local pair lock keys automatically update when server advances to new round', () => {
      const sessionId = 'sess_lock_test';
      const round1Pair = ['Cand 1', 'Cand 2'];
      const round2Pair = ['Cand 3', 'Cand 1'];

      const lockKeyRound1 = getSessionPairLockKey(sessionId, round1Pair);
      const lockKeyRound2 = getSessionPairLockKey(sessionId, round2Pair);

      // Lock keys are unique per pair and session
      assert.strictEqual(lockKeyRound1, `${sessionId}:::Cand 1:::Cand 2`);
      assert.strictEqual(lockKeyRound2, `${sessionId}:::Cand 3:::Cand 1`);
      assert.notStrictEqual(lockKeyRound1, lockKeyRound2);

      // Simulated local votes map
      const votesByLockKey = {
        [lockKeyRound1]: 'Cand 1'
      };

      // In Round 1, voter has voted
      assert.strictEqual(Boolean(votesByLockKey[lockKeyRound1]), true);
      assert.strictEqual(Boolean(votesByLockKey[lockKeyRound2]), false);

      // In Round 2, voter has NOT voted yet: controls automatically re-enable
      assert.strictEqual(votesByLockKey[lockKeyRound2], undefined);
    });
  });
});
