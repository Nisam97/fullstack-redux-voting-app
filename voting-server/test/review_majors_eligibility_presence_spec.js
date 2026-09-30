import { expect } from 'chai';
import makeStore from '../src/store.js';
import {
  initRound,
  canCompleteEarly,
  closeRoundOnce,
  computeEligibility,
  recordRoundSubmission,
  resetRounds,
  snapshotsByRound
} from '../src/roundManager.js';
import { registerVoter, clearVoters } from '../src/auth/voter.js';
import { resetAuthConfig } from '../src/auth/config.js';

describe('Regression: review majors (eligibility snapshot synthesis and AC-7 guard)', () => {
  beforeEach(() => {
    clearVoters();
    resetAuthConfig();
    resetRounds();
  });

  describe('Major 1: No snapshot synthesis and strict token-keyed presence', () => {
    it('returns false and logs loudly when snapshot is missing (ordering violation AC-9)', () => {
      const store = makeStore();
      const sessionId = 'sess_no_snapshot';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'No Snapshot Test',
        entries: ['Alpha', 'Beta']
      });
      store.dispatch({ type: 'START_SESSION', sessionId });

      // Connect a voter directly to presence in store so presence is active
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId,
        voterToken: 'tok_active_voter',
        socketId: 'sock_1'
      });

      // Initialize round without dispatching SNAPSHOT_ROUND_ELIGIBILITY
      const round = initRound(sessionId, ['Alpha', 'Beta']);
      const roundId = round.roundId;

      // Ensure no snapshot is registered
      expect(snapshotsByRound.has(`${sessionId}:::${roundId}`)).to.be.false;

      let loggedError = '';
      const originalConsoleError = console.error;
      console.error = (msg) => {
        loggedError = String(msg);
      };

      try {
        const canClose = canCompleteEarly({
          sessionId,
          roundId,
          store
        });

        expect(canClose).to.be.false;
        expect(loggedError).to.include('Missing snapshot for round');
        expect(loggedError).to.include('AC-9');
      } finally {
        console.error = originalConsoleError;
      }
    });

    it('strictly isolates voters whose display names share prefixes (e.g. Vikram vs Vikram_2)', () => {
      const store = makeStore();
      const sessionId = 'sess_prefix_test';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Prefix Isolation Test',
        entries: ['Candidate A', 'Candidate B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId });

      const reg1 = registerVoter({ sessionId, displayName: 'Vikram', store });
      const reg2 = registerVoter({ sessionId, displayName: 'Vikram_2', store });

      const token1 = reg1.voter.sessionToken;
      const token2 = reg2.voter.sessionToken;

      expect(token1).to.not.equal(token2);

      // Connect both
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId,
        voterToken: token1,
        socketId: 'sock_vikram_1'
      });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId,
        voterToken: token2,
        socketId: 'sock_vikram_2'
      });

      const round = initRound(sessionId, ['Candidate A', 'Candidate B'], { store });
      const roundId = round.roundId;

      // Both tokens are in the frozen snapshot
      const snapshot = [token1, token2];
      snapshotsByRound.set(`${sessionId}:::${roundId}`, snapshot);

      // Token 2 votes
      recordRoundSubmission({ sessionId, roundId, sessionToken: token2 });

      // Evaluation must NOT credit Vikram_2 ballot to Vikram
      const eligibility = computeEligibility({
        snapshot,
        presence: store.getState().getIn(['sessions', sessionId, 'presence']),
        submittedTokens: [token2],
        now: 1000
      });

      expect(eligibility.activeCount).to.equal(2);
      expect(eligibility.votedCount).to.equal(1);
      expect(eligibility.hasQuorum).to.be.false;

      // Token 1 votes as well
      recordRoundSubmission({ sessionId, roundId, sessionToken: token1 });

      const fullEligibility = computeEligibility({
        snapshot,
        presence: store.getState().getIn(['sessions', sessionId, 'presence']),
        submittedTokens: [token1, token2],
        now: 1000
      });

      expect(fullEligibility.votedCount).to.equal(2);
      expect(fullEligibility.hasQuorum).to.be.true;
    });

    it('does not synthesize a snapshot from mid-round joiners and does not cache synthesized snapshot', () => {
      const store = makeStore();
      const sessionId = 'sess_no_synth_cache';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'No Synth Cache Test',
        entries: ['Alpha', 'Beta']
      });
      store.dispatch({ type: 'START_SESSION', sessionId });

      // Mid-round joiners connect to presence
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId,
        voterToken: 'tok_late_1',
        socketId: 'sock_late_1'
      });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId,
        voterToken: 'tok_late_2',
        socketId: 'sock_late_2'
      });

      // Round initialized without snapshot
      const round = initRound(sessionId, ['Alpha', 'Beta']);
      const roundId = round.roundId;
      const key = `${sessionId}:::${roundId}`;

      expect(snapshotsByRound.has(key)).to.be.false;

      const originalConsoleError = console.error;
      console.error = () => {};

      try {
        const canClose = canCompleteEarly({
          sessionId,
          roundId,
          store
        });

        expect(canClose).to.be.false;
        // Verify no fallback synthesis cached anything into snapshotsByRound
        expect(snapshotsByRound.has(key)).to.be.false;
      } finally {
        console.error = originalConsoleError;
      }
    });

    it('strictly isolates tokens when tokens themselves share prefixes (e.g. tok_user vs tok_user_admin)', () => {
      const store = makeStore();
      const sessionId = 'sess_token_prefix_test';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Token Prefix Test',
        entries: ['Alpha', 'Beta']
      });
      store.dispatch({ type: 'START_SESSION', sessionId });

      const tokenA = 'tok_user';
      const tokenB = 'tok_user_admin';

      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId,
        voterToken: tokenA,
        socketId: 'sock_a'
      });
      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId,
        voterToken: tokenB,
        socketId: 'sock_b'
      });

      const round = initRound(sessionId, ['Alpha', 'Beta'], { store });
      const roundId = round.roundId;
      const snapshot = [tokenA, tokenB];
      snapshotsByRound.set(`${sessionId}:::${roundId}`, snapshot);

      // Only tokenB votes
      recordRoundSubmission({ sessionId, roundId, sessionToken: tokenB });

      const eligibility = computeEligibility({
        snapshot,
        presence: store.getState().getIn(['sessions', sessionId, 'presence']),
        submittedTokens: [tokenB],
        now: 1000
      });

      expect(eligibility.votedCount).to.equal(1);
      expect(eligibility.hasQuorum).to.be.false;

      const activeVoterA = eligibility.activeSnapshotVoters.find(v => v.voterKey === tokenA);
      const activeVoterB = eligibility.activeSnapshotVoters.find(v => v.voterKey === tokenB);

      expect(activeVoterA.hasVoted).to.be.false;
      expect(activeVoterB.hasVoted).to.be.true;
    });
  });

  describe('Major 2: AC-7 zero active voters guard in closeRoundOnce', () => {
    it('refuses closure with ZERO_ACTIVE_VOTERS when all snapshot voters are inactive and none voted', () => {
      const store = makeStore();
      const sessionId = 'sess_zero_active';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Zero Active Test',
        entries: ['Alpha', 'Beta', 'Gamma']
      });
      store.dispatch({ type: 'START_SESSION', sessionId });

      const reg1 = registerVoter({ sessionId, displayName: 'V1', store });
      const reg2 = registerVoter({ sessionId, displayName: 'V2', store });
      const t1 = reg1.voter.sessionToken;
      const t2 = reg2.voter.sessionToken;

      const round = initRound(sessionId, ['Alpha', 'Beta'], { store });
      const roundId = round.roundId;
      const snapshot = [t1, t2];
      snapshotsByRound.set(`${sessionId}:::${roundId}`, snapshot);

      // Disconnect both past grace period (15s ago)
      const mockPresence = new Map();
      mockPresence.set(t1, { connected: false, disconnectedAt: 1000 });
      mockPresence.set(t2, { connected: false, disconnectedAt: 1000 });

      // Early close attempt at now = 25000 (elapsed 24000 > grace 10000)
      const result = closeRoundOnce({
        sessionId,
        roundId,
        store,
        presence: mockPresence,
        snapshot,
        now: 25000,
        graceMs: 10000,
        isTimerExpiry: false
      });

      expect(result.success).to.be.false;
      expect(result.reason).to.equal('ZERO_ACTIVE_VOTERS');
      expect(result.roundId).to.equal(roundId);
    });

    it('exempts timer expiry from zero active voters inhibition (allows natural closure)', () => {
      const store = makeStore();
      const sessionId = 'sess_timer_expiry';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Timer Expiry Test',
        entries: ['Alpha', 'Beta', 'Gamma']
      });
      store.dispatch({ type: 'START_SESSION', sessionId });

      const reg1 = registerVoter({ sessionId, displayName: 'V1', store });
      const t1 = reg1.voter.sessionToken;

      const round = initRound(sessionId, ['Alpha', 'Beta'], { store });
      const roundId = round.roundId;
      const snapshot = [t1];
      snapshotsByRound.set(`${sessionId}:::${roundId}`, snapshot);

      // Disconnect voter past grace
      const mockPresence = new Map();
      mockPresence.set(t1, { connected: false, disconnectedAt: 1000 });

      // Timer expiry close (isTimerExpiry: true)
      const result = closeRoundOnce({
        sessionId,
        roundId,
        store,
        presence: mockPresence,
        snapshot,
        now: 25000,
        graceMs: 10000,
        isTimerExpiry: true
      });

      expect(result.success).to.be.true;
      expect(result.advanced).to.be.true;
    });

    it('permits early closure when at least one snapshot voter is active and quorum is reached', () => {
      const store = makeStore();
      const sessionId = 'sess_active_closes';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Active Closes Test',
        entries: ['Alpha', 'Beta', 'Gamma']
      });
      store.dispatch({ type: 'START_SESSION', sessionId });

      const reg1 = registerVoter({ sessionId, displayName: 'V1', store });
      const reg2 = registerVoter({ sessionId, displayName: 'V2', store });
      const t1 = reg1.voter.sessionToken;
      const t2 = reg2.voter.sessionToken;

      const round = initRound(sessionId, ['Alpha', 'Beta'], { store });
      const roundId = round.roundId;
      const snapshot = [t1, t2];
      snapshotsByRound.set(`${sessionId}:::${roundId}`, snapshot);

      // V2 is disconnected past grace; V1 is connected and voted
      const mockPresence = new Map();
      mockPresence.set(t1, { connected: true, disconnectedAt: null });
      mockPresence.set(t2, { connected: false, disconnectedAt: 1000 });

      recordRoundSubmission({ sessionId, roundId, sessionToken: t1 });
      store.dispatch({ type: 'VOTE', sessionId, entry: 'Alpha' });

      const result = closeRoundOnce({
        sessionId,
        roundId,
        store,
        presence: mockPresence,
        snapshot,
        now: 25000,
        graceMs: 10000,
        isTimerExpiry: false
      });

      expect(result.success).to.be.true;
      expect(result.advanced).to.be.true;
    });

    it('voter who voted before disconnecting remains active-by-vote and does not trigger ZERO_ACTIVE_VOTERS', () => {
      const store = makeStore();
      const sessionId = 'sess_active_by_vote';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Active By Vote Test',
        entries: ['Alpha', 'Beta', 'Gamma']
      });
      store.dispatch({ type: 'START_SESSION', sessionId });

      const reg1 = registerVoter({ sessionId, displayName: 'Solo', store });
      const t1 = reg1.voter.sessionToken;

      const round = initRound(sessionId, ['Alpha', 'Beta'], { store });
      const roundId = round.roundId;
      const snapshot = [t1];
      snapshotsByRound.set(`${sessionId}:::${roundId}`, snapshot);

      // Voter casts ballot first, then disconnects 60s ago
      recordRoundSubmission({ sessionId, roundId, sessionToken: t1 });
      store.dispatch({ type: 'VOTE', sessionId, entry: 'Alpha' });

      const mockPresence = new Map();
      mockPresence.set(t1, { connected: false, disconnectedAt: 1000 });

      // Early close attempt at now = 70000 (well past grace)
      const result = closeRoundOnce({
        sessionId,
        roundId,
        store,
        presence: mockPresence,
        snapshot,
        now: 70000,
        graceMs: 10000,
        isTimerExpiry: false
      });

      expect(result.success).to.be.true;
      expect(result.advanced).to.be.true;
    });

    it('inhibits early closure on rematch round when all voters are inactive (tie ladder AC-7)', () => {
      const store = makeStore();
      const sessionId = 'sess_rematch_zero_active';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Rematch Zero Active Test',
        entries: ['Alpha', 'Beta']
      });
      store.dispatch({ type: 'START_SESSION', sessionId });

      const reg1 = registerVoter({ sessionId, displayName: 'V1', store });
      const reg2 = registerVoter({ sessionId, displayName: 'V2', store });
      const t1 = reg1.voter.sessionToken;
      const t2 = reg2.voter.sessionToken;

      // First round
      const round1 = initRound(sessionId, ['Alpha', 'Beta'], { store });
      // Rematch round
      const rematch = initRound(sessionId, ['Alpha', 'Beta'], { store });
      const rematchRoundId = rematch.roundId;

      const snapshot = [t1, t2];
      snapshotsByRound.set(`${sessionId}:::${rematchRoundId}`, snapshot);

      // Both voters disconnected
      const mockPresence = new Map();
      mockPresence.set(t1, { connected: false, disconnectedAt: 1000 });
      mockPresence.set(t2, { connected: false, disconnectedAt: 1000 });

      const earlyResult = closeRoundOnce({
        sessionId,
        roundId: rematchRoundId,
        store,
        presence: mockPresence,
        snapshot,
        now: 30000,
        graceMs: 10000,
        isTimerExpiry: false
      });

      expect(earlyResult.success).to.be.false;
      expect(earlyResult.reason).to.equal('ZERO_ACTIVE_VOTERS');

      // But timer expiry advances it
      const timerResult = closeRoundOnce({
        sessionId,
        roundId: rematchRoundId,
        store,
        presence: mockPresence,
        snapshot,
        now: 30000,
        graceMs: 10000,
        isTimerExpiry: true
      });

      expect(timerResult.success).to.be.true;
    });
  });
});
