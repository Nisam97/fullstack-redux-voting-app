import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store.js';
import startServer, { serializeSessionState } from '../src/server.js';
import roundManager, { resetRounds } from '../src/roundManager.js';
import timerManager from '../src/timer.js';
import { registerVoter, clearVoters } from '../src/auth/voter.js';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin.js';

/**
 * AC-9 regression: the frozen tally carriers (`rounds` and `finalVote`) must
 * never reach a client while a round is active, no matter when the client
 * connects. The original leak: serializeSessionState only stripped `rounds`,
 * so a fresh subscriber during the reveal window received `finalVote` with
 * the frozen tally, and the /rounds REST endpoint served the in memory list
 * unguarded. The live `vote.tally` is stripped during active rounds too
 * (AGENTS.md: tallies stay hidden during an active round); voters see their
 * own vote confirmed in the UI and the frozen tally appears at reveal.
 */

describe('AC-9 regression — frozen tally hiding across every broadcast surface', () => {
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
          // keep listening
        }
      }

      socket.on('session_state', onState);
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

  function setupSession(sessionId) {
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId,
      title: 'AC-9 Guard Session',
      entries: ['Alpha', 'Beta', 'Gamma'],
      timerDuration: 30
    });
    store.dispatch({ type: 'START_SESSION', sessionId });

    io = startServer(store, 0);
    port = io.httpServer.address().port;
    return sessionId;
  }

  async function castVotes(sessionId, counts) {
    const voters = [];
    for (let i = 0; i < counts.alpha + counts.beta; i++) {
      voters.push(registerVoter({ sessionId, displayName: `Voter${i}`, store }));
    }
    const roundId = roundManager.getCurrentRoundId(sessionId, store);
    let i = 0;
    for (let a = 0; a < counts.alpha; a++, i++) {
      store.dispatch({ type: 'VOTE', sessionId, entry: 'Alpha' });
      roundManager.recordRoundSubmission({ sessionId, roundId, sessionToken: voters[i].voter.sessionToken });
    }
    for (let b = 0; b < counts.beta; b++, i++) {
      store.dispatch({ type: 'VOTE', sessionId, entry: 'Beta' });
      roundManager.recordRoundSubmission({ sessionId, roundId, sessionToken: voters[i].voter.sessionToken });
    }
    return roundId;
  }

  it('1. fresh subscriber during VOTING receives no frozen tally carrier', async () => {
    const sessionId = setupSession('sess_ac9_voting');
    await castVotes(sessionId, { alpha: 2, beta: 1 });

    const voter = registerVoter({ sessionId, displayName: 'LateJoiner', store });
    const client = createClientSocket({ auth: { voterToken: voter.voter.sessionToken } });
    client.emit('subscribe_session', sessionId);

    const state = await waitForSessionState(client, s => s.id === sessionId && s.status === 'open');

    expect(state.roundLifecycle).to.equal('VOTING');
    expect(state).to.not.have.property('rounds');
    expect(state).to.not.have.property('finalVote');
    expect(state).to.not.have.property('revealTimer');
  });

  it('2. fresh subscriber during ROUND_CLOSED receives the settled rounds but not the unrevealed tally', async () => {
    const sessionId = setupSession('sess_ac9_closed');
    const roundId = await castVotes(sessionId, { alpha: 2, beta: 1 });

    roundManager.closeRoundOnce({
      sessionId,
      roundId,
      store,
      timerManager: io.timerManager,
      io,
      revealDuration: 2
    });

    // Move the store back to ROUND_CLOSED to model the guarded window: the
    // round is closed but the reveal has not been reached. The settled history
    // is released (AC-3), while the round's own tally stays withheld until the
    // reveal through `finalVote` and through the live `vote.tally`.
    store.dispatch({
      type: 'SET_ROUND_LIFECYCLE',
      sessionId,
      lifecycle: 'ROUND_CLOSED',
      roundId
    });

    const voter = registerVoter({ sessionId, displayName: 'MidCloseJoiner', store });
    const client = createClientSocket({ auth: { voterToken: voter.voter.sessionToken } });
    client.emit('subscribe_session', sessionId);

    const state = await waitForSessionState(client, s => s.id === sessionId && s.roundLifecycle === 'ROUND_CLOSED');

    // Carrier 1 of 3: settled history is public the moment the round closes.
    expect(state.rounds).to.have.lengthOf(1);
    expect(state.rounds[0].roundIndex).to.equal(1);
    expect(state.rounds[0].tally).to.deep.equal({ Alpha: 2, Beta: 1 });

    // Carrier 2 of 3: the just closed round's own tally is still withheld.
    expect(state).to.not.have.property('finalVote');

    // Carrier 3 of 3: the live tally is emptied, not deleted, so the vote
    // shape the client renders survives.
    expect(state.vote).to.have.property('pair');
    expect(state.vote.tally).to.deep.equal({});
  });

  it('3. reveal window delivers finalVote and rounds to the live results view (no regression)', async () => {
    const sessionId = setupSession('sess_ac9_reveal');
    const roundId = await castVotes(sessionId, { alpha: 2, beta: 1 });

    const voter = registerVoter({ sessionId, displayName: 'Watcher', store });
    const client = createClientSocket({ auth: { voterToken: voter.voter.sessionToken } });
    client.emit('subscribe_session', sessionId);

    await waitForSessionState(client, s => s.id === sessionId);

    // Two emissions race the dispatch batch: SET_ROUND_LIFECYCLE first, then
    // APPEND_ROUND_RESULT. Wait for the reveal state that carries the round.
    const revealPromise = waitForSessionState(
      client,
      s => s.roundLifecycle === 'RESULTS_REVEALED' && Array.isArray(s.rounds) && s.rounds.length > 0
    );

    roundManager.closeRoundOnce({
      sessionId,
      roundId,
      store,
      timerManager: io.timerManager,
      io,
      revealDuration: 2
    });

    const state = await revealPromise;

    expect(state.roundLifecycle).to.equal('RESULTS_REVEALED');
    expect(state.finalVote).to.exist;
    expect(state.finalVote.tally).to.deep.equal({ Alpha: 2, Beta: 1 });
    expect(state.rounds).to.have.lengthOf(1);
    expect(state.rounds[0].tally).to.deep.equal({ Alpha: 2, Beta: 1 });
  });

  it('4. GET /api/sessions/:id/rounds serves no rounds while a round is actively voting', async () => {
    const sessionId = setupSession('sess_ac9_rest');

    // Mid round: a snapshot from a previous closure sits in the rounds list
    // (simulated by the reducer append) while the round lifecycle is VOTING.
    // The REST endpoint must apply the same guard as the socket payload.
    store.dispatch({ type: 'START_SESSION', sessionId: 'sess_ac9_rest' });
    store.dispatch({
      type: 'SET_ROUND_LIFECYCLE',
      sessionId,
      lifecycle: 'VOTING',
      roundId: 'sess_ac9_rest:::r1'
    });
    store.dispatch({
      type: 'APPEND_ROUND_RESULT',
      sessionId,
      roundSnapshot: {
        roundIndex: 1,
        kind: 'pairwise',
        candidates: ['Alpha', 'Beta'],
        tally: { Alpha: 2, Beta: 1 },
        totalVotes: 3,
        closedAt: new Date().toISOString(),
        resolution: 'majority_win',
        advanced: ['Alpha']
      }
    });

    const res = await fetch(`http://localhost:${port}/api/sessions/${sessionId}/rounds`);
    const body = await res.json();

    expect(res.status).to.equal(200);
    expect(body.rounds).to.have.lengthOf(0);
  });

  it('5. GET /api/sessions/:id/rounds serves rounds once the round is revealed', async () => {
    const sessionId = setupSession('sess_ac9_revealed');

    const roundId = await castVotes(sessionId, { alpha: 2, beta: 1 });
    roundManager.closeRoundOnce({
      sessionId,
      roundId,
      store,
      timerManager: io.timerManager,
      io,
      revealDuration: 2
    });

    const res = await fetch(`http://localhost:${port}/api/sessions/${sessionId}/rounds`);
    const body = await res.json();

    expect(res.status).to.equal(200);
    // Reveal window: history is readable per AC-3.
    expect(body.rounds.length).to.be.at.least(1);
    expect(body.rounds.some(r => r.tally && r.tally.Alpha === 2)).to.equal(true);
  });

  it('6. serializeSessionState strips finalVote, rounds, and the live tally during VOTING (unit contract)', () => {
    const serialized = serializeSessionState({
      id: 's_unit',
      status: 'open',
      roundLifecycle: 'VOTING',
      rounds: [{ roundIndex: 1, tally: { A: 2 } }],
      finalVote: { pair: ['A', 'B'], tally: { A: 2, B: 1 }, closedAt: Date.now() },
      vote: { pair: ['A', 'B'], tally: { A: 2, B: 1 } }
    });

    expect(serialized).to.not.have.property('finalVote');
    expect(serialized).to.not.have.property('rounds');
    expect(serialized.vote).to.deep.equal({ pair: ['A', 'B'], tally: {} });
  });

  it('6b. serializeSessionState withholds all three carriers during TIE_PENDING (unit contract)', () => {
    const serialized = serializeSessionState({
      id: 's_unit_tie',
      status: 'open',
      roundLifecycle: 'TIE_PENDING',
      rounds: [{ roundIndex: 1, tally: { A: 2, B: 1 } }],
      finalVote: { pair: ['A', 'B'], tally: { A: 1, B: 1 }, closedAt: Date.now() },
      vote: { pair: ['A', 'B'], tally: { A: 1, B: 1 } }
    });

    // A tie awaiting an admin decision is not yet a settled outcome (AC-3), so
    // even the already closed rounds stay back until the window resolves.
    expect(serialized).to.not.have.property('rounds');
    expect(serialized).to.not.have.property('finalVote');
    expect(serialized.vote).to.deep.equal({ pair: ['A', 'B'], tally: {} });
  });

  it('6c. serializeSessionState releases rounds but keeps the tally withheld at ROUND_CLOSED (unit contract)', () => {
    const serialized = serializeSessionState({
      id: 's_unit_closed',
      status: 'open',
      roundLifecycle: 'ROUND_CLOSED',
      rounds: [{ roundIndex: 1, tally: { A: 2 } }],
      finalVote: { pair: ['A', 'B'], tally: { A: 2, B: 1 }, closedAt: Date.now() },
      vote: { pair: ['A', 'B'], tally: { A: 2, B: 1 } }
    });

    expect(serialized.rounds).to.have.lengthOf(1);
    expect(serialized).to.not.have.property('finalVote');
    expect(serialized.vote).to.deep.equal({ pair: ['A', 'B'], tally: {} });
  });

  it('6d. a recovered pending session still withholds its history during a TIE_PENDING window (unit contract)', () => {
    // Guards the recovered branch against swallowing TIE_PENDING. Recovery
    // resets a dead session to 'pending' with no live round, which would
    // otherwise look exactly like the recovered history case.
    const serialized = serializeSessionState({
      id: 's_recovered_tie',
      status: 'pending',
      roundLifecycle: 'TIE_PENDING',
      rounds: [{ roundIndex: 1, tally: { A: 2 } }],
      finalVote: { pair: ['A', 'B'], tally: { A: 1, B: 1 }, closedAt: Date.now() }
    });

    expect(serialized).to.not.have.property('rounds');
    expect(serialized).to.not.have.property('finalVote');
  });

  it('7. serializeSessionState retains finalVote and rounds during RESULTS_REVEALED (unit contract)', () => {
    const serialized = serializeSessionState({
      id: 's_unit2',
      status: 'open',
      roundLifecycle: 'RESULTS_REVEALED',
      rounds: [{ roundIndex: 1, tally: { A: 2 } }],
      finalVote: { pair: ['A', 'B'], tally: { A: 2, B: 1 }, closedAt: Date.now() }
    });

    expect(serialized).to.have.property('finalVote');
    expect(serialized).to.have.property('rounds');
  });

  it('8. serializeSessionState retains everything once the session is completed (unit contract)', () => {
    const serialized = serializeSessionState({
      id: 's_unit3',
      status: 'completed',
      roundLifecycle: 'VOTING',
      rounds: [{ roundIndex: 1, tally: { A: 2 } }],
      finalVote: { pair: ['A', 'B'], tally: { A: 2, B: 1 }, closedAt: Date.now() }
    });

    expect(serialized).to.have.property('finalVote');
    expect(serialized).to.have.property('rounds');
  });

  // The recovered case. `recoverSessionsFromDb` resets a session that was open
  // when the process died back to 'pending', because the live round is gone.
  // Every snapshot in `rounds[]` was already broadcast to everyone at the
  // moment its round closed, so withholding it after a crash leaks nothing and
  // only makes the socket and the REST read contradict the results page, which
  // renders the same persisted history.
  it('9. serializeSessionState releases settled rounds for a session recovered mid tournament, but not finalVote (unit contract)', () => {
    const serialized = serializeSessionState({
      id: 's_recovered',
      status: 'pending',
      rounds: [
        { roundIndex: 1, tally: { Alpha: 2, Beta: 1 } },
        { roundIndex: 2, tally: { Alpha: 1, Gamma: 1 } }
      ],
      finalVote: { pair: ['Alpha', 'Gamma'], tally: { Alpha: 1, Gamma: 1 }, closedAt: Date.now() }
    });

    expect(serialized).to.have.property('rounds');
    expect(serialized.rounds).to.have.lengthOf(2);
    expect(serialized.rounds[0].tally).to.deep.equal({ Alpha: 2, Beta: 1 });
    expect(serialized).to.not.have.property('finalVote');
  });

  it('10. serializeSessionState still withholds a recovered session history while a round is live (unit contract)', () => {
    const serialized = serializeSessionState({
      id: 's_recovered_live',
      status: 'pending',
      roundLifecycle: 'VOTING',
      rounds: [{ roundIndex: 1, tally: { A: 2 } }],
      vote: { pair: ['A', 'B'], tally: { A: 1 } }
    });

    expect(serialized).to.not.have.property('rounds');
    expect(serialized.vote).to.deep.equal({ pair: ['A', 'B'], tally: {} });
  });

  it('11. a pending session with no closed round is unchanged and carries no rounds (unit contract)', () => {
    const serialized = serializeSessionState({
      id: 's_pending_empty',
      status: 'pending'
    });

    expect(serialized).to.not.have.property('rounds');
    expect(serialized).to.not.have.property('finalVote');
  });

  it('12. GET /api/sessions/:id/rounds serves the settled history of a session recovered mid tournament', async () => {
    setupSession('sess_ac9_recovered_live');
    // Model recovery: a session that died mid tournament comes back 'pending'
    // with its already closed rounds still in the list.
    const pendingId = 'sess_ac9_recovered_pending';
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: pendingId,
      title: 'Recovered Mid Tournament',
      entries: ['Alpha', 'Beta', 'Gamma'],
      timerDuration: 30
    });
    store.dispatch({
      type: 'APPEND_ROUND_RESULT',
      sessionId: pendingId,
      roundSnapshot: {
        roundIndex: 1,
        kind: 'pairwise',
        candidates: ['Alpha', 'Beta'],
        tally: { Alpha: 2, Beta: 1 },
        totalVotes: 3,
        closedAt: new Date().toISOString(),
        resolution: 'majority_win',
        advanced: ['Alpha']
      }
    });

    const res = await fetch(`http://localhost:${port}/api/sessions/${pendingId}/rounds`);
    const body = await res.json();

    expect(res.status).to.equal(200);
    expect(body.rounds).to.have.lengthOf(1);
    expect(body.rounds[0].tally).to.deep.equal({ Alpha: 2, Beta: 1 });
  });
});
