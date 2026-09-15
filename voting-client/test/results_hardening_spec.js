import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  transformTallyToChartData,
  getPairwiseSummary,
  calculatePercentage,
  getResultsVisibilityState,
  getGuardedResultsPresentation,
  isServerRoundClosed
} from '../src/components/results/resultsUtils.js';
import {
  setSessionState,
  selectVote,
  selectTimerBySessionId,
  getSessionPairLockKey,
  NEXT,
  VOTE
} from '../src/redux/voteSlice.js';
import { createAppStore } from '../src/redux/store.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 5 — Stage D: Component & Real-Time Transition Test Hardening', () => {

  // =========================================================================
  // 1. Active Round — Results Hidden
  // =========================================================================
  describe('Area 1 — Active Round Hides Results & Guards Tallies', () => {
    it('keeps tallies, percentages, and chart null while a round is actively open and running', () => {
      const now = 1700000000000;
      const pair = ['Trainspotting', '28 Days Later'];
      const tally = { Trainspotting: 15, '28 Days Later': 10 };
      const runningTimer = {
        sessionId: 'sess_active_guard',
        duration: 30,
        expiresAt: now + 20000,
        status: 'running'
      };

      const rawState = getResultsVisibilityState({
        hasLoaded: true,
        winner: null,
        pair,
        timer: runningTimer,
        now
      });
      assert.strictEqual(rawState, 'VOTING_IN_PROGRESS');

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair,
        tally,
        timer: runningTimer,
        now
      });

      // State determination
      assert.strictEqual(presentation.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(presentation.isVotingActive, true);
      assert.strictEqual(presentation.message, 'Voting in Progress');
      assert.strictEqual(presentation.subMessage, 'Results will be revealed when this round ends.');

      // Visual guarding
      assert.strictEqual(presentation.showChart, false);
      assert.strictEqual(presentation.showStats, false);
      assert.strictEqual(presentation.chartData, null);
      assert.strictEqual(presentation.candidateResults, null);
      assert.strictEqual(presentation.totalVotes, null);

      // Only candidate names are exposed for contender cards
      assert.deepStrictEqual(presentation.contenders, ['Trainspotting', '28 Days Later']);

      // Strict serialization check: no numbers (15, 10, 25, 60, 40) leak in data structures
      const serializedData = JSON.stringify({
        chartData: presentation.chartData,
        candidateResults: presentation.candidateResults,
        totalVotes: presentation.totalVotes
      });
      assert.strictEqual(serializedData.includes('15'), false);
      assert.strictEqual(serializedData.includes('10'), false);
      assert.strictEqual(serializedData.includes('25'), false);
      assert.strictEqual(serializedData.includes('60'), false);
      assert.strictEqual(serializedData.includes('40'), false);
    });

    it('recalculating countdown ticks does not prematurely expose final results', () => {
      const baseTime = 1700000000000;
      const pair = ['Sunshine', '127 Hours'];
      const tally = { Sunshine: 8, '127 Hours': 4 };
      const timer = {
        sessionId: 'sess_countdown_ticks',
        duration: 30,
        expiresAt: baseTime + 10000,
        status: 'running'
      };

      // Ticks at +1s, +5s, +9s before expiry
      const tickOffsets = [1000, 5000, 9000, 9999];
      for (const offset of tickOffsets) {
        const pres = getGuardedResultsPresentation({
          hasLoaded: true,
          winner: null,
          pair,
          tally,
          timer,
          now: baseTime + offset
        });
        assert.strictEqual(pres.visibilityState, 'VOTING_IN_PROGRESS');
        assert.strictEqual(pres.showChart, false);
        assert.strictEqual(pres.chartData, null);
        assert.strictEqual(pres.candidateResults, null);
      }
    });
  });

  // =========================================================================
  // 2. Closed Round — Results Revealed
  // =========================================================================
  describe('Area 2 — Closed Round Reveals Results with Exact Authoritative Numbers', () => {
    it('reveals chart data, candidate stats, and authoritative totals when the round closes', () => {
      const now = 1700000000000;
      const pair = ['Alien', 'Predator'];
      const tally = { Alien: 14, Predator: 6 };
      const closedTimer = {
        sessionId: 'sess_closed_reveal',
        duration: 30,
        expiresAt: now - 500,
        status: 'closed'
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair,
        tally,
        timer: closedTimer,
        now
      });

      // Presentation state
      assert.strictEqual(presentation.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presentation.isVotingActive, false);
      assert.strictEqual(presentation.showChart, true);
      assert.strictEqual(presentation.showStats, true);

      // Total votes
      assert.strictEqual(presentation.totalVotes, 20);

      // Chart data structure & values
      assert.ok(Array.isArray(presentation.chartData));
      assert.strictEqual(presentation.chartData.length, 2);

      assert.strictEqual(presentation.chartData[0].candidate, 'Alien');
      assert.strictEqual(presentation.chartData[0].votes, 14);
      assert.strictEqual(presentation.chartData[0].percentage, 70.0);

      assert.strictEqual(presentation.chartData[1].candidate, 'Predator');
      assert.strictEqual(presentation.chartData[1].votes, 6);
      assert.strictEqual(presentation.chartData[1].percentage, 30.0);

      // Candidate results for cards
      assert.ok(Array.isArray(presentation.candidateResults));
      assert.strictEqual(presentation.candidateResults[0].candidate, 'Alien');
      assert.strictEqual(presentation.candidateResults[0].votes, 14);
      assert.strictEqual(presentation.candidateResults[0].percentage, 70.0);
      assert.strictEqual(presentation.candidateResults[0].position, 1);

      assert.strictEqual(presentation.candidateResults[1].candidate, 'Predator');
      assert.strictEqual(presentation.candidateResults[1].votes, 6);
      assert.strictEqual(presentation.candidateResults[1].percentage, 30.0);
      assert.strictEqual(presentation.candidateResults[1].position, 2);
    });

    it('reveals results when server confirms closure without timer object (timer: null)', () => {
      const pair = ['Solaris', 'Stalker'];
      const tally = { Solaris: 9, Stalker: 11 };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        pair,
        tally,
        timer: null,
        now: Date.now()
      });

      assert.strictEqual(presentation.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presentation.showChart, true);
      assert.strictEqual(presentation.totalVotes, 20);
      assert.strictEqual(presentation.chartData[0].percentage, 45.0);
      assert.strictEqual(presentation.chartData[1].percentage, 55.0);
    });
  });

  // =========================================================================
  // 3. Round N -> Round N+1 Stale Invalidation
  // =========================================================================
  describe('Area 3 — Round N -> Round N+1 Immediate Stale Invalidation', () => {
    it('purges all candidate names, tallies, percentages, and charts from Round N upon advance', () => {
      const now = 1700000000000;
      const sessionId = 'sess_round_n_advance';

      // Round N (closed results with tallies A=7, B=3)
      const roundNPair = ['Candidate A', 'Candidate B'];
      const roundNTally = { 'Candidate A': 7, 'Candidate B': 3 };
      const roundNTimer = { sessionId, duration: 30, expiresAt: now - 1000, status: 'closed' };

      const roundNPres = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: roundNPair,
        tally: roundNTally,
        timer: roundNTimer,
        now
      });
      assert.strictEqual(roundNPres.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(roundNPres.totalVotes, 10);

      // Server advances tournament to Round N+1: [C, D], empty tally, running timer
      const roundNPlus1Pair = ['Candidate C', 'Candidate D'];
      const roundNPlus1Tally = {};
      const roundNPlus1Timer = { sessionId, duration: 30, expiresAt: now + 30000, status: 'running' };

      const roundNPlus1Pres = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: roundNPlus1Pair,
        tally: roundNPlus1Tally,
        timer: roundNPlus1Timer,
        now
      });

      // Assertions per Stage D requirements:
      // - A is absent
      assert.strictEqual(roundNPlus1Pres.contenders.includes('Candidate A'), false);
      // - B is absent
      assert.strictEqual(roundNPlus1Pres.contenders.includes('Candidate B'), false);
      // - Old chart is absent
      assert.strictEqual(roundNPlus1Pres.showChart, false);
      assert.strictEqual(roundNPlus1Pres.chartData, null);
      // - Old ResultCards data absent
      assert.strictEqual(roundNPlus1Pres.candidateResults, null);
      assert.strictEqual(roundNPlus1Pres.totalVotes, null);
      // - New round presented as voting in progress
      assert.strictEqual(roundNPlus1Pres.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(roundNPlus1Pres.isVotingActive, true);
      assert.deepStrictEqual(roundNPlus1Pres.contenders, ['Candidate C', 'Candidate D']);

      // - 7, 3, 70%, 30% are absent from any presentation data
      const serialized = JSON.stringify(roundNPlus1Pres);
      assert.strictEqual(serialized.includes('"votes":7'), false);
      assert.strictEqual(serialized.includes('"votes":3'), false);
      assert.strictEqual(serialized.includes('70'), false);
      assert.strictEqual(serialized.includes('30'), false);
    });

    it('computes distinct round keys across rounds to guarantee React component unmounting', () => {
      const sessionId = 'sess_key_invalidation';
      const keyRoundN = getSessionPairLockKey(sessionId, ['Candidate A', 'Candidate B']);
      const keyRoundNPlus1 = getSessionPairLockKey(sessionId, ['Candidate C', 'Candidate D']);

      assert.strictEqual(keyRoundN, `${sessionId}:::Candidate A:::Candidate B`);
      assert.strictEqual(keyRoundNPlus1, `${sessionId}:::Candidate C:::Candidate D`);
      assert.notStrictEqual(keyRoundN, keyRoundNPlus1);
    });
  });

  // =========================================================================
  // 4. New Round -> New Results
  // =========================================================================
  describe('Area 4 — New Round -> New Results Revealed without Round N Ghosts', () => {
    it('reveals Round N+1 authoritative results cleanly without leaking Round N data', () => {
      const now = 1700000000000;
      const sessionId = 'sess_new_results_reveal';

      // Round N+1 closed with C=12, D=4 (total 16, 75% / 25%)
      const roundNPlus1Pair = ['Candidate C', 'Candidate D'];
      const roundNPlus1Tally = { 'Candidate C': 12, 'Candidate D': 4 };
      const roundNPlus1ClosedTimer = {
        sessionId,
        duration: 30,
        expiresAt: now - 500,
        status: 'closed'
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: roundNPlus1Pair,
        tally: roundNPlus1Tally,
        timer: roundNPlus1ClosedTimer,
        now
      });

      // 1. C and D appear
      assert.deepStrictEqual(presentation.contenders, ['Candidate C', 'Candidate D']);
      assert.strictEqual(presentation.candidateResults[0].candidate, 'Candidate C');
      assert.strictEqual(presentation.candidateResults[1].candidate, 'Candidate D');

      // 2. Authoritative tally appears
      assert.strictEqual(presentation.candidateResults[0].votes, 12);
      assert.strictEqual(presentation.candidateResults[1].votes, 4);
      assert.strictEqual(presentation.totalVotes, 16);

      // 3. Percentages are correct
      assert.strictEqual(presentation.candidateResults[0].percentage, 75.0);
      assert.strictEqual(presentation.candidateResults[1].percentage, 25.0);

      // 4. Chart represents new round
      assert.strictEqual(presentation.showChart, true);
      assert.strictEqual(presentation.chartData[0].candidate, 'Candidate C');
      assert.strictEqual(presentation.chartData[0].votes, 12);
      assert.strictEqual(presentation.chartData[0].percentage, 75.0);

      // 5. No Round N data returns (A, B, 7, 3, 70%, 30% cannot be found)
      const serialized = JSON.stringify(presentation);
      assert.strictEqual(serialized.includes('Candidate A'), false);
      assert.strictEqual(serialized.includes('Candidate B'), false);
      assert.strictEqual(serialized.includes('"votes":7'), false);
      assert.strictEqual(serialized.includes('"votes":3'), false);
      assert.strictEqual(serialized.includes('70'), false);
      assert.strictEqual(serialized.includes('30'), false);
    });
  });

  // =========================================================================
  // 5. Real-Time Redux Update without Reload
  // =========================================================================
  describe('Area 5 — Real-Time Redux Store Updates without Page Reload', () => {
    it('reacts to incoming socket session_state updates in Redux without reloads or navigation', () => {
      const store = createAppStore();
      const sessionId = 'sess_live_flow';

      // 1. Dispatch Round 1 Closed State
      store.dispatch(setSessionState(sessionId, {
        title: 'Film Cup',
        status: 'voting',
        vote: {
          pair: ['Film A', 'Film B'],
          tally: { 'Film A': 10, 'Film B': 10 }
        },
        timer: {
          duration: 30,
          expiresAt: 500000,
          status: 'closed'
        }
      }));

      let state = store.getState();
      let vote = selectVote(state, sessionId);
      let timer = selectTimerBySessionId(state, sessionId);

      let presRound1 = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: vote.pair,
        tally: vote.tally,
        timer,
        now: 600000
      });
      assert.strictEqual(presRound1.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presRound1.totalVotes, 20);
      assert.strictEqual(presRound1.showChart, true);

      // 2. Dispatch Round 2 Active State (emulates socket event arriving)
      store.dispatch(setSessionState(sessionId, {
        title: 'Film Cup',
        status: 'voting',
        vote: {
          pair: ['Film C', 'Film D'],
          tally: {}
        },
        timer: {
          duration: 30,
          expiresAt: 700000,
          status: 'running'
        }
      }));

      state = store.getState();
      vote = selectVote(state, sessionId);
      timer = selectTimerBySessionId(state, sessionId);

      let presRound2 = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: vote.pair,
        tally: vote.tally,
        timer,
        now: 650000 // now < expiresAt
      });
      assert.strictEqual(presRound2.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(presRound2.showChart, false);
      assert.strictEqual(presRound2.chartData, null);
      assert.deepStrictEqual(presRound2.contenders, ['Film C', 'Film D']);
    });
  });

  // =========================================================================
  // 6. Multi-Session Isolation
  // =========================================================================
  describe('Area 6 — Bidirectional Multi-Session Isolation', () => {
    it('maintains strict isolation between Session A and Session B during round transitions', () => {
      const store = createAppStore();
      const sessA = 'sess_iso_alpha';
      const sessB = 'sess_iso_beta';

      // Setup Session A in Closed Results state
      store.dispatch(setSessionState(sessA, {
        title: 'Tournament Alpha',
        status: 'voting',
        vote: {
          pair: ['Alpha 1', 'Alpha 2'],
          tally: { 'Alpha 1': 14, 'Alpha 2': 6 }
        },
        timer: { duration: 30, expiresAt: 500000, status: 'closed' }
      }));

      // Setup Session B in Closed Results state
      store.dispatch(setSessionState(sessB, {
        title: 'Tournament Beta',
        status: 'voting',
        vote: {
          pair: ['Beta 1', 'Beta 2'],
          tally: { 'Beta 1': 8, 'Beta 2': 2 }
        },
        timer: { duration: 30, expiresAt: 500000, status: 'closed' }
      }));

      // 1. Advance Session B to Round 2 (running)
      store.dispatch(setSessionState(sessB, {
        title: 'Tournament Beta',
        status: 'voting',
        vote: {
          pair: ['Beta 3', 'Beta 4'],
          tally: {}
        },
        timer: { duration: 30, expiresAt: 750000, status: 'running' }
      }));

      // Verify Session A is 100% unaffected
      let state = store.getState();
      let voteA = selectVote(state, sessA);
      let timerA = selectTimerBySessionId(state, sessA);
      let presA = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: voteA.pair,
        tally: voteA.tally,
        timer: timerA,
        now: 600000
      });
      assert.strictEqual(presA.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presA.totalVotes, 20);
      assert.deepStrictEqual(presA.contenders, ['Alpha 1', 'Alpha 2']);
      assert.strictEqual(presA.chartData[0].votes, 14);

      // 2. Advance Session A to a new round
      store.dispatch(setSessionState(sessA, {
        title: 'Tournament Alpha',
        status: 'voting',
        vote: {
          pair: ['Alpha 3', 'Alpha 4'],
          tally: {}
        },
        timer: { duration: 30, expiresAt: 800000, status: 'running' }
      }));

      // Verify Session B is 100% unaffected
      state = store.getState();
      let voteB = selectVote(state, sessB);
      let timerB = selectTimerBySessionId(state, sessB);
      let presB = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: voteB.pair,
        tally: voteB.tally,
        timer: timerB,
        now: 600000
      });
      assert.strictEqual(presB.visibilityState, 'VOTING_IN_PROGRESS');
      assert.deepStrictEqual(presB.contenders, ['Beta 3', 'Beta 4']);
      assert.strictEqual(timerB.status, 'running');
    });
  });

  // =========================================================================
  // 7. Timer Boundary Behavior (Cases A, B, C)
  // =========================================================================
  describe('Area 7 — Timer Boundary Behavior & Server Authority Distinction', () => {
    const pair = ['Runner 1', 'Runner 2'];
    const tally = { 'Runner 1': 5, 'Runner 2': 5 };
    const expiresAt = 1000000;

    it('Case A: now < expiresAt -> strictly VOTING_IN_PROGRESS', () => {
      const now = expiresAt - 1; // 1 millisecond before expiry
      const timer = { duration: 30, expiresAt, status: 'running' };

      const pres = getGuardedResultsPresentation({
        hasLoaded: true,
        pair,
        tally,
        timer,
        now
      });
      assert.strictEqual(pres.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(pres.showChart, false);
      assert.strictEqual(pres.chartData, null);
    });

    it('Case B: now === expiresAt -> reveals results for current round without auto-advancing', () => {
      const now = expiresAt; // exact boundary
      const timer = { duration: 30, expiresAt, status: 'running' };

      const pres = getGuardedResultsPresentation({
        hasLoaded: true,
        pair,
        tally,
        timer,
        now
      });
      // Visual countdown reached zero: reveals current round tallies while awaiting server event
      assert.strictEqual(pres.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(pres.showChart, true);
      assert.strictEqual(pres.totalVotes, 10);
      // Pair remains unchanged: client does not advance pair autonomously
      assert.deepStrictEqual(pres.contenders, ['Runner 1', 'Runner 2']);
    });

    it('Case C: Authoritative server round closure drives state transition', () => {
      // 1. Explicit serverConfirmedClosure flag
      const presFlag = getGuardedResultsPresentation({
        hasLoaded: true,
        pair,
        tally,
        timer: { duration: 30, expiresAt: 99999999, status: 'running' },
        serverConfirmedClosure: true
      });
      assert.strictEqual(presFlag.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(isServerRoundClosed(null, true), true);

      // 2. Server emits timer with status 'closed' or 'expired'
      const presClosed = getGuardedResultsPresentation({
        hasLoaded: true,
        pair,
        tally,
        timer: { duration: 30, expiresAt: null, status: 'closed' }
      });
      assert.strictEqual(presClosed.visibilityState, 'RESULTS_REVEALED');

      // 3. Server clears timer completely (timer: null)
      const presNull = getGuardedResultsPresentation({
        hasLoaded: true,
        pair,
        tally,
        timer: null
      });
      assert.strictEqual(presNull.visibilityState, 'RESULTS_REVEALED');
    });
  });

  // =========================================================================
  // 8. Zero Client Auto-Advance
  // =========================================================================
  describe('Area 8 — Zero Client Auto-Advance Immutability Guarantee', () => {
    it('verifies results evaluation, expiry boundary, and chart rendering NEVER dispatch NEXT or VOTE', () => {
      const store = createAppStore();
      const dispatchedActions = [];
      const originalDispatch = store.dispatch;

      store.dispatch = (action) => {
        dispatchedActions.push(action);
        return originalDispatch(action);
      };

      // Set initial session
      store.dispatch(setSessionState('sess_zero_advance', {
        status: 'voting',
        vote: { pair: ['Team X', 'Team Y'], tally: { 'Team X': 2, 'Team Y': 1 } },
        timer: { duration: 30, expiresAt: 5000, status: 'running' }
      }));

      // Simulate calculations across various phases:
      // 1. While running
      getGuardedResultsPresentation({
        hasLoaded: true,
        pair: ['Team X', 'Team Y'],
        tally: { 'Team X': 2, 'Team Y': 1 },
        timer: { duration: 30, expiresAt: 5000, status: 'running' },
        now: 4000
      });

      // 2. At exact expiry boundary
      getGuardedResultsPresentation({
        hasLoaded: true,
        pair: ['Team X', 'Team Y'],
        tally: { 'Team X': 2, 'Team Y': 1 },
        timer: { duration: 30, expiresAt: 5000, status: 'running' },
        now: 5000
      });

      // 3. Past expiry
      getGuardedResultsPresentation({
        hasLoaded: true,
        pair: ['Team X', 'Team Y'],
        tally: { 'Team X': 2, 'Team Y': 1 },
        timer: { duration: 30, expiresAt: 5000, status: 'running' },
        now: 6000
      });

      // 4. Chart data transformation
      transformTallyToChartData(['Team X', 'Team Y'], { 'Team X': 2, 'Team Y': 1 });
      getPairwiseSummary(['Team X', 'Team Y'], { 'Team X': 2, 'Team Y': 1 });

      // Check all dispatched actions: ONLY setSessionState was called, NO NEXT or VOTE
      const actionTypes = dispatchedActions.map((a) => a.type);
      assert.strictEqual(actionTypes.includes(NEXT), false);
      assert.strictEqual(actionTypes.includes(VOTE), false);
      assert.strictEqual(actionTypes.includes('vote/NEXT'), false);
      assert.strictEqual(actionTypes.includes('NEXT'), false);
      assert.strictEqual(actionTypes.includes('vote/VOTE'), false);
      assert.strictEqual(actionTypes.includes('VOTE'), false);
    });
  });

  // =========================================================================
  // 9. Chart Correctness & Numerical Edge Cases
  // =========================================================================
  describe('Area 9 — Chart Correctness & Numeric Edge Cases', () => {
    it('computes exact 70.0% / 30.0% distribution for A=7, B=3 (total 10)', () => {
      const pair = ['Alpha', 'Beta'];
      const tally = { Alpha: 7, Beta: 3 };

      const chartData = transformTallyToChartData(pair, tally);
      assert.strictEqual(chartData[0].votes, 7);
      assert.strictEqual(chartData[0].percentage, 70.0);
      assert.strictEqual(chartData[1].votes, 3);
      assert.strictEqual(chartData[1].percentage, 30.0);

      const summary = getPairwiseSummary(pair, tally);
      assert.strictEqual(summary.totalVotes, 10);
      assert.strictEqual(summary.leader, 'Alpha');
      assert.strictEqual(summary.margin, 4);
      assert.strictEqual(summary.isTie, false);
    });

    it('handles zero total votes safely (A=0, B=0) returning 0% without NaN or Infinity', () => {
      const pair = ['Alpha', 'Beta'];
      const tally = { Alpha: 0, Beta: 0 };

      const chartData = transformTallyToChartData(pair, tally);
      assert.strictEqual(chartData[0].votes, 0);
      assert.strictEqual(chartData[0].percentage, 0);
      assert.strictEqual(Number.isNaN(chartData[0].percentage), false);
      assert.strictEqual(Number.isFinite(chartData[0].percentage), true);

      assert.strictEqual(chartData[1].votes, 0);
      assert.strictEqual(chartData[1].percentage, 0);
      assert.strictEqual(Number.isNaN(chartData[1].percentage), false);
      assert.strictEqual(Number.isFinite(chartData[1].percentage), true);

      const summary = getPairwiseSummary(pair, tally);
      assert.strictEqual(summary.totalVotes, 0);
      assert.strictEqual(summary.leader, null);
      assert.strictEqual(summary.margin, 0);
      assert.strictEqual(summary.isTie, true);
    });

    it('handles single vote edge case (A=1, B=0) returning 100% and 0%', () => {
      const pair = ['Alpha', 'Beta'];
      const tally = { Alpha: 1, Beta: 0 };

      const chartData = transformTallyToChartData(pair, tally);
      assert.strictEqual(chartData[0].percentage, 100.0);
      assert.strictEqual(chartData[1].percentage, 0.0);

      const summary = getPairwiseSummary(pair, tally);
      assert.strictEqual(summary.totalVotes, 1);
      assert.strictEqual(summary.leader, 'Alpha');
      assert.strictEqual(summary.margin, 1);
      assert.strictEqual(summary.isTie, false);
    });

    it('handles exact tie case (A=5, B=5) returning 50.0% and 50.0% with isTie: true', () => {
      const pair = ['Alpha', 'Beta'];
      const tally = { Alpha: 5, Beta: 5 };

      const chartData = transformTallyToChartData(pair, tally);
      assert.strictEqual(chartData[0].percentage, 50.0);
      assert.strictEqual(chartData[1].percentage, 50.0);

      const summary = getPairwiseSummary(pair, tally);
      assert.strictEqual(summary.totalVotes, 10);
      assert.strictEqual(summary.leader, null);
      assert.strictEqual(summary.margin, 0);
      assert.strictEqual(summary.isTie, true);
    });

    it('handles calculatePercentage helper bounds safely', () => {
      assert.strictEqual(calculatePercentage(0, 0), 0);
      assert.strictEqual(calculatePercentage(5, 0), 0);
      assert.strictEqual(calculatePercentage(-1, 10), 0);
      assert.strictEqual(calculatePercentage(5, 10), 50.0);
      assert.strictEqual(calculatePercentage(1, 3), 33.3);
      assert.strictEqual(calculatePercentage(2, 3), 66.7);
    });
  });

  // =========================================================================
  // 10. Existing Edge Cases Preserved
  // =========================================================================
  describe('Area 10 — Existing Feature 5 Edge Cases Preserved', () => {
    it('preserves LOADING state when session has not loaded', () => {
      const pres = getGuardedResultsPresentation({
        hasLoaded: false,
        winner: null,
        pair: ['A', 'B'],
        tally: { A: 1 }
      });
      assert.strictEqual(pres.visibilityState, 'LOADING');
      assert.strictEqual(pres.showChart, false);
      assert.strictEqual(pres.chartData, null);
    });

    it('preserves EMPTY state when session loaded but has fewer than 2 candidates in active pair', () => {
      const pres = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: ['A'],
        tally: {}
      });
      assert.strictEqual(pres.visibilityState, 'EMPTY');
      assert.strictEqual(pres.showChart, false);
      assert.strictEqual(pres.chartData, null);
    });

    it('preserves CONCLUDED state when tournament winner is declared', () => {
      const pres = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: 'Solaris',
        pair: [],
        tally: {}
      });
      assert.strictEqual(pres.visibilityState, 'CONCLUDED');
      assert.strictEqual(pres.showChart, false);
    });

    it('handles missing tally keys safely by defaulting absent candidate count to 0', () => {
      const pair = ['Present Cand', 'Missing Cand'];
      const tally = { 'Present Cand': 8 }; // 'Missing Cand' omitted from server tally

      const chartData = transformTallyToChartData(pair, tally);
      assert.strictEqual(chartData[0].candidate, 'Present Cand');
      assert.strictEqual(chartData[0].votes, 8);
      assert.strictEqual(chartData[0].percentage, 100.0);

      assert.strictEqual(chartData[1].candidate, 'Missing Cand');
      assert.strictEqual(chartData[1].votes, 0);
      assert.strictEqual(chartData[1].percentage, 0.0);
    });

    it('strictly preserves server pair candidate order (pair[0] first, pair[1] second)', () => {
      // Server order is [Candidate Y, Candidate X], even if Candidate X has more votes
      const pair = ['Candidate Y', 'Candidate X'];
      const tally = { 'Candidate X': 100, 'Candidate Y': 1 };

      const chartData = transformTallyToChartData(pair, tally);
      assert.strictEqual(chartData[0].candidate, 'Candidate Y');
      assert.strictEqual(chartData[0].votes, 1);

      assert.strictEqual(chartData[1].candidate, 'Candidate X');
      assert.strictEqual(chartData[1].votes, 100);
    });
  });

});
