import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import roundManager, {
  ROUND_LIFECYCLE,
  initRound,
  getCurrentRound,
  getCurrentRoundId,
  closeRoundOnce,
  expireReveal,
  canAcceptVotes,
  resetRounds
} from '../src/roundManager.js';
import timerManager, { TimerManager } from '../src/timer.js';
import { registerVoter, clearVoters } from '../src/auth/voter.js';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin.js';

describe('Feature 8 — Stage B: Reveal Timer & Socket Synchronization Hardening', () => {
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

  function waitForEvent(socket, eventName, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for event "${eventName}" after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  function waitForSessionState(socket, predicate, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('session_state', onState);
        reject(new Error(`Timed out waiting for matching session_state after ${timeoutMs}ms`));
      }, timeoutMs);

      function onState(state) {
        try {
          if (predicate(state)) {
            clearTimeout(timer);
            socket.off('session_state', onState);
            resolve(state);
          }
        } catch {
          // ignore predicate errors and keep listening
        }
      }

      socket.on('session_state', onState);
    });
  }

  function waitForTimerState(socket, predicate, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('timer_state', onTimer);
        reject(new Error(`Timed out waiting for matching timer_state after ${timeoutMs}ms`));
      }, timeoutMs);

      function onTimer(t) {
        try {
          if (predicate(t)) {
            clearTimeout(timer);
            socket.off('timer_state', onTimer);
            resolve(t);
          }
        } catch {
          // ignore predicate errors
        }
      }

      socket.on('timer_state', onTimer);
    });
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

  describe('1. Multi-Client Synchronization in Shared Room', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_sync',
        title: 'Multi-Client Sync',
        entries: ['Matrix', 'Inception', 'Interstellar'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_sync' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('1. multiple clients in same session receive identical authoritative RESULTS_REVEALED state on closure', async () => {
      const v1 = registerVoter({ sessionId: 'sess_sync', displayName: 'Voter1', store });
      const v2 = registerVoter({ sessionId: 'sess_sync', displayName: 'Voter2', store });

      const c1 = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      const c2 = createClientSocket({ auth: { voterToken: v2.voter.sessionToken } });

      c1.emit('subscribe_session', 'sess_sync');
      c2.emit('subscribe_session', 'sess_sync');

      await Promise.all([
        waitForSessionState(c1, s => s.id === 'sess_sync'),
        waitForSessionState(c2, s => s.id === 'sess_sync')
      ]);

      const roundId = roundManager.getCurrentRoundId('sess_sync', store);

      // Both clients listen for transition to RESULTS_REVEALED
      const c1RevealPromise = waitForSessionState(c1, s => s.roundLifecycle === 'RESULTS_REVEALED');
      const c2RevealPromise = waitForSessionState(c2, s => s.roundLifecycle === 'RESULTS_REVEALED');

      // Close round with reveal duration 1s
      roundManager.closeRoundOnce({
        sessionId: 'sess_sync',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      const [state1, state2] = await Promise.all([c1RevealPromise, c2RevealPromise]);

      expect(state1.roundLifecycle).to.equal('RESULTS_REVEALED');
      expect(state2.roundLifecycle).to.equal('RESULTS_REVEALED');
      expect(state1.roundId).to.equal(state2.roundId);
      expect(state1.finalVote).to.deep.equal(state2.finalVote);
      expect(state1.revealTimer.expiresAt).to.equal(state2.revealTimer.expiresAt);
      expect(state1.revealTimer.duration).to.equal(1);
      expect(state2.revealTimer.duration).to.equal(1);
    });

    it('2. multiple clients receive identical timer_state event with status revealing', async () => {
      const v1 = registerVoter({ sessionId: 'sess_sync', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_sync', displayName: 'V2', store });

      const c1 = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      const c2 = createClientSocket({ auth: { voterToken: v2.voter.sessionToken } });

      c1.emit('subscribe_session', 'sess_sync');
      c2.emit('subscribe_session', 'sess_sync');

      await Promise.all([
        waitForSessionState(c1, s => s.id === 'sess_sync'),
        waitForSessionState(c2, s => s.id === 'sess_sync')
      ]);

      const roundId = roundManager.getCurrentRoundId('sess_sync', store);

      const c1TimerPromise = waitForTimerState(c1, t => t.status === 'revealing');
      const c2TimerPromise = waitForTimerState(c2, t => t.status === 'revealing');

      roundManager.closeRoundOnce({
        sessionId: 'sess_sync',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      const [t1, t2] = await Promise.all([c1TimerPromise, c2TimerPromise]);

      expect(t1.sessionId).to.equal('sess_sync');
      expect(t2.sessionId).to.equal('sess_sync');
      expect(t1.status).to.equal('revealing');
      expect(t2.status).to.equal('revealing');
      expect(t1.expiresAt).to.equal(t2.expiresAt);
      expect(t1.duration).to.equal(1);
      expect(t2.duration).to.equal(1);
    });
  });

  describe('2. Multi-Session Strict Room Isolation', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_iso_1',
        title: 'Isolation Session 1',
        entries: ['A1', 'A2', 'A3'],
        timerDuration: 30
      });
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_iso_2',
        title: 'Isolation Session 2',
        entries: ['B1', 'B2', 'B3'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_iso_1' });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_iso_2' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('3. Session A reveal transition does not leak events to Session B room subscribers', async () => {
      const vA = registerVoter({ sessionId: 'sess_iso_1', displayName: 'VoterA', store });
      const vB = registerVoter({ sessionId: 'sess_iso_2', displayName: 'VoterB', store });

      const cA = createClientSocket({ auth: { voterToken: vA.voter.sessionToken } });
      const cB = createClientSocket({ auth: { voterToken: vB.voter.sessionToken } });

      cA.emit('subscribe_session', 'sess_iso_1');
      cB.emit('subscribe_session', 'sess_iso_2');

      await Promise.all([
        waitForSessionState(cA, s => s.id === 'sess_iso_1'),
        waitForSessionState(cB, s => s.id === 'sess_iso_2')
      ]);

      const bEvents = [];
      cB.on('session_state', s => bEvents.push({ type: 'session_state', id: s.id, lifecycle: s.roundLifecycle }));
      cB.on('timer_state', t => bEvents.push({ type: 'timer_state', id: t.sessionId, status: t.status }));

      const roundIdA = roundManager.getCurrentRoundId('sess_iso_1', store);

      // Close Session A only
      roundManager.closeRoundOnce({
        sessionId: 'sess_iso_1',
        roundId: roundIdA,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      // Verify Session A client received reveal
      const aState = await waitForSessionState(cA, s => s.roundLifecycle === 'RESULTS_REVEALED');
      expect(aState.id).to.equal('sess_iso_1');

      // Allow 150ms for any potential rogue leakage
      await new Promise(r => setTimeout(r, 150));

      // Assert Session B received zero events from Session A
      const leakedEvents = bEvents.filter(e => e.id === 'sess_iso_1');
      expect(leakedEvents).to.have.lengthOf(0);

      // Verify Session B is still open in VOTING with its voting timer active
      const bSession = store.getState().getIn(['sessions', 'sess_iso_2']);
      expect(bSession.get('roundLifecycle')).to.equal('VOTING');
      expect(io.timerManager.getTimer('sess_iso_2')).to.be.ok;
      expect(io.timerManager.getTimer('sess_iso_2').status).to.equal('running');
    });

    it('4. Session B can continue voting and accept valid submissions while Session A is in reveal', async () => {
      const vA = registerVoter({ sessionId: 'sess_iso_1', displayName: 'VoterA', store });
      const vB = registerVoter({ sessionId: 'sess_iso_2', displayName: 'VoterB', store });

      const cA = createClientSocket({ auth: { voterToken: vA.voter.sessionToken } });
      const cB = createClientSocket({ auth: { voterToken: vB.voter.sessionToken } });

      cA.emit('subscribe_session', 'sess_iso_1');
      cB.emit('subscribe_session', 'sess_iso_2');

      await Promise.all([
        waitForSessionState(cA, s => s.id === 'sess_iso_1'),
        waitForSessionState(cB, s => s.id === 'sess_iso_2')
      ]);

      const roundIdA = roundManager.getCurrentRoundId('sess_iso_1', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_iso_1',
        roundId: roundIdA,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      // Client B casts a vote in Session B during Session A's reveal period
      cB.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_iso_2',
        entry: 'B1',
        voterToken: vB.voter.sessionToken
      });

      const updatedB = await waitForSessionState(cB, s => s.vote?.tally?.B1 === 1);
      expect(updatedB.id).to.equal('sess_iso_2');
      expect(updatedB.roundLifecycle).to.equal('VOTING');
      expect(updatedB.vote.tally.B1).to.equal(1);
    });
  });

  describe('3. Reveal Timer Synchronization & Contract Bounds', () => {
    it('5. reveal timer duration and expiresAt accurately reflect configured reveal interval', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_bounds',
        title: 'Bounds Test',
        entries: ['Opt1', 'Opt2', 'Opt3']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_bounds' });

      const round = getCurrentRound('sess_bounds', store);
      const customTm = new TimerManager();

      const timerEntry = customTm.startRevealTimer('sess_bounds', round.roundId, 2, store);
      expect(timerEntry).to.be.ok;
      expect(timerEntry.duration).to.equal(2);
      expect(timerEntry.status).to.equal('revealing');

      const expectedDelta = 2000;
      const actualDelta = timerEntry.expiresAt - timerEntry.startedAt;
      expect(actualDelta).to.equal(expectedDelta);

      customTm.clearAllTimers();
    });

    it('6. server timer exclusivity: session cannot simultaneously hold voting timer and reveal timer', () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_excl',
        title: 'Exclusivity Test',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_excl' });

      const customTm = new TimerManager();
      customTm.startTimer('sess_excl', 30, store);

      // Initially, voting timer is running and reveal timer is null
      expect(customTm.getTimer('sess_excl')).to.be.ok;
      expect(customTm.getRevealTimer('sess_excl')).to.be.null;

      const round = getCurrentRound('sess_excl', store);

      // Close round and start reveal timer
      closeRoundOnce({
        sessionId: 'sess_excl',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 2
      });

      // During reveal: reveal timer is running, voting timer MUST be null
      expect(customTm.getRevealTimer('sess_excl')).to.be.ok;
      expect(customTm.getTimer('sess_excl')).to.be.null;

      customTm.clearAllTimers();
    });
  });

  describe('4. Client Reconnect & Hydration Resilience', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_reconn',
        title: 'Reconnection Resilience',
        entries: ['Item 1', 'Item 2', 'Item 3'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_reconn' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('7. client reconnecting during reveal receives authoritative reveal state without timer reset', async () => {
      const v = registerVoter({ sessionId: 'sess_reconn', displayName: 'ReconnUser', store });
      const c1 = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });
      c1.emit('subscribe_session', 'sess_reconn');
      await waitForSessionState(c1, s => s.id === 'sess_reconn');

      const roundId = roundManager.getCurrentRoundId('sess_reconn', store);

      // Close round
      roundManager.closeRoundOnce({
        sessionId: 'sess_reconn',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      const serverRevealTimer = io.timerManager.getRevealTimer('sess_reconn');
      const originalExpiresAt = serverRevealTimer.expiresAt;

      // Disconnect client 1
      c1.disconnect();

      // Wait 150ms during reveal
      await new Promise(r => setTimeout(r, 150));

      // Reconnect with new socket connection
      const c2 = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });
      const c2StatePromise = waitForSessionState(c2, s => s.id === 'sess_reconn');
      const c2TimerPromise = waitForEvent(c2, 'timer_state');

      c2.emit('subscribe_session', 'sess_reconn');

      const [hydratedState, hydratedTimer] = await Promise.all([c2StatePromise, c2TimerPromise]);

      expect(hydratedState.roundLifecycle).to.equal('RESULTS_REVEALED');
      expect(hydratedState.finalVote).to.be.ok;
      expect(hydratedTimer.status).to.equal('revealing');
      // Verify server did not reset expiresAt
      expect(hydratedTimer.expiresAt).to.equal(originalExpiresAt);
    });

    it('8. client reconnecting ~100ms before expiration receives authoritative state without glitch', async () => {
      const v = registerVoter({ sessionId: 'sess_reconn', displayName: 'TightUser', store });
      const roundId = roundManager.getCurrentRoundId('sess_reconn', store);

      // Start reveal with duration 1s
      roundManager.closeRoundOnce({
        sessionId: 'sess_reconn',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      // Wait 850ms (approx 150ms before expiration)
      await new Promise(r => setTimeout(r, 850));

      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_reconn');

      const state = await waitForSessionState(client, s => s.id === 'sess_reconn');
      // State must be either still revealing or already advanced to next voting round
      expect(['RESULTS_REVEALED', 'VOTING']).to.include(state.roundLifecycle);
    });

    it('9. client reconnecting after reveal expiration hydrates to the new round in VOTING phase', async () => {
      const v = registerVoter({ sessionId: 'sess_reconn', displayName: 'PostUser', store });
      const roundId = roundManager.getCurrentRoundId('sess_reconn', store);

      roundManager.closeRoundOnce({
        sessionId: 'sess_reconn',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      // Wait 1.15s until reveal has definitely expired and advanced to NEXT
      await new Promise(r => setTimeout(r, 1150));

      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });
      const statePromise = waitForSessionState(client, s => s.id === 'sess_reconn');
      const timerPromise = waitForEvent(client, 'timer_state');

      client.emit('subscribe_session', 'sess_reconn');

      const [state, timer] = await Promise.all([statePromise, timerPromise]);

      expect(state.roundLifecycle).to.equal('VOTING');
      expect(state.vote.pair).to.deep.equal(['Item 3', 'Item 1']);
      expect(timer.status).to.equal('running');
    });
  });

  describe('5. Leave / Rejoin & Subscription Idempotency', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_sub',
        title: 'Subscribe Idempotency',
        entries: ['Film A', 'Film B', 'Film C'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_sub' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('10. unsubscribing during reveal does not cancel server reveal timer or advance round prematurely', async () => {
      const v = registerVoter({ sessionId: 'sess_sub', displayName: 'Leaver', store });
      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_sub');
      await waitForSessionState(client, s => s.id === 'sess_sub');

      const roundId = roundManager.getCurrentRoundId('sess_sub', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_sub',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      // Client leaves the room
      client.emit('unsubscribe_session', 'sess_sub');
      await new Promise(r => setTimeout(r, 100));

      // Verify server reveal timer is still running
      const revealTimer = io.timerManager.getRevealTimer('sess_sub');
      expect(revealTimer).to.be.ok;
      expect(revealTimer.status).to.equal('revealing');

      // Client re-subscribes
      client.emit('subscribe_session', 'sess_sub');
      const hydrated = await waitForSessionState(client, s => s.id === 'sess_sub');
      expect(hydrated.roundLifecycle).to.equal('RESULTS_REVEALED');
    });

    it('11. repeated subscribe_session calls are idempotent and do not duplicate reveal timers', async () => {
      const v = registerVoter({ sessionId: 'sess_sub', displayName: 'Repeater', store });
      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });

      // Emit subscribe_session 4 times consecutively
      client.emit('subscribe_session', 'sess_sub');
      client.emit('subscribe_session', 'sess_sub');
      client.emit('subscribe_session', 'sess_sub');
      client.emit('subscribe_session', 'sess_sub');

      await waitForSessionState(client, s => s.id === 'sess_sub');

      const roundId = roundManager.getCurrentRoundId('sess_sub', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_sub',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      // Verify exactly 1 active reveal timer exists
      expect(io.timerManager.activeRevealTimers.size).to.equal(1);
      expect(io.timerManager.getRevealTimer('sess_sub')).to.be.ok;
    });

    it('12. repeated unsubscribe_session calls do not crash server or corrupt state', async () => {
      const v = registerVoter({ sessionId: 'sess_sub', displayName: 'Unsubber', store });
      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });

      client.emit('subscribe_session', 'sess_sub');
      await waitForSessionState(client, s => s.id === 'sess_sub');

      // Repeatedly unsubscribe
      client.emit('unsubscribe_session', 'sess_sub');
      client.emit('unsubscribe_session', 'sess_sub');
      client.emit('unsubscribe_session', 'sess_sub');

      await new Promise(r => setTimeout(r, 100));

      // Server is healthy and session state is unchanged
      const session = store.getState().getIn(['sessions', 'sess_sub']);
      expect(session.get('status')).to.equal('open');
      expect(session.get('roundLifecycle')).to.equal('VOTING');
    });
  });

  describe('6. Race Conditions & Stale Callback Hardening', () => {
    it('13. stale reveal callback cannot advance a round that has already advanced', () => {
      let nextDispatchCount = 0;
      const testStore = {
        getState: () => store.getState(),
        dispatch: (action) => {
          if (action.type === 'NEXT') nextDispatchCount++;
        }
      };

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_stale',
        title: 'Stale Callback Test',
        entries: ['X', 'Y', 'Z']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_stale' });

      const round1 = initRound('sess_stale', ['X', 'Y']);
      const round2 = initRound('sess_stale', ['Z', 'X']);

      expect(getCurrentRoundId('sess_stale')).to.equal(round2.roundId);

      // Attempt to expire reveal with stale round1 ID
      const customTm = new TimerManager();
      const result = expireReveal({
        sessionId: 'sess_stale',
        roundId: round1.roundId,
        store: testStore,
        timerManager: customTm
      });

      expect(result.success).to.be.false;
      expect(result.reason).to.equal('STALE_ROUND');
      expect(nextDispatchCount).to.equal(0);
    });

    it('14. duplicate expireReveal calls dispatch NEXT exactly once', () => {
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
        sessionId: 'sess_dup_exp',
        title: 'Duplicate Expiry Test',
        entries: ['M', 'N', 'O']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_dup_exp' });

      const round = getCurrentRound('sess_dup_exp', store);
      const customTm = new TimerManager();

      closeRoundOnce({
        sessionId: 'sess_dup_exp',
        roundId: round.roundId,
        store: testStore,
        timerManager: customTm,
        revealDuration: 2
      });

      const firstExpiry = expireReveal({
        sessionId: 'sess_dup_exp',
        roundId: round.roundId,
        store: testStore,
        timerManager: customTm
      });
      expect(firstExpiry.success).to.be.true;

      const secondExpiry = expireReveal({
        sessionId: 'sess_dup_exp',
        roundId: round.roundId,
        store: testStore,
        timerManager: customTm
      });
      expect(secondExpiry.success).to.be.false;
      expect(secondExpiry.reason).to.equal('ALREADY_EXPIRED');

      expect(nextDispatchCount).to.equal(1);
      customTm.clearAllTimers();
    });

    it('15. concurrent final vote submission and timer expiry convergence triggers closure at most once', () => {
      let closeCallCount = 0;
      const customTm = new TimerManager();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_conv',
        title: 'Convergence Test',
        entries: ['P', 'Q', 'R']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_conv' });

      const round = getCurrentRound('sess_conv', store);

      // Simulate concurrent close requests
      const r1 = closeRoundOnce({
        sessionId: 'sess_conv',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 1
      });
      if (r1.success) closeCallCount++;

      const r2 = closeRoundOnce({
        sessionId: 'sess_conv',
        roundId: round.roundId,
        store,
        timerManager: customTm,
        revealDuration: 1
      });
      if (r2.success) closeCallCount++;

      expect(closeCallCount).to.equal(1);
      expect(customTm.activeRevealTimers.size).to.equal(1);
      customTm.clearAllTimers();
    });
  });

  describe('7. Final Round & Tournament Completion', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_final_tourn',
        title: 'Final Tournament Match',
        entries: ['Champion', 'Challenger'], // exactly 2 entries -> 1 round -> completion
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_final_tourn' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('16. final round results remain visible during reveal before tournament completes', async () => {
      const v = registerVoter({ sessionId: 'sess_final_tourn', displayName: 'FinalVoter', store });
      const client = createClientSocket({ auth: { voterToken: v.voter.sessionToken } });
      client.emit('subscribe_session', 'sess_final_tourn');
      await waitForSessionState(client, s => s.id === 'sess_final_tourn');

      // Cast winning vote
      client.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_final_tourn',
        entry: 'Champion',
        voterToken: v.voter.sessionToken
      });

      await waitForSessionState(client, s => s.vote?.tally?.Champion === 1);

      const roundId = roundManager.getCurrentRoundId('sess_final_tourn', store);

      // Close round
      roundManager.closeRoundOnce({
        sessionId: 'sess_final_tourn',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      // During reveal, session status MUST still be open and results revealed
      const revealState = await waitForSessionState(client, s => s.roundLifecycle === 'RESULTS_REVEALED');
      expect(revealState.status).to.equal('open');
      expect(revealState.finalVote.pair).to.deep.equal(['Champion', 'Challenger']);
      expect(revealState.finalVote.tally.Champion).to.equal(1);

      // After reveal timer expires (1.15s), session completes and winner is set
      const completedState = await waitForSessionState(client, s => s.status === 'completed', 2000);
      expect(completedState.status).to.equal('completed');
      expect(completedState.winner).to.equal('Champion');

      // Verify no voting timer is running after tournament completion
      expect(io.timerManager.getTimer('sess_final_tourn')).to.be.null;
      expect(io.timerManager.getRevealTimer('sess_final_tourn')).to.be.null;
    });
  });

  describe('8. Authoritative Result Freeze & Error Contract', () => {
    beforeEach((done) => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_freeze',
        title: 'Freeze Test',
        entries: ['Candidate 1', 'Candidate 2', 'Candidate 3'],
        timerDuration: 30
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_freeze' });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    it('17. votes during reveal are rejected with ROUND_CLOSED and do not corrupt frozen tally', async () => {
      const v1 = registerVoter({ sessionId: 'sess_freeze', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_freeze', displayName: 'V2', store });

      const c1 = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      const c2 = createClientSocket({ auth: { voterToken: v2.voter.sessionToken } });

      c1.emit('subscribe_session', 'sess_freeze');
      c2.emit('subscribe_session', 'sess_freeze');

      await Promise.all([
        waitForSessionState(c1, s => s.id === 'sess_freeze'),
        waitForSessionState(c2, s => s.id === 'sess_freeze')
      ]);

      // Valid vote before closure
      c1.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_freeze',
        entry: 'Candidate 1',
        voterToken: v1.voter.sessionToken
      });

      await waitForSessionState(c1, s => s.vote?.tally?.['Candidate 1'] === 1);

      const roundId = roundManager.getCurrentRoundId('sess_freeze', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_freeze',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      await waitForSessionState(c1, s => s.roundLifecycle === 'RESULTS_REVEALED');

      // Now client 2 attempts to vote during RESULTS_REVEALED
      const errorPromise = waitForEvent(c2, 'action_error');
      c2.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_freeze',
        entry: 'Candidate 2',
        voterToken: v2.voter.sessionToken
      });

      const err = await errorPromise;
      expect(err.action).to.equal('VOTE');
      expect(err.error).to.equal('ROUND_CLOSED');

      // Verify the session tally in store was NOT mutated
      const session = store.getState().getIn(['sessions', 'sess_freeze']);
      expect(session.getIn(['vote', 'tally', 'Candidate 1'])).to.equal(1);
      expect(session.getIn(['vote', 'tally', 'Candidate 2'])).to.be.undefined;
      expect(session.getIn(['finalVote', 'tally', 'Candidate 1'])).to.equal(1);
      expect(session.getIn(['finalVote', 'tally', 'Candidate 2'])).to.be.undefined;
    });

    it('18. error contract: ROUND_CLOSED is unicast to sending client and not broadcast to room', async () => {
      const v1 = registerVoter({ sessionId: 'sess_freeze', displayName: 'V1', store });
      const v2 = registerVoter({ sessionId: 'sess_freeze', displayName: 'V2', store });

      const c1 = createClientSocket({ auth: { voterToken: v1.voter.sessionToken } });
      const c2 = createClientSocket({ auth: { voterToken: v2.voter.sessionToken } });

      c1.emit('subscribe_session', 'sess_freeze');
      c2.emit('subscribe_session', 'sess_freeze');

      await Promise.all([
        waitForSessionState(c1, s => s.id === 'sess_freeze'),
        waitForSessionState(c2, s => s.id === 'sess_freeze')
      ]);

      const roundId = roundManager.getCurrentRoundId('sess_freeze', store);
      roundManager.closeRoundOnce({
        sessionId: 'sess_freeze',
        roundId,
        store,
        timerManager: io.timerManager,
        io,
        revealDuration: 1
      });

      await waitForSessionState(c1, s => s.roundLifecycle === 'RESULTS_REVEALED');

      let c1ReceivedError = false;
      c1.on('action_error', () => { c1ReceivedError = true; });

      const c2ErrorPromise = waitForEvent(c2, 'action_error');
      c2.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_freeze',
        entry: 'Candidate 2',
        voterToken: v2.voter.sessionToken
      });

      const err = await c2ErrorPromise;
      expect(err.error).to.equal('ROUND_CLOSED');

      await new Promise(r => setTimeout(r, 100));
      // Client 1 should NOT receive client 2's action_error
      expect(c1ReceivedError).to.be.false;
    });
  });
});
