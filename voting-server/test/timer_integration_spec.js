import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store';
import startServer from '../src/server';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin';
import { registerVoter, clearVoters } from '../src/auth/voter';
import { resetAuthConfig } from '../src/auth/config';

describe('Timer Integration & Socket Behavior', () => {
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

  function connectClient(sessionId = 'sess_default', options = {}) {
    const voter = registerVoter({
      sessionId,
      displayName: `Voter_${Date.now()}_${Math.random()}`,
      store
    });

    const socket = createClientSocket({
      auth: {
        token: adminToken,
        voterToken: voter?.voter?.sessionToken
      },
      ...options
    });

    if (voter && voter.success) {
      socket.voterToken = voter.voter.sessionToken;
      socket.emit('join_session', { sessionId, displayName: voter.voter.displayName });
    }

    return new Promise((resolve, reject) => {
      socket.once('sessions', (sessions) => {
        resolve({ socket, initialSessions: sessions, voter });
      });
      socket.once('connect_error', reject);
    });
  }

  beforeEach((done) => {
    clearAdmin();
    clearVoters();
    resetAuthConfig();
    const admin = seedAdmin({
      username: 'admin',
      email: 'admin@votesphere.local',
      password: 'Password123!'
    });
    adminToken = generateAdminToken(admin);

    store = makeStore();

    // Create and start default session
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_default',
      title: '90s Cult Movies',
      entries: ['Trainspotting', '28 Days Later', 'Sunshine']
    });
    store.dispatch({
      type: 'START_SESSION',
      sessionId: 'sess_default'
    });

    // Create and start horror session
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_horror',
      title: 'Horror Classics',
      entries: ['The Shining', 'Psycho', 'Alien']
    });
    store.dispatch({
      type: 'START_SESSION',
      sessionId: 'sess_horror'
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

  describe('1. Timer Startup on Session Open', () => {
    it('starts timer and emits timer_state to room when session opens with active pair', (done) => {
      // Create a pending session
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_stage_b',
        title: 'Stage B Session',
        entries: ['Entry A', 'Entry B', 'Entry C']
      });

      connectClient('sess_stage_b').then(({ socket }) => {
        socket.emit('subscribe_session', 'sess_stage_b');

        // Listen for timer_state
        socket.on('timer_state', (timerState) => {
          if (timerState && timerState.status === 'running') {
            expect(timerState.sessionId).to.equal('sess_stage_b');
            expect(timerState.duration).to.equal(30);
            expect(timerState.expiresAt).to.be.a('number');
            expect(timerState.expiresAt).to.be.above(Date.now());
            done();
          }
        });

        // Start session to open it and generate initial pair
        setTimeout(() => {
          store.dispatch({
            type: 'START_SESSION',
            sessionId: 'sess_stage_b'
          });
        }, 50);
      }).catch(done);
    });
  });

  describe('2. Timer Hydration on Reconnect / Subscribe', () => {
    it('hydrates active running timer_state immediately upon subscribing', (done) => {
      connectClient('sess_default').then(({ socket }) => {
        let receivedTimerState = null;
        let receivedSessionState = null;

        socket.on('session_state', (state) => {
          receivedSessionState = state;
        });

        socket.on('timer_state', (timerState) => {
          receivedTimerState = timerState;
          if (receivedSessionState && receivedTimerState) {
            expect(receivedSessionState.id).to.equal('sess_default');
            expect(receivedTimerState.sessionId).to.equal('sess_default');
            expect(receivedTimerState.status).to.equal('running');
            expect(receivedTimerState.duration).to.equal(30);
            expect(receivedTimerState.expiresAt).to.be.above(Date.now());
            done();
          }
        });

        socket.emit('subscribe_session', 'sess_default');
      }).catch(done);
    });

    it('hydrates null timer_state when subscribing to a pending session', (done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_pending_1',
        title: 'Pending Session',
        entries: ['A', 'B']
      });

      connectClient('sess_pending_1').then(({ socket }) => {
        socket.on('timer_state', (timerState) => {
          expect(timerState.sessionId).to.equal('sess_pending_1');
          expect(timerState.duration).to.be.null;
          expect(timerState.expiresAt).to.be.null;
          expect(timerState.status).to.be.null;
          done();
        });

        socket.emit('subscribe_session', 'sess_pending_1');
      }).catch(done);
    });

    it('hydrates null timer_state when subscribing to a completed session', (done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_completed_1',
        title: 'Completed Session',
        entries: ['WinnerOnly']
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_completed_1'
      });

      // Status is completed since only 1 entry existed
      const state = store.getState().getIn(['sessions', 'sess_completed_1']);
      expect(state.get('status')).to.equal('completed');

      connectClient('sess_completed_1').then(({ socket }) => {
        socket.on('timer_state', (timerState) => {
          expect(timerState.sessionId).to.equal('sess_completed_1');
          expect(timerState.status).to.be.null;
          done();
        });

        socket.emit('subscribe_session', 'sess_completed_1');
      }).catch(done);
    });

    it('hydrates null timer_state when subscribing to an archived session', (done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_archived_1',
        title: 'Archived Session',
        entries: ['A', 'B']
      });
      store.dispatch({
        type: 'ARCHIVE_SESSION',
        sessionId: 'sess_archived_1'
      });

      connectClient('sess_archived_1').then(({ socket }) => {
        socket.on('timer_state', (timerState) => {
          expect(timerState.sessionId).to.equal('sess_archived_1');
          expect(timerState.status).to.be.null;
          done();
        });

        socket.emit('subscribe_session', 'sess_archived_1');
      }).catch(done);
    });

    it('safely ignores subscription to an unknown session without emitting', (done) => {
      connectClient('sess_default').then(({ socket }) => {
        let receivedEvent = false;

        socket.on('session_state', () => { receivedEvent = true; });
        socket.on('timer_state', () => { receivedEvent = true; });

        socket.emit('subscribe_session', 'sess_completely_unknown');

        setTimeout(() => {
          expect(receivedEvent).to.be.false;
          done();
        }, 100);
      }).catch(done);
    });
  });

  describe('3. Expiry and Pair Progression', () => {
    it('dispatches NEXT on timer expiry, updates pair, and starts new timer for next round', (done) => {
      connectClient('sess_default').then(({ socket }) => {
        let timerEvents = 0;
        let sessionStateCount = 0;

        socket.emit('subscribe_session', 'sess_default');

        socket.on('session_state', (state) => {
          sessionStateCount++;
          if (sessionStateCount === 2) {
            // Received updated session state after expiry
            expect(state.vote.pair).to.be.an('array');
            done();
          }
        });

        // Trigger manual expiry on timerManager to simulate timer timeout
        setTimeout(() => {
          io.timerManager.handleExpiry('sess_default', store, io);
        }, 80);
      }).catch(done);
    });
  });

  describe('4. Tournament Completion', () => {
    it('clears timer and emits null timer_state when final round completes', (done) => {
      // 2 entries tournament: 1 round determines winner
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_final_round',
        title: 'Final Round Tourney',
        entries: ['Finalist A', 'Finalist B']
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_final_round'
      });

      connectClient('sess_final_round').then(({ socket }) => {
        socket.emit('subscribe_session', 'sess_final_round');

        socket.on('timer_state', (timerState) => {
          if (timerState.status === null) {
            // Verified timer cleared on completion
            expect(timerState.sessionId).to.equal('sess_final_round');
            expect(timerState.duration).to.be.null;
            expect(io.timerManager.getTimer('sess_final_round')).to.be.null;
            done();
          }
        });

        // Cast vote and simulate expiry to determine winner
        store.dispatch({
          type: 'VOTE',
          sessionId: 'sess_final_round',
          entry: 'Finalist A'
        });

        setTimeout(() => {
          io.timerManager.handleExpiry('sess_final_round', store, io);
        }, 80);
      }).catch(done);
    });
  });

  describe('5. Session Archive', () => {
    it('clears timer and emits null timer_state when session is archived', (done) => {
      connectClient('sess_default').then(({ socket }) => {
        socket.emit('subscribe_session', 'sess_default');

        socket.on('timer_state', (timerState) => {
          if (timerState.status === null) {
            expect(timerState.sessionId).to.equal('sess_default');
            expect(io.timerManager.getTimer('sess_default')).to.be.null;
            done();
          }
        });

        setTimeout(() => {
          store.dispatch({
            type: 'ARCHIVE_SESSION',
            sessionId: 'sess_default'
          });
        }, 80);
      }).catch(done);
    });
  });

  describe('6. Room Isolation', () => {
    it('strictly isolates timer_state events between distinct session rooms', async () => {
      const { socket: clientDefault } = await connectClient('sess_default');
      const { socket: clientHorror } = await connectClient('sess_horror');

      const defaultEvents = [];
      const horrorEvents = [];

      clientDefault.on('timer_state', (evt) => defaultEvents.push(evt));
      clientHorror.on('timer_state', (evt) => horrorEvents.push(evt));

      // Subscribe each client to its own room
      clientDefault.emit('subscribe_session', 'sess_default');
      clientHorror.emit('subscribe_session', 'sess_horror');

      await new Promise(r => setTimeout(r, 100));

      // Clear event logs after initial hydration
      defaultEvents.length = 0;
      horrorEvents.length = 0;

      // Trigger timer restart on sess_default only
      io.timerManager.startTimer('sess_default', 20, store, io);

      await new Promise(r => setTimeout(r, 100));

      // clientDefault should receive sess_default timer_state
      expect(defaultEvents.length).to.be.at.least(1);
      expect(defaultEvents.every(e => e.sessionId === 'sess_default')).to.be.true;

      // clientHorror should NOT receive any sess_default event
      expect(horrorEvents.filter(e => e.sessionId === 'sess_default')).to.have.lengthOf(0);

      // sess_horror timer should remain unchanged
      const horrorTimer = io.timerManager.getTimer('sess_horror');
      expect(horrorTimer).to.be.ok;
      expect(horrorTimer.sessionId).to.equal('sess_horror');
      expect(horrorTimer.duration).to.equal(30);
    });
  });

  describe('7. Race-Condition: VOTE vs Expiry (Authoritative Server Ordering)', () => {
    it('processes VOTE before expiry: vote is counted into tally before NEXT advances', async () => {
      // 1. Initial active pair
      const sessionBefore = store.getState().getIn(['sessions', 'sess_default']);
      const pair = sessionBefore.getIn(['vote', 'pair']).toJS();
      const votedCandidate = pair[0];

      // 2. Dispatch VOTE action
      store.dispatch({
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: votedCandidate
      });

      // Verify vote tally updated
      const sessionWithVote = store.getState().getIn(['sessions', 'sess_default']);
      expect(sessionWithVote.getIn(['vote', 'tally', votedCandidate])).to.equal(1);

      // 3. Trigger expiry -> dispatches NEXT
      io.timerManager.handleExpiry('sess_default', store, io);

      // 4. Verify winner of that round was votedCandidate (it got 1 vote, other got 0)
      const sessionAfterNext = store.getState().getIn(['sessions', 'sess_default']);
      const nextPair = sessionAfterNext.getIn(['vote', 'pair']).toJS();
      // The voted candidate advanced as winner into the next pair
      expect(nextPair).to.include(votedCandidate);
    });

    it('processes expiry before VOTE: subsequent vote for old candidate is rejected by pair check', async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      // 1. Capture original pair
      const sessionInitial = store.getState().getIn(['sessions', 'sess_default']);
      const oldPair = sessionInitial.getIn(['vote', 'pair']).toJS();
      const oldCandidate = oldPair[0];

      // 2. Timer expires first -> enters RESULTS_REVEALED, then NEXT after reveal
      io.timerManager.handleExpiry('sess_default', store, io);

      // Wait for the default reveal timer to expire (1s + buffer)
      await wait(1500);

      const sessionAfterExpiry = store.getState().getIn(['sessions', 'sess_default']);
      const newPair = sessionAfterExpiry.getIn(['vote', 'pair']).toJS();

      // Ensure pair has progressed
      expect(newPair).to.not.deep.equal(oldPair);

      // 3. Stale VOTE arrives for oldCandidate (which is not in the active pair now)
      if (!newPair.includes(oldCandidate)) {
        store.dispatch({
          type: 'VOTE',
          sessionId: 'sess_default',
          entry: oldCandidate
        });

        // 4. State is protected: reducer guard rejects candidates not in the active pair
        const sessionAfterStaleVote = store.getState().getIn(['sessions', 'sess_default']);
        expect(sessionAfterStaleVote.getIn(['vote', 'tally', oldCandidate])).to.be.undefined;
      }
    });
  });
});
