import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  initialState,
  normalizeSession,
  setSessionState,
  setTimerState,
  setTiePending,
  resolveTie,
  selectVotingMode,
  selectTiePending,
  selectIsTiePending,
  selectCandidates,
  selectSessionById,
  RESOLVE_TIE,
  SET_TIE_PENDING,
  TIE_PENDING
} from '../src/redux/voteSlice.js';
import {
  REMOTE_ACTION_TYPES,
  LOCAL_ACTION_TYPES,
  createAppStore
} from '../src/redux/store.js';
import { formatResolution, RESOLUTION_LABELS } from '../src/components/results/resultsUtils.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 5: Single Ballot Mode and Tie Ladder (Client Architecture)', () => {

  describe('1. Session Normalization & Single Ballot State Invariants', () => {
    it('1.1 normalizeSession defaults votingMode to tournament when omitted', () => {
      const normalized = normalizeSession({ id: 'sess_1', title: 'Default Mode' }, 'sess_1');
      assert.strictEqual(normalized.votingMode, 'tournament');
      assert.strictEqual(normalized.tieCount, 0);
      assert.strictEqual(normalized.zeroVoteCount, 0);
      assert.strictEqual(normalized.tiePending, null);
    });

    it('1.2 normalizeSession preserves single_ballot votingMode and counters', () => {
      const raw = {
        id: 'sess_2',
        title: 'Best Director',
        votingMode: 'single_ballot',
        tieCount: 1,
        zeroVoteCount: 1,
        roundLifecycle: 'TIE_PENDING',
        tiePending: {
          candidates: ['Nolan', 'Villeneuve'],
          expiresAt: Date.now() + 30000,
          duration: 30
        }
      };
      const normalized = normalizeSession(raw, 'sess_2');
      assert.strictEqual(normalized.votingMode, 'single_ballot');
      assert.strictEqual(normalized.tieCount, 1);
      assert.strictEqual(normalized.zeroVoteCount, 1);
      assert.strictEqual(normalized.roundLifecycle, 'TIE_PENDING');
      assert.deepStrictEqual(normalized.tiePending.candidates, ['Nolan', 'Villeneuve']);
    });

    it('1.3 normalizeSession clears tiePending when session concludes with a winner', () => {
      const raw = {
        id: 'sess_3',
        winner: 'Nolan',
        status: 'completed',
        tiePending: { candidates: ['Nolan', 'Villeneuve'] }
      };
      const normalized = normalizeSession(raw, 'sess_3');
      assert.strictEqual(normalized.winner, 'Nolan');
      assert.strictEqual(normalized.tiePending, null);
    });
  });

  describe('2. Reducer Tie Ladder Transitions & Timer Hydration', () => {
    it('2.1 SET_TIE_PENDING transitions session into TIE_PENDING and records metadata', () => {
      const sessionId = 'sess_tie_1';
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Tie Ladder Session',
        status: 'open',
        roundLifecycle: 'VOTING',
        vote: { pair: ['Alpha', 'Beta'], tally: {} }
      }));

      const expiresAt = Date.now() + 30000;
      state = voteReducer(state, setTiePending(sessionId, {
        candidates: ['Alpha', 'Beta'],
        expiresAt,
        duration: 30,
        roundId: `${sessionId}:::r1`
      }));

      const session = selectSessionById(state, sessionId);
      assert.strictEqual(session.roundLifecycle, 'TIE_PENDING');
      assert.strictEqual(session.timer, null);
      assert.strictEqual(session.revealTimer, null);
      assert.deepStrictEqual(session.tiePending.candidates, ['Alpha', 'Beta']);
      assert.strictEqual(session.tiePending.duration, 30);
      assert.strictEqual(session.tiePending.expiresAt, expiresAt);
    });

    it('2.2 timerState with status tie_pending updates roundLifecycle and tiePending', () => {
      const sessionId = 'sess_tie_2';
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Tie Timer Session',
        status: 'open',
        roundLifecycle: 'VOTING'
      }));

      const expiresAt = Date.now() + 30000;
      state = voteReducer(state, setTimerState(sessionId, {
        status: 'tie_pending',
        candidates: ['Cand X', 'Cand Y'],
        duration: 30,
        expiresAt
      }));

      const session = selectSessionById(state, sessionId);
      assert.strictEqual(session.roundLifecycle, 'TIE_PENDING');
      assert.deepStrictEqual(session.tiePending.candidates, ['Cand X', 'Cand Y']);
      assert.strictEqual(session.tiePending.expiresAt, expiresAt);
    });

    it('2.3 timerState with status running clears tiePending upon advancing to new round', () => {
      const sessionId = 'sess_tie_3';
      let state = voteReducer(initialState, setSessionState({
        id: sessionId,
        title: 'Advancing Session',
        status: 'open',
        roundLifecycle: 'TIE_PENDING',
        tiePending: { candidates: ['A', 'B'], expiresAt: Date.now() + 10000 }
      }));

      state = voteReducer(state, setTimerState(sessionId, {
        status: 'running',
        duration: 30,
        expiresAt: Date.now() + 30000
      }));

      const session = selectSessionById(state, sessionId);
      assert.strictEqual(session.roundLifecycle, 'VOTING');
      assert.strictEqual(session.tiePending, null);
      assert.strictEqual(session.timer.status, 'running');
    });

    it('2.4 RESOLVE_TIE is pure intent and does not locally alter server state', () => {
      const sessionId = 'sess_tie_4';
      const initialSession = {
        id: sessionId,
        roundLifecycle: 'TIE_PENDING',
        tiePending: { candidates: ['Alpha', 'Beta'] }
      };
      const state = voteReducer(initialState, setSessionState(initialSession));
      const nextState = voteReducer(state, resolveTie(sessionId, 'round_1', 'pick', 'Alpha'));
      assert.strictEqual(selectSessionById(nextState, sessionId).roundLifecycle, 'TIE_PENDING');
    });
  });

  describe('3. Selectors for Single Ballot & Tie Ladder', () => {
    it('3.1 selectVotingMode returns session votingMode or default tournament', () => {
      const state = voteReducer(initialState, setSessionState({
        id: 'sess_sb',
        votingMode: 'single_ballot'
      }));
      assert.strictEqual(selectVotingMode(state, 'sess_sb'), 'single_ballot');
      assert.strictEqual(selectVotingMode(state, 'non_existent'), 'tournament');
    });

    it('3.2 selectTiePending and selectIsTiePending accurately reflect ladder state', () => {
      const state = voteReducer(initialState, setSessionState({
        id: 'sess_pending',
        roundLifecycle: 'TIE_PENDING',
        tiePending: { candidates: ['Item 1', 'Item 2'], duration: 30 }
      }));
      assert.strictEqual(selectIsTiePending(state, 'sess_pending'), true);
      assert.deepStrictEqual(selectTiePending(state, 'sess_pending')?.candidates, ['Item 1', 'Item 2']);
      assert.strictEqual(selectIsTiePending(state, 'unknown'), false);
      assert.strictEqual(selectTiePending(state, 'unknown'), null);
    });

    it('3.3 selectCandidates returns multi-candidate list in single ballot and pair in tournament', () => {
      const sbState = voteReducer(initialState, setSessionState({
        id: 'sess_candidates',
        vote: { candidates: ['C1', 'C2', 'C3', 'C4'], pair: ['C1', 'C2'] }
      }));
      assert.deepStrictEqual(selectCandidates(sbState, 'sess_candidates'), ['C1', 'C2', 'C3', 'C4']);

      const tourneyState = voteReducer(initialState, setSessionState({
        id: 'sess_tourney',
        vote: { pair: ['T1', 'T2'] }
      }));
      assert.deepStrictEqual(selectCandidates(tourneyState, 'sess_tourney'), ['T1', 'T2']);
    });
  });

  describe('4. Remote Action Transmission & Echo Prevention', () => {
    it('4.1 RESOLVE_TIE is included in REMOTE_ACTION_TYPES', () => {
      assert.ok(REMOTE_ACTION_TYPES.has('RESOLVE_TIE'));
      assert.ok(REMOTE_ACTION_TYPES.has(RESOLVE_TIE));
    });

    it('4.2 SET_TIE_PENDING and tie_pending are in LOCAL_ACTION_TYPES and never emitted', () => {
      assert.ok(LOCAL_ACTION_TYPES.has(SET_TIE_PENDING));
      assert.ok(LOCAL_ACTION_TYPES.has(TIE_PENDING));
    });

    it('4.3 createRemoteActionMiddleware enriches RESOLVE_TIE with admin token and emits to socket', () => {
      const emittedActions = [];
      const mockSocket = {
        emit: (event, payload) => {
          emittedActions.push({ event, payload });
        }
      };

      const testStore = createAppStore(mockSocket);
      const action = resolveTie({
        sessionId: 'sess_enrich',
        roundId: 'sess_enrich:::r2',
        choice: 'pick',
        winner: 'Candidate X',
        token: 'admin-jwt-token-123'
      });

      testStore.dispatch(action);

      assert.strictEqual(emittedActions.length, 1);
      assert.strictEqual(emittedActions[0].event, 'action');
      assert.strictEqual(emittedActions[0].payload.type, 'RESOLVE_TIE');
      assert.strictEqual(emittedActions[0].payload.choice, 'pick');
      assert.strictEqual(emittedActions[0].payload.winner, 'Candidate X');
      assert.strictEqual(emittedActions[0].payload.token, 'admin-jwt-token-123');
    });

    it('4.4 createRemoteActionMiddleware does NOT emit SET_TIE_PENDING to socket', () => {
      const emittedActions = [];
      const mockSocket = {
        emit: (event, payload) => {
          emittedActions.push({ event, payload });
        }
      };

      const testStore = createAppStore(mockSocket);
      testStore.dispatch(setTiePending('sess_local', { candidates: ['A', 'B'] }));

      assert.strictEqual(emittedActions.length, 0);
    });
  });

  describe('5. Resolution Formatting for History Timeline', () => {
    it('5.1 formatResolution maps new tie ladder settlement enums to human readable badges', () => {
      assert.strictEqual(formatResolution('runoff'), 'Runoff Rematch');
      assert.strictEqual(formatResolution('admin_pick'), 'Admin Decision');
      assert.strictEqual(formatResolution('coin_flip'), 'Coin Flip');
      assert.strictEqual(formatResolution('no_result'), 'No Result');
      assert.strictEqual(formatResolution('zero_vote_replay'), 'Zero-Vote Replay');
      assert.strictEqual(formatResolution('majority_win', ['Dune: Part Two']), 'Winner: Dune: Part Two');
      assert.strictEqual(formatResolution('tie_advance'), 'Tie, Both Advanced');
    });

    it('5.1a formatResolution renders the exact AC-6 badge strings', () => {
      // Spec 0003 AC-6 names these two literals, so the timeline badge must
      // read exactly this rather than any paraphrase.
      assert.strictEqual(formatResolution('majority_win'), 'Majority Win');
      assert.strictEqual(formatResolution('tie_advance'), 'Tie, Both Advanced');
    });

    it('5.2 RESOLUTION_LABELS contains all spec 0004 resolution types', () => {
      assert.strictEqual(RESOLUTION_LABELS.runoff, 'Runoff Rematch');
      assert.strictEqual(RESOLUTION_LABELS.admin_pick, 'Admin Decision');
      assert.strictEqual(RESOLUTION_LABELS.coin_flip, 'Coin Flip');
      assert.strictEqual(RESOLUTION_LABELS.no_result, 'No Result');
      assert.strictEqual(RESOLUTION_LABELS.zero_vote_replay, 'Zero-Vote Replay');
      assert.strictEqual(RESOLUTION_LABELS.majority_win, 'Majority Win');
      assert.strictEqual(RESOLUTION_LABELS.tie_advance, 'Tie, Both Advanced');
    });
  });

  describe('6. Edge Cases & Normalization Security', () => {
    it('6.1 normalizeSession strips forbidden tokens and secrets', () => {
      const raw = {
        id: 'sess_sec',
        title: 'Security Sanitization',
        voterToken: 'secret_voter_token',
        token: 'admin_token',
        jwt: 'jwt_payload',
        password: 'admin_password',
        secret: 'internal_secret',
        entries: ['A', 'B']
      };
      const normalized = normalizeSession(raw, 'sess_sec');
      assert.strictEqual(normalized.voterToken, undefined);
      assert.strictEqual(normalized.token, undefined);
      assert.strictEqual(normalized.jwt, undefined);
      assert.strictEqual(normalized.password, undefined);
      assert.strictEqual(normalized.secret, undefined);
      assert.deepStrictEqual(normalized.entries, ['A', 'B']);
    });

    it('6.2 selectCandidates safely returns empty array when session or vote is empty', () => {
      const state = { vote: { bySessionId: {}, activeSessionId: null } };
      assert.deepStrictEqual(selectCandidates(state, 'non_existent'), []);
    });

    it('6.3 selectIsTiePending returns false for null/empty session or normal voting', () => {
      const state = voteReducer(initialState, setSessionState({
        id: 'sess_normal',
        roundLifecycle: 'VOTING'
      }));
      assert.strictEqual(selectIsTiePending(state, 'sess_normal'), false);
      assert.strictEqual(selectIsTiePending(state, null), false);
    });
  });
});
