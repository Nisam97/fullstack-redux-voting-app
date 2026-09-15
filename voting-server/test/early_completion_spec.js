import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store';
import startServer from '../src/server';
import { clearAdmin, seedAdmin, generateAdminToken } from '../src/auth/admin';
import { registerVoter, clearVoters } from '../src/auth/voter';
import { resetAuthConfig } from '../src/auth/config';
import roundManager, {
  initRound,
  getCurrentRound,
  getCurrentRoundId,
  recordRoundSubmission,
  getRoundSubmissionCount,
  getRoundSubmissions,
  hasAllVotersVoted,
  isRoundClosed,
  closeRoundOnce,
  resetRounds
} from '../src/roundManager';

describe('Feature 7 — Stage A: Backend Participation Tracking & Idempotent Early Completion', () => {

  beforeEach(() => {
    clearAdmin();
    clearVoters();
    resetAuthConfig();
    resetRounds();
  });

  describe('1. Participation Tracking & Completion Detection (Unit Tests)', () => {
    it('1. zero eligible voters -> hasAllVotersVoted is false (zero-voter protection)', () => {
      const round = initRound('sess_1', ['Candidate A', 'Candidate B']);
      expect(round).to.be.ok;

      // 0 eligible voters in sess_1
      const result = hasAllVotersVoted({
        sessionId: 'sess_1',
        roundId: round.roundId,
        eligibleVoterCount: 0
      });
      expect(result).to.be.false;
    });

    it('2. one eligible voter / zero submissions -> hasAllVotersVoted is false', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tourney',
        entries: ['A', 'B']
      });
      registerVoter({ sessionId: 'sess_1', displayName: 'Voter1', store });

      const round = initRound('sess_1', ['A', 'B']);
      const result = hasAllVotersVoted({
        sessionId: 'sess_1',
        roundId: round.roundId
      });
      expect(result).to.be.false;
    });

    it('3. one eligible voter / one valid submission -> hasAllVotersVoted is true', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tourney',
        entries: ['A', 'B']
      });
      const voter = registerVoter({ sessionId: 'sess_1', displayName: 'Voter1', store });

      const round = initRound('sess_1', ['A', 'B']);
      const record = recordRoundSubmission({
        sessionId: 'sess_1',
        roundId: round.roundId,
        sessionToken: voter.voter.sessionToken
      });
      expect(record.success).to.be.true;
      expect(record.isNew).to.be.true;

      const result = hasAllVotersVoted({
        sessionId: 'sess_1',
        roundId: round.roundId
      });
      expect(result).to.be.true;
    });

    it('4. two eligible voters / one submission -> hasAllVotersVoted is false', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tourney',
        entries: ['A', 'B']
      });
      const v1 = registerVoter({ sessionId: 'sess_1', displayName: 'Voter1', store });
      registerVoter({ sessionId: 'sess_1', displayName: 'Voter2', store });

      const round = initRound('sess_1', ['A', 'B']);
      recordRoundSubmission({
        sessionId: 'sess_1',
        roundId: round.roundId,
        sessionToken: v1.voter.sessionToken
      });

      const result = hasAllVotersVoted({
        sessionId: 'sess_1',
        roundId: round.roundId
      });
      expect(result).to.be.false;
    });

    it('5. two eligible voters / two submissions -> hasAllVotersVoted is true', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tourney',
        entries: ['A', 'B']
      });
      const v1 = registerVoter({ sessionId: 'sess_1', displayName: 'Voter1', store });
      const v2 = registerVoter({ sessionId: 'sess_1', displayName: 'Voter2', store });

      const round = initRound('sess_1', ['A', 'B']);
      recordRoundSubmission({ sessionId: 'sess_1', roundId: round.roundId, sessionToken: v1.voter.sessionToken });
      recordRoundSubmission({ sessionId: 'sess_1', roundId: round.roundId, sessionToken: v2.voter.sessionToken });

      const result = hasAllVotersVoted({
        sessionId: 'sess_1',
        roundId: round.roundId
      });
      expect(result).to.be.true;
    });

    it('6. duplicate submission from same voter counts exactly once', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tourney',
        entries: ['A', 'B']
      });
      const v1 = registerVoter({ sessionId: 'sess_1', displayName: 'Voter1', store });
      registerVoter({ sessionId: 'sess_1', displayName: 'Voter2', store });

      const round = initRound('sess_1', ['A', 'B']);
      const first = recordRoundSubmission({ sessionId: 'sess_1', roundId: round.roundId, sessionToken: v1.voter.sessionToken });
      expect(first.isNew).to.be.true;

      // Duplicate submission by v1
      const second = recordRoundSubmission({ sessionId: 'sess_1', roundId: round.roundId, sessionToken: v1.voter.sessionToken });
      expect(second.isNew).to.be.false;
      expect(second.submittedCount).to.equal(1);

      expect(getRoundSubmissionCount({ sessionId: 'sess_1', roundId: round.roundId })).to.equal(1);
      expect(hasAllVotersVoted({ sessionId: 'sess_1', roundId: round.roundId })).to.be.false;
    });

    it('7. invalid submission with unknown token does not count', () => {
      const round = initRound('sess_1', ['A', 'B']);
      const result = recordRoundSubmission({
        sessionId: 'sess_1',
        roundId: round.roundId,
        sessionToken: 'invalid-non-existent-token'
      });
      expect(result.success).to.be.false;
      expect(result.error).to.equal('INVALID_TOKEN');
      expect(getRoundSubmissionCount({ sessionId: 'sess_1', roundId: round.roundId })).to.equal(0);
    });

    it('8. voter from another session does not count', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_A', title: 'A', entries: ['A1', 'A2'] });
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_B', title: 'B', entries: ['B1', 'B2'] });

      const voterB = registerVoter({ sessionId: 'sess_B', displayName: 'VoterB', store });
      const roundA = initRound('sess_A', ['A1', 'A2']);

      const attempt = recordRoundSubmission({
        sessionId: 'sess_A',
        roundId: roundA.roundId,
        sessionToken: voterB.voter.sessionToken
      });
      expect(attempt.success).to.be.false;
      expect(attempt.error).to.equal('SESSION_MISMATCH');
      expect(getRoundSubmissionCount({ sessionId: 'sess_A', roundId: roundA.roundId })).to.equal(0);
    });

    it('9. submission from another round does not count toward current round', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_1', title: 'Tourney', entries: ['A', 'B', 'C'] });
      const v1 = registerVoter({ sessionId: 'sess_1', displayName: 'Voter1', store });

      const round1 = initRound('sess_1', ['A', 'B']);
      recordRoundSubmission({ sessionId: 'sess_1', roundId: round1.roundId, sessionToken: v1.voter.sessionToken });

      // Round 2 initializes
      const round2 = initRound('sess_1', ['C', 'A']);
      expect(round2.roundId).to.not.equal(round1.roundId);
      expect(getRoundSubmissionCount({ sessionId: 'sess_1', roundId: round2.roundId })).to.equal(0);
      expect(hasAllVotersVoted({ sessionId: 'sess_1', roundId: round2.roundId })).to.be.false;
    });

    it('10. new round starts with zero participation even if pair was seen previously (rematch after tie)', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_1', title: 'Tourney', entries: ['A', 'B'] });
      const v1 = registerVoter({ sessionId: 'sess_1', displayName: 'Voter1', store });

      const round1 = initRound('sess_1', ['A', 'B']);
      recordRoundSubmission({ sessionId: 'sess_1', roundId: round1.roundId, sessionToken: v1.voter.sessionToken });
      expect(getRoundSubmissionCount({ sessionId: 'sess_1', roundId: round1.roundId })).to.equal(1);

      // Suppose Round 2 was between other candidates
      initRound('sess_1', ['C', 'D']);

      // Round 3 is a rematch with identical pair ['A', 'B']
      const round3 = initRound('sess_1', ['A', 'B']);
      expect(round3.roundIndex).to.equal(3);
      expect(getRoundSubmissionCount({ sessionId: 'sess_1', roundId: round3.roundId })).to.equal(0);
      expect(hasAllVotersVoted({ sessionId: 'sess_1', roundId: round3.roundId })).to.be.false;
    });
  });

  describe('2. Idempotent Round Completion Mechanism (closeRoundOnce)', () => {
    it('11. final valid vote triggers closeRoundOnce and advances the store', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_test', title: 'Test', entries: ['A', 'B', 'C'] });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_test' });

      const round = initRound('sess_test', ['A', 'B']);
      let dispatchedAction = null;
      const originalDispatch = store.dispatch;
      store.dispatch = (action) => {
        dispatchedAction = action;
        return originalDispatch(action);
      };

      const result = closeRoundOnce({
        sessionId: 'sess_test',
        roundId: round.roundId,
        store
      });

      expect(result.success).to.be.true;
      expect(result.advanced).to.be.true;
      expect(dispatchedAction).to.deep.equal({ type: 'NEXT', sessionId: 'sess_test' });
      expect(isRoundClosed('sess_test', round.roundId)).to.be.true;
    });

    it('12. partial participation does not complete the round', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_test', title: 'Test', entries: ['A', 'B', 'C'] });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_test' });

      const v1 = registerVoter({ sessionId: 'sess_test', displayName: 'V1', store });
      registerVoter({ sessionId: 'sess_test', displayName: 'V2', store });

      const round = initRound('sess_test', ['A', 'B']);
      recordRoundSubmission({ sessionId: 'sess_test', roundId: round.roundId, sessionToken: v1.voter.sessionToken });

      const isComplete = hasAllVotersVoted({ sessionId: 'sess_test', roundId: round.roundId });
      expect(isComplete).to.be.false;
    });

    it('13. duplicate final-voter event cannot complete twice', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_test', title: 'Test', entries: ['A', 'B', 'C'] });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_test' });

      const round = initRound('sess_test', ['A', 'B']);
      let nextDispatchCount = 0;
      const originalDispatch = store.dispatch;
      store.dispatch = (action) => {
        if (action.type === 'NEXT') nextDispatchCount++;
        return originalDispatch(action);
      };

      // First completion succeeds
      const res1 = closeRoundOnce({ sessionId: 'sess_test', roundId: round.roundId, store });
      expect(res1.success).to.be.true;
      expect(nextDispatchCount).to.equal(1);

      // Duplicate completion attempt for same round becomes harmless no-op
      const res2 = closeRoundOnce({ sessionId: 'sess_test', roundId: round.roundId, store });
      expect(res2.success).to.be.false;
      expect(res2.reason).to.equal('ALREADY_CLOSED');
      expect(nextDispatchCount).to.equal(1);
    });

    it('14. completion is strictly idempotent across multiple callers', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_idemp', title: 'Idempotency', entries: ['A', 'B', 'C'] });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_idemp' });

      const round = initRound('sess_idemp', ['A', 'B']);
      let callCount = 0;
      store.dispatch = (action) => {
        if (action.type === 'NEXT') callCount++;
      };

      for (let i = 0; i < 5; i++) {
        closeRoundOnce({ sessionId: 'sess_idemp', roundId: round.roundId, store });
      }

      expect(callCount).to.equal(1);
    });

    it('15. second completion attempt returns ALREADY_CLOSED reason without throwing', () => {
      const round = initRound('sess_reason', ['A', 'B']);
      const first = closeRoundOnce({ sessionId: 'sess_reason', roundId: round.roundId });
      expect(first.success).to.be.true;

      const second = closeRoundOnce({ sessionId: 'sess_reason', roundId: round.roundId });
      expect(second.success).to.be.false;
      expect(second.reason).to.equal('ALREADY_CLOSED');
      expect(second.roundId).to.equal(round.roundId);
    });

    it('16. completed round cannot accept further submissions or trigger another completion', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_comp', title: 'Test', entries: ['A', 'B'] });
      const voter = registerVoter({ sessionId: 'sess_comp', displayName: 'V1', store });

      const round = initRound('sess_comp', ['A', 'B']);
      closeRoundOnce({ sessionId: 'sess_comp', roundId: round.roundId, store });

      const attempt = recordRoundSubmission({
        sessionId: 'sess_comp',
        roundId: round.roundId,
        sessionToken: voter.voter.sessionToken
      });
      expect(attempt.success).to.be.false;
      expect(attempt.error).to.equal('ROUND_CLOSED');
    });
  });

  describe('3. Timer Integration & Race Condition Protection', () => {
    it('17. CRITICAL RACE TEST: simultaneous final vote and timer expiry produce exactly ONE NEXT dispatch', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_race', title: 'Race Test', entries: ['A', 'B', 'C'] });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_race' });

      const round = initRound('sess_race', ['A', 'B']);
      let nextDispatches = 0;
      const originalDispatch = store.dispatch;
      store.dispatch = (action) => {
        if (action.type === 'NEXT') nextDispatches++;
        return originalDispatch(action);
      };

      let timerCleared = false;
      const mockTimerManager = {
        clearTimer: (sId) => {
          if (sId === 'sess_race') timerCleared = true;
        }
      };

      // Both paths attempt to close round simultaneously
      const path1 = closeRoundOnce({
        sessionId: 'sess_race',
        roundId: round.roundId,
        store,
        timerManager: mockTimerManager
      });

      const path2 = closeRoundOnce({
        sessionId: 'sess_race',
        roundId: round.roundId,
        store,
        timerManager: mockTimerManager
      });

      expect(path1.success).to.be.true;
      expect(path2.success).to.be.false;
      expect(path2.reason).to.equal('ALREADY_CLOSED');
      expect(nextDispatches).to.equal(1, 'NEXT must be dispatched at most once for this round');
      expect(timerCleared).to.be.true;
    });

    it('18. timer callback after early completion is harmless and does not advance round', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_timer_after', title: 'Test', entries: ['A', 'B', 'C'] });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_timer_after' });

      const round = initRound('sess_timer_after', ['A', 'B']);
      let nextDispatches = 0;
      store.dispatch = (action) => {
        if (action.type === 'NEXT') nextDispatches++;
      };

      // 1. Early completion fires first
      closeRoundOnce({ sessionId: 'sess_timer_after', roundId: round.roundId, store });
      expect(nextDispatches).to.equal(1);

      // 2. Scheduled timer callback fires afterwards for the same round
      const expiryResult = closeRoundOnce({ sessionId: 'sess_timer_after', roundId: round.roundId, store });
      expect(expiryResult.success).to.be.false;
      expect(expiryResult.reason).to.equal('ALREADY_CLOSED');
      expect(nextDispatches).to.equal(1);
    });

    it('19. early completion stops/cancels the active timer in timerManager', () => {
      const store = makeStore();
      let clearedSessionId = null;
      const mockTimerManager = {
        clearTimer: (sId) => {
          clearedSessionId = sId;
        }
      };

      const round = initRound('sess_timer_stop', ['A', 'B']);
      closeRoundOnce({
        sessionId: 'sess_timer_stop',
        roundId: round.roundId,
        store,
        timerManager: mockTimerManager
      });

      expect(clearedSessionId).to.equal('sess_timer_stop');
    });

    it('20. stale timer callback from Round 1 cannot advance newly started Round 2', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_stale', title: 'Stale Test', entries: ['A', 'B', 'C', 'D'] });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_stale' });

      let nextCount = 0;
      store.dispatch = (action) => {
        if (action.type === 'NEXT') nextCount++;
      };

      // Round 1 begins and completes
      const round1 = initRound('sess_stale', ['A', 'B']);
      closeRoundOnce({ sessionId: 'sess_stale', roundId: round1.roundId, store });
      expect(nextCount).to.equal(1);

      // Round 2 is now active
      const round2 = initRound('sess_stale', ['C', 'D']);
      expect(round2.roundId).to.not.equal(round1.roundId);

      // Stale timer callback for Round 1 arrives now
      const staleResult = closeRoundOnce({ sessionId: 'sess_stale', roundId: round1.roundId, store });
      expect(staleResult.success).to.be.false;
      expect(staleResult.reason).to.equal('ALREADY_CLOSED');
      expect(nextCount).to.equal(1, 'Stale Round 1 callback must not advance Round 2');
    });
  });

  describe('4. Multi-Session Isolation & Round Boundaries', () => {
    it('21. Session A completion does not affect Session B timer or active round', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_A', title: 'A', entries: ['A1', 'A2'] });
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_B', title: 'B', entries: ['B1', 'B2'] });

      const roundA = initRound('sess_A', ['A1', 'A2']);
      const roundB = initRound('sess_B', ['B1', 'B2']);

      const clearedSessions = [];
      const mockTimerManager = {
        clearTimer: (sId) => clearedSessions.push(sId)
      };

      closeRoundOnce({
        sessionId: 'sess_A',
        roundId: roundA.roundId,
        store,
        timerManager: mockTimerManager
      });

      expect(isRoundClosed('sess_A', roundA.roundId)).to.be.true;
      expect(isRoundClosed('sess_B', roundB.roundId)).to.be.false;
      expect(clearedSessions).to.deep.equal(['sess_A']);
    });

    it('22. Session A participation is completely isolated from Session B', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_A', title: 'A', entries: ['A1', 'A2'] });
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_B', title: 'B', entries: ['B1', 'B2'] });

      const voterA = registerVoter({ sessionId: 'sess_A', displayName: 'VoterA', store });
      const voterB = registerVoter({ sessionId: 'sess_B', displayName: 'VoterB', store });

      const roundA = initRound('sess_A', ['A1', 'A2']);
      const roundB = initRound('sess_B', ['B1', 'B2']);

      recordRoundSubmission({ sessionId: 'sess_A', roundId: roundA.roundId, sessionToken: voterA.voter.sessionToken });

      expect(getRoundSubmissionCount({ sessionId: 'sess_A', roundId: roundA.roundId })).to.equal(1);
      expect(getRoundSubmissionCount({ sessionId: 'sess_B', roundId: roundB.roundId })).to.equal(0);
      expect(hasAllVotersVoted({ sessionId: 'sess_A', roundId: roundA.roundId })).to.be.true;
      expect(hasAllVotersVoted({ sessionId: 'sess_B', roundId: roundB.roundId })).to.be.false;
    });

    it('23. Round A participation is not counted for Round B in the same session', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_1', title: 'T', entries: ['1', '2', '3'] });
      const voter = registerVoter({ sessionId: 'sess_1', displayName: 'V', store });

      const r1 = initRound('sess_1', ['1', '2']);
      recordRoundSubmission({ sessionId: 'sess_1', roundId: r1.roundId, sessionToken: voter.voter.sessionToken });

      const r2 = initRound('sess_1', ['3', '1']);
      expect(getRoundSubmissionCount({ sessionId: 'sess_1', roundId: r1.roundId })).to.equal(1);
      expect(getRoundSubmissionCount({ sessionId: 'sess_1', roundId: r2.roundId })).to.equal(0);
    });
  });

  describe('5. Real-Time Socket & Server Integration (End-to-End)', () => {
    let io;
    let store;
    let port;
    let adminToken;
    const clients = [];

    function createClientSocket(options = {}) {
      const socket = Client(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        ...options
      });
      clients.push(socket);
      return socket;
    }

    beforeEach((done) => {
      clearAdmin();
      clearVoters();
      resetAuthConfig();
      resetRounds();

      const admin = seedAdmin({
        username: 'admin',
        email: 'admin@votesphere.local',
        password: 'Password123!'
      });
      adminToken = generateAdminToken(admin);

      store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_e2e',
        title: 'Film Tournament',
        entries: ['Trainspotting', '28 Days Later', 'Sunshine'],
        timerDuration: 30
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_e2e'
      });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    afterEach((done) => {
      while (clients.length > 0) {
        const socket = clients.pop();
        if (socket && socket.connected) {
          socket.disconnect();
        }
      }
      if (io) {
        io.close(() => done());
      } else {
        done();
      }
    });

    it('24. all registered voters vote -> round advances immediately without waiting for timer', (done) => {
      // Register 2 voters
      const v1 = registerVoter({ sessionId: 'sess_e2e', displayName: 'Alice', store });
      const v2 = registerVoter({ sessionId: 'sess_e2e', displayName: 'Bob', store });

      const client1 = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      const client2 = createClientSocket({ auth: { voterToken: v2.voter.sessionToken } });

      let roundAdvanced = false;

      client1.emit('subscribe_session', 'sess_e2e');
      client2.emit('subscribe_session', 'sess_e2e');

      client1.on('session_state', (state) => {
        if (state && state.vote && Array.isArray(state.vote.pair)) {
          if (state.vote.pair[0] !== 'Trainspotting' || state.vote.pair[1] !== '28 Days Later') {
            if (!roundAdvanced) {
              roundAdvanced = true;
              expect(state.vote.pair).to.deep.equal(['Sunshine', 'Trainspotting']);
              done();
            }
          }
        }
      });

      // Cast vote 1
      setTimeout(() => {
        client1.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_e2e',
          entry: 'Trainspotting',
          voterToken: v1.voter.sessionToken
        });
      }, 50);

      // Cast vote 2 (the final eligible voter)
      setTimeout(() => {
        client2.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_e2e',
          entry: '28 Days Later',
          voterToken: v2.voter.sessionToken
        });
      }, 100);
    });

    it('25. session with 0 voters does NOT auto-complete early; timer continues running', (done) => {
      // sess_e2e has 0 voters registered
      expect(io.timerManager.getTimer('sess_e2e')).to.be.ok;
      expect(io.timerManager.getTimer('sess_e2e').status).to.equal('running');

      const client = createClientSocket();
      client.emit('subscribe_session', 'sess_e2e');

      let sessionUpdateCount = 0;
      client.on('session_state', () => {
        sessionUpdateCount++;
      });

      setTimeout(() => {
        // Only initial session_state received; NO premature NEXT advance occurred
        expect(sessionUpdateCount).to.equal(1);
        const session = store.getState().getIn(['sessions', 'sess_e2e']);
        expect(session.getIn(['vote', 'pair']).toJS()).to.deep.equal(['Trainspotting', '28 Days Later']);
        expect(io.timerManager.getTimer('sess_e2e').status).to.equal('running');
        done();
      }, 150);
    });
  });
});
