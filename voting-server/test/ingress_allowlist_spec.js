import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import roundManager, { ROUND_LIFECYCLE } from '../src/roundManager.js';
import timerManager from '../src/timer.js';
import { clearVoters } from '../src/auth/voter.js';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin.js';

describe('Regression: socket action ingress allowlist', function() {
  this.timeout(10000);
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

  function waitForEvent(socket, eventName, timeoutMs = 3000) {
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

  function waitForActionError(socket, expectedError, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('action_error', onError);
        reject(new Error(`no action_error with ${expectedError} within ${timeoutMs}ms`));
      }, timeoutMs);

      function onError(err) {
        if (err.error === expectedError) {
          clearTimeout(timer);
          socket.off('action_error', onError);
          resolve(err);
        }
      }

      socket.on('action_error', onError);
    });
  }

  function waitForSessionState(socket, predicate, timeoutMs = 3000) {
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

  before((done) => {
    clearAdmin();
    clearVoters();
    roundManager.resetRounds();
    const admin = seedAdmin();
    adminToken = generateAdminToken(admin);
    store = makeStore();
    io = startServer(store, 0);
    port = io.httpServer.address().port;
    done();
  });

  beforeEach(() => {
    clearVoters();
    roundManager.resetRounds();
    timerManager.clearAllTimers();
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_ingress',
      title: 'Ingress',
      entries: ['A', 'B', 'C']
    });
    store.dispatch({ type: 'START_SESSION', sessionId: 'sess_ingress' });
  });

  afterEach(() => {
    while (clients.length > 0) {
      const socket = clients.pop();
      if (socket && socket.connected) {
        socket.disconnect();
      }
    }
    timerManager.clearAllTimers();
    roundManager.resetRounds();
  });

  after((done) => {
    if (io) {
      io.close(() => done());
      io = null;
    } else {
      done();
    }
  });

  it('rejects SET_ROUND_LIFECYCLE from an anonymous socket and never mutates the store', async () => {
    const socket = createClientSocket();
    const connected = waitForEvent(socket, 'connect');
    await connected;

    socket.emit('action', {
      type: 'SET_ROUND_LIFECYCLE',
      sessionId: 'sess_ingress',
      lifecycle: 'VOTING',
      roundId: 'sess_ingress:::r9',
      finalVote: { pair: ['A', 'B'], tally: { A: 999 } }
    });

    const err = await waitForActionError(socket, 'FORBIDDEN_ACTION');
    expect(err.action).to.equal('SET_ROUND_LIFECYCLE');

    const session = store.getState().getIn(['sessions', 'sess_ingress']);
    expect(session.get('roundLifecycle')).to.equal(ROUND_LIFECYCLE.VOTING);
    expect(session.get('finalVote')).to.be.undefined;
  });

  it('rejects unknown action types with FORBIDDEN_ACTION', async () => {
    const socket = createClientSocket();
    await waitForEvent(socket, 'connect');

    socket.emit('action', { type: 'TOTALWIPE', sessionId: 'sess_ingress' });
    const err = await waitForActionError(socket, 'FORBIDDEN_ACTION');
    expect(err.action).to.equal('TOTALWIPE');
  });

  it('still accepts an authorized admin action through the allowlist', async () => {
    // Re-create the session in pending so START_SESSION has visible effect
    roundManager.resetRounds();
    store.dispatch({ type: 'ARCHIVE_SESSION', sessionId: 'sess_ingress' });
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_ingress2',
      title: 'Ingress Two',
      entries: ['A', 'B', 'C']
    });

    const socket = createClientSocket({ auth: { token: adminToken } });
    await waitForEvent(socket, 'connect');
    socket.emit('subscribe_session', { sessionId: 'sess_ingress2' });

    const p = waitForSessionState(socket, (s) => s.status === 'open');
    socket.emit('action', { type: 'START_SESSION', sessionId: 'sess_ingress2' });
    await p;

    expect(store.getState().getIn(['sessions', 'sess_ingress2', 'status'])).to.equal('open');
  });
});
