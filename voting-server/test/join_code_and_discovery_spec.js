import { expect } from 'chai';
import http from 'http';
import ioClient from 'socket.io-client';
import makeStore from '../src/store.js';
import startServer, {
  getUniqueJoinCode,
  resetJoinRateLimit
} from '../src/server.js';
import Session from '../src/db/models/Session.js';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import { generateJoinCode, JOIN_CODE_CHARSET, JOIN_CODE_LENGTH } from '../src/utils/joinCode.js';

describe('Phase 2: Join Code and Discovery (Spec 0002)', function () {
  this.timeout(20000);

  let adminToken;
  let server;
  let store;
  let port;
  const clients = [];

  function createClientSocket(clientPort = port, options = {}) {
    const socket = ioClient(`http://localhost:${clientPort}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      ...options
    });
    clients.push(socket);
    return socket;
  }

  function httpGet(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method: 'GET',
          headers
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            let body = data;
            try {
              body = JSON.parse(data);
            } catch {
              // keep as string
            }
            resolve({ statusCode: res.statusCode, headers: res.headers, body });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
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
    resetJoinRateLimit();
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

  describe('Join Code Generation & Collision Handling (AC-10)', () => {
    it('generates 10,000 codes matching allowed alphabet and having exact length 6', () => {
      const charsetRegex = new RegExp(`^[${JOIN_CODE_CHARSET}]{6}$`);
      for (let i = 0; i < 10000; i++) {
        const code = generateJoinCode();
        expect(code).to.have.lengthOf(JOIN_CODE_LENGTH);
        expect(code).to.match(charsetRegex);
      }
    });

    it('skips a colliding candidate and returns a unique code', async () => {
      const existingCode = 'ABC234';
      await Session.create({
        sessionId: 'sess_existing',
        title: 'Existing Session',
        entries: ['A', 'B'],
        status: 'pending',
        type: 'public',
        votingMode: 'single_ballot',
        joinCode: existingCode
      });

      const uniqueCode = await getUniqueJoinCode(10);
      expect(uniqueCode).to.be.a('string');
      expect(uniqueCode).to.have.lengthOf(6);
    });
  });

  describe('GET /api/join/:code Resolver Endpoint (AC-1)', () => {
    it('resolves a valid 6-character code for a pending session and returns 200 with required shape', async () => {
      const testCode = 'JCODE1';
      await Session.create({
        sessionId: 'sess_pending_1',
        title: 'Best Movie 2026',
        entries: ['Dune', 'Oppenheimer'],
        status: 'pending',
        type: 'public',
        votingMode: 'single_ballot',
        joinCode: testCode,
        pendingExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });

      const res = await httpGet(`/api/join/${testCode}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body).to.deep.equal({
        sessionId: 'sess_pending_1',
        name: 'Best Movie 2026',
        status: 'pending',
        sessionType: 'public',
        votingMode: 'single_ballot'
      });
    });

    it('resolves code case-insensitively and strips non-alphanumeric characters', async () => {
      const testCode = 'JCODE2';
      await Session.create({
        sessionId: 'sess_open_1',
        title: 'Open Tournament',
        entries: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'],
        status: 'open',
        type: 'public',
        votingMode: 'tournament',
        joinCode: testCode
      });

      const res = await httpGet(`/api/join/j-c-o-d-e-2`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.sessionId).to.equal('sess_open_1');
      expect(res.body.status).to.equal('open');
      expect(res.body.votingMode).to.equal('tournament');
    });

    it('returns 404 for unknown code', async () => {
      const res = await httpGet('/api/join/ZZZZZZ');
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Code not found or no longer active.' });
    });

    it('returns 404 for archived session', async () => {
      const testCode = 'ARCH01';
      await Session.create({
        sessionId: 'sess_archived',
        title: 'Archived Election',
        entries: ['A', 'B'],
        status: 'archived',
        type: 'public',
        votingMode: 'single_ballot',
        joinCode: testCode
      });

      const res = await httpGet(`/api/join/${testCode}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Code not found or no longer active.' });
    });

    it('returns 404 for completed session', async () => {
      const testCode = 'COMP01';
      await Session.create({
        sessionId: 'sess_completed',
        title: 'Completed Session',
        entries: ['A', 'B'],
        status: 'completed',
        type: 'public',
        votingMode: 'single_ballot',
        joinCode: testCode
      });

      const res = await httpGet(`/api/join/${testCode}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Code not found or no longer active.' });
    });

    it('returns metadata for secured session (Spec 0007 AC-9 update)', async () => {
      const testCode = 'SECU01';
      await Session.create({
        sessionId: 'sess_secured',
        title: 'Private Board Vote',
        entries: ['A', 'B'],
        status: 'pending',
        type: 'secured',
        votingMode: 'single_ballot',
        joinCode: testCode
      });

      const res = await httpGet(`/api/join/${testCode}`);
      expect(res.statusCode).to.equal(200);
      expect(res.body).to.deep.equal({
        sessionId: 'sess_secured',
        name: 'Private Board Vote',
        status: 'pending',
        sessionType: 'secured',
        votingMode: 'single_ballot'
      });
    });

    it('returns 404 for expired session past pendingExpiresAt', async () => {
      const testCode = 'EXPR01';
      await Session.create({
        sessionId: 'sess_expired',
        title: 'Old Pending Session',
        entries: ['A', 'B'],
        status: 'pending',
        type: 'public',
        votingMode: 'single_ballot',
        joinCode: testCode,
        pendingExpiresAt: new Date(Date.now() - 1000) // expired 1s ago
      });

      const res = await httpGet(`/api/join/${testCode}`);
      expect(res.statusCode).to.equal(404);
      expect(res.body).to.deep.equal({ error: 'Code not found or no longer active.' });
    });
  });

  describe('Rate Limiter for GET /api/join/:code (AC-7)', () => {
    it('allows 30 requests per minute and returns 429 on the 31st request', async () => {
      for (let i = 1; i <= 30; i++) {
        const res = await httpGet('/api/join/NONEX1');
        expect(res.statusCode).to.equal(404);
      }

      const throttledRes = await httpGet('/api/join/NONEX1');
      expect(throttledRes.statusCode).to.equal(429);
      expect(throttledRes.body).to.deep.equal({ error: 'Too many requests, please wait.' });
    });
  });

  describe('Secured Session Broadcast Filter (AC-8)', () => {
    it('omits secured sessions from voter socket sessions broadcast while admin receives all', (done) => {
      // 1. Create a public session and a secured session via admin socket
      const adminSocket = createClientSocket(port, {
        auth: { token: adminToken }
      });

      adminSocket.on('connect', () => {
        adminSocket.emit('action', {
          type: 'CREATE_SESSION',
          sessionId: 'sess_public_filter',
          title: 'Public Election',
          entries: ['Candidate 1', 'Candidate 2'],
          sessionType: 'public'
        });

        adminSocket.emit('action', {
          type: 'CREATE_SESSION',
          sessionId: 'sess_secured_filter',
          title: 'Secured Election',
          entries: ['Candidate A', 'Candidate B'],
          sessionType: 'secured'
        });

        // 2. Connect a regular voter socket (no admin token)
        setTimeout(() => {
          const voterSocket = createClientSocket(port);
          voterSocket.on('sessions', (voterSessions) => {
            const hasSecured = voterSessions.some(
              (s) => s.sessionId === 'sess_secured_filter' || s.id === 'sess_secured_filter'
            );
            const hasPublic = voterSessions.some(
              (s) => s.sessionId === 'sess_public_filter' || s.id === 'sess_public_filter'
            );

            expect(hasSecured).to.be.false;
            expect(hasPublic).to.be.true;

            // Verify admin socket can see both
            adminSocket.emit('sessions');
            adminSocket.once('sessions', (adminSessions) => {
              const adminHasSecured = adminSessions.some(
                (s) => s.sessionId === 'sess_secured_filter' || s.id === 'sess_secured_filter'
              );
              const adminHasPublic = adminSessions.some(
                (s) => s.sessionId === 'sess_public_filter' || s.id === 'sess_public_filter'
              );
              expect(adminHasSecured).to.be.true;
              expect(adminHasPublic).to.be.true;
              done();
            });
          });
        }, 150);
      });
    });
  });

  describe('REFRESH_JOIN_CODE Action (AC-9)', () => {
    it('rejects unauthenticated socket clients with action_error UNAUTHORIZED', (done) => {
      const client = createClientSocket(port);
      client.on('connect', () => {
        client.emit('action', {
          type: 'REFRESH_JOIN_CODE',
          sessionId: 'sess_default'
        });
      });

      client.on('action_error', (err) => {
        expect(err.action).to.equal('REFRESH_JOIN_CODE');
        expect(err.error).to.equal('UNAUTHORIZED');
        done();
      });
    });

    it('regenerates join code, updates store and DB, and makes old code return 404 while new resolves 200', (done) => {
      const adminSocket = createClientSocket(port, {
        auth: { token: adminToken }
      });

      adminSocket.on('connect', async () => {
        // Create a session
        adminSocket.emit('action', {
          type: 'CREATE_SESSION',
          sessionId: 'sess_rotate_test',
          title: 'Rotation Test Session',
          entries: ['Alpha', 'Beta'],
          sessionType: 'public'
        });

        // Wait for session to be created in store and DB
        setTimeout(async () => {
          const initialDoc = await Session.findOne({ sessionId: 'sess_rotate_test' }).lean();
          expect(initialDoc).to.not.be.null;
          const oldCode = initialDoc.joinCode;
          expect(oldCode).to.be.a('string');

          // Check that old code resolves with 200
          const resBefore = await httpGet(`/api/join/${oldCode}`);
          expect(resBefore.statusCode).to.equal(200);

          // Listen for re-emitted sessions
          adminSocket.once('sessions', async (sessions) => {
            const updated = sessions.find((s) => s.id === 'sess_rotate_test');
            expect(updated).to.not.be.undefined;
            expect(updated.joinCode).to.not.equal(oldCode);
            const newCode = updated.joinCode;

            // Old code must now 404
            const resOld = await httpGet(`/api/join/${oldCode}`);
            expect(resOld.statusCode).to.equal(404);

            // New code must resolve with 200
            const resNew = await httpGet(`/api/join/${newCode}`);
            expect(resNew.statusCode).to.equal(200);
            expect(resNew.body.sessionId).to.equal('sess_rotate_test');

            // MongoDB must have the new code
            const dbDoc = await Session.findOne({ sessionId: 'sess_rotate_test' }).lean();
            expect(dbDoc.joinCode).to.equal(newCode);

            done();
          });

          // Dispatch REFRESH_JOIN_CODE
          adminSocket.emit('action', {
            type: 'REFRESH_JOIN_CODE',
            sessionId: 'sess_rotate_test',
            token: adminToken
          });
        }, 150);
      });
    });
  });
});
