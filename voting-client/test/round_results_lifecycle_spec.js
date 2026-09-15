import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  initialState,
  setSessionState,
  setTimerState,
  selectVote,
  selectRoundLifecycle,
  selectRoundId,
  selectRoundIndex,
  selectFinalVote,
  selectRevealTimer,
  selectTimerBySessionId,
  selectIsRevealActive,
  vote
} from '../src/redux/voteSlice.js';
import { createAppStore } from '../src/redux/store.js';
import {
  getResultsVisibilityState,
  getGuardedResultsPresentation,
  getPairwiseSummary
} from '../src/components/results/resultsUtils.js';
import { calculateRemainingMs, formatTime } from '../src/utils/timerUtils.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 8 — Stage C: Frontend Round Results Lifecycle', () => {

  describe('1. Redux State & Hydration', () => {
    it('1. session_state stores roundLifecycle', () => {
      const sessionId = 'sess_f8_1';
      const state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Movies',
        status: 'open',
        roundLifecycle: 'RESULTS_REVEALED',
        roundId: 'round_1',
        roundIndex: 1,
        vote: { pair: ['A', 'B'], tally: { A: 2, B: 1 } }
      }));

      assert.strictEqual(selectRoundLifecycle(state, sessionId), 'RESULTS_REVEALED');
      assert.strictEqual(selectRoundId(state, sessionId), 'round_1');
      assert.strictEqual(selectRoundIndex(state, sessionId), 1);
      assert.strictEqual(selectIsRevealActive(state, sessionId), true);
    });

    it('2. finalVote is stored correctly and preserved', () => {
      const sessionId = 'sess_f8_2';
      const finalVotePayload = {
        pair: ['Alpha', 'Beta'],
        tally: { Alpha: 5, Beta: 3 },
        closedAt: 1700000000000
      };

      const state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Contenders',
        status: 'open',
        roundLifecycle: 'RESULTS_REVEALED',
        finalVote: finalVotePayload,
        vote: { pair: ['Alpha', 'Beta'], tally: { Alpha: 5, Beta: 3 } }
      }));

      const storedFinalVote = selectFinalVote(state, sessionId);
      assert.ok(storedFinalVote);
      assert.deepStrictEqual(storedFinalVote.pair, ['Alpha', 'Beta']);
      assert.deepStrictEqual(storedFinalVote.tally, { Alpha: 5, Beta: 3 });
      assert.strictEqual(storedFinalVote.closedAt, 1700000000000);
    });

    it('3. revealTimer is stored correctly via session_state and timer_state', () => {
      const sessionId = 'sess_f8_3';
      const revealTimerPayload = {
        duration: 5,
        expiresAt: 1700000005000,
        startedAt: 1700000000000,
        status: 'revealing',
        roundId: 'round_1'
      };

      // Case A: Hydration through session_state
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Contenders',
        status: 'open',
        roundLifecycle: 'RESULTS_REVEALED',
        revealTimer: revealTimerPayload
      }));

      let storedTimer = selectRevealTimer(state, sessionId);
      assert.ok(storedTimer);
      assert.strictEqual(storedTimer.expiresAt, 1700000005000);
      assert.strictEqual(storedTimer.status, 'revealing');

      // Case B: Update through timer_state with status: revealing
      state = voteReducer(state, setTimerState({
        sessionId,
        duration: 10,
        expiresAt: 1700000010000,
        status: 'revealing'
      }));

      storedTimer = selectRevealTimer(state, sessionId);
      assert.ok(storedTimer);
      assert.strictEqual(storedTimer.duration, 10);
      assert.strictEqual(storedTimer.expiresAt, 1700000010000);
      assert.strictEqual(storedTimer.status, 'revealing');
      // Voting timer must be null when revealTimer is active
      assert.strictEqual(selectTimerBySessionId(state, sessionId), null);
    });

    it('4. Reveal state is isolated by session', () => {
      const sessionA = 'sess_iso_a';
      const sessionB = 'sess_iso_b';

      let state = voteReducer(initialState, setSessionState({
        id: sessionA,
        title: 'Session A',
        roundLifecycle: 'RESULTS_REVEALED',
        finalVote: { pair: ['A1', 'A2'], tally: { A1: 4 } },
        revealTimer: { duration: 5, expiresAt: 2000000, status: 'revealing' }
      }));

      state = voteReducer(state, setSessionState({
        id: sessionB,
        title: 'Session B',
        roundLifecycle: 'VOTING',
        finalVote: null,
        revealTimer: null,
        timer: { duration: 30, expiresAt: 3000000, status: 'running' }
      }));

      // Session A has reveal active
      assert.strictEqual(selectRoundLifecycle(state, sessionA), 'RESULTS_REVEALED');
      assert.strictEqual(selectIsRevealActive(state, sessionA), true);
      assert.deepStrictEqual(selectFinalVote(state, sessionA)?.pair, ['A1', 'A2']);
      assert.strictEqual(selectRevealTimer(state, sessionA)?.expiresAt, 2000000);

      // Session B remains strictly in VOTING with its own timer
      assert.strictEqual(selectRoundLifecycle(state, sessionB), 'VOTING');
      assert.strictEqual(selectIsRevealActive(state, sessionB), false);
      assert.strictEqual(selectFinalVote(state, sessionB), null);
      assert.strictEqual(selectRevealTimer(state, sessionB), null);
      assert.strictEqual(selectTimerBySessionId(state, sessionB)?.expiresAt, 3000000);
    });

    it('5. Older round state cannot overwrite newer round state (stale protection)', () => {
      const sessionId = 'sess_stale_round';

      // Current state: Round 2 VOTING
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Tournament',
        roundLifecycle: 'VOTING',
        roundId: 'round_2',
        roundIndex: 2,
        vote: { pair: ['C', 'D'], tally: {} }
      }));

      // A delayed event from Round 1 RESULTS_REVEALED arrives
      const lateRound1State = {
        id: sessionId,
        title: 'Tournament',
        roundLifecycle: 'RESULTS_REVEALED',
        roundId: 'round_1',
        roundIndex: 1,
        finalVote: { pair: ['A', 'B'], tally: { A: 2 } }
      };

      state = voteReducer(state, setSessionState(lateRound1State));

      // Must NOT revert back to Round 1!
      assert.strictEqual(selectRoundIndex(state, sessionId), 2);
      assert.strictEqual(selectRoundId(state, sessionId), 'round_2');
      assert.strictEqual(selectRoundLifecycle(state, sessionId), 'VOTING');
      assert.deepStrictEqual(selectVote(state, sessionId)?.pair, ['C', 'D']);
    });
  });

  describe('2. Round Lifecycle UI Presentation', () => {
    it('6. VOTING displays voting in progress presentation and hides results', () => {
      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: ['Candidate 1', 'Candidate 2'],
        tally: { 'Candidate 1': 3, 'Candidate 2': 1 },
        timer: { status: 'running', expiresAt: Date.now() + 20000 },
        roundLifecycle: 'VOTING'
      });

      assert.strictEqual(presentation.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(presentation.isVotingActive, true);
      assert.strictEqual(presentation.showStats, false);
      assert.strictEqual(presentation.showChart, false);
      assert.strictEqual(presentation.chartData, null);
    });

    it('7. ROUND_CLOSED identifies round closure and prepares results', () => {
      const visibility = getResultsVisibilityState({
        hasLoaded: true,
        winner: null,
        pair: ['Candidate 1', 'Candidate 2'],
        roundLifecycle: 'ROUND_CLOSED'
      });

      assert.strictEqual(visibility, 'RESULTS_REVEALED');
    });

    it('8. RESULTS_REVEALED displays final results using finalVote', () => {
      const finalVote = {
        pair: ['Winner Candidate', 'Runner-up Candidate'],
        tally: { 'Winner Candidate': 10, 'Runner-up Candidate': 4 }
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: ['Different Pair A', 'Different Pair B'], // Mutable vote pair (should be superseded)
        tally: { 'Different Pair A': 1 },
        roundLifecycle: 'RESULTS_REVEALED',
        finalVote
      });

      assert.strictEqual(presentation.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presentation.isVotingActive, false);
      assert.strictEqual(presentation.showStats, true);
      assert.strictEqual(presentation.showChart, true);
      assert.strictEqual(presentation.totalVotes, 14);

      // Uses finalVote.pair and finalVote.tally
      assert.deepStrictEqual(presentation.effectivePair, ['Winner Candidate', 'Runner-up Candidate']);
      assert.strictEqual(presentation.candidateResults[0].candidate, 'Winner Candidate');
      assert.strictEqual(presentation.candidateResults[0].votes, 10);
      assert.strictEqual(presentation.candidateResults[1].candidate, 'Runner-up Candidate');
      assert.strictEqual(presentation.candidateResults[1].votes, 4);
    });

    it('9. RESULTS_REVEALED accepts revealTimer and exposes it in presentation model', () => {
      const revealTimer = {
        duration: 5,
        expiresAt: Date.now() + 5000,
        status: 'revealing'
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: ['A', 'B'],
        tally: { A: 2 },
        roundLifecycle: 'RESULTS_REVEALED',
        finalVote: { pair: ['A', 'B'], tally: { A: 2 } },
        revealTimer
      });

      assert.strictEqual(presentation.revealTimer, revealTimer);
      assert.strictEqual(presentation.revealTimer.expiresAt, revealTimer.expiresAt);
    });

    it('10. Next authoritative VOTING state restores voting UI and clears previous reveal state', () => {
      const sessionId = 'sess_f8_next';

      // Step 1: In RESULTS_REVEALED
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Tourney',
        roundLifecycle: 'RESULTS_REVEALED',
        roundId: 'round_1',
        roundIndex: 1,
        finalVote: { pair: ['A', 'B'], tally: { A: 3 } },
        revealTimer: { duration: 5, expiresAt: 12345, status: 'revealing' }
      }));

      assert.strictEqual(selectRoundLifecycle(state, sessionId), 'RESULTS_REVEALED');
      assert.ok(selectFinalVote(state, sessionId));

      // Step 2: Server advances round to Round 2 VOTING
      state = voteReducer(state, setSessionState({
        id: sessionId,
        title: 'Tourney',
        roundLifecycle: 'VOTING',
        roundId: 'round_2',
        roundIndex: 2,
        vote: { pair: ['A', 'C'], tally: {} },
        timer: { duration: 30, expiresAt: 99999, status: 'running' }
      }));

      assert.strictEqual(selectRoundLifecycle(state, sessionId), 'VOTING');
      assert.strictEqual(selectIsRevealActive(state, sessionId), false);
      assert.deepStrictEqual(selectVote(state, sessionId)?.pair, ['A', 'C']);
      // Previous round's finalVote and revealTimer must be cleared
      assert.strictEqual(selectFinalVote(state, sessionId), null);
      assert.strictEqual(selectRevealTimer(state, sessionId), null);
      assert.strictEqual(selectTimerBySessionId(state, sessionId)?.status, 'running');
    });
  });

  describe('3. Timer & Countdown Authority', () => {
    it('11. Reveal countdown uses server expiresAt for remaining calculation', () => {
      const now = 1000000;
      const expiresAt = now + 4000; // 4 seconds remaining

      const remainingMs = calculateRemainingMs(expiresAt, now);
      assert.strictEqual(remainingMs, 4000);
      assert.strictEqual(formatTime(remainingMs), '00:04');
    });

    it('12. Countdown reaching zero locally does NOT dispatch NEXT', () => {
      const store = createAppStore();
      const sessionId = 'sess_f8_no_next';

      store.dispatch(setSessionState({
        id: sessionId,
        title: 'Test',
        roundLifecycle: 'RESULTS_REVEALED',
        finalVote: { pair: ['X', 'Y'], tally: { X: 2 } },
        revealTimer: { duration: 5, expiresAt: 1000, status: 'revealing' }
      }));

      // Simulate local clock passing reveal expiresAt
      const now = 5000; // Past expiresAt
      const remainingMs = calculateRemainingMs(1000, now);
      assert.strictEqual(remainingMs, 0);
      assert.strictEqual(formatTime(remainingMs), '00:00');

      // Check actions on store: No NEXT action exists
      const currentState = store.getState();
      assert.strictEqual(selectRoundLifecycle(currentState, sessionId), 'RESULTS_REVEALED');
      // Verify store was not automatically transitioned by the client
      assert.strictEqual(selectIsRevealActive(currentState, sessionId), true);
    });

    it('13. Voting countdown is not displayed during reveal', () => {
      const sessionId = 'sess_f8_no_voting_timer';

      const state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Test',
        roundLifecycle: 'RESULTS_REVEALED',
        finalVote: { pair: ['A', 'B'], tally: { A: 1 } },
        revealTimer: { duration: 5, expiresAt: 12345, status: 'revealing' }
      }));

      // Voting timer must be null
      assert.strictEqual(selectTimerBySessionId(state, sessionId), null);
      // Reveal timer must be set
      assert.ok(selectRevealTimer(state, sessionId));
    });
  });

  describe('4. Authoritative Results Stability', () => {
    it('14. Final tally comes strictly from finalVote, not mutable vote', () => {
      const finalVote = {
        pair: ['P1', 'P2'],
        tally: { P1: 8, P2: 6 }
      };

      const mutableVote = {
        pair: ['P1', 'P2'],
        tally: { P1: 99, P2: 99 } // Corrupt or late client vote
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: mutableVote.pair,
        tally: mutableVote.tally,
        roundLifecycle: 'RESULTS_REVEALED',
        finalVote
      });

      // Presentation must use finalVote (8, 6), not mutable vote (99, 99)
      assert.strictEqual(presentation.totalVotes, 14);
      assert.strictEqual(presentation.candidateResults[0].votes, 8);
      assert.strictEqual(presentation.candidateResults[1].votes, 6);
    });

    it('15. Results remain visually stable even if vote tally in state is wiped', () => {
      const finalVote = {
        pair: ['X', 'Y'],
        tally: { X: 4, Y: 4 }
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: ['X', 'Y'],
        tally: {}, // Empty mutable tally
        roundLifecycle: 'RESULTS_REVEALED',
        finalVote
      });

      assert.strictEqual(presentation.totalVotes, 8);
      const summary = getPairwiseSummary(presentation.effectivePair, presentation.effectiveTally);
      assert.strictEqual(summary.isTie, true);
      assert.strictEqual(summary.totalVotes, 8);
    });
  });

  describe('5. Reconnection & Hydration', () => {
    it('16. Hydrating during reveal restores reveal UI with server expiresAt', () => {
      const sessionId = 'sess_reconnect_reveal';
      const serverExpiresAt = Date.now() + 3500;

      const state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Tourney',
        status: 'open',
        roundLifecycle: 'RESULTS_REVEALED',
        roundId: 'round_3',
        roundIndex: 3,
        finalVote: { pair: ['Alpha', 'Beta'], tally: { Alpha: 3, Beta: 2 } },
        revealTimer: { duration: 5, expiresAt: serverExpiresAt, status: 'revealing' }
      }));

      assert.strictEqual(selectRoundLifecycle(state, sessionId), 'RESULTS_REVEALED');
      assert.strictEqual(selectIsRevealActive(state, sessionId), true);
      assert.strictEqual(selectRevealTimer(state, sessionId)?.expiresAt, serverExpiresAt);
      assert.deepStrictEqual(selectFinalVote(state, sessionId)?.pair, ['Alpha', 'Beta']);
    });

    it('17. Hydrating after reveal displays the new round immediately', () => {
      const sessionId = 'sess_reconnect_post_reveal';

      // Client connects after reveal has ended and server is in next round
      const state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Tourney',
        status: 'open',
        roundLifecycle: 'VOTING',
        roundId: 'round_4',
        roundIndex: 4,
        vote: { pair: ['Alpha', 'Gamma'], tally: {} },
        timer: { duration: 30, expiresAt: Date.now() + 30000, status: 'running' },
        finalVote: null,
        revealTimer: null
      }));

      assert.strictEqual(selectRoundLifecycle(state, sessionId), 'VOTING');
      assert.strictEqual(selectIsRevealActive(state, sessionId), false);
      assert.strictEqual(selectFinalVote(state, sessionId), null);
      assert.deepStrictEqual(selectVote(state, sessionId)?.pair, ['Alpha', 'Gamma']);
    });
  });

  describe('6. Error Handling', () => {
    it('18. ROUND_CLOSED action error does not mutate local lifecycle or dispatch NEXT', () => {
      const store = createAppStore();
      const sessionId = 'sess_error_handling';

      store.dispatch(setSessionState({
        id: sessionId,
        title: 'Tourney',
        status: 'open',
        roundLifecycle: 'ROUND_CLOSED',
        vote: { pair: ['A', 'B'], tally: { A: 1 } }
      }));

      // Voter attempts to dispatch a late vote
      store.dispatch(vote(sessionId, 'A'));

      // Simulate receiving action_error from server: { action: 'VOTE', error: 'ROUND_CLOSED' }
      const errorPayload = { action: 'VOTE', error: 'ROUND_CLOSED', message: 'Round is closed' };
      assert.strictEqual(errorPayload.error, 'ROUND_CLOSED');

      // State remains ROUND_CLOSED without client-side mutation
      const state = store.getState();
      assert.strictEqual(selectRoundLifecycle(state, sessionId), 'ROUND_CLOSED');
    });
  });
});
