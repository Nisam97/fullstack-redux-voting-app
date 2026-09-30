import { expect } from 'chai';
import ioClient from 'socket.io-client';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import Session from '../src/db/models/Session.js';
import * as repository from '../src/db/repository.js';

/**
 * Regression specs for the second batch of review minor fixes:
 * 1. The joinCode unique index is partial (pending and open only), so a new
 *    session can reuse the code of a completed or archived session and still
 *    persist (previously the global unique index silently failed the save).
 * 2. whoCanJoin and publishResultsPublicly are validated at ingress, so a bad
 *    value is rejected with VALIDATION_ERROR before any dispatch (previously
 *    the session was created in memory and then failed Mongoose validation at
 *    persistence time, vanishing on restart).
 */

describe('Regression: session model review minors, batch 2', function () {
  this.timeout(20000);

  let adminToken;
  let server;
  let store;
  let port;
  const clients = [];

  function createClientSocket() {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
    clients.push(socket);
    return socket;
  }

  function createSessionViaSocket(socket, sessionId, extras = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for broadcast')), 8000);
      const onSessions = (sessions) => {
        const target = sessions.find((s) => s.id === sessionId);
        if (target) {
          clearTimeout(timer);
          socket.off('sessions', onSessions);
          resolve(target);
        }
      };
      socket.on('sessions', onSessions);
      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId,
        title: `Session ${sessionId}`,
        entries: ['Alpha', 'Beta'],
        token: adminToken,
        ...extras
      });
    });
  }

  before(async function () {
    this.timeout(120000);
    await setupTestDb();
  });

  after(async function () {
    this.timeout(30000);
    while (clients.length > 0) {
      const sock = clients.pop();
      if (sock && sock.connected) {
        sock.disconnect();
      }
    }
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    clearAdmin();
    seedAdmin({
      username: 'admin',
      email: 'admin@votesphere.local',
      password: 'Password123!'
    });
    adminToken = generateAdminToken({ username: 'admin', role: 'admin' });

    store = makeStore();
    server = startServer(store, 0);
    port = server.httpServer.address().port;
  });

  afterEach((done) => {
    while (clients.length > 0) {
      const sock = clients.pop();
      if (sock && sock.connected) {
        sock.disconnect();
      }
    }
    if (server && server.httpServer) {
      server.httpServer.close(done);
    } else {
      done();
    }
  });

  describe('joinCode uniqueness is scoped to pending and open sessions', () => {
    it('a pending session can persist with the same code as a completed session', async () => {
      const reusedCode = 'ARCH66'; // valid charset, no ambiguous characters

      // A completed session holding the code
      await repository.saveSession({
        sessionId: 'sess_done_with_code',
        title: 'Completed Code Holder',
        entries: ['A', 'B'],
        status: 'completed',
        joinCode: reusedCode,
        votingMode: 'single_ballot'
      });
      const heldBefore = await repository.getSessionBySessionId('sess_done_with_code');
      expect(heldBefore.joinCode).to.equal(reusedCode);

      // A new pending session reusing that code must persist. Before the
      // partial index fix this save died on the global unique index and the
      // session silently vanished from MongoDB.
      await repository.saveSession({
        sessionId: 'sess_code_reuse',
        title: 'Reusing Completed Code',
        entries: ['A', 'B'],
        status: 'pending',
        joinCode: reusedCode,
        votingMode: 'single_ballot'
      });

      const persisted = await repository.getSessionBySessionId('sess_code_reuse');
      expect(persisted).to.exist;
      expect(persisted.joinCode).to.equal(reusedCode);
      expect(persisted.status).to.equal('pending');
    });

    it('a pending session can persist with the same code as an archived session', async () => {
      const reusedCode = 'BZF4XQ';

      await repository.saveSession({
        sessionId: 'sess_archived_holder',
        title: 'Archived Code Holder',
        entries: ['A', 'B'],
        status: 'archived',
        joinCode: reusedCode,
        votingMode: 'single_ballot'
      });

      await repository.saveSession({
        sessionId: 'sess_reuse_after_archive',
        title: 'Reusing Archived Code',
        entries: ['A', 'B'],
        status: 'pending',
        joinCode: reusedCode,
        votingMode: 'single_ballot'
      });

      const persisted = await repository.getSessionBySessionId('sess_reuse_after_archive');
      expect(persisted).to.exist;
      expect(persisted.joinCode).to.equal(reusedCode);
    });

    it('still rejects a duplicate code between two pending sessions', async () => {
      await Session.init(); // Ensure the partial unique index is built
      const sharedCode = 'PND111';

      await new Session({
        sessionId: 'sess_pending_one',
        title: 'Pending One',
        entries: ['A', 'B'],
        status: 'pending',
        joinCode: sharedCode,
        votingMode: 'single_ballot'
      }).save();

      // The hard guard must still bite for two active sessions: the second
      // save with the same code is rejected at the index level.
      let duplicateRejected = false;
      try {
        await new Session({
          sessionId: 'sess_pending_two',
          title: 'Pending Two',
          entries: ['A', 'B'],
          status: 'pending',
          joinCode: sharedCode,
          votingMode: 'single_ballot'
        }).save();
      } catch (err) {
        duplicateRejected = true;
        expect(err.name).to.equal('MongoServerError');
        expect(err.code).to.equal(11000); // duplicate key
      }
      expect(duplicateRejected).to.be.true;
    });

    it('two sessions created over the socket always receive distinct codes and persist', async () => {
      const socket = createClientSocket();
      // The ingress overwrites any client-supplied joinCode with a
      // server-derived unique one, so a repeated forced code is harmless.
      const first = await createSessionViaSocket(socket, 'sess_sock_one', { joinCode: 'ZZZZZZ' });
      const second = await createSessionViaSocket(socket, 'sess_sock_two', { joinCode: 'ZZZZZZ' });

      expect(first.joinCode).to.be.a('string').with.lengthOf(6);
      expect(second.joinCode).to.be.a('string').with.lengthOf(6);
      expect(first.joinCode).to.not.equal(second.joinCode);

      const firstPersisted = await repository.getSessionBySessionId('sess_sock_one');
      const secondPersisted = await repository.getSessionBySessionId('sess_sock_two');
      expect(firstPersisted).to.exist;
      expect(secondPersisted).to.exist;
      expect(secondPersisted.joinCode).to.equal(second.joinCode);
    });
  });

  describe('whoCanJoin and publishResultsPublicly are validated at ingress', () => {
    it('rejects an unknown whoCanJoin value with VALIDATION_ERROR and creates nothing', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('VALIDATION_ERROR');
        expect(err.message).to.include('Who can join');
        // Nothing was dispatched: no session in the store, nothing in MongoDB
        expect(store.getState().hasIn(['sessions', 'sess_bad_who'])).to.be.false;
        Session.findOne({ sessionId: 'sess_bad_who' }).then((doc) => {
          expect(doc).to.be.null;
          done();
        }).catch(done);
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_bad_who',
        title: 'Bad Who Can Join',
        entries: ['A', 'B'],
        whoCanJoin: 'banana',
        token: adminToken
      });
    });

    it('rejects a non-boolean publishResultsPublicly with VALIDATION_ERROR', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('VALIDATION_ERROR');
        expect(store.getState().hasIn(['sessions', 'sess_bad_publish'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_bad_publish',
        title: 'Bad Publish Flag',
        entries: ['A', 'B'],
        publishResultsPublicly: 'yes',
        token: adminToken
      });
    });

    it('accepts each valid whoCanJoin enum value and persists it', async () => {
      const socket = createClientSocket();

      for (const [idx, value] of ['public', 'allowlist', 'approval'].entries()) {
        const created = await createSessionViaSocket(socket, `sess_who_${idx}`, {
          whoCanJoin: value
        });
        expect(created.whoCanJoin).to.equal(value);

        let persisted = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          persisted = await repository.getSessionBySessionId(`sess_who_${idx}`);
          if (persisted) break;
          await new Promise(r => setTimeout(r, 50));
        }
        expect(persisted).to.exist;
        expect(persisted.whoCanJoin).to.equal(value);
      }
    });
  });
});
