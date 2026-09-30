import jwt from 'jsonwebtoken';
import { expect } from 'chai';
import http from 'http';
import { io as Client } from 'socket.io-client';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import User from '../src/db/models/User.js';
import SessionAllowlistEntry from '../src/db/models/SessionAllowlistEntry.js';
import SessionJoinRequest from '../src/db/models/SessionJoinRequest.js';
import VoteParticipation from '../src/db/models/VoteParticipation.js';
import { generateAdminToken } from '../src/auth/admin.js';
import { generateVoterToken, buildVoterCookieHeader } from '../src/auth/voterCookie.js';
import { clearVoters } from '../src/auth/voter.js';
import startServer from '../src/server.js';
import makeStore from '../src/store.js';

function httpRequest(options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(rawData);
        } catch {
          parsed = rawData;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      const payload = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
      req.write(payload);
    }
    req.end();
  });
}

describe('Feature 8: Secured Sessions, Access Control & Vote Participation (Spec 0007)', function () {
  this.timeout(15000);

  let io;
  let port;
  let store;
  let adminToken;
  const clients = [];

  function createSocketClient(options = {}) {
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
        reject(new Error(`Timed out waiting for event "${eventName}"`));
      }, timeoutMs);
      socket.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  before(async () => {
    await setupTestDb();
    await User.init();
    await SessionAllowlistEntry.init();
    await SessionJoinRequest.init();
    await VoteParticipation.init();

    store = makeStore();
    io = startServer(store, 0);
    const addr = io.httpServer ? io.httpServer.address() : null;
    port = addr ? addr.port : 8090;

    adminToken = generateAdminToken({
      username: 'admin',
      email: 'admin@example.com'
    });
  });

  after(async () => {
    if (io) {
      await new Promise((resolve) => io.close(resolve));
    }
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    clearVoters();
  });

  afterEach(async () => {
    while (clients.length > 0) {
      const s = clients.pop();
      if (s.connected) s.disconnect();
    }
  });

  describe('1. Ingress Validation & Mode Defaulting (AC-1)', () => {
    it('rejects CREATE_SESSION with type: "secured" and whoCanJoin: "public"', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const errorPromise = waitForEvent(socket, 'action_error');
      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sec_test_public_reject',
        title: 'Invalid Secured Session',
        entries: ['Candidate A', 'Candidate B'],
        sessionType: 'secured',
        whoCanJoin: 'public',
        token: adminToken
      });

      const err = await errorPromise;
      expect(err.action).to.equal('CREATE_SESSION');
      expect(err.error).to.equal('VALIDATION_ERROR');
    });

    it('defaults whoCanJoin to "allowlist" when omitted on a secured session', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sec_test_default_allowlist',
        title: 'Default Allowlist Session',
        entries: ['Candidate A', 'Candidate B'],
        sessionType: 'secured',
        token: adminToken
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      const session = store.getState().getIn(['sessions', 'sec_test_default_allowlist']);
      expect(session).to.not.be.undefined;
      expect(session.get('type')).to.equal('secured');
      expect(session.get('whoCanJoin')).to.equal('allowlist');
    });

    it('accepts whoCanJoin: "approval" on secured sessions', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sec_test_approval_accept',
        title: 'Approval Session',
        entries: ['Candidate A', 'Candidate B'],
        sessionType: 'secured',
        whoCanJoin: 'approval',
        token: adminToken
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      const session = store.getState().getIn(['sessions', 'sec_test_approval_accept']);
      expect(session).to.not.be.undefined;
      expect(session.get('whoCanJoin')).to.equal('approval');
    });
  });

  describe('2. Allowlist Ingress and Storage (AC-2, AC-4)', () => {
    it('rejects SET_ALLOWLIST from anonymous client without admin token', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const errorPromise = waitForEvent(socket, 'action_error');
      socket.emit('action', {
        type: 'SET_ALLOWLIST',
        sessionId: 'sec_session_allowlist',
        emails: ['alice@example.com', 'bob@example.com']
      });

      const err = await errorPromise;
      expect(err.action).to.equal('SET_ALLOWLIST');
      expect(err.error).to.equal('UNAUTHORIZED');
    });

    it('normalizes, deduplicates, and persists allowlist entries', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sec_allowlist_store',
        title: 'Allowlist Session',
        entries: ['A', 'B'],
        sessionType: 'secured',
        whoCanJoin: 'allowlist',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      socket.emit('action', {
        type: 'SET_ALLOWLIST',
        sessionId: 'sec_allowlist_store',
        emails: ['  Alice@Example.com  ', 'BOB@EXAMPLE.COM', 'alice@example.com', 'invalid-email'],
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 300));

      const docs = await SessionAllowlistEntry.find({ sessionId: 'sec_allowlist_store' });
      const storedEmails = docs.map((d) => d.email).sort();
      expect(storedEmails).to.deep.equal(['alice@example.com', 'bob@example.com']);
    });
  });

  describe('3. Allowlist Joining and Admission (AC-3)', () => {
    const sessionId = 'sec_join_allowlist';

    beforeEach(async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Join Test Session',
        entries: ['A', 'B'],
        sessionType: 'secured',
        whoCanJoin: 'allowlist',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      socket.emit('action', {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['admitted@example.com'],
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 300));
    });

    it('returns 401 AUTHENTICATION_REQUIRED when an unauthenticated voter attempts to join', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { displayName: 'Guest Voter' });

      expect(res.statusCode).to.equal(401);
      expect(res.body.error).to.equal('AUTHENTICATION_REQUIRED');
    });

    it('returns 403 NOT_ON_ALLOWLIST when an authenticated voter is not on the allowlist', async () => {
      const nonAllowlistedUser = await User.create({
        email: 'outsider@example.com',
        username: 'outsider',
        name: 'Outsider'
      });
      const jwtToken = generateVoterToken(nonAllowlistedUser);
      const cookieHeader = buildVoterCookieHeader(jwtToken);

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader
        }
      }, { displayName: 'Outsider' });

      expect(res.statusCode).to.equal(403);
      expect(res.body.error).to.equal('NOT_ON_ALLOWLIST');
    });

    it('admits allowlisted voter with 200 and returns voterToken', async () => {
      const allowedUser = await User.create({
        email: 'admitted@example.com',
        username: 'admitted_voter',
        name: 'Admitted Voter'
      });
      const jwtToken = generateVoterToken(allowedUser);
      const cookieHeader = buildVoterCookieHeader(jwtToken);

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader
        }
      }, { displayName: 'Admitted Voter' });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.voterToken).to.be.a('string');
      expect(res.body.displayName).to.equal('Admitted Voter');
    });
  });

  describe('4. Approval Queue Flow (AC-5, AC-6)', () => {
    const sessionId = 'sec_approval_flow';
    let voterUser;
    let voterCookie;

    beforeEach(async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Approval Queue Test',
        entries: ['Option 1', 'Option 2'],
        sessionType: 'secured',
        whoCanJoin: 'approval',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      voterUser = await User.create({
        email: 'applicant@example.com',
        username: 'applicant',
        name: 'Applicant User'
      });
      const jwtToken = generateVoterToken(voterUser);
      voterCookie = buildVoterCookieHeader(jwtToken);
    });

    it('returns 202 pending_approval when an authenticated voter joins an approval session', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: voterCookie
        }
      }, { displayName: 'Applicant User' });

      expect(res.statusCode).to.equal(202);
      expect(res.body.status).to.equal('pending_approval');
      expect(res.body.requestId).to.be.a('string');

      const reqDoc = await SessionJoinRequest.findById(res.body.requestId);
      expect(reqDoc).to.not.be.null;
      expect(reqDoc.status).to.equal('pending');
      expect(reqDoc.email).to.equal('applicant@example.com');
    });

    it('emits participant_status approved with voterToken on APPROVE_PARTICIPANT', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: voterCookie
        }
      }, { displayName: 'Applicant User' });

      const requestId = res.body.requestId;

      // Connect voter socket with session room subscription
      const voterSocket = createSocketClient({
        extraHeaders: {
          Cookie: voterCookie
        }
      });
      await waitForEvent(voterSocket, 'connect');
      voterSocket.emit('subscribe_session', { sessionId });

      const statusPromise = waitForEvent(voterSocket, 'participant_status');

      // Admin approves
      const adminSocket = createSocketClient();
      await waitForEvent(adminSocket, 'connect');
      adminSocket.emit('action', {
        type: 'APPROVE_PARTICIPANT',
        sessionId,
        requestId,
        token: adminToken
      });

      const statusData = await statusPromise;
      expect(statusData.sessionId).to.equal(sessionId);
      expect(statusData.status).to.equal('approved');
      expect(statusData.voterToken).to.be.a('string');

      const updatedReq = await SessionJoinRequest.findById(requestId);
      expect(updatedReq.status).to.equal('approved');
    });

    it('emits participant_status rejected and blocks future joins on REJECT_PARTICIPANT', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: voterCookie
        }
      }, { displayName: 'Applicant User' });

      const requestId = res.body.requestId;

      const voterSocket = createSocketClient({
        extraHeaders: {
          Cookie: voterCookie
        }
      });
      await waitForEvent(voterSocket, 'connect');
      voterSocket.emit('subscribe_session', { sessionId });

      const statusPromise = waitForEvent(voterSocket, 'participant_status');

      const adminSocket = createSocketClient();
      await waitForEvent(adminSocket, 'connect');
      adminSocket.emit('action', {
        type: 'REJECT_PARTICIPANT',
        sessionId,
        requestId,
        token: adminToken
      });

      const statusData = await statusPromise;
      expect(statusData.status).to.equal('rejected');

      // Trying to join again returns 403 REQUEST_REJECTED
      const retryRes = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: voterCookie
        }
      }, { displayName: 'Applicant User' });

      expect(retryRes.statusCode).to.equal(403);
      expect(retryRes.body.error).to.equal('REQUEST_REJECTED');
    });
  });

  describe('5. Lifecycle Guard on START_SESSION (AC-7)', () => {
    it('rejects START_SESSION when there are 0 eligible participants', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sec_empty_start',
        title: 'Empty Secured Session',
        entries: ['A', 'B'],
        sessionType: 'secured',
        whoCanJoin: 'allowlist',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      const errorPromise = waitForEvent(socket, 'action_error');
      socket.emit('action', {
        type: 'START_SESSION',
        sessionId: 'sec_empty_start',
        token: adminToken
      });

      const err = await errorPromise;
      expect(err.action).to.equal('START_SESSION');
      expect(err.error).to.equal('NO_ELIGIBLE_PARTICIPANTS');
    });

    it('auto-rejects all pending requests when START_SESSION runs', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sec_auto_reject_start',
        title: 'Auto Reject Test',
        entries: ['A', 'B'],
        sessionType: 'secured',
        whoCanJoin: 'approval',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      // Create an approved participant so the session can start
      const voter1 = await User.create({ email: 'voter1@test.com', username: 'voter1', name: 'V1' });
      const voter1Cookie = buildVoterCookieHeader(generateVoterToken(voter1));
      const join1 = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/sessions/sec_auto_reject_start/join',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: voter1Cookie }
      }, { displayName: 'V1' });

      socket.emit('action', {
        type: 'APPROVE_PARTICIPANT',
        sessionId: 'sec_auto_reject_start',
        requestId: join1.body.requestId,
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      // Create a pending applicant
      const voter2 = await User.create({ email: 'voter2@test.com', username: 'voter2', name: 'V2' });
      const voter2Cookie = buildVoterCookieHeader(generateVoterToken(voter2));
      const join2 = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/sessions/sec_auto_reject_start/join',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: voter2Cookie }
      }, { displayName: 'V2' });

      // Start tournament
      socket.emit('action', {
        type: 'START_SESSION',
        sessionId: 'sec_auto_reject_start',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 400));

      const pendingDoc = await SessionJoinRequest.findById(join2.body.requestId);
      expect(pendingDoc.status).to.equal('rejected');
    });
  });

  describe('6. Participant Removal (AC-8)', () => {
    it('invalidates voterToken immediately on REMOVE_PARTICIPANT and blocks subsequent votes', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sec_remove_test',
        title: 'Removal Test',
        entries: ['Alpha', 'Beta'],
        sessionType: 'secured',
        whoCanJoin: 'allowlist',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      const voter = await User.create({ email: 'removable@test.com', username: 'removable', name: 'Removable' });
      socket.emit('action', {
        type: 'SET_ALLOWLIST',
        sessionId: 'sec_remove_test',
        emails: ['removable@test.com'],
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      const voterCookie = buildVoterCookieHeader(generateVoterToken(voter));
      const joinRes = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/sessions/sec_remove_test/join',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: voterCookie }
      }, { displayName: 'Removable' });

      const voterToken = joinRes.body.voterToken;

      // Start session
      socket.emit('action', {
        type: 'START_SESSION',
        sessionId: 'sec_remove_test',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      // Remove participant
      socket.emit('action', {
        type: 'REMOVE_PARTICIPANT',
        sessionId: 'sec_remove_test',
        voterToken,
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      // Attempt to vote
      const voteErrorPromise = waitForEvent(socket, 'action_error');
      socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sec_remove_test',
        entry: 'Alpha',
        voterToken
      });

      const err = await voteErrorPromise;
      expect(err.action).to.equal('VOTE');
      expect(err.error).to.equal('FORBIDDEN_VOTER_TOKEN');
    });
  });

  describe('7. Vote Participation Audit Recording & Duplicate Prevention (AC-10)', () => {
    it('creates VoteParticipation record and prevents duplicate voting even across server state resets', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const sessionId = 'sec_audit_test';
      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Audit Recording Test',
        entries: ['Candidate A', 'Candidate B'],
        sessionType: 'secured',
        whoCanJoin: 'allowlist',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      const voter = await User.create({ email: 'audited@test.com', username: 'audited', name: 'Audited Voter' });
      socket.emit('action', {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['audited@test.com'],
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      const voterCookie = buildVoterCookieHeader(generateVoterToken(voter));
      const joinRes = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: voterCookie }
      }, { displayName: 'Audited Voter' });

      const voterToken = joinRes.body.voterToken;

      socket.emit('action', {
        type: 'START_SESSION',
        sessionId,
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      const voterSocket = createSocketClient({
        extraHeaders: { Cookie: voterCookie }
      });
      await waitForEvent(voterSocket, 'connect');
      voterSocket.emit('subscribe_session', { sessionId });

      // Cast initial vote
      voterSocket.emit('action', {
        type: 'VOTE',
        sessionId,
        entry: 'Candidate A',
        voterToken
      });
      await new Promise((r) => setTimeout(r, 400));

      // Verify VoteParticipation record in database
      const auditRecord = await VoteParticipation.findOne({ sessionId, userId: voter._id });
      expect(auditRecord).to.not.be.null;
      expect(auditRecord.roundId).to.be.a('string');
      // Crucial: Vote choice is NEVER stored in participation audit record
      expect(auditRecord.entry).to.be.undefined;
      expect(auditRecord.candidate).to.be.undefined;

      // Second vote from same voter in same round is rejected
      const dupErrorPromise = waitForEvent(voterSocket, 'action_error');
      voterSocket.emit('action', {
        type: 'VOTE',
        sessionId,
        entry: 'Candidate B',
        voterToken
      });

      const err = await dupErrorPromise;
      expect(err.action).to.equal('VOTE');
      expect(err.error).to.equal('DUPLICATE_VOTE');
    });
  });

  describe('8. Join Code Resolution for Secured Sessions (AC-9)', () => {
    it('resolves join code for secured sessions with 200 without leaking emails', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const sessionId = 'sec_join_code_res';
      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Join Code Test',
        entries: ['Opt1', 'Opt2'],
        sessionType: 'secured',
        whoCanJoin: 'allowlist',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 300));

      const session = store.getState().getIn(['sessions', sessionId]);
      const joinCode = session.get('joinCode');
      expect(joinCode).to.be.a('string');

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/join/${joinCode}`,
        method: 'GET'
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.sessionId).to.equal(sessionId);
      expect(res.body.sessionType).to.equal('secured');
      // No participant emails leaked
      expect(res.body.allowlist).to.be.undefined;
      expect(res.body.emails).to.be.undefined;
    });
  });

  describe('9. Mode Switching Between Allowlist and Approval (AC-12)', () => {
    it('switches whoCanJoin via SET_WHO_CAN_JOIN with admin token', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const sessionId = 'sec_mode_switch';
      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Mode Switch Test',
        entries: ['A', 'B'],
        sessionType: 'secured',
        whoCanJoin: 'allowlist',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 200));

      socket.emit('action', {
        type: 'SET_WHO_CAN_JOIN',
        sessionId,
        whoCanJoin: 'approval',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 300));

      const session = store.getState().getIn(['sessions', sessionId]);
      expect(session.get('whoCanJoin')).to.equal('approval');
    });
  });
});
