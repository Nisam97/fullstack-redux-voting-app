import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatResolution,
  deriveTotals
} from '../src/components/results/resultsUtils.js';
import voteReducer, {
  setSessionState,
  appendRoundResult,
  selectSessionRounds,
  selectRoundTotals
} from '../src/redux/voteSlice.js';
import { fetchSessionRounds } from '../src/services/history.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Round History and Full Results Client Specs', () => {

  describe('resultsUtils: formatResolution & deriveTotals', () => {
    it('formatResolution returns descriptive badges for round resolutions', () => {
      assert.strictEqual(formatResolution('WINNER', ['Trainspotting']), 'Winner: Trainspotting');
      assert.strictEqual(formatResolution('WINNER'), 'Winner declared');
      assert.strictEqual(formatResolution('TIE_REQUEUED'), 'Tie — Re-queued');
      assert.strictEqual(formatResolution('TIE_COIN_TOSS'), 'Tie — Decided by coin toss');
      assert.strictEqual(formatResolution('UNKNOWN'), 'Round complete');
    });

    it('deriveTotals returns empty summary when rounds is empty', () => {
      const totals = deriveTotals([]);
      assert.strictEqual(totals.totalRounds, 0);
      assert.strictEqual(totals.totalVotes, 0);
      assert.deepStrictEqual(totals.candidates, []);
    });

    it('deriveTotals aggregates votes, percentages, and win/loss records', () => {
      const rounds = [
        {
          roundIndex: 0,
          candidates: ['Trainspotting', '28 Days Later'],
          tally: { Trainspotting: 4, '28 Days Later': 1 },
          totalVotes: 5,
          resolution: 'WINNER',
          advanced: ['Trainspotting']
        },
        {
          roundIndex: 1,
          candidates: ['Trainspotting', 'Sunshine'],
          tally: { Trainspotting: 3, Sunshine: 2 },
          totalVotes: 5,
          resolution: 'WINNER',
          advanced: ['Trainspotting']
        }
      ];

      const totals = deriveTotals(rounds);
      assert.strictEqual(totals.totalRounds, 2);
      assert.strictEqual(totals.totalVotes, 10);
      assert.strictEqual(totals.candidates.length, 3);

      // Trainspotting: 7 votes out of 10 = 70%, 2 wins, 0 losses
      const top = totals.candidates[0];
      assert.strictEqual(top.name, 'Trainspotting');
      assert.strictEqual(top.totalVotes, 7);
      assert.strictEqual(top.percentage, 70);
      assert.strictEqual(top.wins, 2);
      assert.strictEqual(top.losses, 0);

      // Sunshine: 2 votes = 20%, 0 wins, 1 loss
      const sunshine = totals.candidates.find(c => c.name === 'Sunshine');
      assert.strictEqual(sunshine.totalVotes, 2);
      assert.strictEqual(sunshine.percentage, 20);
      assert.strictEqual(sunshine.wins, 0);
      assert.strictEqual(sunshine.losses, 1);

      // 28 Days Later: 1 vote = 10%, 0 wins, 1 loss
      const daysLater = totals.candidates.find(c => c.name === '28 Days Later');
      assert.strictEqual(daysLater.totalVotes, 1);
      assert.strictEqual(daysLater.percentage, 10);
      assert.strictEqual(daysLater.wins, 0);
      assert.strictEqual(daysLater.losses, 1);
    });
  });

  describe('voteSlice: normalizeSession rounds guarding', () => {
    it('strips rounds when roundLifecycle is VOTING and status is not completed', () => {
      const state = voteReducer(undefined, setSessionState({
        id: 's1',
        status: 'open',
        roundLifecycle: 'VOTING',
        rounds: [
          { roundIndex: 0, candidates: ['A', 'B'], tally: { A: 2, B: 1 } }
        ]
      }));

      assert.deepStrictEqual(state.bySessionId.s1.rounds, []);
    });

    it('preserves rounds when roundLifecycle is ROUND_CLOSED', () => {
      const round0 = { roundIndex: 0, candidates: ['A', 'B'], tally: { A: 2, B: 1 } };
      const state = voteReducer(undefined, setSessionState({
        id: 's1',
        status: 'open',
        roundLifecycle: 'ROUND_CLOSED',
        rounds: [round0]
      }));

      assert.strictEqual(state.bySessionId.s1.rounds.length, 1);
      assert.strictEqual(state.bySessionId.s1.rounds[0].roundIndex, 0);
    });

    it('preserves rounds when roundLifecycle is RESULTS_REVEALED', () => {
      const round0 = { roundIndex: 0, candidates: ['A', 'B'], tally: { A: 2, B: 1 } };
      const state = voteReducer(undefined, setSessionState({
        id: 's1',
        status: 'open',
        roundLifecycle: 'RESULTS_REVEALED',
        rounds: [round0]
      }));

      assert.strictEqual(state.bySessionId.s1.rounds.length, 1);
    });

    it('preserves rounds when session is completed', () => {
      const round0 = { roundIndex: 0, candidates: ['A', 'B'], tally: { A: 2, B: 1 } };
      const state = voteReducer(undefined, setSessionState({
        id: 's1',
        status: 'completed',
        roundLifecycle: 'VOTING',
        rounds: [round0]
      }));

      assert.strictEqual(state.bySessionId.s1.rounds.length, 1);
    });
  });

  describe('voteSlice: appendRoundResult and selectors', () => {
    it('appends round result idempotently', () => {
      let state = voteReducer(undefined, setSessionState({
        id: 's1',
        status: 'open',
        rounds: []
      }));

      const round0 = {
        roundIndex: 0,
        candidates: ['Alpha', 'Beta'],
        tally: { Alpha: 3, Beta: 2 },
        totalVotes: 5,
        resolution: 'WINNER',
        advanced: ['Alpha']
      };

      state = voteReducer(state, appendRoundResult({
        sessionId: 's1',
        roundSnapshot: round0
      }));

      assert.strictEqual(state.bySessionId.s1.rounds.length, 1);
      assert.strictEqual(state.bySessionId.s1.rounds[0].roundIndex, 0);

      // Re-dispatching same round index should not duplicate
      state = voteReducer(state, appendRoundResult({
        sessionId: 's1',
        roundSnapshot: round0
      }));
      assert.strictEqual(state.bySessionId.s1.rounds.length, 1);

      // Dispatching round 1
      const round1 = {
        roundIndex: 1,
        candidates: ['Alpha', 'Gamma'],
        tally: { Alpha: 4, Gamma: 1 },
        totalVotes: 5,
        resolution: 'WINNER',
        advanced: ['Alpha']
      };
      state = voteReducer(state, appendRoundResult({
        sessionId: 's1',
        roundSnapshot: round1
      }));
      assert.strictEqual(state.bySessionId.s1.rounds.length, 2);

      // Selectors
      const selectedRounds = selectSessionRounds({ vote: state }, 's1');
      assert.strictEqual(selectedRounds.length, 2);

      const totals = selectRoundTotals({ vote: state }, 's1');
      assert.strictEqual(totals.totalRounds, 2);
      assert.strictEqual(totals.totalVotes, 10);
      assert.strictEqual(totals.candidates[0].name, 'Alpha');
      assert.strictEqual(totals.candidates[0].totalVotes, 7);
    });
  });

  describe('services/history: fetchSessionRounds (covers: AC-7)', () => {
    it('returns error when sessionId is missing', async () => {
      const res = await fetchSessionRounds('');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'INVALID_SESSION_ID');
    });

    it('fetches rounds successfully via fetch API', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => ({
          ok: true,
          json: async () => ({
            success: true,
            sessionId: 'sess_123',
            rounds: [{ roundIndex: 0, candidates: ['A', 'B'] }]
          })
        });

        const res = await fetchSessionRounds('sess_123');
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.sessionId, 'sess_123');
        assert.strictEqual(res.rounds.length, 1);
        assert.strictEqual(res.rounds[0].roundIndex, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('handles 404 or network errors gracefully', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => ({
          ok: false,
          json: async () => ({
            success: false,
            error: 'ROUNDS_NOT_FOUND',
            message: 'No rounds found'
          })
        });

        const res = await fetchSessionRounds('sess_missing');
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.error, 'ROUNDS_NOT_FOUND');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
