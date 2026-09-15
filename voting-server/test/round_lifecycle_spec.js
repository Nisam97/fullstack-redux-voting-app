import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import roundManager, {
  ROUND_LIFECYCLE,
  DEFAULT_REVEAL_DURATION,
  initRound,
  getCurrentRound,
  getCurrentRoundId,
  closeRoundOnce,
  expireReveal,
  canAcceptVotes,
  recordRoundSubmission,
  resetRounds
} from '../src/roundManager.js';
import timerManager, { TimerManager } from '../src/timer.js';
import { registerVoter, clearVoters } from '../src/auth/voter.js';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin.js';

describe('Feature 8 — Stage A: Backend Round Results Lifecycle', () => {
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
      auth: {
        token: adminToken
      },
      ...options
    });
    clients.push(socket);
    return socket;
  }

  beforeEach((done) => {
    clearAdmin();
    clearVoters();
    resetRounds();
    timerManager.clearAllTimers();

    const admin = seedAdmin();
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
    timerManager.clearAllTimers();
    resetRounds();
    if (io) {
      io.close(() => done());
      io = null;
    } else {
      done();
    }
  });

  describe('1. Lifecycle Phases & Progression', () => {
    it('1. new active round starts in VOTING phase', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_life_1',
        title: 'Life 1',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_life_1' });

      const session = store.getState().getIn(['sessions', 'sess_life_1']);
      expect(session.get('roundLifecycle')).to.equal(ROUND_LIFECYCLE.VOTING);

      const round = getCurrentRound('sess_life_1', store);
      expect(round).to.be.ok;
      expect(round.lifecycle).to.equal(ROUND_LIFECYCLE.VOTING);
      expect(round.closed).to.be.false;
    });

    it('2. closure transitions round to ROUND_CLOSED and freezes finalVote tally', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_life_2',
        title: 'Life 2',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_life_2' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_life_2', entry: 'A' });

      const round = getCurrentRound('sess_life_2', store);
      const customTm = new TimerManager();

      const result = closeRoundOnce({
        sessionId: 'sess_life_2',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 1
      });

      expect(result.success).to.be.true;
      expect(result.closed).to.be.true;
      expect(round.closed).to.be.true;
      expect(round.finalVote).to.be.ok;
      expect(round.finalVote.pair).to.deep.equal(['A', 'B']);
      expect(round.finalVote.tally).to.deep.equal({ A: 1 });

      customTm.clearAllTimers();
    });

    it('3. results become RESULTS_REVEALED during active reveal period', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_life_3',
        title: 'Life 3',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_life_3' });

      const round = getCurrentRound('sess_life_3', store);
      const customTm = new TimerManager();

      closeRoundOnce({
        sessionId: 'sess_life_3',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 2
      });

      const session = store.getState().getIn(['sessions', 'sess_life_3']);
      expect(session.get('roundLifecycle')).to.equal(ROUND_LIFECYCLE.RESULTS_REVEALED);
      expect(round.lifecycle).to.equal(ROUND_LIFECYCLE.RESULTS_REVEALED);

      customTm.clearAllTimers();
    });

    it('4. reveal expiration transitions to next round (NEXT)', (done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_life_4',
        title: 'Life 4',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_life_4' });

      const round = getCurrentRound('sess_life_4', store);
      const customTm = new TimerManager();

      closeRoundOnce({
        sessionId: 'sess_life_4',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 1
      });

      // Wait for reveal timer to expire (1s + 100ms)
      setTimeout(() => {
        const session = store.getState().getIn(['sessions', 'sess_life_4']);
        // Pair should now be ['C', 'A'] (or advanced) and lifecycle reset to VOTING
        expect(session.get('roundLifecycle')).to.equal(ROUND_LIFECYCLE.VOTING);
        expect(session.getIn(['vote', 'pair']).toJS()).to.not.deep.equal(['A', 'B']);
        customTm.clearAllTimers();
        done();
      }, 1150);
    });

    it('5. final tournament completion still works after reveal expires', (done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_life_5',
        title: 'Life 5',
        entries: ['A', 'B'] // Only 2 entries -> 1 round -> winner
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_life_5' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_life_5', entry: 'A' });

      const round = getCurrentRound('sess_life_5', store);
      const customTm = new TimerManager();

      closeRoundOnce({
        sessionId: 'sess_life_5',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 1
      });

      setTimeout(() => {
        const session = store.getState().getIn(['sessions', 'sess_life_5']);
        expect(session.get('status')).to.equal('completed');
        expect(session.get('winner')).to.equal('A');
        customTm.clearAllTimers();
        done();
      }, 1150);
    });
  });

  describe('2. Voting Restrictions', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_restr',
        title: 'Restrictions',
        entries: ['Alpha', 'Beta', 'Gamma'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_restr' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('6. vote accepted during VOTING phase', (done) => {
      const v = registerVoter({ sessionId: 'sess_restr', displayName: 'V1', store });
      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_restr');

      client.on('session_state', (state) => {
        if (state.vote && state.vote.tally && state.vote.tally.Alpha === 1) {
          expect(state.roundLifecycle).to.equal('VOTING');
          done();
        }
      });

      setTimeout(() => {
        client.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_restr',
          entry: 'Alpha',
          voterToken: v.voter.sessionToken
        });
      }, 50);
    });

    it('7. vote rejected during ROUND_CLOSED', (done) => {
      const v = registerVoter({ sessionId: 'sess_restr', displayName: 'V2', store });
      const roundId = roundManager.getCurrentRoundId('sess_restr', store);

      // Explicitly close round
      roundManager.closeRoundOnce({
        sessionId: 'sess_restr',
        roundId,
        store,
        timerManager: io.timerManager,
        revealDuration: 2
      });

      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_restr');

      client.on('action_error', (err) => {
        expect(err.action).to.equal('VOTE');
        expect(err.error).to.equal('ROUND_CLOSED');
        done();
      });

      setTimeout(() => {
        client.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_restr',
          entry: 'Alpha',
          voterToken: v.voter.sessionToken
        });
      }, 50);
    });

    it('8. vote rejected during RESULTS_REVEALED', (done) => {
      const v = registerVoter({ sessionId: 'sess_restr', displayName: 'V3', store });
      const roundId = roundManager.getCurrentRoundId('sess_restr', store);

      roundManager.closeRoundOnce({
        sessionId: 'sess_restr',
        roundId,
        store,
        timerManager: io.timerManager,
        revealDuration: 2
      });

      const session = store.getState().getIn(['sessions', 'sess_restr']);
      expect(session.get('roundLifecycle')).to.equal('RESULTS_REVEALED');

      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_restr');

      client.on('action_error', (err) => {
        expect(err.action).to.equal('VOTE');
        expect(err.error).to.equal('ROUND_CLOSED');
        done();
      });

      setTimeout(() => {
        client.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_restr',
          entry: 'Beta',
          voterToken: v.voter.sessionToken
        });
      }, 50);
    });

    it('9. rejected votes do not mutate final results tally or restart timer', (done) => {
      // First cast a valid vote
      const v1 = registerVoter({ sessionId: 'sess_restr', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_restr', displayName: 'V2', store });

      store.dispatch({ type: 'VOTE', sessionId: 'sess_restr', entry: 'Alpha' });

      const roundId = roundManager.getCurrentRoundId('sess_restr', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_restr',
        roundId,
        store,
        timerManager: io.timerManager,
        revealDuration: 2
      });

      const client = createClientSocket({ auth: { voterToken: v2.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_restr');

      client.on('action_error', (err) => {
        expect(err.error).to.equal('ROUND_CLOSED');

        // Verify tally unchanged
        const currentSession = store.getState().getIn(['sessions', 'sess_restr']);
        expect(currentSession.getIn(['vote', 'tally', 'Alpha'])).to.equal(1);
        expect(currentSession.getIn(['vote', 'tally', 'Beta'])).to.be.undefined;

        // Verify reveal timer still running and voting timer not restarted
        expect(io.timerManager.getRevealTimer('sess_restr')).to.be.ok;
        expect(io.timerManager.getTimer('sess_restr')).to.be.null;
        done();
      });

      setTimeout(() => {
        client.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_restr',
          entry: 'Beta',
          voterToken: v2.voter.sessionToken
        });
      }, 50);
    });
  });

  describe('3. Timer Management & Sequencing', () => {
    it('10. voting timer stops when round closes', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_timer_1',
        title: 'Timer 1',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_timer_1' });

      const customTm = new TimerManager();
      customTm.startTimer('sess_timer_1', 30, store);
      expect(customTm.getTimer('sess_timer_1')).to.be.ok;

      const round = getCurrentRound('sess_timer_1', store);
      closeRoundOnce({
        sessionId: 'sess_timer_1',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 2
      });

      expect(customTm.getTimer('sess_timer_1')).to.be.null;
      customTm.clearAllTimers();
    });

    it('11. reveal timer begins correctly upon closure', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_timer_2',
        title: 'Timer 2',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_timer_2' });

      const customTm = new TimerManager();
      const round = getCurrentRound('sess_timer_2', store);

      closeRoundOnce({
        sessionId: 'sess_timer_2',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 3
      });

      const revealTimer = customTm.getRevealTimer('sess_timer_2');
      expect(revealTimer).to.be.ok;
      expect(revealTimer.duration).to.equal(3);
      expect(revealTimer.status).to.equal('revealing');
      expect(revealTimer.roundId).to.equal(round.roundId);

      customTm.clearAllTimers();
    });

    it('12. reveal timer does not overlap with voting timer for same session', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_timer_3',
        title: 'Timer 3',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_timer_3' });

      const customTm = new TimerManager();
      customTm.startTimer('sess_timer_3', 30, store);

      const round = getCurrentRound('sess_timer_3', store);
      closeRoundOnce({
        sessionId: 'sess_timer_3',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 2
      });

      // Voting timer MUST be null while reveal timer is active
      expect(customTm.getTimer('sess_timer_3')).to.be.null;
      expect(customTm.getRevealTimer('sess_timer_3')).to.be.ok;

      customTm.clearAllTimers();
    });

    it('13. new voting timer begins only after NEXT advancement', (done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_timer_4',
        title: 'Timer 4',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_timer_4' });

      const customTm = new TimerManager();
      const round = getCurrentRound('sess_timer_4', store);

      store.subscribe(() => {
        const state = store.getState();
        customTm.onStateChange(null, state, store);
      });

      closeRoundOnce({
        sessionId: 'sess_timer_4',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 1
      });

      // During reveal, voting timer is null
      expect(customTm.getTimer('sess_timer_4')).to.be.null;
      expect(customTm.getRevealTimer('sess_timer_4')).to.be.ok;

      // After reveal expires (1s), NEXT runs and restarts voting timer
      setTimeout(() => {
        expect(customTm.getRevealTimer('sess_timer_4')).to.be.null;
        expect(customTm.getTimer('sess_timer_4')).to.be.ok;
        expect(customTm.getTimer('sess_timer_4').status).to.equal('running');
        customTm.clearAllTimers();
        done();
      }, 1150);
    });
  });

  describe('4. Race Protection & Idempotency', () => {
    it('14. closure is strictly idempotent (multiple calls advance round at most once)', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_race_1',
        title: 'Race 1',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_race_1' });

      const round = getCurrentRound('sess_race_1', store);
      const customTm = new TimerManager();

      const r1 = closeRoundOnce({
        sessionId: 'sess_race_1',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 2
      });
      expect(r1.success).to.be.true;

      const r2 = closeRoundOnce({
        sessionId: 'sess_race_1',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 2
      });
      expect(r2.success).to.be.false;
      expect(r2.reason).to.equal('ALREADY_CLOSED');

      const r3 = closeRoundOnce({
        sessionId: 'sess_race_1',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 2
      });
      expect(r3.success).to.be.false;
      expect(r3.reason).to.equal('ALREADY_CLOSED');

      customTm.clearAllTimers();
    });

    it('15. reveal expiration is idempotent (duplicate expiry callbacks dispatch NEXT once)', () => {
      let nextDispatchCount = 0;
      const testStore = {
        getState: () => store.getState(),
        dispatch: (action) => {
          if (action.type === 'NEXT') nextDispatchCount++;
        }
      };

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_race_2',
        title: 'Race 2',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_race_2' });

      const round = getCurrentRound('sess_race_2', store);
      const customTm = new TimerManager();

      closeRoundOnce({
        sessionId: 'sess_race_2',
        roundId: round.roundId,
        store: testStore,
        timerManager: customTm,
        revealDuration: 2
      });

      const e1 = expireReveal({
        sessionId: 'sess_race_2',
        roundId: round.roundId,
        store: testStore,
        timerManager: customTm
      });
      expect(e1.success).to.be.true;
      expect(e1.advanced).to.be.true;

      const e2 = expireReveal({
        sessionId: 'sess_race_2',
        roundId: round.roundId,
        store: testStore,
        timerManager: customTm
      });
      expect(e2.success).to.be.false;
      expect(e2.reason).to.equal('ALREADY_EXPIRED');

      expect(nextDispatchCount).to.equal(1);
      customTm.clearAllTimers();
    });

    it('16. stale reveal callback from older round cannot advance newer round', () => {
      let nextDispatchCount = 0;
      const testStore = {
        getState: () => store.getState(),
        dispatch: (action) => {
          if (action.type === 'NEXT') nextDispatchCount++;
        }
      };

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_race_3',
        title: 'Race 3',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_race_3' });

      // Round 1
      const r1 = initRound('sess_race_3', ['A', 'B']);
      // Advance to Round 2
      const r2 = initRound('sess_race_3', ['C', 'A']);

      expect(getCurrentRoundId('sess_race_3')).to.equal(r2.roundId);

      // Stale callback for r1
      const result = expireReveal({
        sessionId: 'sess_race_3',
        roundId: r1.roundId,
        store: testStore
      });

      expect(result.success).to.be.false;
      expect(result.reason).to.equal('STALE_ROUND');
      expect(nextDispatchCount).to.equal(0);
    });

    it('17. final-vote and timer expiry race results in exactly one transition', () => {
      let nextDispatchCount = 0;
      const testStore = {
        getState: () => store.getState(),
        dispatch: (action) => {
          if (action.type === 'NEXT') nextDispatchCount++;
          store.dispatch(action);
        }
      };

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_race_4',
        title: 'Race 4',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_race_4' });

      const round = getCurrentRound('sess_race_4', store);
      const customTm = new TimerManager();

      // Simulate simultaneous close attempts (one from timer, one from voter)
      const res1 = closeRoundOnce({
        sessionId: 'sess_race_4',
        roundId: round.roundId,
        store: testStore,
        timerManager: customTm,
        revealDuration: 2
      });

      const res2 = closeRoundOnce({
        sessionId: 'sess_race_4',
        roundId: round.roundId,
        store: testStore,
        timerManager: customTm,
        revealDuration: 2
      });

      expect(res1.success).to.be.true;
      expect(res2.success).to.be.false;
      expect(res2.reason).to.equal('ALREADY_CLOSED');

      // Ensure reveal timer is scheduled exactly once
      expect(customTm.activeRevealTimers.size).to.equal(1);
      customTm.clearAllTimers();
    });

    it('18. no duplicate NEXT dispatched during the reveal lifecycle', (done) => {
      let nextCount = 0;
      const origDispatch = store.dispatch.bind(store);
      store.dispatch = (action) => {
        if (action.type === 'NEXT' && action.sessionId === 'sess_race_5') {
          nextCount++;
        }
        return origDispatch(action);
      };

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_race_5',
        title: 'Race 5',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_race_5' });

      const round = getCurrentRound('sess_race_5', store);
      const customTm = new TimerManager();

      closeRoundOnce({
        sessionId: 'sess_race_5',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 1
      });

      // Attempt concurrent duplicate closure
      closeRoundOnce({
        sessionId: 'sess_race_5',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 1
      });

      setTimeout(() => {
        expect(nextCount).to.equal(1);
        customTm.clearAllTimers();
        done();
      }, 1150);
    });
  });

  describe('5. Multi-Session Isolation', () => {
    it('19. Session A lifecycle does not affect Session B', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_iso_a',
        title: 'Session A',
        entries: ['A1', 'A2', 'A3']
      });
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_iso_b',
        title: 'Session B',
        entries: ['B1', 'B2', 'B3']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_iso_a' });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_iso_b' });

      const roundA = getCurrentRound('sess_iso_a', store);
      const roundB = getCurrentRound('sess_iso_b', store);
      const customTm = new TimerManager();

      // Close Session A
      closeRoundOnce({
        sessionId: 'sess_iso_a',
        roundId: roundA.roundId,
        store,
        timerManager: customTm,
        revealDuration: 2
      });

      // Session A is in RESULTS_REVEALED
      expect(store.getState().getIn(['sessions', 'sess_iso_a', 'roundLifecycle'])).to.equal(ROUND_LIFECYCLE.RESULTS_REVEALED);
      expect(roundA.closed).to.be.true;

      // Session B MUST remain in VOTING and unclosed
      expect(store.getState().getIn(['sessions', 'sess_iso_b', 'roundLifecycle'])).to.equal(ROUND_LIFECYCLE.VOTING);
      expect(roundB.closed).to.be.false;
      expect(canAcceptVotes('sess_iso_b')).to.be.true;

      customTm.clearAllTimers();
    });

    it('20. Session A reveal callback cannot advance Session B', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_iso_a2',
        title: 'Session A2',
        entries: ['A1', 'A2', 'A3']
      });
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_iso_b2',
        title: 'Session B2',
        entries: ['B1', 'B2', 'B3']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_iso_a2' });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_iso_b2' });

      const roundA = getCurrentRound('sess_iso_a2', store);
      const customTm = new TimerManager();

      // Attempt to expire Session B with Session A's roundId
      const result = expireReveal({
        sessionId: 'sess_iso_b2',
        roundId: roundA.roundId,
        store,
        timerManager: customTm
      });

      expect(result.success).to.be.false;
      expect(result.reason).to.equal('STALE_ROUND');

      // Session B's round pair is completely unmodified
      expect(store.getState().getIn(['sessions', 'sess_iso_b2', 'vote', 'pair']).toJS()).to.deep.equal(['B1', 'B2']);
      customTm.clearAllTimers();
    });
  });

  describe('6. Reconnect & Hydration', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_recon',
        title: 'Reconnection Test',
        entries: ['Film 1', 'Film 2', 'Film 3'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_recon' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('21. client reconnecting during reveal receives correct RESULTS_REVEALED state and timer', (done) => {
      const v = registerVoter({ sessionId: 'sess_recon', displayName: 'ReconVoter', store });
      const roundId = roundManager.getCurrentRoundId('sess_recon', store);

      // Close round and enter reveal
      roundManager.closeRoundOnce({
        sessionId: 'sess_recon',
        roundId,
        store,
        timerManager: io.timerManager,
        revealDuration: 2
      });

      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });

      let receivedState = false;
      let receivedTimer = false;

      client.on('session_state', (state) => {
        expect(state.roundLifecycle).to.equal('RESULTS_REVEALED');
        expect(state.finalVote).to.be.ok;
        receivedState = true;
        if (receivedState && receivedTimer) done();
      });

      client.on('timer_state', (timerState) => {
        expect(timerState.status).to.equal('revealing');
        expect(timerState.duration).to.equal(2);
        receivedTimer = true;
        if (receivedState && receivedTimer) done();
      });

      client.emit('subscribe_session', 'sess_recon');
    });

    it('22. client reconnecting after reveal receives the correct current round state', (done) => {
      const v = registerVoter({ sessionId: 'sess_recon', displayName: 'ReconVoter2', store });
      const roundId = roundManager.getCurrentRoundId('sess_recon', store);

      roundManager.closeRoundOnce({
        sessionId: 'sess_recon',
        roundId,
        store,
        timerManager: io.timerManager,
        revealDuration: 1
      });

      // Wait until reveal has expired (1.15s)
      setTimeout(() => {
        const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });

        client.on('session_state', (state) => {
          expect(state.roundLifecycle).to.equal('VOTING');
          expect(state.vote.pair).to.deep.equal(['Film 3', 'Film 1']);
          done();
        });

        client.emit('subscribe_session', 'sess_recon');
      }, 1150);
    });
  });
});
