import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import {
  initRound,
  recordRoundSubmission,
  getRoundSubmissions,
  canCompleteEarly,
  closeRoundOnce,
  computeEligibility,
  resetRounds
} from '../src/roundManager.js';
import { registerVoter, clearVoters } from '../src/auth/voter.js';
import { resetAuthConfig } from '../src/auth/config.js';
import { GRACE_PERIOD_MS } from '../src/constants.js';

describe('Authoritative Eligibility and Quorum Integration (AC 4, AC 5, AC 6, AC 7, AC 9)', function () {
  beforeEach(() => {
    clearVoters();
    resetAuthConfig();
    resetRounds();
  });

  describe('1. Snapshot Relative Quorum Evaluation (AC 6, AC 7)', () => {
    it('computes quorum directly via pure helper computeEligibility', () => {
      const now = 50000;
      const snapshot = ['voter_1', 'voter_2'];
      const presence = new Map([
        ['voter_1', { connected: true, disconnectedAt: null }],
        ['voter_2', { connected: false, disconnectedAt: 45000 }] // inside 10s grace
      ]);

      const partialVote = computeEligibility({
        snapshot,
        presence,
        submittedTokens: ['voter_1'],
        now,
        graceMs: GRACE_PERIOD_MS
      });

      expect(partialVote.hasQuorum).to.equal(false);
      expect(partialVote.activeCount).to.equal(2);
      expect(partialVote.votedCount).to.equal(1);

      const fullVote = computeEligibility({
        snapshot,
        presence,
        submittedTokens: ['voter_1', 'voter_2'],
        now,
        graceMs: GRACE_PERIOD_MS
      });

      expect(fullVote.hasQuorum).to.equal(true);
      expect(fullVote.votedCount).to.equal(2);
    });

    it('past grace ghost voter drops from active denominator (AC 3, AC 6)', () => {
      const now = 50000;
      const snapshot = ['voter_1', 'voter_2'];
      const presence = new Map([
        ['voter_1', { connected: true, disconnectedAt: null }],
        ['voter_2', { connected: false, disconnectedAt: 30000 }] // 20s elapsed, past grace
      ]);

      const result = computeEligibility({
        snapshot,
        presence,
        submittedTokens: ['voter_1'],
        now,
        graceMs: GRACE_PERIOD_MS
      });

      expect(result.hasQuorum).to.equal(true);
      expect(result.activeCount).to.equal(1);
      expect(result.votedCount).to.equal(1);
    });

    it('zero active snapshot voters inhibits early close (AC 7)', () => {
      const now = 50000;
      const snapshot = ['voter_1', 'voter_2'];
      const presence = new Map([
        ['voter_1', { connected: false, disconnectedAt: 20000 }],
        ['voter_2', { connected: false, disconnectedAt: 20000 }]
      ]);

      const result = computeEligibility({
        snapshot,
        presence,
        submittedTokens: [],
        now,
        graceMs: GRACE_PERIOD_MS
      });

      expect(result.hasQuorum).to.equal(false);
      expect(result.activeCount).to.equal(0);
    });
  });

  describe('2. Late Joiner and Reconnect Scenarios (AC 4, AC 5)', () => {
    it('late joiner mid round votes successfully but cannot delay early close of existing snapshot', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_integ_late',
        title: 'Late Joiner Session',
        entries: ['Option A', 'Option B', 'Option C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_integ_late' });

      const v1 = registerVoter({ sessionId: 'sess_integ_late', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_integ_late', displayName: 'V2', store });

      const round = initRound('sess_integ_late', ['Option A', 'Option B']);

      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_integ_late',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_v1',
        timestamp: 1000
      });

      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_integ_late',
        voterToken: v2.voter.sessionToken,
        socketId: 'sock_v2',
        timestamp: 1000
      });

      store.dispatch({
        type: 'SNAPSHOT_ROUND_ELIGIBILITY',
        sessionId: 'sess_integ_late',
        roundId: round.roundId,
        timestamp: 1000
      });

      // Late joiner V3 arrives mid round
      const v3 = registerVoter({ sessionId: 'sess_integ_late', displayName: 'V3', store });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_integ_late',
        voterToken: v3.voter.sessionToken,
        socketId: 'sock_v3',
        timestamp: 2000
      });

      // V1 and V2 cast votes
      recordRoundSubmission({
        sessionId: 'sess_integ_late',
        roundId: round.roundId,
        sessionToken: v1.voter.sessionToken
      });

      recordRoundSubmission({
        sessionId: 'sess_integ_late',
        roundId: round.roundId,
        sessionToken: v2.voter.sessionToken
      });

      // Early close condition met for snapshot without waiting for V3
      const canClose = canCompleteEarly({
        sessionId: 'sess_integ_late',
        roundId: round.roundId,
        store
      });

      expect(canClose).to.equal(true);

      // Late joiner V3 can still cast valid ballot if round is open
      const subV3 = recordRoundSubmission({
        sessionId: 'sess_integ_late',
        roundId: round.roundId,
        sessionToken: v3.voter.sessionToken
      });
      expect(subV3.success).to.equal(true);
      expect(getRoundSubmissions({ sessionId: 'sess_integ_late', roundId: round.roundId }).length).to.equal(3);
    });

    it('reconnected voter ballot is accepted and duplicate vote ledger preserves integrity (AC 4)', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_integ_reconn',
        title: 'Reconnect Session',
        entries: ['Option A', 'Option B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_integ_reconn' });

      const v1 = registerVoter({ sessionId: 'sess_integ_reconn', displayName: 'V1', store });
      const round = initRound('sess_integ_reconn', ['Option A', 'Option B']);

      const firstVote = recordRoundSubmission({
        sessionId: 'sess_integ_reconn',
        roundId: round.roundId,
        sessionToken: v1.voter.sessionToken
      });
      expect(firstVote.success).to.equal(true);
      expect(firstVote.isNew).to.equal(true);

      // Second attempt by same voter in same round is rejected as duplicate
      const duplicateVote = recordRoundSubmission({
        sessionId: 'sess_integ_reconn',
        roundId: round.roundId,
        sessionToken: v1.voter.sessionToken
      });
      expect(duplicateVote.success).to.equal(true);
      expect(duplicateVote.isNew).to.equal(false);
      expect(getRoundSubmissions({ sessionId: 'sess_integ_reconn', roundId: round.roundId }).length).to.equal(1);
    });
  });

  describe('3. Snapshot Ordering and Ladder Independence (AC 9)', () => {
    it('tie ladder step takes fresh snapshot capturing new participants', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_ladder_step',
        title: 'Ladder Step Session',
        entries: ['Option A', 'Option B', 'Option C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_ladder_step' });

      const v1 = registerVoter({ sessionId: 'sess_ladder_step', displayName: 'V1', store });
      const r1 = initRound('sess_ladder_step', ['Option A', 'Option B']);

      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_ladder_step',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_v1',
        timestamp: 1000
      });

      store.dispatch({
        type: 'SNAPSHOT_ROUND_ELIGIBILITY',
        sessionId: 'sess_ladder_step',
        roundId: r1.roundId,
        timestamp: 1000
      });

      const snap1 = store.getState().getIn(['sessions', 'sess_ladder_step', 'snapshots', r1.roundId]);
      expect(snap1.get('eligibleVoterKeys').size).to.equal(1);

      // New participant joins before round 2 starts
      const v2 = registerVoter({ sessionId: 'sess_ladder_step', displayName: 'V2', store });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_ladder_step',
        voterToken: v2.voter.sessionToken,
        socketId: 'sock_v2',
        timestamp: 2000
      });

      // Rematch round 2 opens
      const r2 = initRound('sess_ladder_step', ['Option A', 'Option B']);
      store.dispatch({
        type: 'SNAPSHOT_ROUND_ELIGIBILITY',
        sessionId: 'sess_ladder_step',
        roundId: r2.roundId,
        timestamp: 2100
      });

      const snap2 = store.getState().getIn(['sessions', 'sess_ladder_step', 'snapshots', r2.roundId]);
      expect(snap2.get('eligibleVoterKeys').size).to.equal(2);
      expect(snap2.get('eligibleVoterKeys').has(v2.voter.sessionToken)).to.equal(true);

      // Snap 1 remains untouched (immutable history)
      const snap1Again = store.getState().getIn(['sessions', 'sess_ladder_step', 'snapshots', r1.roundId]);
      expect(snap1Again.get('eligibleVoterKeys').size).to.equal(1);
    });
  });

  describe('4. Production Path Wiring and Authoritative Early Close (Blockers 1, 2, 3)', () => {
    let ioServer = null;
    const clientSockets = [];

    afterEach((done) => {
      while (clientSockets.length > 0) {
        const s = clientSockets.pop();
        if (s && s.connected) {
          s.disconnect();
        }
      }
      if (ioServer) {
        ioServer.close(() => done());
        ioServer = null;
      } else {
        done();
      }
    });

    it('Blocker 1: initRound with store dispatches SNAPSHOT_ROUND_ELIGIBILITY to Redux store', () => {
      // covers: AC-1, AC-9, Blocker 1
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_prod_snap',
        title: 'Snap Test',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_prod_snap' });

      const v1 = registerVoter({ sessionId: 'sess_prod_snap', displayName: 'V1', store });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_prod_snap',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_1',
        timestamp: 1000
      });

      const round = initRound('sess_prod_snap', ['A', 'B'], { store });
      expect(round).to.not.be.null;

      const storeSnapshot = store.getState().getIn(['sessions', 'sess_prod_snap', 'snapshots', round.roundId]);
      expect(storeSnapshot).to.not.be.undefined;
      expect(storeSnapshot.get('eligibleVoterKeys').size).to.equal(1);
      expect(storeSnapshot.get('eligibleVoterKeys').has(v1.voter.sessionToken)).to.equal(true);
    });

    it('Blocker 1: snapshot excludes disconnected voters at round opening', () => {
      // covers: AC-1, AC-9, Blocker 1
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_disc_snap',
        title: 'Disconnected Snapshot Test',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_disc_snap' });

      const v1 = registerVoter({ sessionId: 'sess_disc_snap', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_disc_snap', displayName: 'V2', store });

      // V1 connected, V2 disconnected
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_disc_snap',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_1',
        timestamp: 1000
      });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_disc_snap',
        voterToken: v2.voter.sessionToken,
        socketId: 'sock_2',
        timestamp: 1000
      });
      store.dispatch({
        type: 'RECORD_PRESENCE_DISCONNECT',
        sessionId: 'sess_disc_snap',
        voterToken: v2.voter.sessionToken,
        socketId: 'sock_2',
        timestamp: 1500
      });

      const round = initRound('sess_disc_snap', ['A', 'B'], { store });
      const storeSnapshot = store.getState().getIn(['sessions', 'sess_disc_snap', 'snapshots', round.roundId]);
      expect(storeSnapshot.get('eligibleVoterKeys').has(v1.voter.sessionToken)).to.equal(true);
      expect(storeSnapshot.get('eligibleVoterKeys').has(v2.voter.sessionToken)).to.equal(false);
      expect(storeSnapshot.get('snapshotCount')).to.equal(1);
    });

    it('Blocker 2: socket subscribe_session with voterToken records presence in store', (done) => {
      // covers: AC-2, AC-8, Blocker 2
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_prod_pres',
        title: 'Presence Socket Test',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_prod_pres' });

      const v1 = registerVoter({ sessionId: 'sess_prod_pres', displayName: 'Alice', store });
      const voterToken = v1.voter.sessionToken;

      ioServer = startServer(store, 0);
      const port = ioServer.httpServer.address().port;

      const client = Client(`http://localhost:${port}`, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });
      clientSockets.push(client);

      client.on('connect', () => {
        client.emit('subscribe_session', { sessionId: 'sess_prod_pres', voterToken });

        setTimeout(() => {
          const presenceMap = store.getState().getIn(['sessions', 'sess_prod_pres', 'presence']);
          expect(presenceMap).to.not.be.undefined;
          const voterRec = presenceMap.get(voterToken);
          expect(voterRec).to.not.be.undefined;
          expect(voterRec.get('connected')).to.equal(true);
          done();
        }, 100);
      });
    });

    it('Blocker 2: socket subscribe_session without voterToken does not record voter presence', (done) => {
      // covers: AC-2, AC-8, AC-10, Blocker 2
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_anon_pres',
        title: 'Anonymous Socket Test',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_anon_pres' });

      ioServer = startServer(store, 0);
      const port = ioServer.httpServer.address().port;

      const client = Client(`http://localhost:${port}`, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });
      clientSockets.push(client);

      client.on('connect', () => {
        client.emit('subscribe_session', { sessionId: 'sess_anon_pres' });

        setTimeout(() => {
          const presenceMap = store.getState().getIn(['sessions', 'sess_anon_pres', 'presence']);
          expect(presenceMap === undefined || presenceMap.size === 0).to.equal(true);
          done();
        }, 100);
      });
    });

    it('Blocker 3: canCompleteEarly evaluates store presence and triggers early close without timer', () => {
      // covers: AC-6, Blocker 3
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_prod_early',
        title: 'Early Close Test',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_prod_early' });

      const v1 = registerVoter({ sessionId: 'sess_prod_early', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_prod_early', displayName: 'V2', store });

      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_prod_early',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_1',
        timestamp: 1000
      });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_prod_early',
        voterToken: v2.voter.sessionToken,
        socketId: 'sock_2',
        timestamp: 1000
      });

      const round = initRound('sess_prod_early', ['A', 'B'], { store });

      // Before anyone votes, canCompleteEarly is false
      expect(canCompleteEarly({ sessionId: 'sess_prod_early', roundId: round.roundId, store })).to.equal(false);

      // V1 votes
      recordRoundSubmission({
        sessionId: 'sess_prod_early',
        roundId: round.roundId,
        sessionToken: v1.voter.sessionToken
      });
      expect(canCompleteEarly({ sessionId: 'sess_prod_early', roundId: round.roundId, store })).to.equal(false);

      // V2 votes -> all active snapshot voters have voted, early close succeeds
      recordRoundSubmission({
        sessionId: 'sess_prod_early',
        roundId: round.roundId,
        sessionToken: v2.voter.sessionToken
      });
      expect(canCompleteEarly({ sessionId: 'sess_prod_early', roundId: round.roundId, store })).to.equal(true);
    });

    it('Blocker 3: single-voter session triggers early close immediately on vote (no flat 2-voter floor)', () => {
      // covers: AC-6, Blocker 3
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_single_voter',
        title: 'Single Voter Session',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_single_voter' });

      const v1 = registerVoter({ sessionId: 'sess_single_voter', displayName: 'Solo', store });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_single_voter',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_solo',
        timestamp: 1000
      });

      const round = initRound('sess_single_voter', ['A', 'B'], { store });

      expect(canCompleteEarly({ sessionId: 'sess_single_voter', roundId: round.roundId, store })).to.equal(false);

      recordRoundSubmission({
        sessionId: 'sess_single_voter',
        roundId: round.roundId,
        sessionToken: v1.voter.sessionToken
      });

      // Under AC-6, 1 of 1 active snapshot voter has voted -> early close succeeds
      expect(canCompleteEarly({ sessionId: 'sess_single_voter', roundId: round.roundId, store })).to.equal(true);
    });

    it('Blocker 3: zero active snapshot voters inhibits early close (AC-7)', () => {
      // covers: AC-7, Blocker 3
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_zero_active',
        title: 'Zero Active Test',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_zero_active' });

      const v1 = registerVoter({ sessionId: 'sess_zero_active', displayName: 'Leaver', store });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_zero_active',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_l',
        timestamp: 1000
      });

      const round = initRound('sess_zero_active', ['A', 'B'], { store });

      // Leaver disconnects at monotonic ms 10000
      store.dispatch({
        type: 'RECORD_PRESENCE_DISCONNECT',
        sessionId: 'sess_zero_active',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_l',
        timestamp: 10000
      });

      // Now at 25000 (15s later, past 10s grace window), leaver is excluded from active set
      // activeSnapshotCount is 0, so early close must be inhibited
      const result = canCompleteEarly({
        sessionId: 'sess_zero_active',
        roundId: round.roundId,
        store,
        now: 25000,
        graceMs: GRACE_PERIOD_MS
      });

      expect(result).to.equal(false);
    });
  });
});
