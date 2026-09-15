import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
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

describe('Feature 5 — Stage C: Real-Time Round Transition & Stale-Result Invalidation', () => {

  describe('Test 1 — Closed -> New Open Round Transition', () => {
    it('immediately transitions from revealed results to Voting in Progress with guarded data on round advance', () => {
      const now = 1000000;
      const sessionId = 'sess_transition_1';

      // 1. Round N (Closed): Pair [A, B] with closed tally
      const round1Pair = ['Trainspotting', '28 Days Later'];
      const round1Tally = { Trainspotting: 7, '28 Days Later': 3 };
      const round1ClosedTimer = {
        sessionId,
        duration: 30,
        expiresAt: now - 1000,
        status: 'closed'
      };

      const round1Presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: round1Pair,
        tally: round1Tally,
        timer: round1ClosedTimer,
        now
      });

      assert.strictEqual(round1Presentation.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(round1Presentation.showChart, true);
      assert.strictEqual(round1Presentation.showStats, true);
      assert.strictEqual(round1Presentation.totalVotes, 10);
      assert.deepStrictEqual(round1Presentation.contenders, ['Trainspotting', '28 Days Later']);
      assert.strictEqual(round1Presentation.roundKey, 'Trainspotting:::28 Days Later');

      // 2. Server advances tournament to Round N+1: Pair [C, D] with running timer and zero/new tally
      const round2Pair = ['Sunshine', '127 Hours'];
      const round2Tally = {};
      const round2RunningTimer = {
        sessionId,
        duration: 30,
        expiresAt: now + 30000,
        status: 'running'
      };

      const round2Presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: round2Pair,
        tally: round2Tally,
        timer: round2RunningTimer,
        now
      });

      // Assertions per Stage C specification:
      // - Results immediately return to "Voting in Progress"
      assert.strictEqual(round2Presentation.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(round2Presentation.isVotingActive, true);
      assert.strictEqual(round2Presentation.message, 'Voting in Progress');

      // - Round N contenders (A and B) are absent from contenders
      assert.strictEqual(round2Presentation.contenders.includes('Trainspotting'), false);
      assert.strictEqual(round2Presentation.contenders.includes('28 Days Later'), false);

      // - Round N+1 contenders (C and D) are active
      assert.deepStrictEqual(round2Presentation.contenders, ['Sunshine', '127 Hours']);
      assert.strictEqual(round2Presentation.roundKey, 'Sunshine:::127 Hours');

      // - ResultsChart is strictly hidden/absent
      assert.strictEqual(round2Presentation.showChart, false);
      assert.strictEqual(round2Presentation.chartData, null);
      assert.strictEqual(round2Presentation.candidateResults, null);
      assert.strictEqual(round2Presentation.totalVotes, null);
    });
  });

  describe('Test 2 — No Stale Candidate Names', () => {
    it('ensures Round N candidate names never appear in Round N+1 active presentation', () => {
      const now = 2000000;
      const round2Pair = ['Slumdog Millionaire', 'Steve Jobs'];
      const round2RunningTimer = {
        sessionId: 'sess_stale_names',
        duration: 30,
        expiresAt: now + 20000,
        status: 'running'
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: round2Pair,
        tally: {},
        timer: round2RunningTimer,
        now
      });

      // Strict check: Candidate names from previous round (e.g. Trainspotting) cannot be found
      const serialized = JSON.stringify(presentation);
      assert.strictEqual(serialized.includes('Trainspotting'), false);
      assert.strictEqual(serialized.includes('28 Days Later'), false);

      assert.deepStrictEqual(presentation.contenders, ['Slumdog Millionaire', 'Steve Jobs']);
    });
  });

  describe('Test 3 — No Stale Vote Counts or Tallies', () => {
    it('prevents tallies and percentages from Round N from leaking into Round N+1', () => {
      const now = 3000000;
      const round2Pair = ['Sunshine', '127 Hours'];
      // Even if an un-sanitized client object or stale tally was passed, VOTING_IN_PROGRESS guards it:
      const staleRound1Tally = { Trainspotting: 7, '28 Days Later': 3 };
      const round2RunningTimer = {
        sessionId: 'sess_stale_counts',
        duration: 30,
        expiresAt: now + 25000,
        status: 'running'
      };

      const presentation = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: round2Pair,
        tally: staleRound1Tally,
        timer: round2RunningTimer,
        now
      });

      assert.strictEqual(presentation.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(presentation.showStats, false);
      assert.strictEqual(presentation.showChart, false);
      assert.strictEqual(presentation.chartData, null);
      assert.strictEqual(presentation.candidateResults, null);
      assert.strictEqual(presentation.totalVotes, null);

      // Verify that numbers 7, 3, 70, 30 do not appear anywhere in candidateResults or chartData
      const serialized = JSON.stringify({
        chartData: presentation.chartData,
        candidateResults: presentation.candidateResults,
        totalVotes: presentation.totalVotes
      });
      assert.strictEqual(serialized.includes('"votes":7'), false);
      assert.strictEqual(serialized.includes('"votes":3'), false);
      assert.strictEqual(serialized.includes('"percentage":70'), false);
      assert.strictEqual(serialized.includes('"percentage":30'), false);
    });
  });

  describe('Test 4 — Real-Time State Update without Page Reload', () => {
    it('updates Redux store on socket session_state event and updates presentation immediately', () => {
      const store = createAppStore();
      const sessionId = 'sess_live_socket';

      // 1. Session in Round 1 (closed)
      store.dispatch(setSessionState(sessionId, {
        title: 'Danny Boyle Film Cup',
        status: 'voting',
        vote: {
          pair: ['Trainspotting', '28 Days Later'],
          tally: { Trainspotting: 14, '28 Days Later': 8 }
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
      let lockKey1 = getSessionPairLockKey(sessionId, vote.pair);

      assert.deepStrictEqual(vote.pair, ['Trainspotting', '28 Days Later']);
      assert.strictEqual(timer.status, 'closed');
      assert.strictEqual(lockKey1, `${sessionId}:::Trainspotting:::28 Days Later`);

      let pres1 = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: vote.pair,
        tally: vote.tally,
        timer,
        now: 600000
      });
      assert.strictEqual(pres1.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(pres1.showChart, true);
      assert.strictEqual(pres1.totalVotes, 22);

      // 2. Server emits session_state with Round 2
      const round2ExpiresAt = 700000;
      store.dispatch(setSessionState(sessionId, {
        title: 'Danny Boyle Film Cup',
        status: 'voting',
        vote: {
          pair: ['Sunshine', '127 Hours'],
          tally: {}
        },
        timer: {
          duration: 30,
          expiresAt: round2ExpiresAt,
          status: 'running'
        }
      }));

      state = store.getState();
      vote = selectVote(state, sessionId);
      timer = selectTimerBySessionId(state, sessionId);
      let lockKey2 = getSessionPairLockKey(sessionId, vote.pair);

      // Lock key must have changed (causing React to remount DOM elements with new keys)
      assert.notStrictEqual(lockKey1, lockKey2);
      assert.strictEqual(lockKey2, `${sessionId}:::Sunshine:::127 Hours`);

      // Presentation must immediately return to VOTING_IN_PROGRESS
      let pres2 = getGuardedResultsPresentation({
        hasLoaded: true,
        winner: null,
        pair: vote.pair,
        tally: vote.tally,
        timer,
        now: 650000 // now < expiresAt
      });

      assert.strictEqual(pres2.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(pres2.showChart, false);
      assert.strictEqual(pres2.chartData, null);
      assert.deepStrictEqual(pres2.contenders, ['Sunshine', '127 Hours']);
    });
  });

  describe('Test 5 — Multi-Session Isolation', () => {
    it('preserves Session 1 closed results when Session 2 transitions to a new round', () => {
      const store = createAppStore();
      const sess1Id = 'session_alpha';
      const sess2Id = 'session_beta';

      // Setup Session 1 (Closed results)
      store.dispatch(setSessionState(sess1Id, {
        title: 'Alpha Tournament',
        status: 'voting',
        vote: {
          pair: ['Matrix', 'Inception'],
          tally: { Matrix: 10, Inception: 5 }
        },
        timer: {
          duration: 30,
          expiresAt: 500000,
          status: 'closed'
        }
      }));

      // Setup Session 2 (Round 1)
      store.dispatch(setSessionState(sess2Id, {
        title: 'Beta Tournament',
        status: 'voting',
        vote: {
          pair: ['Godfather', 'Scarface'],
          tally: { Godfather: 4, Scarface: 4 }
        },
        timer: {
          duration: 30,
          expiresAt: 500000,
          status: 'closed'
        }
      }));

      // Verify Session 1 initial presentation
      let state = store.getState();
      let s1Vote = selectVote(state, sess1Id);
      let s1Timer = selectTimerBySessionId(state, sess1Id);
      let s1Pres = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: s1Vote.pair,
        tally: s1Vote.tally,
        timer: s1Timer,
        now: 600000
      });
      assert.strictEqual(s1Pres.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(s1Pres.totalVotes, 15);

      // Advance Session 2 to Round 2 (Running)
      store.dispatch(setSessionState(sess2Id, {
        title: 'Beta Tournament',
        status: 'voting',
        vote: {
          pair: ['Goodfellas', 'Casino'],
          tally: {}
        },
        timer: {
          duration: 30,
          expiresAt: 750000,
          status: 'running'
        }
      }));

      // Re-query Session 1 and Session 2
      state = store.getState();
      const s1VoteAfter = selectVote(state, sess1Id);
      const s1TimerAfter = selectTimerBySessionId(state, sess1Id);
      const s2VoteAfter = selectVote(state, sess2Id);
      const s2TimerAfter = selectTimerBySessionId(state, sess2Id);

      // Session 1 remains completely unaffected
      assert.deepStrictEqual(s1VoteAfter.pair, ['Matrix', 'Inception']);
      assert.strictEqual(s1TimerAfter.status, 'closed');
      const s1PresAfter = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: s1VoteAfter.pair,
        tally: s1VoteAfter.tally,
        timer: s1TimerAfter,
        now: 600000
      });
      assert.strictEqual(s1PresAfter.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(s1PresAfter.totalVotes, 15);
      assert.strictEqual(s1PresAfter.showChart, true);

      // Session 2 is in Voting in Progress
      const s2PresAfter = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: s2VoteAfter.pair,
        tally: s2VoteAfter.tally,
        timer: s2TimerAfter,
        now: 600000
      });
      assert.strictEqual(s2PresAfter.visibilityState, 'VOTING_IN_PROGRESS');
      assert.strictEqual(s2PresAfter.showChart, false);
      assert.deepStrictEqual(s2PresAfter.contenders, ['Goodfellas', 'Casino']);
    });
  });

  describe('Test 6 — Timer Boundary Analysis (Cases A, B, C)', () => {
    const pair = ['Alien', 'Predator'];
    const tally = { Alien: 5, Predator: 2 };
    const expiresAt = 1000000;

    it('Case A: now < expiresAt -> VOTING_IN_PROGRESS (Guarded tallies)', () => {
      const now = expiresAt - 1000; // 1s before expiry
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
      assert.strictEqual(pres.showStats, false);
      assert.strictEqual(pres.chartData, null);
    });

    it('Case B: now === expiresAt (visual expiry) -> reveals results for current pair without auto-advancing', () => {
      const now = expiresAt; // exact boundary
      const timer = { duration: 30, expiresAt, status: 'running' };

      const pres = getGuardedResultsPresentation({
        hasLoaded: true,
        pair,
        tally,
        timer,
        now
      });

      // Visual expiry on client reveals current round's tallies while awaiting server event
      assert.strictEqual(pres.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(pres.showChart, true);
      assert.strictEqual(pres.showStats, true);
      assert.strictEqual(pres.totalVotes, 7);
      // Pair remains unchanged: client does not fabricate a new round
      assert.deepStrictEqual(pres.contenders, ['Alien', 'Predator']);
    });

    it('Case C: serverConfirmedClosure -> authoritative results reveal', () => {
      // timer is closed / null or serverConfirmedClosure is true
      const pres1 = getGuardedResultsPresentation({
        hasLoaded: true,
        pair,
        tally,
        timer: null,
        serverConfirmedClosure: true
      });
      assert.strictEqual(pres1.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(pres1.showChart, true);
      assert.strictEqual(isServerRoundClosed(null, true), true);

      const pres2 = getGuardedResultsPresentation({
        hasLoaded: true,
        pair,
        tally,
        timer: { duration: 30, expiresAt, status: 'closed' }
      });
      assert.strictEqual(pres2.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(pres2.showChart, true);
    });
  });

  describe('Test 7 — Server Authority & Zero Client Dispatch', () => {
    it('verifies the client never dispatches NEXT or mutates tournament rounds autonomously', () => {
      const store = createAppStore();
      const dispatchedActions = [];
      const originalDispatch = store.dispatch;

      store.dispatch = (action) => {
        dispatchedActions.push(action);
        return originalDispatch(action);
      };

      // Set initial session
      store.dispatch(setSessionState('sess_authority', {
        status: 'voting',
        vote: {
          pair: ['Candidate 1', 'Candidate 2'],
          tally: { 'Candidate 1': 3, 'Candidate 2': 1 }
        },
        timer: {
          duration: 30,
          expiresAt: 1000,
          status: 'running'
        }
      }));

      // Evaluate boundary at and beyond timer expiry
      const nowBoundary = 1000;
      const nowPast = 2000;

      const presAtExpiry = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: ['Candidate 1', 'Candidate 2'],
        tally: { 'Candidate 1': 3, 'Candidate 2': 1 },
        timer: { duration: 30, expiresAt: 1000, status: 'running' },
        now: nowBoundary
      });

      const presPastExpiry = getGuardedResultsPresentation({
        hasLoaded: true,
        pair: ['Candidate 1', 'Candidate 2'],
        tally: { 'Candidate 1': 3, 'Candidate 2': 1 },
        timer: { duration: 30, expiresAt: 1000, status: 'running' },
        now: nowPast
      });

      assert.strictEqual(presAtExpiry.visibilityState, 'RESULTS_REVEALED');
      assert.strictEqual(presPastExpiry.visibilityState, 'RESULTS_REVEALED');

      // Check actions dispatched: only setSessionState should have been called, NO NEXT or VOTE
      const actionTypes = dispatchedActions.map((a) => a.type);
      assert.strictEqual(actionTypes.includes(NEXT), false);
      assert.strictEqual(actionTypes.includes(VOTE), false);
      assert.strictEqual(actionTypes.includes('vote/NEXT'), false);
      assert.strictEqual(actionTypes.includes('NEXT'), false);
    });
  });

});
