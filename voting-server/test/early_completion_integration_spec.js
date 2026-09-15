import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store';
import startServer from '../src/server';
import { clearAdmin, seedAdmin, generateAdminToken } from '../src/auth/admin';
import { registerVoter, clearVoters, getVoterCount } from '../src/auth/voter';
import { resetAuthConfig } from '../src/auth/config';
import roundManager, {
  initRound,
  getCurrentRound,
  getCurrentRoundId,
  recordRoundSubmission,
  getRoundSubmissionCount,
  hasAllVotersVoted,
  canCompleteEarly,
  isRoundClosed,
  closeRoundOnce,
  resetRounds
} from '../src/roundManager';
import { TimerManager } from '../src/timer';

describe('Feature 7 — Stage B: Backend Socket, Vote & Timer Integration Verification', () => {
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
      io = null;
    } else {
      done();
    }
  });

  describe('1. Socket Vote Integration', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_vote_int',
        title: 'Film Poll',
        entries: ['Trainspotting', '28 Days Later', 'Sunshine'],
        timerDuration: 30
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_vote_int'
      });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('1. valid voter vote participates in current round', (done) => {
      const v1 = registerVoter({ sessionId: 'sess_vote_int', displayName: 'Alice', store });
      registerVoter({ sessionId: 'sess_vote_int', displayName: 'Bob', store });

      const client = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_vote_int');

      client.on('session_state', (state) => {
        if (state.vote && state.vote.tally && state.vote.tally.Trainspotting === 1) {
          const roundId = roundManager.getCurrentRoundId('sess_vote_int', store);
          expect(roundManager.getRoundSubmissionCount({ sessionId: 'sess_vote_int', roundId })).to.equal(1);
          done();
        }
      });

      setTimeout(() => {
        client.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_vote_int',
          entry: 'Trainspotting',
          voterToken: v1.voter.sessionToken
        });
      }, 50);
    });

    it('2. final valid voter triggers early completion and advances round', (done) => {
      const v1 = registerVoter({ sessionId: 'sess_vote_int', displayName: 'Alice', store });
      const v2 = registerVoter({ sessionId: 'sess_vote_int', displayName: 'Bob', store });

      const c1 = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      const c2 = createClientSocket({ auth: { voterToken: v2.voter.sessionToken } });

      c1.emit('subscribe_session', 'sess_vote_int');
      c2.emit('subscribe_session', 'sess_vote_int');

      let completed = false;
      c1.on('session_state', (state) => {
        if (state.vote && Array.isArray(state.vote.pair)) {
          // Initial pair was ['Trainspotting', '28 Days Later']. Next pair is ['Sunshine', 'Trainspotting']
          if (state.vote.pair[0] === 'Sunshine' && !completed) {
            completed = true;
            done();
          }
        }
      });

      setTimeout(() => {
        c1.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_vote_int',
          entry: 'Trainspotting',
          voterToken: v1.voter.sessionToken
        });
      }, 50);

      setTimeout(() => {
        c2.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_vote_int',
          entry: '28 Days Later',
          voterToken: v2.voter.sessionToken
        });
      }, 100);
    });

    it('3. invalid voter token cannot trigger completion', (done) => {
      const v1 = registerVoter({ sessionId: 'sess_vote_int', displayName: 'Alice', store });
      registerVoter({ sessionId: 'sess_vote_int', displayName: 'Bob', store });

      const client = createClientSocket();
      client.emit('subscribe_session', 'sess_vote_int');

      client.on('action_error', (err) => {
        expect(err.action).to.equal('VOTE');
        expect(err.error).to.equal('INVALID_TOKEN');

        const session = store.getState().getIn(['sessions', 'sess_vote_int']);
        expect(session.getIn(['vote', 'pair']).toJS()).to.deep.equal(['Trainspotting', '28 Days Later']);
        done();
      });

      setTimeout(() => {
        client.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_vote_int',
          entry: 'Trainspotting',
          voterToken: 'completely-bogus-token'
        });
      }, 50);
    });

    it('4. duplicate voter cannot trigger completion', (done) => {
      const v1 = registerVoter({ sessionId: 'sess_vote_int', displayName: 'Alice', store });
      registerVoter({ sessionId: 'sess_vote_int', displayName: 'Bob', store });

      const client = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_vote_int');

      let errorCount = 0;
      client.on('action_error', (err) => {
        if (err.error === 'DUPLICATE_VOTE') {
          errorCount++;
          const session = store.getState().getIn(['sessions', 'sess_vote_int']);
          // Pair should NOT have advanced
          expect(session.getIn(['vote', 'pair']).toJS()).to.deep.equal(['Trainspotting', '28 Days Later']);
          expect(session.getIn(['vote', 'tally', 'Trainspotting'])).to.equal(1);
          done();
        }
      });

      // Vote once
      client.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_vote_int',
        entry: 'Trainspotting',
        voterToken: v1.voter.sessionToken
      });

      // Duplicate vote immediately
      setTimeout(() => {
        client.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_vote_int',
          entry: 'Trainspotting',
          voterToken: v1.voter.sessionToken
        });
      }, 50);
    });

    it('5. wrong-session voter cannot trigger completion', (done) => {
      // Create session B
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_other',
        title: 'Other Session',
        entries: ['Item1', 'Item2']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_other' });

      registerVoter({ sessionId: 'sess_vote_int', displayName: 'Alice', store });
      registerVoter({ sessionId: 'sess_vote_int', displayName: 'Bob', store });
      const voterB = registerVoter({ sessionId: 'sess_other', displayName: 'Charlie', store });

      const client = createClientSocket({ auth: { voterToken: voterB.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_vote_int');

      client.on('action_error', (err) => {
        expect(err.action).to.equal('VOTE');
        expect(err.error).to.equal('SESSION_MISMATCH');
        const roundId = roundManager.getCurrentRoundId('sess_vote_int', store);
        expect(roundManager.getRoundSubmissionCount({ sessionId: 'sess_vote_int', roundId })).to.equal(0);
        done();
      });

      setTimeout(() => {
        client.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_vote_int',
          entry: 'Trainspotting',
          voterToken: voterB.voter.sessionToken
        });
      }, 50);
    });

    it('6. vote for entry not in active pair cannot trigger completion', (done) => {
      const v1 = registerVoter({ sessionId: 'sess_vote_int', displayName: 'Alice', store });
      registerVoter({ sessionId: 'sess_vote_int', displayName: 'Bob', store });

      const client = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_vote_int');

      client.on('action_error', (err) => {
        expect(err.action).to.equal('VOTE');
        expect(err.error).to.equal('INVALID_ENTRY');

        const roundId = roundManager.getCurrentRoundId('sess_vote_int', store);
        expect(roundManager.getRoundSubmissionCount({ sessionId: 'sess_vote_int', roundId })).to.equal(0);

        const session = store.getState().getIn(['sessions', 'sess_vote_int']);
        expect(session.getIn(['vote', 'pair']).toJS()).to.deep.equal(['Trainspotting', '28 Days Later']);
        done();
      });

      setTimeout(() => {
        client.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_vote_int',
          entry: 'NotACandidate',
          voterToken: v1.voter.sessionToken
        });
      }, 50);
    });
  });

  describe('2. Timer Integration', () => {
    it('7. timer expiry still advances the round using closeRoundOnce', (done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_timer_adv',
        title: 'Timer Adv',
        entries: ['Item 1', 'Item 2', 'Item 3'],
        timerDuration: 5
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_timer_adv' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;

      const round1Id = roundManager.getCurrentRoundId('sess_timer_adv', store);
      expect(round1Id).to.be.ok;

      // Force timer expiry via handleExpiry
      io.timerManager.handleExpiry('sess_timer_adv', round1Id, store, io);

      expect(roundManager.isRoundClosed('sess_timer_adv', round1Id)).to.be.true;
      const session = store.getState().getIn(['sessions', 'sess_timer_adv']);
      expect(session.getIn(['vote', 'pair']).toJS()).to.not.deep.equal(['Item 1', 'Item 2']);
      done();
    });

    it('8. early completion cancels active timer and prevents subsequent expiry advance', (done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_timer_cancel',
        title: 'Cancel Timer',
        entries: ['A', 'B', 'C'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_timer_cancel' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;

      const v1 = registerVoter({ sessionId: 'sess_timer_cancel', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_timer_cancel', displayName: 'V2', store });

      const c1 = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      const c2 = createClientSocket({ auth: { voterToken: v2.voter.sessionToken } });

      c1.emit('subscribe_session', 'sess_timer_cancel');
      c2.emit('subscribe_session', 'sess_timer_cancel');

      const round1Id = roundManager.getCurrentRoundId('sess_timer_cancel', store);

      c1.on('session_state', (state) => {
        if (state.vote && state.vote.pair && state.vote.pair[0] === 'C') {
          // Round 1 completed early and advanced to Round 2
          expect(roundManager.isRoundClosed('sess_timer_cancel', round1Id)).to.be.true;

          // If the old Round 1 timer expiry callback now fires, it must be harmless
          io.timerManager.handleExpiry('sess_timer_cancel', round1Id, store, io);

          // State must still be on Round 2 pair ['C', 'A']
          const curr = store.getState().getIn(['sessions', 'sess_timer_cancel']);
          expect(curr.getIn(['vote', 'pair']).toJS()).to.deep.equal(['C', 'A']);
          done();
        }
      });

      setTimeout(() => {
        c1.emit('action', { type: 'VOTE', sessionId: 'sess_timer_cancel', entry: 'A', voterToken: v1.voter.sessionToken });
      }, 50);

      setTimeout(() => {
        c2.emit('action', { type: 'VOTE', sessionId: 'sess_timer_cancel', entry: 'B', voterToken: v2.voter.sessionToken });
      }, 100);
    });

    it('9. stale timer cannot advance newly started round', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_stale_test',
        title: 'Stale Round Test',
        entries: ['A', 'B', 'C', 'D'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_stale_test' });

      const tm = new TimerManager();
      const round1 = roundManager.initRound('sess_stale_test', ['A', 'B']);
      tm.startTimer('sess_stale_test', 30, store, null);

      // Round 1 completes early
      roundManager.closeRoundOnce({
        sessionId: 'sess_stale_test',
        roundId: round1.roundId,
        store,
        timerManager: tm
      });

      // Round 2 is now active
      const round2 = roundManager.getCurrentRound('sess_stale_test', store);
      expect(round2.roundId).to.not.equal(round1.roundId);
      tm.startTimer('sess_stale_test', 30, store, null);

      let nextCount = 0;
      const origDispatch = store.dispatch;
      store.dispatch = (action) => {
        if (action.type === 'NEXT') nextCount++;
        return origDispatch(action);
      };

      // Stale callback for Round 1 fires
      tm.handleExpiry('sess_stale_test', round1.roundId, store, null);

      // Must NOT have dispatched NEXT for Round 2
      expect(nextCount).to.equal(0);
      expect(tm.getTimer('sess_stale_test').status).to.equal('running');
    });

    it('10. old timer cannot interfere with or cancel next round timer', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_interfere',
        title: 'Interference Test',
        entries: ['A', 'B', 'C'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_interfere' });

      const tm = new TimerManager();
      const round1 = roundManager.initRound('sess_interfere', ['A', 'B']);
      tm.startTimer('sess_interfere', 30, store, null);

      // Complete Round 1
      roundManager.closeRoundOnce({
        sessionId: 'sess_interfere',
        roundId: round1.roundId,
        store,
        timerManager: tm
      });

      // Round 2 timer created
      const round2 = roundManager.initRound('sess_interfere', ['C', 'A']);
      const timer2 = tm.startTimer('sess_interfere', 30, store, null);
      expect(timer2.status).to.equal('running');

      // Attempt stale expiry of Round 1
      tm.handleExpiry('sess_interfere', round1.roundId, store, null);

      // Round 2 timer must still be active and intact
      const activeTimer = tm.getTimer('sess_interfere');
      expect(activeTimer).to.be.ok;
      expect(activeTimer.status).to.equal('running');
      expect(activeTimer.roundId).to.equal(round2.roundId);
    });
  });

  describe('3. Socket State Broadcast & Room Delivery', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_room_a',
        title: 'Room A',
        entries: ['A1', 'A2', 'A3'],
        timerDuration: 30
      });
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_room_b',
        title: 'Room B',
        entries: ['B1', 'B2', 'B3'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_room_a' });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_room_b' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('11. early completion results in session_state emission to correct room', (done) => {
      const vA1 = registerVoter({ sessionId: 'sess_room_a', displayName: 'A1', store });
      const vA2 = registerVoter({ sessionId: 'sess_room_a', displayName: 'A2', store });

      const clientA = createClientSocket({ auth: { voterToken: vA1.voter.sessionToken } });
      const clientB = createClientSocket();

      clientA.emit('subscribe_session', 'sess_room_a');
      clientB.emit('subscribe_session', 'sess_room_b');

      let clientBReceivedState = false;
      clientB.on('session_state', (bState) => {
        // Only initial state for sess_room_b is expected
        if (bState.id === 'sess_room_a') {
          clientBReceivedState = true;
        }
      });

      clientA.on('session_state', (aState) => {
        if (aState.vote && aState.vote.pair && aState.vote.pair[0] === 'A3') {
          expect(clientBReceivedState).to.be.false;
          done();
        }
      });

      setTimeout(() => {
        clientA.emit('action', { type: 'VOTE', sessionId: 'sess_room_a', entry: 'A1', voterToken: vA1.voter.sessionToken });
      }, 50);

      setTimeout(() => {
        clientA.emit('action', { type: 'VOTE', sessionId: 'sess_room_a', entry: 'A2', voterToken: vA2.voter.sessionToken });
      }, 100);
    });

    it('12. next pair is authoritative and starts a new authoritative timer', (done) => {
      const v1 = registerVoter({ sessionId: 'sess_room_a', displayName: 'Alice', store });
      const v2 = registerVoter({ sessionId: 'sess_room_a', displayName: 'Bob', store });

      const client = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_room_a');

      let timerStartedForNewPair = false;
      client.on('timer_state', (timerState) => {
        if (timerState.status === 'running' && timerStartedForNewPair) {
          expect(timerState.duration).to.equal(30);
          done();
        }
      });

      client.on('session_state', (state) => {
        if (state.vote && state.vote.pair && state.vote.pair[0] === 'A3') {
          timerStartedForNewPair = true;
        }
      });

      setTimeout(() => {
        client.emit('action', { type: 'VOTE', sessionId: 'sess_room_a', entry: 'A1', voterToken: v1.voter.sessionToken });
      }, 50);

      setTimeout(() => {
        client.emit('action', { type: 'VOTE', sessionId: 'sess_room_a', entry: 'A2', voterToken: v2.voter.sessionToken });
      }, 100);
    });
  });

  describe('4. Race Conditions Hardening', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_race_hard',
        title: 'Race Tournament',
        entries: ['E1', 'E2', 'E3', 'E4'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_race_hard' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('13. simultaneous final vote + timer expiry produce exactly ONE NEXT action', (done) => {
      const v1 = registerVoter({ sessionId: 'sess_race_hard', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_race_hard', displayName: 'V2', store });

      const c1 = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      const c2 = createClientSocket({ auth: { voterToken: v2.voter.sessionToken } });

      c1.emit('subscribe_session', 'sess_race_hard');
      c2.emit('subscribe_session', 'sess_race_hard');

      let nextCount = 0;
      const origDispatch = store.dispatch;
      store.dispatch = (action) => {
        if (action.type === 'NEXT' && action.sessionId === 'sess_race_hard') {
          nextCount++;
        }
        return origDispatch(action);
      };

      // Voter 1 votes
      c1.emit('action', { type: 'VOTE', sessionId: 'sess_race_hard', entry: 'E1', voterToken: v1.voter.sessionToken });

      setTimeout(() => {
        const roundId = roundManager.getCurrentRoundId('sess_race_hard', store);

        // Final vote and timer expiry fire simultaneously
        c2.emit('action', { type: 'VOTE', sessionId: 'sess_race_hard', entry: 'E2', voterToken: v2.voter.sessionToken });
        io.timerManager.handleExpiry('sess_race_hard', roundId, store, io);

        setTimeout(() => {
          expect(nextCount).to.equal(1, 'NEXT must be dispatched exactly once for this round');
          done();
        }, 150);
      }, 50);
    });

    it('14. two near-simultaneous final-voter events produce exactly ONE NEXT action', () => {
      const round = roundManager.initRound('sess_race_hard', ['E1', 'E2']);
      let nextCount = 0;
      const origDispatch = store.dispatch;
      store.dispatch = (action) => {
        if (action.type === 'NEXT' && action.sessionId === 'sess_race_hard') {
          nextCount++;
        }
        return origDispatch(action);
      };

      const res1 = roundManager.closeRoundOnce({
        sessionId: 'sess_race_hard',
        roundId: round.roundId,
        store
      });
      const res2 = roundManager.closeRoundOnce({
        sessionId: 'sess_race_hard',
        roundId: round.roundId,
        store
      });

      expect(res1.success).to.be.true;
      expect(res1.advanced).to.be.true;
      expect(res2.success).to.be.false;
      expect(res2.reason).to.equal('ALREADY_CLOSED');
      expect(nextCount).to.equal(1);
    });
  });

  describe('5. Round Isolation & Dynamic Eligibility', () => {
    it('15. Round N participation does not leak to Round N+1', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_isol',
        title: 'Isolation',
        entries: ['A', 'B', 'C', 'D']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_isol' });

      const v1 = registerVoter({ sessionId: 'sess_isol', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_isol', displayName: 'V2', store });

      const round1 = roundManager.initRound('sess_isol', ['A', 'B']);
      roundManager.recordRoundSubmission({ sessionId: 'sess_isol', roundId: round1.roundId, sessionToken: v1.voter.sessionToken });
      roundManager.recordRoundSubmission({ sessionId: 'sess_isol', roundId: round1.roundId, sessionToken: v2.voter.sessionToken });

      expect(roundManager.getRoundSubmissionCount({ sessionId: 'sess_isol', roundId: round1.roundId })).to.equal(2);
      expect(roundManager.hasAllVotersVoted({ sessionId: 'sess_isol', roundId: round1.roundId })).to.be.true;

      // Advance to Round 2
      roundManager.closeRoundOnce({ sessionId: 'sess_isol', roundId: round1.roundId, store });
      const round2 = roundManager.initRound('sess_isol', ['C', 'D']);

      expect(roundManager.getRoundSubmissionCount({ sessionId: 'sess_isol', roundId: round2.roundId })).to.equal(0);
      expect(roundManager.hasAllVotersVoted({ sessionId: 'sess_isol', roundId: round2.roundId })).to.be.false;
    });

    it('16. zero voters do not trigger early completion', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_zero',
        title: 'Zero Voters',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_zero' });

      const round = roundManager.initRound('sess_zero', ['A', 'B']);
      expect(getVoterCount('sess_zero')).to.equal(0);
      expect(canCompleteEarly({ sessionId: 'sess_zero', roundId: round.roundId })).to.be.false;
      expect(hasAllVotersVoted({ sessionId: 'sess_zero', roundId: round.roundId })).to.be.false;
    });

    it('17. single voter session does not trigger early completion (minEligibleVoters = 2)', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_one',
        title: 'One Voter',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_one' });

      const v1 = registerVoter({ sessionId: 'sess_one', displayName: 'SoleVoter', store });
      const round = roundManager.initRound('sess_one', ['A', 'B']);

      roundManager.recordRoundSubmission({
        sessionId: 'sess_one',
        roundId: round.roundId,
        sessionToken: v1.voter.sessionToken
      });

      expect(getVoterCount('sess_one')).to.equal(1);
      expect(roundManager.getRoundSubmissionCount({ sessionId: 'sess_one', roundId: round.roundId })).to.equal(1);
      // One voter alone must NOT trigger early completion
      expect(canCompleteEarly({ sessionId: 'sess_one', roundId: round.roundId })).to.be.false;
    });

    it('18. dynamic voter joining is respected (late voter prevents premature completion)', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_dyn',
        title: 'Dynamic Joining',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_dyn' });

      const vA = registerVoter({ sessionId: 'sess_dyn', displayName: 'Alice', store });
      const vB = registerVoter({ sessionId: 'sess_dyn', displayName: 'Bob', store });
      const round = roundManager.initRound('sess_dyn', ['A', 'B']);

      // Alice votes
      roundManager.recordRoundSubmission({
        sessionId: 'sess_dyn',
        roundId: round.roundId,
        sessionToken: vA.voter.sessionToken
      });
      expect(canCompleteEarly({ sessionId: 'sess_dyn', roundId: round.roundId })).to.be.false;

      // Charlie joins before Bob votes
      const vC = registerVoter({ sessionId: 'sess_dyn', displayName: 'Charlie', store });
      expect(getVoterCount('sess_dyn')).to.equal(3);

      // Bob votes
      roundManager.recordRoundSubmission({
        sessionId: 'sess_dyn',
        roundId: round.roundId,
        sessionToken: vB.voter.sessionToken
      });

      // 2 out of 3 submitted -> must NOT complete early!
      expect(roundManager.getRoundSubmissionCount({ sessionId: 'sess_dyn', roundId: round.roundId })).to.equal(2);
      expect(canCompleteEarly({ sessionId: 'sess_dyn', roundId: round.roundId })).to.be.false;

      // Charlie votes
      roundManager.recordRoundSubmission({
        sessionId: 'sess_dyn',
        roundId: round.roundId,
        sessionToken: vC.voter.sessionToken
      });

      // 3 out of 3 submitted -> now it can complete early!
      expect(roundManager.getRoundSubmissionCount({ sessionId: 'sess_dyn', roundId: round.roundId })).to.equal(3);
      expect(canCompleteEarly({ sessionId: 'sess_dyn', roundId: round.roundId })).to.be.true;
    });

    it('19. multi-session isolation: Session A early completion does not touch Session B', () => {
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_alpha', title: 'Alpha', entries: ['A1', 'A2', 'A3'] });
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_beta', title: 'Beta', entries: ['B1', 'B2', 'B3'] });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_alpha' });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_beta' });

      const vA1 = registerVoter({ sessionId: 'sess_alpha', displayName: 'Alpha1', store });
      const vA2 = registerVoter({ sessionId: 'sess_alpha', displayName: 'Alpha2', store });
      const vB1 = registerVoter({ sessionId: 'sess_beta', displayName: 'Beta1', store });
      const vB2 = registerVoter({ sessionId: 'sess_beta', displayName: 'Beta2', store });

      const roundA = roundManager.initRound('sess_alpha', ['A1', 'A2']);
      const roundB = roundManager.initRound('sess_beta', ['B1', 'B2']);

      const tm = new TimerManager();
      tm.startTimer('sess_alpha', 30, store, null);
      tm.startTimer('sess_beta', 30, store, null);

      // Session A completes early
      roundManager.recordRoundSubmission({ sessionId: 'sess_alpha', roundId: roundA.roundId, sessionToken: vA1.voter.sessionToken });
      roundManager.recordRoundSubmission({ sessionId: 'sess_alpha', roundId: roundA.roundId, sessionToken: vA2.voter.sessionToken });

      roundManager.closeRoundOnce({
        sessionId: 'sess_alpha',
        roundId: roundA.roundId,
        store,
        timerManager: tm
      });

      // Session A is closed; Session B is untouched
      expect(roundManager.isRoundClosed('sess_alpha', roundA.roundId)).to.be.true;
      expect(roundManager.isRoundClosed('sess_beta', roundB.roundId)).to.be.false;
      expect(tm.getTimer('sess_alpha')).to.be.null;
      expect(tm.getTimer('sess_beta')).to.be.ok;
      expect(tm.getTimer('sess_beta').status).to.equal('running');

      const sessBState = store.getState().getIn(['sessions', 'sess_beta']);
      expect(sessBState.getIn(['vote', 'pair']).toJS()).to.deep.equal(['B1', 'B2']);
    });
  });
});
