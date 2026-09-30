import { expect } from 'chai';
import ioClient from 'socket.io-client';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import reducer from '../src/reducer.js';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import { generateJoinCode, JOIN_CODE_CHARSET, JOIN_CODE_LENGTH } from '../src/utils/joinCode.js';

describe('Phase 1: Session Model Extension (Spec 0001)', function () {
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
      server.httpServer.close(done);
    } else {
      done();
    }
  });

  describe('Join Code Generator (AC-2 Primitive)', () => {
    it('generates a 6-character code matching the allowed alphabet', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateJoinCode();
        expect(code).to.be.a('string');
        expect(code).to.have.lengthOf(JOIN_CODE_LENGTH);
        for (const char of code) {
          expect(JOIN_CODE_CHARSET).to.include(char);
        }
      }
    });

    it('ensures join codes omit ambiguous characters 0, O, 1, I, L across 100 iterations (AC-2)', () => {
      const ambiguous = ['0', 'O', '1', 'I', 'L'];
      for (let i = 0; i < 100; i++) {
        const code = generateJoinCode();
        for (const badChar of ambiguous) {
          expect(code).to.not.include(badChar);
        }
      }
    });
  });

  describe('Voting Mode Derivation (AC-1)', () => {
    it('derives single_ballot when entry count is 2 to 6 candidates', (done) => {
      const socket = createClientSocket();

      socket.on('sessions', (sessions) => {
        const target = sessions.find((s) => s.id === 'sess_single_ballot');
        if (target) {
          expect(target.votingMode).to.equal('single_ballot');
          expect(target.entryCount).to.equal(4);
          expect(target.joinCode).to.be.a('string').with.lengthOf(6);
          done();
        }
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_single_ballot',
        title: 'Small Council Election',
        entries: ['Alice', 'Bob', 'Charlie', 'Dana'],
        token: adminToken
      });
    });

    it('derives single_ballot at exact boundary of 2 and 6 candidates', (done) => {
      const socket = createClientSocket();
      let count = 0;

      socket.on('sessions', (sessions) => {
        const s2 = sessions.find((s) => s.id === 'sess_bound_2');
        const s6 = sessions.find((s) => s.id === 'sess_bound_6');
        if (s2 && s2.votingMode === 'single_ballot') count |= 1;
        if (s6 && s6.votingMode === 'single_ballot') count |= 2;
        if (count === 3) done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_bound_2',
        title: 'Two Candidates',
        entries: ['Option A', 'Option B'],
        token: adminToken
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_bound_6',
        title: 'Six Candidates',
        entries: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'],
        token: adminToken
      });
    });

    it('derives tournament when entry count is 7 or more candidates', (done) => {
      const socket = createClientSocket();

      socket.on('sessions', (sessions) => {
        const target = sessions.find((s) => s.id === 'sess_tournament_mode');
        if (target) {
          expect(target.votingMode).to.equal('tournament');
          expect(target.entryCount).to.equal(8);
          done();
        }
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_tournament_mode',
        title: 'Large Film Bracket',
        entries: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
        token: adminToken
      });
    });
  });

  describe('Ingress Validation & Error Handling (AC-3, AC-7)', () => {
    it('rejects candidateInfo item description exceeding 80 characters with VALIDATION_ERROR', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('VALIDATION_ERROR');
        expect(store.getState().hasIn(['sessions', 'sess_long_desc'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_long_desc',
        title: 'Invalid Description Poll',
        entries: ['Option A', 'Option B'],
        candidateInfo: [
          { name: 'Option A', description: 'x'.repeat(81) }
        ],
        token: adminToken
      });
    });

    it('rejects invalid session type with VALIDATION_ERROR', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('VALIDATION_ERROR');
        expect(store.getState().hasIn(['sessions', 'sess_bad_type'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_bad_type',
        title: 'Bad Type Poll',
        entries: ['Option A', 'Option B'],
        sessionType: 'unsupported_type',
        token: adminToken
      });
    });

    it('rejects out of range timerDuration and prevents session creation (AC-3)', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.code || err.error).to.include('VALIDATION_ERROR');
        expect(store.getState().hasIn(['sessions', 'sess_low_duration'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_low_duration',
        title: 'Low Duration Poll',
        entries: ['Option A', 'Option B'],
        timerDuration: 4,
        token: adminToken
      });
    });

    it('rejects candidateInfo item name exceeding 80 characters with VALIDATION_ERROR', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.error).to.equal('VALIDATION_ERROR');
        expect(store.getState().hasIn(['sessions', 'sess_long_name'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_long_name',
        title: 'Invalid Name Poll',
        entries: ['Option A', 'Option B'],
        candidateInfo: [
          { name: 'X'.repeat(81), description: 'Valid description' }
        ],
        token: adminToken
      });
    });

    it('rejects timerDuration above 300 seconds and prevents session creation (AC-3)', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('CREATE_SESSION');
        expect(err.code || err.error).to.include('VALIDATION_ERROR');
        expect(store.getState().hasIn(['sessions', 'sess_high_duration'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_high_duration',
        title: 'High Duration Poll',
        entries: ['Option A', 'Option B'],
        timerDuration: 301,
        token: adminToken
      });
    });

    it('defaults candidateInfo to [] when omitted (AC-7)', (done) => {
      const socket = createClientSocket();

      socket.on('sessions', (sessions) => {
        const target = sessions.find((s) => s.id === 'sess_no_candidate_info');
        if (target) {
          expect(target.candidateInfo).to.deep.equal([]);
          done();
        }
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_no_candidate_info',
        title: 'No Candidate Info Poll',
        entries: ['Entry 1', 'Entry 2'],
        token: adminToken
      });
    });
  });

  describe('Broadcast & Seven Fields Surface (AC-4, AC-6)', () => {
    it('includes all 7 new fields in sessions socket broadcast and sets 7-day pending expiry', (done) => {
      const socket = createClientSocket();

      socket.on('sessions', (sessions) => {
        const target = sessions.find((s) => s.id === 'sess_all_fields');
        if (target) {
          expect(target.type).to.equal('public');
          expect(target.votingMode).to.equal('single_ballot');
          expect(target.joinCode).to.be.a('string').with.lengthOf(6);
          expect(target.whoCanJoin).to.equal('public');
          expect(target.publishResultsPublicly).to.be.true;
          expect(target.candidateInfo).to.deep.equal([
            { name: 'Cand A', description: 'First candidate' },
            { name: 'Cand B', description: 'Second candidate' }
          ]);
          expect(target.pendingExpiresAt).to.exist;

          const expiryDate = new Date(target.pendingExpiresAt);
          const now = Date.now();
          const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
          expect(expiryDate.getTime()).to.be.closeTo(now + sevenDaysMs, 60000);

          done();
        }
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_all_fields',
        title: 'Rich Candidate Poll',
        entries: ['Cand A', 'Cand B'],
        candidateInfo: [
          { name: 'Cand A', description: 'First candidate' },
          { name: 'Cand B', description: 'Second candidate' }
        ],
        token: adminToken
      });
    });

    it('generates distinct unique join codes for consecutively created sessions (AC-2)', (done) => {
      const socket = createClientSocket();

      socket.on('sessions', (sessions) => {
        const s1 = sessions.find((s) => s.id === 'sess_join_1');
        const s2 = sessions.find((s) => s.id === 'sess_join_2');
        if (s1 && s2) {
          expect(s1.joinCode).to.be.a('string').with.lengthOf(6);
          expect(s2.joinCode).to.be.a('string').with.lengthOf(6);
          expect(s1.joinCode).to.not.equal(s2.joinCode);
          done();
        }
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_join_1',
        title: 'Join Code Session 1',
        entries: ['A', 'B'],
        token: adminToken
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sess_join_2',
        title: 'Join Code Session 2',
        entries: ['C', 'D'],
        token: adminToken
      });
    });

    it('stores all 7 fields in Immutable reducer state on CREATE_SESSION (AC-6)', () => {
      const initial = reducer();
      const nextState = reducer(initial, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_reducer_test',
        title: 'Reducer Unit Test',
        entries: ['Entry 1', 'Entry 2'],
        sessionType: 'secured',
        votingMode: 'single_ballot',
        joinCode: 'TEST99',
        whoCanJoin: 'allowlist',
        publishResultsPublicly: false,
        candidateInfo: [{ name: 'Entry 1', description: 'Desc 1' }],
        pendingExpiresAt: new Date(1700000000000).toISOString()
      });

      const session = nextState.getIn(['sessions', 'sess_reducer_test']);
      expect(session).to.exist;
      expect(session.get('type')).to.equal('secured');
      expect(session.get('votingMode')).to.equal('single_ballot');
      expect(session.get('joinCode')).to.equal('TEST99');
      expect(session.get('whoCanJoin')).to.equal('allowlist');
      expect(session.get('publishResultsPublicly')).to.be.false;
      expect(session.get('pendingExpiresAt')).to.equal(new Date(1700000000000).toISOString());
      expect(session.get('candidateInfo').toJS()).to.deep.equal([{ name: 'Entry 1', description: 'Desc 1' }]);
    });
  });
});
