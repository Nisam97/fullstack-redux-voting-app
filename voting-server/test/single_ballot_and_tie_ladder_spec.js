import { expect } from 'chai';
import { List, Map, fromJS } from 'immutable';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin.js';
import { registerVoter, clearVoters } from '../src/auth/voter.js';
import { resetAuthConfig } from '../src/auth/config.js';
import roundManager, { ROUND_LIFECYCLE } from '../src/roundManager.js';
import { TimerManager } from '../src/timer.js';
import { initBallot, voteBallot, getTotalVotes, getPluralityWinners, deriveRunoff } from '../src/ballot.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';

describe('Feature 5 (Spec 0004): Single Ballot Mode and Tie Ladder', function () {
  this.timeout(20000);

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

  function connectVoter(sessionId, displayName = 'Voter') {
    const registration = registerVoter({
      sessionId,
      displayName: `${displayName}_${Date.now()}_${Math.random()}`,
      store
    });
    const socket = createClientSocket({
      auth: {
        token: adminToken,
        voterToken: registration.voter.sessionToken
      }
    });
    socket.voterToken = registration.voter.sessionToken;
    socket.emit('join_session', { sessionId, displayName: registration.voter.displayName });
    return { socket, registration };
  }

  before(async function () {
    this.timeout(120000);
    await setupTestDb();
  });

  after(async function () {
    this.timeout(30000);
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    clearAdmin();
    clearVoters();
    resetAuthConfig();
    roundManager.resetRounds();

    const admin = seedAdmin({
      username: 'admin',
      email: 'admin@votesphere.local',
      password: 'Password123!'
    });
    adminToken = generateAdminToken(admin);

    store = makeStore();
  });

  afterEach((done) => {
    while (clients.length > 0) {
      const socket = clients.pop();
      if (socket && socket.connected) {
        socket.disconnect();
      }
    }
    roundManager.resetRounds();
    if (io) {
      io.close(() => done());
      io = null;
    } else {
      done();
    }
  });

  describe('1. Pure Ballot Module (AC-1)', () => {
    it('initializes single ballot with all candidates and pair alias for backward compatibility', () => {
      const entries = ['Alice', 'Bob', 'Charlie', 'Dana'];
      const ballot = initBallot(entries);

      expect(ballot.get('candidates')).to.deep.equal(List(['Alice', 'Bob', 'Charlie', 'Dana']));
      expect(ballot.get('pair')).to.deep.equal(List(['Alice', 'Bob']));
      expect(ballot.get('tally').isEmpty()).to.be.true;
    });

    it('accumulates tally accurately and computes total votes', () => {
      let ballot = initBallot(['Alice', 'Bob', 'Charlie']);
      ballot = voteBallot(ballot, 'Alice');
      ballot = voteBallot(ballot, 'Alice');
      ballot = voteBallot(ballot, 'Charlie');

      expect(ballot.getIn(['tally', 'Alice'])).to.equal(2);
      expect(ballot.getIn(['tally', 'Charlie'])).to.equal(1);
      expect(ballot.getIn(['tally', 'Bob'])).to.be.undefined;
      expect(getTotalVotes(ballot)).to.equal(3);
    });

    it('identifies plurality winner or detects ties', () => {
      let b1 = initBallot(['A', 'B', 'C']);
      b1 = voteBallot(b1, 'A');
      b1 = voteBallot(b1, 'A');
      b1 = voteBallot(b1, 'B');
      const w1 = getPluralityWinners(b1);
      expect(w1).to.deep.equal(['A']);

      let b2 = initBallot(['A', 'B', 'C']);
      b2 = voteBallot(b2, 'A');
      b2 = voteBallot(b2, 'B');
      const w2 = getPluralityWinners(b2);
      expect(w2).to.deep.equal(['A', 'B']);
    });

    it('derives runoff ballot filtered only to tied contenders with reset tally', () => {
      let ballot = initBallot(['A', 'B', 'C']);
      ballot = voteBallot(ballot, 'A');
      ballot = voteBallot(ballot, 'B');
      const runoff = deriveRunoff(ballot, ['A', 'B']);

      expect(runoff.get('candidates')).to.deep.equal(List(['A', 'B']));
      expect(runoff.get('pair')).to.deep.equal(List(['A', 'B']));
      expect(runoff.get('tally').isEmpty()).to.be.true;
    });
  });

  describe('2. Single Ballot Session Lifecycle & Ingress (AC-1, AC-2, AC-3)', () => {
    it('initializes session in single ballot mode and accepts votes for any candidate', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      const client = createClientSocket();

      client.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_sb_1',
        title: 'Board Election',
        entries: ['Alpha', 'Beta', 'Gamma'],
        votingMode: 'single_ballot',
        token: adminToken
      });

      setTimeout(() => {
        client.emit('action', {
          type: 'START_SESSION',
          sessionId: 'sess_sb_1',
          token: adminToken
        });

        setTimeout(() => {
          const state = store.getState().getIn(['sessions', 'sess_sb_1']);
          expect(state.get('votingMode')).to.equal('single_ballot');
          expect(state.get('status')).to.equal('open');
          expect(state.get('roundLifecycle')).to.equal('VOTING');
          expect(state.getIn(['vote', 'candidates']).toJS()).to.deep.equal(['Alpha', 'Beta', 'Gamma']);

          // Register voter and cast vote for 3rd candidate Gamma
          const { socket: voterSock, registration } = connectVoter('sess_sb_1', 'Voter1');
          voterSock.emit('subscribe_session', 'sess_sb_1');

          // The live tally is hidden by the shared guard during VOTING, so the
          // accepted vote is verified in the authoritative store.
          const poll = setInterval(() => {
            const storeTally = store.getState().getIn(['sessions', 'sess_sb_1', 'vote', 'tally', 'Gamma']);
            if (storeTally === 1) {
              clearInterval(poll);
              const state = store.getState().getIn(['sessions', 'sess_sb_1']);
              expect(state.get('votingMode')).to.equal('single_ballot');
              expect(state.get('roundLifecycle')).to.equal('VOTING');
              expect(state.getIn(['vote', 'candidates']).toJS()).to.deep.equal(['Alpha', 'Beta', 'Gamma']);
              done();
            }
          }, 20);

          setTimeout(() => {
            voterSock.emit('action', {
              type: 'VOTE',
              sessionId: 'sess_sb_1',
              entry: 'Gamma',
              voterToken: registration.voter.sessionToken
            });
          }, 60);
        }, 60);
      }, 60);
    });

    it('rejects vote for candidate not in active candidates array', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_sb_reject',
        title: 'Rejection Test',
        entries: ['Alpha', 'Beta', 'Gamma'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_sb_reject' });

      const { socket: voterSock, registration } = connectVoter('sess_sb_reject', 'VoterReject');
      voterSock.emit('subscribe_session', 'sess_sb_reject');

      voterSock.on('action_error', (err) => {
        expect(err.action).to.equal('VOTE');
        expect(err.error).to.equal('INVALID_ENTRY');
        done();
      });

      setTimeout(() => {
        voterSock.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_sb_reject',
          entry: 'NonExistentCandidate',
          voterToken: registration.voter.sessionToken
        });
      }, 60);
    });
  });

  describe('3. Plurality Win & Reveal Transition (AC-3)', () => {
    it('declares decisive plurality winner with majority_win and marks session completed', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_plurality',
        title: 'Plurality Test',
        entries: ['Alice', 'Bob', 'Charlie'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_plurality' });

      store.dispatch({ type: 'VOTE', sessionId: 'sess_plurality', entry: 'Charlie' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_plurality', entry: 'Charlie' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_plurality', entry: 'Alice' });

      const round = roundManager.getCurrentRound('sess_plurality', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_plurality',
        roundId: round.roundId,
        store
      });

      // Complete reveal transition
      roundManager.expireReveal({
        sessionId: 'sess_plurality',
        roundId: round.roundId,
        store
      });

      const finalState = store.getState().getIn(['sessions', 'sess_plurality']);
      expect(finalState.get('status')).to.equal('completed');
      expect(finalState.get('winner')).to.equal('Charlie');

      const rounds = finalState.get('rounds');
      expect(rounds.size).to.equal(1);
      const r0 = rounds.get(0).toJS();
      expect(r0.kind).to.equal('single_ballot');
      expect(r0.resolution).to.equal('majority_win');
      expect(r0.candidates).to.deep.equal(['Alice', 'Bob', 'Charlie']);
      expect(r0.tally).to.deep.equal({ Charlie: 2, Alice: 1 });
    });
  });

  describe('4. Zero-Vote Replay and Termination (AC-4)', () => {
    it('replays zero vote round once with zero_vote_replay, then ends as no_result on second zero vote', () => {
      const tm = new TimerManager();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_zero',
        title: 'Zero Vote Test',
        entries: ['Candidate 1', 'Candidate 2', 'Candidate 3'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_zero' });

      // First zero-vote round closure
      const r1 = roundManager.getCurrentRound('sess_zero', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_zero',
        roundId: r1.roundId,
        store,
        timerManager: tm
      });

      roundManager.expireReveal({
        sessionId: 'sess_zero',
        roundId: r1.roundId,
        store,
        timerManager: tm
      });

      let state = store.getState().getIn(['sessions', 'sess_zero']);
      expect(state.get('status')).to.equal('open');
      expect(state.get('roundLifecycle')).to.equal('VOTING');
      expect(state.get('zeroVoteCount')).to.equal(1);

      // Verify first round recorded as zero_vote_replay
      let rounds = state.get('rounds').toJS();
      expect(rounds).to.have.lengthOf(1);
      expect(rounds[0].resolution).to.equal('zero_vote_replay');

      // Second zero-vote round closure
      const r2 = roundManager.getCurrentRound('sess_zero', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_zero',
        roundId: r2.roundId,
        store,
        timerManager: tm
      });

      roundManager.expireReveal({
        sessionId: 'sess_zero',
        roundId: r2.roundId,
        store,
        timerManager: tm
      });

      state = store.getState().getIn(['sessions', 'sess_zero']);
      expect(state.get('status')).to.equal('completed');
      expect(state.get('winner')).to.be.null;

      rounds = state.get('rounds').toJS();
      expect(rounds).to.have.lengthOf(2);
      expect(rounds[1].resolution).to.equal('no_result');
      tm.clearAllTimers();
    });
  });

  describe('5. Tie Ladder: First Tie Runoff (AC-5)', () => {
    it('launches runoff round with only tied contenders on first tie', () => {
      const tm = new TimerManager();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_tie_runoff',
        title: 'Tie Runoff Test',
        entries: ['Alice', 'Bob', 'Charlie'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_tie_runoff' });

      // Alice: 2, Bob: 2, Charlie: 1 -> Alice & Bob tie for first place
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tie_runoff', entry: 'Alice' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tie_runoff', entry: 'Alice' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tie_runoff', entry: 'Bob' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tie_runoff', entry: 'Bob' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tie_runoff', entry: 'Charlie' });

      const r1 = roundManager.getCurrentRound('sess_tie_runoff', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_tie_runoff',
        roundId: r1.roundId,
        store,
        timerManager: tm
      });

      roundManager.expireReveal({
        sessionId: 'sess_tie_runoff',
        roundId: r1.roundId,
        store,
        timerManager: tm
      });

      const state = store.getState().getIn(['sessions', 'sess_tie_runoff']);
      expect(state.get('status')).to.equal('open');
      expect(state.get('roundLifecycle')).to.equal('VOTING');
      expect(state.get('tieCount')).to.equal(1);

      // Runoff contains only Alice and Bob
      expect(state.getIn(['vote', 'candidates']).toJS()).to.deep.equal(['Alice', 'Bob']);

      const rounds = state.get('rounds').toJS();
      expect(rounds).to.have.lengthOf(1);
      expect(rounds[0].resolution).to.equal('runoff');
      expect(rounds[0].candidates).to.deep.equal(['Alice', 'Bob', 'Charlie']);
      tm.clearAllTimers();
    });
  });

  describe('6. Second Tie: TIE_PENDING & Authoritative Resolution (AC-6, AC-7, AC-8, AC-9)', () => {
    it('transitions to TIE_PENDING on second consecutive tie and arms 30s countdown', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_tie_pending',
        title: 'Tie Pending Test',
        entries: ['Alice', 'Bob'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_tie_pending' });
      // Tie count 1 (runoff)
      store.dispatch({ type: 'START_RUNOFF', sessionId: 'sess_tie_pending', tiedCandidates: ['Alice', 'Bob'] });

      // Runoff ties 1-1 again
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tie_pending', entry: 'Alice' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tie_pending', entry: 'Bob' });

      const client = createClientSocket();
      client.emit('subscribe_session', 'sess_tie_pending');

      client.on('tie_pending', (payload) => {
        expect(payload.sessionId).to.equal('sess_tie_pending');
        expect(payload.candidates).to.deep.equal(['Alice', 'Bob']);
        expect(payload.duration).to.equal(30);
        expect(payload.expiresAt).to.be.a('number');

        const state = store.getState().getIn(['sessions', 'sess_tie_pending']);
        expect(state.get('roundLifecycle')).to.equal('TIE_PENDING');
        expect(state.getIn(['tiePending', 'candidates']).toJS()).to.deep.equal(['Alice', 'Bob']);
        done();
      });

      setTimeout(() => {
        const r = roundManager.getCurrentRound('sess_tie_pending', store);
        roundManager.closeRoundOnce({
          sessionId: 'sess_tie_pending',
          roundId: r.roundId,
          store,
          timerManager: io.timerManager,
          io
        });
      }, 50);
    });

    it('resolves tie authoritatively via admin pick (AC-8)', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_admin_pick',
        title: 'Admin Pick Test',
        entries: ['Alpha', 'Beta'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_admin_pick' });
      store.dispatch({ type: 'START_RUNOFF', sessionId: 'sess_admin_pick', tiedCandidates: ['Alpha', 'Beta'] });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_admin_pick', entry: 'Alpha' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_admin_pick', entry: 'Beta' });

      const round = roundManager.getCurrentRound('sess_admin_pick', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_admin_pick',
        roundId: round.roundId,
        store,
        timerManager: io.timerManager,
        io
      });

      const adminClient = createClientSocket();
      adminClient.emit('subscribe_session', 'sess_admin_pick');

      let doneCalled = false;
      adminClient.on('session_state', (sessionState) => {
        if (!doneCalled && sessionState.status === 'completed' && sessionState.winner === 'Beta') {
          doneCalled = true;
          const rounds = store.getState().getIn(['sessions', 'sess_admin_pick', 'rounds']).toJS();
          const lastRound = rounds[rounds.length - 1];
          expect(lastRound.resolution).to.equal('admin_pick');
          done();
        }
      });

      setTimeout(() => {
        adminClient.emit('action', {
          type: 'RESOLVE_TIE',
          sessionId: 'sess_admin_pick',
          choice: 'pick',
          winner: 'Beta',
          token: adminToken
        });
      }, 60);
    });

    it('resolves tie authoritatively via coin flip (AC-8)', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_coin_flip',
        title: 'Coin Flip Test',
        entries: ['Candidate A', 'Candidate B'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_coin_flip' });
      store.dispatch({ type: 'START_RUNOFF', sessionId: 'sess_coin_flip', tiedCandidates: ['Candidate A', 'Candidate B'] });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_coin_flip', entry: 'Candidate A' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_coin_flip', entry: 'Candidate B' });

      const round = roundManager.getCurrentRound('sess_coin_flip', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_coin_flip',
        roundId: round.roundId,
        store,
        timerManager: io.timerManager,
        io
      });

      const adminClient = createClientSocket();
      adminClient.emit('subscribe_session', 'sess_coin_flip');

      let doneCalled = false;
      adminClient.on('session_state', (sessionState) => {
        if (!doneCalled && sessionState.status === 'completed' && sessionState.winner) {
          doneCalled = true;
          expect(['Candidate A', 'Candidate B']).to.include(sessionState.winner);
          const rounds = store.getState().getIn(['sessions', 'sess_coin_flip', 'rounds']).toJS();
          const lastRound = rounds[rounds.length - 1];
          expect(lastRound.resolution).to.equal('coin_flip');
          done();
        }
      });

      setTimeout(() => {
        adminClient.emit('action', {
          type: 'RESOLVE_TIE',
          sessionId: 'sess_coin_flip',
          choice: 'coin_flip',
          token: adminToken
        });
      }, 60);
    });
  });

  describe('7. Ingress Security & Error States (AC-6, AC-7, AC-8)', () => {
    it('rejects RESOLVE_TIE from an anonymous client without admin token', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      const anonClient = Client(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false
      });
      clients.push(anonClient);

      anonClient.on('connect', () => {
        anonClient.emit('action', {
          type: 'RESOLVE_TIE',
          sessionId: 'sess_anon_tie',
          choice: 'coin_flip'
        });
      });

      anonClient.on('action_error', (err) => {
        expect(err.action).to.equal('RESOLVE_TIE');
        expect(err.error).to.equal('UNAUTHORIZED');
        done();
      });
    });

    it('rejects RESOLVE_TIE with invalid choice option', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      const adminClient = createClientSocket();
      adminClient.on('connect', () => {
        adminClient.emit('action', {
          type: 'RESOLVE_TIE',
          sessionId: 'sess_err_choice',
          choice: 'rock_paper_scissors',
          token: adminToken
        });
      });

      adminClient.on('action_error', (err) => {
        expect(err.action).to.equal('RESOLVE_TIE');
        expect(err.error).to.equal('INVALID_CHOICE');
        done();
      });
    });

    it('rejects RESOLVE_TIE when roundLifecycle is not TIE_PENDING', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_not_pending',
        title: 'Not Pending Test',
        entries: ['A', 'B'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_not_pending' });

      const adminClient = createClientSocket();
      adminClient.on('connect', () => {
        adminClient.emit('action', {
          type: 'RESOLVE_TIE',
          sessionId: 'sess_not_pending',
          choice: 'coin_flip',
          token: adminToken
        });
      });

      adminClient.on('action_error', (err) => {
        expect(err.action).to.equal('RESOLVE_TIE');
        expect(err.error).to.equal('NOT_TIE_PENDING');
        done();
      });
    });

    it('rejects RESOLVE_TIE when picked winner is not among tied candidates', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_inv_winner',
        title: 'Invalid Winner Test',
        entries: ['A', 'B'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_inv_winner' });
      store.dispatch({
        type: 'SET_ROUND_LIFECYCLE',
        sessionId: 'sess_inv_winner',
        lifecycle: 'TIE_PENDING',
        tiePending: {
          roundId: 'sess_inv_winner:::r1',
          candidates: ['A', 'B'],
          duration: 30
        }
      });

      const adminClient = createClientSocket();
      adminClient.on('connect', () => {
        adminClient.emit('action', {
          type: 'RESOLVE_TIE',
          sessionId: 'sess_inv_winner',
          choice: 'pick',
          winner: 'Z_NotTied',
          token: adminToken
        });
      });

      adminClient.on('action_error', (err) => {
        expect(err.action).to.equal('RESOLVE_TIE');
        expect(err.error).to.equal('INVALID_WINNER');
        done();
      });
    });

    it('resolves tie authoritatively via automatic coin flip when the 30s timer expires (AC-9)', (done) => {
      // The production closeRoundOnce arms the tie timer with a hardcoded 30s,
      // so this test drives the same authoritative chain (startTiePendingTimer,
      // handleTiePendingExpiry, resolveTieAuthoritative) with a short duration
      // and no admin action, which is the path every abandoned session takes.
      const tm = new TimerManager();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_auto_flip',
        title: 'Auto Flip Test',
        entries: ['Alice', 'Bob'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_auto_flip' });
      store.dispatch({ type: 'START_RUNOFF', sessionId: 'sess_auto_flip', tiedCandidates: ['Alice', 'Bob'] });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_auto_flip', entry: 'Alice' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_auto_flip', entry: 'Bob' });

      store.dispatch({
        type: 'SET_ROUND_LIFECYCLE',
        sessionId: 'sess_auto_flip',
        lifecycle: 'TIE_PENDING',
        roundId: roundManager.getCurrentRoundId('sess_auto_flip', store),
        tiePending: {
          roundId: roundManager.getCurrentRoundId('sess_auto_flip', store),
          candidates: ['Alice', 'Bob'],
          duration: 30,
          startedAt: Date.now(),
          expiresAt: Date.now() + 30000
        }
      });

      const roundId = roundManager.getCurrentRoundId('sess_auto_flip', store);
      tm.startTiePendingTimer('sess_auto_flip', roundId, 0.05, store, null);

      setTimeout(() => {
        try {
          const state = store.getState().getIn(['sessions', 'sess_auto_flip']);
          expect(state.get('status')).to.equal('completed');
          expect(['Alice', 'Bob']).to.include(state.get('winner'));
          // The reducer removes the key rather than storing null.
          expect(state.get('tiePending')).to.be.undefined;

          const rounds = state.get('rounds').toJS();
          const lastRound = rounds[rounds.length - 1];
          expect(lastRound.resolution).to.equal('coin_flip');
          expect(lastRound.advanced).to.deep.equal([state.get('winner')]);

          // The expired timer entry must be gone.
          expect(tm.getTiePendingTimer('sess_auto_flip')).to.be.null;
          tm.clearAllTimers();
          done();
        } catch (err) {
          done(err);
        }
      }, 400);
    });

    it('lets an admin pick beat the timer: a later expiry is a harmless no-op (AC-8, AC-9)', (done) => {
      const tm = new TimerManager();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_pick_beats_timer',
        title: 'Pick Beats Timer Test',
        entries: ['Alpha', 'Beta'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_pick_beats_timer' });
      store.dispatch({ type: 'START_RUNOFF', sessionId: 'sess_pick_beats_timer', tiedCandidates: ['Alpha', 'Beta'] });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_pick_beats_timer', entry: 'Alpha' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_pick_beats_timer', entry: 'Beta' });

      store.dispatch({
        type: 'SET_ROUND_LIFECYCLE',
        sessionId: 'sess_pick_beats_timer',
        lifecycle: 'TIE_PENDING',
        roundId: roundManager.getCurrentRoundId('sess_pick_beats_timer', store),
        tiePending: {
          roundId: roundManager.getCurrentRoundId('sess_pick_beats_timer', store),
          candidates: ['Alpha', 'Beta'],
          duration: 30,
          startedAt: Date.now(),
          expiresAt: Date.now() + 30000
        }
      });

      const roundId = roundManager.getCurrentRoundId('sess_pick_beats_timer', store);
      tm.startTiePendingTimer('sess_pick_beats_timer', roundId, 0.3, store, null);

      // The admin resolves well before the timer fires.
      setTimeout(() => {
        const result = roundManager.resolveTieAuthoritative({
          sessionId: 'sess_pick_beats_timer',
          roundId,
          choice: 'pick',
          winner: 'Beta',
          store,
          timerManager: tm,
          io: null
        });
        expect(result.success).to.be.true;
        expect(result.resolution).to.equal('admin_pick');
      }, 80);

      // After the would-be expiry, nothing may have changed.
      setTimeout(() => {
        try {
          const state = store.getState().getIn(['sessions', 'sess_pick_beats_timer']);
          expect(state.get('status')).to.equal('completed');
          expect(state.get('winner')).to.equal('Beta');

          const rounds = state.get('rounds').toJS();
          const lastRound = rounds[rounds.length - 1];
          expect(lastRound.resolution).to.equal('admin_pick');
          expect(tm.getTiePendingTimer('sess_pick_beats_timer')).to.be.null;
          tm.clearAllTimers();
          done();
        } catch (err) {
          done(err);
        }
      }, 600);
    });

    it('rejects RESOLVE_TIE with a stale roundId', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_stale_round',
        title: 'Stale Round Test',
        entries: ['A', 'B'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_stale_round' });
      store.dispatch({
        type: 'SET_ROUND_LIFECYCLE',
        sessionId: 'sess_stale_round',
        lifecycle: 'TIE_PENDING',
        tiePending: {
          roundId: 'sess_stale_round:::r2',
          candidates: ['A', 'B'],
          duration: 30
        }
      });

      const adminClient = createClientSocket();
      adminClient.on('connect', () => {
        adminClient.emit('action', {
          type: 'RESOLVE_TIE',
          sessionId: 'sess_stale_round',
          roundId: 'sess_stale_round:::r1_stale',
          choice: 'coin_flip',
          token: adminToken
        });
      });

      adminClient.on('action_error', (err) => {
        expect(err.action).to.equal('RESOLVE_TIE');
        expect(err.error).to.equal('STALE_ROUND');
        done();
      });
    });
  });

  describe('8. Tournament Mode Tie Ladder (AC-5, AC-6, AC-8)', () => {
    it('requeues the tied pair for an immediate rematch on first tie and counts it (AC-5)', () => {
      const tm = new TimerManager();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_tourney_tie',
        title: 'Tournament Tie Test',
        entries: ['A', 'B', 'C'],
        votingMode: 'tournament'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_tourney_tie' });

      // Round 1: A vs B ties 1-1, C waits in the queue.
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_tie', entry: 'A' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_tie', entry: 'B' });

      const r1 = roundManager.getCurrentRound('sess_tourney_tie', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_tourney_tie',
        roundId: r1.roundId,
        store,
        timerManager: tm
      });
      roundManager.expireReveal({
        sessionId: 'sess_tourney_tie',
        roundId: r1.roundId,
        store,
        timerManager: tm
      });

      const state = store.getState().getIn(['sessions', 'sess_tourney_tie']);
      expect(state.get('status')).to.equal('open');
      expect(state.get('roundLifecycle')).to.equal('VOTING');
      expect(state.get('tieCount')).to.equal(1);
      expect(state.get('winner')).to.be.null;
      expect(state.getIn(['vote', 'pair']).toJS()).to.deep.equal(['A', 'B']);
      expect(state.getIn(['vote', 'tally']).isEmpty()).to.be.true;

      const rounds = state.get('rounds').toJS();
      expect(rounds).to.have.lengthOf(1);
      expect(rounds[0].resolution).to.equal('tie_advance');
      expect(rounds[0].advanced).to.deep.equal(['A', 'B']);
      tm.clearAllTimers();
    });

    it('enters TIE_PENDING on the second consecutive tournament tie (AC-6)', (done) => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_tourney_pending',
        title: 'Tournament Pending Test',
        entries: ['A', 'B'],
        votingMode: 'tournament'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_tourney_pending' });

      // Round 1 ties and requeues.
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_pending', entry: 'A' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_pending', entry: 'B' });
      const r1 = roundManager.getCurrentRound('sess_tourney_pending', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_tourney_pending',
        roundId: r1.roundId,
        store,
        timerManager: io.timerManager
      });
      roundManager.expireReveal({
        sessionId: 'sess_tourney_pending',
        roundId: r1.roundId,
        store,
        timerManager: io.timerManager
      });

      const client = createClientSocket();
      client.emit('subscribe_session', 'sess_tourney_pending');

      client.on('tie_pending', (payload) => {
        try {
          expect(payload.candidates).to.deep.equal(['A', 'B']);
          const state = store.getState().getIn(['sessions', 'sess_tourney_pending']);
          expect(state.get('roundLifecycle')).to.equal('TIE_PENDING');
          expect(state.get('tieCount')).to.equal(2);
          expect(state.getIn(['tiePending', 'candidates']).toJS()).to.deep.equal(['A', 'B']);
          done();
        } catch (err) {
          done(err);
        }
      });

      setTimeout(() => {
        // Round 2: the requeued pair ties again.
        store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_pending', entry: 'A' });
        store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_pending', entry: 'B' });
        const r2 = roundManager.getCurrentRound('sess_tourney_pending', store);
        roundManager.closeRoundOnce({
          sessionId: 'sess_tourney_pending',
          roundId: r2.roundId,
          store,
          timerManager: io.timerManager,
          io
        });
      }, 60);
    });

    it('advances the picked winner through the bracket on resolution, then concludes the tournament (AC-8)', () => {
      const tm = new TimerManager();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_tourney_resolve',
        title: 'Tournament Resolve Test',
        entries: ['A', 'B'],
        votingMode: 'tournament'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_tourney_resolve' });
      store.dispatch({ type: 'START_RUNOFF', sessionId: 'sess_tourney_resolve', tiedCandidates: ['A', 'B'] });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_resolve', entry: 'A' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_resolve', entry: 'B' });

      const r1 = roundManager.getCurrentRound('sess_tourney_resolve', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_tourney_resolve',
        roundId: r1.roundId,
        store,
        timerManager: tm
      });

      const result = roundManager.resolveTieAuthoritative({
        sessionId: 'sess_tourney_resolve',
        roundId: r1.roundId,
        choice: 'pick',
        winner: 'A',
        store,
        timerManager: tm,
        io: null
      });
      expect(result.success).to.be.true;

      let state = store.getState().getIn(['sessions', 'sess_tourney_resolve']);
      // The bracket continues: the session stays open with A advanced first.
      expect(state.get('status')).to.equal('open');
      expect(state.get('roundLifecycle')).to.equal('VOTING');
      // winner stays null (from CREATE_SESSION): only a decisive core.next sets it.
      expect(state.get('winner')).to.be.null;
      expect(state.get('tieCount')).to.equal(0);
      expect(state.get('tiePending')).to.be.undefined;
      expect(state.getIn(['vote', 'pair']).toJS()).to.deep.equal(['A', 'B']);
      expect(state.getIn(['vote', 'tally']).isEmpty()).to.be.true;

      const rounds = state.get('rounds').toJS();
      expect(rounds).to.have.lengthOf(1);
      expect(rounds[0].resolution).to.equal('admin_pick');
      expect(rounds[0].advanced).to.deep.equal(['A']);

      // Continuation: a fresh round identity (armed by the state subscriber in
      // the live server), a decisive vote, and the bracket concludes.
      roundManager.initRound('sess_tourney_resolve', ['A', 'B'], { kind: 'pairwise' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_resolve', entry: 'A' });
      const r2 = roundManager.getCurrentRound('sess_tourney_resolve', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_tourney_resolve',
        roundId: r2.roundId,
        store,
        timerManager: tm
      });
      roundManager.expireReveal({
        sessionId: 'sess_tourney_resolve',
        roundId: r2.roundId,
        store,
        timerManager: tm
      });

      state = store.getState().getIn(['sessions', 'sess_tourney_resolve']);
      expect(state.get('status')).to.equal('completed');
      expect(state.get('winner')).to.equal('A');
      tm.clearAllTimers();
    });
  });

  describe('9. Tournament ladder hardening (runtime regression)', () => {
    it('decisive rematch resets tieCount and the next matchup first tie opens a rematch, not the admin window', () => {
      const tm = new TimerManager();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_ladder_reset', title: 'Ladder Reset', entries: ['A', 'B', 'C', 'D'], timerDuration: 5 });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_ladder_reset' });

      // R1: A vs B split -> tie ladder arms the rematch (tieCount 1).
      const r1 = roundManager.initRound('sess_ladder_reset', ['A', 'B'], { kind: 'pairwise' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ladder_reset', entry: 'A' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ladder_reset', entry: 'B' });
      const close1 = roundManager.closeRoundOnce({ sessionId: 'sess_ladder_reset', roundId: r1.roundId, store, timerManager: tm, revealDuration: 1 });
      expect(close1.success).to.be.true;
      roundManager.expireReveal({ sessionId: 'sess_ladder_reset', roundId: r1.roundId, store, timerManager: tm });
      let state = store.getState().getIn(['sessions', 'sess_ladder_reset']);
      expect(state.get('tieCount')).to.equal(1);
      expect(state.getIn(['vote', 'pair']).toJS()).to.deep.equal(['A', 'B']);

      // R2: decisive rematch -> tieCount must RESET to 0 and the bracket moves on.
      const r2 = roundManager.getCurrentRound('sess_ladder_reset', store);
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ladder_reset', entry: 'A' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ladder_reset', entry: 'A' });
      const close2 = roundManager.closeRoundOnce({ sessionId: 'sess_ladder_reset', roundId: r2.roundId, store, timerManager: tm, revealDuration: 1 });
      expect(close2.success).to.be.true;
      roundManager.expireReveal({ sessionId: 'sess_ladder_reset', roundId: r2.roundId, store, timerManager: tm });
      state = store.getState().getIn(['sessions', 'sess_ladder_reset']);
      expect(state.get('tieCount')).to.equal(0);
      expect(state.getIn(['vote', 'pair']).toJS()).to.deep.equal(['C', 'D']);

      // R3: FIRST tie of the fresh matchup -> rematch again (tieCount 1), never TIE_PENDING.
      const r3 = roundManager.getCurrentRound('sess_ladder_reset', store);
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ladder_reset', entry: 'C' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ladder_reset', entry: 'D' });
      const close3 = roundManager.closeRoundOnce({ sessionId: 'sess_ladder_reset', roundId: r3.roundId, store, timerManager: tm, revealDuration: 1 });
      expect(close3.success).to.be.true;
      roundManager.expireReveal({ sessionId: 'sess_ladder_reset', roundId: r3.roundId, store, timerManager: tm });
      state = store.getState().getIn(['sessions', 'sess_ladder_reset']);
      expect(state.get('roundLifecycle')).to.equal('VOTING');
      expect(state.get('tieCount')).to.equal(1);
      expect(state.get('tiePending')).to.be.undefined;

      // Round identities stayed contiguous: one init per advance, no holes.
      const indexes = state.get('rounds').toJS().map((r) => r.roundIndex);
      expect(indexes).to.deep.equal([1, 2, 3]);
      tm.clearAllTimers();
    });

    it('empty tournament round requeues once through the ladder, then terminates as no_result', () => {
      const tm = new TimerManager();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_empty_bound', title: 'Empty Bound', entries: ['A', 'B', 'C', 'D'], timerDuration: 5 });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_empty_bound' });

      // R1: no votes at all -> 0:0 tie arms a rematch (the ladder run starts).
      const r1 = roundManager.initRound('sess_empty_bound', ['A', 'B'], { kind: 'pairwise' });
      const close1 = roundManager.closeRoundOnce({ sessionId: 'sess_empty_bound', roundId: r1.roundId, store, timerManager: tm, revealDuration: 1 });
      expect(close1.success).to.be.true;
      roundManager.expireReveal({ sessionId: 'sess_empty_bound', roundId: r1.roundId, store, timerManager: tm });
      let state = store.getState().getIn(['sessions', 'sess_empty_bound']);
      expect(state.get('status')).to.equal('open');
      expect(state.get('tieCount')).to.equal(1);
      expect(state.get('zeroVoteCount')).to.equal(1);
      expect(state.getIn(['vote', 'pair']).toJS()).to.deep.equal(['A', 'B']);

      // R2: still no votes -> the session terminates as no_result instead of
      // cycling rematches forever (the bound that stops the runaway loop).
      const r2 = roundManager.getCurrentRound('sess_empty_bound', store);
      const close2 = roundManager.closeRoundOnce({ sessionId: 'sess_empty_bound', roundId: r2.roundId, store, timerManager: tm, revealDuration: 1 });
      expect(close2.success).to.be.true;
      roundManager.expireReveal({ sessionId: 'sess_empty_bound', roundId: r2.roundId, store, timerManager: tm });
      state = store.getState().getIn(['sessions', 'sess_empty_bound']);
      expect(state.get('status')).to.equal('completed');
      expect(state.get('winner')).to.be.null;
      const rounds = state.get('rounds').toJS();
      expect(rounds).to.have.lengthOf(2);
      expect(rounds[0].resolution).to.equal('tie_advance');
      expect(rounds[1].resolution).to.equal('no_result');
      tm.clearAllTimers();
    });

    it('keeps one round identity and the real tallies in the ledger through TIE_PENDING and resolution (AC-10)', async () => {
      io = startServer(store, 0);
      port = io.httpServer.address().port;
      // The REAL server timer manager: the subscriber path this test guards
      // runs through io.timerManager, so closeRoundOnce must clear the armed
      // voting timer exactly as production does.
      const tm = io.timerManager;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_ledger_window',
        title: 'Ledger Window',
        entries: ['Alpha', 'Beta', 'Gamma'],
        votingMode: 'single_ballot'
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_ledger_window' });

      // R1: Alpha 2, Beta 2, Gamma 1 -> first tie arms the runoff.
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ledger_window', entry: 'Alpha' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ledger_window', entry: 'Beta' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ledger_window', entry: 'Alpha' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ledger_window', entry: 'Beta' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ledger_window', entry: 'Gamma' });
      const r1 = roundManager.getCurrentRound('sess_ledger_window', store);
      roundManager.closeRoundOnce({ sessionId: 'sess_ledger_window', roundId: r1.roundId, store, timerManager: tm, revealDuration: 0 });
      roundManager.expireReveal({ sessionId: 'sess_ledger_window', roundId: r1.roundId, store, timerManager: tm });

      let state = store.getState().getIn(['sessions', 'sess_ledger_window']);
      expect(state.get('tieCount')).to.equal(1);

      // R2: the runoff ties 1:1 -> TIE_PENDING.
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ledger_window', entry: 'Alpha' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_ledger_window', entry: 'Beta' });
      const r2 = roundManager.getCurrentRound('sess_ledger_window', store);
      const close2 = roundManager.closeRoundOnce({ sessionId: 'sess_ledger_window', roundId: r2.roundId, store, timerManager: tm, revealDuration: 0 });
      expect(close2.tiePending).to.be.true;

      // While the admin window is open the active identity must stay the tied
      // round. The counter dispatch used to wake the timer subscriber mid
      // window and arm a stray next round identity here.
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(roundManager.getCurrentRoundId('sess_ledger_window', store)).to.equal(r2.roundId);

      const result = roundManager.resolveTieAuthoritative({
        sessionId: 'sess_ledger_window',
        roundId: r2.roundId,
        choice: 'pick',
        winner: 'Alpha',
        store,
        timerManager: tm,
        io: null
      });
      expect(result.success).to.be.true;

      state = store.getState().getIn(['sessions', 'sess_ledger_window']);
      const rounds = state.get('rounds').toJS();
      expect(rounds.map(r => r.roundIndex)).to.deep.equal([1, 2]);
      expect(rounds[0].resolution).to.equal('runoff');
      expect(rounds[0].tally).to.deep.equal({ Alpha: 2, Beta: 2, Gamma: 1 });
      expect(rounds[1].resolution).to.equal('admin_pick');
      expect(rounds[1].tally).to.deep.equal({ Alpha: 1, Beta: 1 });

      // The persisted ledger must mirror the store ledger exactly.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const { Result } = await import('../src/db/models/Result.js');
      const doc = await Result.findOne({ sessionId: 'sess_ledger_window' }).lean();
      expect(doc).to.exist;
      expect(doc.rounds.map(r => r.roundIndex)).to.deep.equal([1, 2]);
      expect(doc.rounds[0].tally).to.deep.equal({ Alpha: 2, Beta: 2, Gamma: 1 });
      expect(doc.rounds[1].tally).to.deep.equal({ Alpha: 1, Beta: 1 });
      tm.clearAllTimers();
    });
  });
});
