import { expect } from 'chai';
import ioClient from 'socket.io-client';
import mongoose from 'mongoose';
import Session from '../src/db/models/Session.js';
import * as repository from '../src/db/repository.js';
import { persistStateChanges, recoverSessionsFromDb } from '../src/db/persistence.js';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';

describe('Stage A: Backend Persistence & Validation Hardening', function () {
  this.timeout(15000);

  let adminToken;
  let server;
  let store;
  let port;
  const clients = [];

  function createClientSocket(clientPort = port) {
    const socket = ioClient(`http://localhost:${clientPort}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
    clients.push(socket);
    return socket;
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
      server.close(() => done());
    } else {
      done();
    }
  });

  // =================================================================
  // 1. Session Mongoose Model — timerDuration Schema Validation
  // =================================================================
  describe('1. Session Model — timerDuration Schema Validation', () => {
    it('defaults timerDuration to 30 when omitted', async () => {
      const session = new Session({
        sessionId: 'sess_schema_default',
        title: 'Default Duration',
        entries: ['A', 'B']
      });
      await session.validate();
      expect(session.timerDuration).to.equal(30);
    });

    it('accepts minimum allowed value of 5', async () => {
      const session = new Session({
        sessionId: 'sess_schema_5',
        title: '5s Session',
        entries: ['A', 'B'],
        timerDuration: 5
      });
      await session.validate();
      expect(session.timerDuration).to.equal(5);
    });

    it('accepts maximum allowed value of 300', async () => {
      const session = new Session({
        sessionId: 'sess_schema_300',
        title: '300s Session',
        entries: ['A', 'B'],
        timerDuration: 300
      });
      await session.validate();
      expect(session.timerDuration).to.equal(300);
    });

    it('rejects timerDuration below 5 (< 5)', async () => {
      const session = new Session({
        sessionId: 'sess_schema_low',
        title: 'Low Duration',
        entries: ['A', 'B'],
        timerDuration: 4
      });
      try {
        await session.validate();
        expect.fail('Should have failed validation');
      } catch (err) {
        expect(err.errors.timerDuration).to.exist;
      }
    });

    it('rejects timerDuration above 300 (> 300)', async () => {
      const session = new Session({
        sessionId: 'sess_schema_high',
        title: 'High Duration',
        entries: ['A', 'B'],
        timerDuration: 301
      });
      try {
        await session.validate();
        expect.fail('Should have failed validation');
      } catch (err) {
        expect(err.errors.timerDuration).to.exist;
      }
    });
  });

  // =================================================================
  // 2. Persistence & Recovery — timerDuration
  // =================================================================
  describe('2. Persistence & Recovery — timerDuration', () => {
    it('persists newly created session with custom timerDuration to MongoDB', async () => {
      const prevState = store.getState();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_persist_timer',
        title: 'Persisted Timer',
        entries: ['Alpha', 'Beta'],
        timerDuration: 45
      });

      const currentState = store.getState();
      await persistStateChanges(prevState, currentState);
      await new Promise(resolve => setTimeout(resolve, 200));

      const doc = await repository.getSessionBySessionId('sess_persist_timer');
      expect(doc).to.exist;
      expect(doc.sessionId).to.equal('sess_persist_timer');
      expect(doc.timerDuration).to.equal(45);
    });

    it('custom timerDuration survives recovery from MongoDB', async () => {
      await repository.saveSession({
        sessionId: 'sess_recover_custom',
        title: 'Custom Recovery',
        entries: ['Entry 1', 'Entry 2'],
        status: 'pending',
        timerDuration: 60
      });

      const freshStore = makeStore();
      const recoveredCount = await recoverSessionsFromDb(freshStore);
      expect(recoveredCount).to.equal(1);

      const recoveredSession = freshStore.getState().getIn(['sessions', 'sess_recover_custom']);
      expect(recoveredSession).to.exist;
      expect(recoveredSession.get('timerDuration')).to.equal(60);
    });

    it('legacy session without timerDuration falls back safely to 30 on recovery', async () => {
      // Legacy document without timerDuration field
      await Session.create({
        sessionId: 'sess_legacy_no_timer',
        title: 'Legacy Session',
        entries: ['Old 1', 'Old 2'],
        status: 'pending'
      });

      const freshStore = makeStore();
      const recoveredCount = await recoverSessionsFromDb(freshStore);
      expect(recoveredCount).to.equal(1);

      const recoveredSession = freshStore.getState().getIn(['sessions', 'sess_legacy_no_timer']);
      expect(recoveredSession).to.exist;
      expect(recoveredSession.get('timerDuration')).to.equal(30);
    });
  });

  // =================================================================
  // 3. Authenticated Socket.io CREATE_SESSION Validation & action_error Feedback
  // =================================================================
  describe('3. Socket.io CREATE_SESSION Validation Feedback', () => {
    it('valid CREATE_SESSION request successfully creates session', (done) => {
      const socket = createClientSocket();

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_valid_socket',
        title: 'Best Director',
        entries: ['Nolan', 'Villeneuve', 'Scorsese'],
        timerDuration: 40,
        token: adminToken
      });

      setTimeout(() => {
        const session = store.getState().getIn(['sessions', 'sess_valid_socket']);
        expect(session).to.exist;
        expect(session.get('title')).to.equal('Best Director');
        expect(session.get('timerDuration')).to.equal(40);
        expect(session.get('entries').size).to.equal(3);
        done();
      }, 100);
    });

    it('rejects missing or empty title with INVALID_TITLE action_error', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('INVALID_TITLE');
        expect(err.message).to.be.a('string');
        expect(store.getState().hasIn(['sessions', 'sess_empty_title'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_empty_title',
        title: '   ',
        entries: ['A', 'B'],
        token: adminToken
      });
    });

    it('rejects fewer than 2 entries with INSUFFICIENT_ENTRIES action_error', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('INSUFFICIENT_ENTRIES');
        expect(err.message).to.be.a('string');
        expect(store.getState().hasIn(['sessions', 'sess_few_entries'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_few_entries',
        title: 'Single Entry Poll',
        entries: ['OnlyOne'],
        token: adminToken
      });
    });

    it('rejects non-string or blank entries with INVALID_ENTRIES action_error', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('INVALID_ENTRIES');
        expect(store.getState().hasIn(['sessions', 'sess_blank_entries'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_blank_entries',
        title: 'Blank Item Poll',
        entries: ['Valid A', '   '],
        token: adminToken
      });
    });

    it('rejects duplicate session ID with DUPLICATE_SESSION_ID action_error without overwriting', (done) => {
      const socket = createClientSocket();

      // First create sess_duplicate
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_duplicate',
        title: 'Original Title',
        entries: ['Original A', 'Original B'],
        timerDuration: 25
      });

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('DUPLICATE_SESSION_ID');
        expect(err.message).to.include('sess_duplicate');

        // Existing session remains untouched
        const session = store.getState().getIn(['sessions', 'sess_duplicate']);
        expect(session.get('title')).to.equal('Original Title');
        expect(session.get('timerDuration')).to.equal(25);
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_duplicate',
        title: 'Overwriting Title',
        entries: ['New A', 'New B'],
        token: adminToken
      });
    });

    it('rejects invalid timerDuration (< 5 or > 300) with INVALID_TIMER_DURATION action_error', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('INVALID_TIMER_DURATION');
        expect(store.getState().hasIn(['sessions', 'sess_bad_duration'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_bad_duration',
        title: 'Bad Duration Poll',
        entries: ['A', 'B'],
        timerDuration: 2,
        token: adminToken
      });
    });

    it('rejects invalid timerDuration type (non-integer / decimal) with INVALID_TIMER_DURATION_TYPE action_error', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('INVALID_TIMER_DURATION_TYPE');
        expect(store.getState().hasIn(['sessions', 'sess_decimal_duration'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_decimal_duration',
        title: 'Decimal Duration Poll',
        entries: ['A', 'B'],
        timerDuration: 25.5,
        token: adminToken
      });
    });

    it('rejects invalid timerDuration string type with INVALID_TIMER_DURATION_TYPE action_error', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('INVALID_TIMER_DURATION_TYPE');
        expect(store.getState().hasIn(['sessions', 'sess_string_duration'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_string_duration',
        title: 'String Duration Poll',
        entries: ['A', 'B'],
        timerDuration: '60',
        token: adminToken
      });
    });

    it('unauthenticated client receives UNAUTHORIZED action_error on CREATE_SESSION', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('UNAUTHORIZED');
        expect(store.getState().hasIn(['sessions', 'sess_unauth'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_unauth',
        title: 'Hacker Session',
        entries: ['A', 'B']
      });
    });
  });
});
