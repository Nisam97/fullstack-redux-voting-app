import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getResultsVisibilityState,
  getGuardedResultsPresentation
} from '../src/components/results/resultsUtils.js';
import voteReducer, {
  initialState,
  setSessionState,
  selectWinner,
  NEXT,
  VOTE
} from '../src/redux/voteSlice.js';
import { createAppStore } from '../src/redux/store.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 5 — Stage B: Results Visibility & Round Guarding', () => {

  describe('Test 1 — Active Round Hides Results', () => {
    it('hides vote counts, percentages, and chart while round is actively running', () => {
      const now = 1000000;
      const sessionId = 'sess_active_round';
      const pair = ['Trainspotting', '28 Days Later'];
      const tally = { Trainspotting: 7, '28 Days Later': 3 };

      const runningTimer = {
        sessionId,
        duration: 30,
        expiresAt: now + 15000,
        status: 'running'
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair,
        tally,
        timer: runningTimer,
        now
      });

      // 1. "Voting in Progress" is determined as presentation state and message
      assert.strictEqual(presentation.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(presentation.isVotingActive, true);
      assert.strictEqual(presentation.message, 'Voting in Progress');
      assert.strictEqual(presentation.subMessage, 'Results will be revealed when this round ends.');

      // 2. Both contenders are identifiable as current contenders
      assert.deepStrictEqual(presentation.contenders, ['Trainspotting', '28 Days Later']);

      // 3. 7 and 3 are NOT rendered as result tallies
      assert.strictEqual(presentation.showStats, false);
      assert.strictEqual(presentation.candidateResults, null);

      // 4. 70% and 30% are NOT rendered
      // 5. ResultsChart is NOT rendered
      assert.strictEqual(presentation.showChart, false);
      assert.strictEqual(presentation.chartData, null);
      assert.strictEqual(presentation.totalVotes, null);
    });
  });

  describe('Test 2 — Closed Round Reveals Results', () => {
    it('reveals ResultsChart, exact vote totals, percentages, and candidate names when round has closed', () => {
      const now = 1000000;
      const sessionId = 'sess_closed_round';
      const pair = ['Trainspotting', '28 Days Later'];
      const tally = { Trainspotting: 7, '28 Days Later': 3 };

      // Case A: Timer has reached expiry (now >= expiresAt)
      const expiredTimer = {
        sessionId,
        duration: 30,
        expiresAt: now - 500,
        status: 'running'
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair,
        tally,
        timer: expiredTimer,
        now
      });

      // 1. Results state is revealed
      assert.strictEqual(presentation.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presentation.isVotingActive, false);
      assert.strictEqual(presentation.showChart, true);
      assert.strictEqual(presentation.showStats, true);

      // 2. ResultsChart data is present and matches authoritative schema
      assert.ok(Array.isArray(presentation.chartData));
      assert.strictEqual(presentation.chartData.length, 2);

      // Candidate 0: Trainspotting
      assert.strictEqual(presentation.chartData[0].candidate, 'Trainspotting');
      assert.strictEqual(presentation.chartData[0].name, 'Trainspotting');
      assert.strictEqual(presentation.chartData[0].votes, 7);
      assert.strictEqual(presentation.chartData[0].percentage, 70.0);

      // Candidate 1: 28 Days Later
      assert.strictEqual(presentation.chartData[1].candidate, '28 Days Later');
      assert.strictEqual(presentation.chartData[1].name, '28 Days Later');
      assert.strictEqual(presentation.chartData[1].votes, 3);
      assert.strictEqual(presentation.chartData[1].percentage, 30.0);

      // 3. Total round votes matches sum of authoritative tallies
      assert.strictEqual(presentation.totalVotes, 10);

      // 4. Candidate card results match exact chart items
      assert.strictEqual(presentation.candidateResults[0].candidate, 'Trainspotting');
      assert.strictEqual(presentation.candidateResults[0].votes, 7);
      assert.strictEqual(presentation.candidateResults[0].percentage, 70.0);
      assert.strictEqual(presentation.candidateResults[0].position, 1);

      assert.strictEqual(presentation.candidateResults[1].candidate, '28 Days Later');
      assert.strictEqual(presentation.candidateResults[1].votes, 3);
      assert.strictEqual(presentation.candidateResults[1].percentage, 30.0);
      assert.strictEqual(presentation.candidateResults[1].position, 2);
    });

    it('reveals results when timer is cleared by server upon round closure (timer: null)', () => {
      const pair = ['A', 'B'];
      const tally = { A: 12, B: 8 };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair,
        tally,
        timer: null,
        now: Date.now()
      });

      assert.strictEqual(presentation.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presentation.showChart, true);
      assert.strictEqual(presentation.chartData[0].votes, 12);
      assert.strictEqual(presentation.chartData[0].percentage, 60.0);
      assert.strictEqual(presentation.chartData[1].votes, 8);
      assert.strictEqual(presentation.chartData[1].percentage, 40.0);
      assert.strictEqual(presentation.totalVotes, 20);
    });
  });

  describe('Test 3 — Zero Votes Protection', () => {
    it('handles closed round with 0 votes rendering 0 votes, 0% without NaN or Infinity', () => {
      const now = 1000000;
      const pair = ['Candidate A', 'Candidate B'];
      const tally = { 'Candidate A': 0, 'Candidate B': 0 };

      const expiredTimer = {
        status: 'expired',
        expiresAt: null
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair,
        tally,
        timer: expiredTimer,
        now
      });

      assert.strictEqual(presentation.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presentation.totalVotes, 0);

      // Verify Candidate A
      const candA = presentation.chartData[0];
      assert.strictEqual(candA.votes, 0);
      assert.strictEqual(candA.percentage, 0);
      assert.strictEqual(Number.isNaN(candA.percentage), false);
      assert.strictEqual(Number.isFinite(candA.percentage), true);

      // Verify Candidate B
      const candB = presentation.chartData[1];
      assert.strictEqual(candB.votes, 0);
      assert.strictEqual(candB.percentage, 0);
      assert.strictEqual(Number.isNaN(candB.percentage), false);
      assert.strictEqual(Number.isFinite(candB.percentage), true);

      // Verify candidate card stats are safe from NaN / Infinity
      assert.strictEqual(presentation.candidateResults[0].percentage, 0);
      assert.strictEqual(presentation.candidateResults[1].percentage, 0);
      assert.strictEqual(Number.isNaN(presentation.candidateResults[0].percentage), false);
      assert.strictEqual(Number.isNaN(presentation.candidateResults[1].percentage), false);
    });
  });

  describe('Test 4 — Winner State', () => {
    it('preserves existing winner / concluded state correctly', () => {
      const sessionId = 'sess_winner';
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Sci-Fi Finals',
        status: 'completed',
        winner: 'Solaris',
        vote: null,
        entries: []
      }));

      const winner = selectWinner(state, sessionId);
      assert.strictEqual(winner, 'Solaris');

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner,
        pair: [],
        tally: {},
        timer: null
      });

      assert.strictEqual(presentation.visibilityState, 'CONCLUDED');
      assert.strictEqual(presentation.winner, 'Solaris');
      assert.strictEqual(presentation.showChart, false);
    });
  });

  describe('Test 5 — Premature Exposure Protection', () => {
    it('strictly guarantees no tally or percentage information leaks into the presentation model during active round', () => {
      const now = 1000000;
      const pair = ['Contender X', 'Contender Y'];
      const tally = { 'Contender X': 99, 'Contender Y': 1 };

      const runningTimer = {
        sessionId: 'sess_guard_test',
        duration: 30,
        expiresAt: now + 20000,
        status: 'running'
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair,
        tally,
        timer: runningTimer,
        now
      });

      // Assert that chartData is null — neither SVG nor accessible table can render tallies
      assert.strictEqual(presentation.chartData, null);

      // Assert that candidateResults is null — ResultCard receives no statistics
      assert.strictEqual(presentation.candidateResults, null);

      // Assert that totalVotes is null
      assert.strictEqual(presentation.totalVotes, null);

      // Deep inspection of the entire presentation object to ensure tally values are absent
      const serialized = JSON.stringify(presentation);
      assert.strictEqual(serialized.includes('99'), false, 'Tally count 99 must not leak');
      assert.strictEqual(serialized.includes('1'), false, 'Tally count 1 must not leak');
      assert.strictEqual(serialized.includes('99.0'), false, 'Percentage 99.0% must not leak');
      assert.strictEqual(serialized.includes('1.0'), false, 'Percentage 1.0% must not leak');
      assert.strictEqual(serialized.includes('100'), false, 'Total votes 100 must not leak');

      // Candidate names must remain accessible for round identification
      assert.ok(serialized.includes('Contender X'));
      assert.ok(serialized.includes('Contender Y'));
    });
  });

  describe('Test 6 — Boundary Timing & Exact Expiry Semantics', () => {
    const timer = {
      sessionId: 'sess_timing',
      duration: 30,
      expiresAt: 1000030,
      status: 'running'
    };

    it('expiresAt > now: active round hides results', () => {
      const state = getResultsVisibilityState({
        hasLoaded: true,
        pair: ['A', 'B'],
        timer,
        now: 1000029 // 1ms before expiry
      });
      assert.strictEqual(state, 'VOTING_IN_PROGRESS');
    });

    it('expiresAt === now: exact boundary triggers round closure and reveals results', () => {
      const state = getResultsVisibilityState({
        hasLoaded: true,
        pair: ['A', 'B'],
        timer,
        now: 1000030 // exactly at expiry
      });
      assert.strictEqual(state, 'RESULTS_REVEALED');
    });

    it('expiresAt < now: past boundary reveals results', () => {
      const state = getResultsVisibilityState({
        hasLoaded: true,
        pair: ['A', 'B'],
        timer,
        now: 1000031 // 1ms past expiry
      });
      assert.strictEqual(state, 'RESULTS_REVEALED');
    });
  });

  describe('Test 7 — Multi-Session Isolation', () => {
    it('maintains independent visibility state between different sessions', () => {
      const now = 1000000;

      // Session A is active with 15s remaining
      const timerA = {
        sessionId: 'sess_A',
        duration: 30,
        expiresAt: now + 15000,
        status: 'running'
      };

      // Session B has expired
      const timerB = {
        sessionId: 'sess_B',
        duration: 30,
        expiresAt: now - 500,
        status: 'running'
      };

      const presA = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: ['A1', 'A2'],
        tally: { A1: 5, A2: 2 },
        timer: timerA,
        now
      });

      const presB = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: ['B1', 'B2'],
        tally: { B1: 10, B2: 4 },
        timer: timerB,
        now
      });

      // Session A must guard tallies
      assert.strictEqual(presA.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(presA.showChart, false);
      assert.strictEqual(presA.chartData, null);

      // Session B must reveal tallies
      assert.strictEqual(presB.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presB.showChart, true);
      assert.strictEqual(presB.chartData[0].votes, 10);
      assert.strictEqual(presB.chartData[1].votes, 4);
      assert.strictEqual(presB.totalVotes, 14);
    });
  });

  describe('Test 8 — Server Authority & Immutability', () => {
    it('frontend visibility evaluation NEVER dispatches NEXT or VOTE actions', () => {
      const store = createAppStore(null);
      const dispatchedActions = [];
      const originalDispatch = store.dispatch;
      store.dispatch = (action) => {
        dispatchedActions.push(action);
        return originalDispatch(action);
      };

      const now = 1000000;
      const runningTimer = {
        sessionId: 'sess_authority',
        duration: 30,
        expiresAt: now + 5000,
        status: 'running'
      };

      // Query active presentation
      getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: ['A', 'B'],
        tally: { A: 3, B: 1 },
        timer: runningTimer,
        now
      });

      // Query expired presentation
      getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: ['A', 'B'],
        tally: { A: 3, B: 1 },
        timer: runningTimer,
        now: now + 6000
      });

      // Assert zero round-advancing actions were dispatched
      assert.strictEqual(dispatchedActions.some(a => a.type === NEXT || a.type === 'NEXT'), false);
      assert.strictEqual(dispatchedActions.some(a => a.type === VOTE || a.type === 'VOTE'), false);
      assert.strictEqual(dispatchedActions.length, 0);
    });
  });

});
