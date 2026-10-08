import http from 'http';
import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import startServer from '../src/server.js';
import makeStore from '../src/store.js';
import * as repository from '../src/db/repository.js';
import { generateAdminToken } from '../src/auth/admin.js';
import { generateVoterToken } from '../src/auth/voterCookie.js';
import { clearVoters } from '../src/auth/voter.js';
import { Map, List } from 'immutable';
import * as roundManager from '../src/roundManager.js';
import { TimerManager } from '../src/timer.js';
import { persistCompletedResult } from '../src/db/persistence.js';
import User from '../src/db/models/User.js';
import Session from '../src/db/models/Session.js';
import SessionAllowlistEntry from '../src/db/models/SessionAllowlistEntry.js';
import SessionJoinRequest from '../src/db/models/SessionJoinRequest.js';
import VoteParticipation from '../src/db/models/VoteParticipation.js';
import Result from '../src/db/models/Result.js';

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
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

function httpGet(port, path, headers = {}) {
  return httpRequest({ hostname: 'localhost', port, path, method: 'GET', headers });
}

describe('Feature 9: Visibility and privacy (Spec 0008)', function () {
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

  function waitForEvent(socket, eventName, timeoutMs = 4000) {
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

  function createStoreSession(sessionId, { type = 'public', whoCanJoin = 'public', publishResultsPublicly } = {}) {
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId,
      title: sessionId,
      entries: ['Alpha', 'Beta'],
      sessionType: type,
      whoCanJoin,
      ...(publishResultsPublicly !== undefined ? { publishResultsPublicly } : {})
    });
  }

  async function makeUser(email, name) {
    // Username must be 3 to 20 alphanumeric/underscore characters.
    const local = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
    const username = `u_${local}`.slice(0, 20).padEnd(3, '0');
    return await User.create({ email, username, name });
  }

  async function createDbSession(sessionId, { type = 'public', whoCanJoin = 'public', status = 'completed', winner = null, publish = false } = {}) {
    return await Session.create({
      sessionId,
      title: sessionId,
      entries: ['Alpha', 'Beta'],
      status,
      type,
      whoCanJoin,
      winner,
      publishResultsPublicly: publish
    });
  }

  async function saveCompletedResult(sessionId, { type, publish, winner = 'Alpha', rounds = [] }) {
    return await repository.saveResult({
      sessionId,
      title: sessionId,
      entries: ['Alpha', 'Beta'],
      winner,
      completedAt: new Date(),
      type,
      publishResultsPublicly: publish,
      rounds
    });
  }

  before(async () => {
    await setupTestDb();
    await User.init();
    await Session.init();
    await SessionAllowlistEntry.init();
    await VoteParticipation.init();

    store = makeStore();
    io = startServer(store, 0);
    const addr = io.httpServer ? io.httpServer.address() : null;
    port = addr ? addr.port : 8090;

    adminToken = generateAdminToken({ username: 'admin', email: 'admin@example.com' });
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

  describe('1. Public results are never gated (AC-1, AC-5)', () => {
    it('serves a public completed result to an anonymous caller and lists it in history', async () => {
      createStoreSession('pub_visible', { type: 'public' });
      await saveCompletedResult('pub_visible', { type: 'public', publish: true, winner: 'Beta' });

      const result = await httpGet(port, '/api/sessions/pub_visible/result');
      expect(result.statusCode).to.equal(200);
      expect(result.body.result.winner).to.equal('Beta');
      expect(result.body.result.type).to.equal('public');

      const history = await httpGet(port, '/api/sessions/history');
      expect(history.statusCode).to.equal(200);
      expect(history.body.results.map((r) => r.sessionId)).to.include('pub_visible');
    });
  });

  describe('2. Unpublished secured results are gated (AC-2, AC-5, AC-6)', () => {
    it('returns 404 to an anonymous caller and is absent from history', async () => {
      await createDbSession('sec_hidden', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed' });
      await saveCompletedResult('sec_hidden', { type: 'secured', publish: false, winner: 'Beta' });

      const anon = await httpGet(port, '/api/sessions/sec_hidden/result');
      expect(anon.statusCode).to.equal(404);

      const anonRounds = await httpGet(port, '/api/sessions/sec_hidden/rounds');
      expect(anonRounds.statusCode).to.equal(404);

      const history = await httpGet(port, '/api/sessions/history');
      expect(history.body.results.map((r) => r.sessionId)).to.not.include('sec_hidden');
    });

    it('creates a secured session unpublished even when a client asks to publish it (AC-11)', async () => {
      // covers: AC-4, AC-6, AC-11
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'sec_force_publish',
        title: 'Force Publish Attempt',
        entries: ['Alpha', 'Beta'],
        sessionType: 'secured',
        whoCanJoin: 'allowlist',
        publishResultsPublicly: true,
        token: adminToken
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const session = store.getState().getIn(['sessions', 'sec_force_publish']);
      expect(session.get('publishResultsPublicly')).to.equal(false);

      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId: 'sec_force_publish',
        round: { roundIndex: 1, kind: 'pairwise', candidates: ['Alpha', 'Beta'], tally: { Alpha: 1, Beta: 0 }, totalVotes: 1, closedAt: new Date(), resolution: 'majority_win', advanced: null }
      });

      // A secured session that never opted out at create must not leak early.
      const anon = await httpGet(port, '/api/sessions/sec_force_publish/rounds');
      expect(anon.statusCode).to.equal(404);
    });

    it('answers a secured lobby read with the unknown id 404, not a reduced body (AC-14)', async () => {
      // Spec 0008 AC-14, an intentional contract change. This case used to
      // assert 200 with a null winner. Nulling the winner while still serving
      // the title, status, whoCanJoin, entry count and voter count still
      // confirmed the session exists, which is the hole AC-14 closes. The
      // expectation below is the new contract, not a weakened one.
      await createDbSession('sec_lobby', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', winner: 'Beta', publish: false });

      const unknown = await httpGet(port, '/api/sessions/no_such_session_at_all/lobby');
      const gated = await httpGet(port, '/api/sessions/sec_lobby/lobby');

      expect(gated.statusCode).to.equal(404);
      // Pinned explicitly, so the guarantee cannot rot into "equal to whatever
      // the other branch happens to send today". The body must not echo the
      // requested id either, or the two are only identical for one id.
      expect(unknown.body).to.deep.equal({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Session was not found.'
      });
      // Byte identical to the unknown id body: same status, same error code,
      // same message. This equality is the actual guarantee, since a caller
      // can compare the two responses.
      expect(gated.statusCode).to.equal(unknown.statusCode);
      expect(gated.body).to.deep.equal(unknown.body);

      // No field of the secured session leaks through the gated body.
      expect(JSON.stringify(gated.body)).to.not.contain('sec_lobby');
      expect(gated.body.title).to.equal(undefined);
      expect(gated.body.status).to.equal(undefined);
      expect(gated.body.whoCanJoin).to.equal(undefined);
      expect(gated.body.entryCount).to.equal(undefined);
      expect(gated.body.voterCount).to.equal(undefined);
      expect(gated.body.winner).to.equal(undefined);
    });

    it('serves a published secured lobby to an anonymous caller, with the winner (AC-14)', async () => {
      // The case the old winner gate used to stand in for. Once the gated read
      // became a 404, winner gating has to be proven on a readable session,
      // otherwise nothing would catch the winner leaking early.
      await createDbSession('sec_lobby_published', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', winner: 'Beta', publish: true });

      const lobby = await httpGet(port, '/api/sessions/sec_lobby_published/lobby');
      expect(lobby.statusCode).to.equal(200);
      expect(lobby.body.winner).to.equal('Beta');
      expect(lobby.body.type).to.equal('secured');
    });

    it('serves a secured lobby to the admin and an approved participant, never a signed in outsider (AC-14)', async () => {
      await createDbSession('sec_lobby_viewers', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', winner: 'Alpha', publish: false });
      await SessionAllowlistEntry.create({ sessionId: 'sec_lobby_viewers', email: 'lobbymember@example.com' });

      const admin = await httpGet(port, '/api/sessions/sec_lobby_viewers/lobby', { Authorization: `Bearer ${adminToken}` });
      expect(admin.statusCode).to.equal(200);
      expect(admin.body.title).to.equal('sec_lobby_viewers');
      expect(admin.body.whoCanJoin).to.equal('allowlist');
      expect(admin.body.entryCount).to.equal(2);
      expect(admin.body.winner).to.equal('Alpha');

      const member = await makeUser('lobbymember@example.com', 'Lobby Member');
      const memberCookie = `vs_voter=${generateVoterToken(member)}`;
      const participant = await httpGet(port, '/api/sessions/sec_lobby_viewers/lobby', { Cookie: memberCookie });
      expect(participant.statusCode).to.equal(200);
      expect(participant.body.winner).to.equal('Alpha');

      // A signed in non participant must not be distinguishable from anonymous.
      const outsider = await makeUser('lobbyoutsider@example.com', 'Lobby Outsider');
      const outsiderCookie = `vs_voter=${generateVoterToken(outsider)}`;
      const denied = await httpGet(port, '/api/sessions/sec_lobby_viewers/lobby', { Cookie: outsiderCookie });
      expect(denied.statusCode).to.equal(404);
      const unknown = await httpGet(port, '/api/sessions/no_such_session_at_all/lobby');
      expect(denied.body).to.deep.equal(unknown.body);
    });

    it('gates a secured lobby held only in the store, not just in MongoDB (AC-14)', async () => {
      // The in memory path is the other branch of the same route. A session
      // living in the Redux store and never written to Mongo has to be gated
      // the same way, or the gate is trivially bypassed by creating a session.
      createStoreSession('sec_lobby_live', { type: 'secured', whoCanJoin: 'allowlist' });

      const anon = await httpGet(port, '/api/sessions/sec_lobby_live/lobby');
      expect(anon.statusCode).to.equal(404);
      const unknown = await httpGet(port, '/api/sessions/no_such_session_at_all/lobby');
      expect(anon.body).to.deep.equal(unknown.body);

      const admin = await httpGet(port, '/api/sessions/sec_lobby_live/lobby', { Authorization: `Bearer ${adminToken}` });
      expect(admin.statusCode).to.equal(200);
      expect(admin.body.title).to.equal('sec_lobby_live');
    });

    it('gates an approval mode secured lobby, serving an approved request and never a pending one (AC-14)', async () => {
      // Approval mode resolves eligibility from SessionJoinRequest, not the
      // allowlist. The lobby gate calls the same shared resolver, so without
      // this case an approval mode regression would only show up on the result
      // read and the lobby would quietly serve everyone.
      await createDbSession('sec_lobby_approval', { type: 'secured', whoCanJoin: 'approval', status: 'completed', winner: 'Alpha', publish: false });

      const approved = await makeUser('lobbyapproved@example.com', 'Lobby Approved');
      const pending = await makeUser('lobbypending@example.com', 'Lobby Pending');

      await SessionJoinRequest.create({
        sessionId: 'sec_lobby_approval',
        userId: approved._id,
        email: 'lobbyapproved@example.com',
        status: 'approved'
      });
      await SessionJoinRequest.create({
        sessionId: 'sec_lobby_approval',
        userId: pending._id,
        email: 'lobbypending@example.com',
        status: 'pending'
      });

      const anon = await httpGet(port, '/api/sessions/sec_lobby_approval/lobby');
      expect(anon.statusCode).to.equal(404);
      const unknown = await httpGet(port, '/api/sessions/no_such_session_at_all/lobby');
      expect(anon.body).to.deep.equal(unknown.body);

      const approvedRead = await httpGet(port, '/api/sessions/sec_lobby_approval/lobby', { Cookie: `vs_voter=${generateVoterToken(approved)}` });
      expect(approvedRead.statusCode).to.equal(200);
      expect(approvedRead.body.whoCanJoin).to.equal('approval');

      const pendingRead = await httpGet(port, '/api/sessions/sec_lobby_approval/lobby', { Cookie: `vs_voter=${generateVoterToken(pending)}` });
      expect(pendingRead.statusCode).to.equal(404);
      expect(pendingRead.body).to.deep.equal(unknown.body);
    });

    it('denies a forged, tampered or empty voter cookie exactly as it denies an anonymous caller (AC-14)', async () => {
      // The gate must fail closed on a bad credential. A caller who cannot be
      // identified has no eligibility, so a forged cookie must not be a way in,
      // and must not produce a different answer than sending no cookie at all.
      await createDbSession('sec_lobby_forged', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', winner: 'Beta', publish: false });

      const member = await makeUser('forgedmember@example.com', 'Forged Member');
      await SessionAllowlistEntry.create({ sessionId: 'sec_lobby_forged', email: 'forgedmember@example.com' });
      const realCookie = generateVoterToken(member);
      // Flip the last characters of the signature: a token that looks real but
      // does not verify.
      const tampered = `${realCookie.slice(0, -3)}abc`;

      const unknown = await httpGet(port, '/api/sessions/no_such_session_at_all/lobby');
      const anonymous = await httpGet(port, '/api/sessions/sec_lobby_forged/lobby');
      const forged = await httpGet(port, '/api/sessions/sec_lobby_forged/lobby', { Cookie: 'vs_voter=not.a.real.token' });
      const tamperedCookie = await httpGet(port, '/api/sessions/sec_lobby_forged/lobby', { Cookie: `vs_voter=${tampered}` });
      const empty = await httpGet(port, '/api/sessions/sec_lobby_forged/lobby', { Cookie: 'vs_voter=' });

      for (const denied of [anonymous, forged, tamperedCookie, empty]) {
        expect(denied.statusCode).to.equal(404);
        expect(denied.body).to.deep.equal(unknown.body);
      }

      // Sanity: the same member with the untampered token is served, so the
      // denials above are about the credential and not about the fixture.
      const legitimate = await httpGet(port, '/api/sessions/sec_lobby_forged/lobby', { Cookie: `vs_voter=${realCookie}` });
      expect(legitimate.statusCode).to.equal(200);
      expect(legitimate.body.winner).to.equal('Beta');
    });

    it('denies a malformed or tampered admin Bearer token on the lobby (AC-14)', async () => {
      // Same fail closed rule on the other credential the route reads. A bad
      // admin token must not be treated as an admin pass, and must not leak
      // through a 500 either.
      await createDbSession('sec_lobby_badadmin', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', winner: 'Alpha', publish: false });

      const unknown = await httpGet(port, '/api/sessions/no_such_session_at_all/lobby');
      const garbage = await httpGet(port, '/api/sessions/sec_lobby_badadmin/lobby', { Authorization: 'Bearer not-a-jwt' });
      const empty = await httpGet(port, '/api/sessions/sec_lobby_badadmin/lobby', { Authorization: 'Bearer ' });

      expect(garbage.statusCode).to.equal(404);
      expect(garbage.body).to.deep.equal(unknown.body);
      expect(empty.statusCode).to.equal(404);
      expect(empty.body).to.deep.equal(unknown.body);

      const real = await httpGet(port, '/api/sessions/sec_lobby_badadmin/lobby', { Authorization: `Bearer ${adminToken}` });
      expect(real.statusCode).to.equal(200);
    });

    it('leaves a public session lobby unchanged for anonymous and signed in callers (AC-13, AC-14)', async () => {
      // The gate must not touch public sessions at all: an anonymous caller
      // still gets the full metadata and counts.
      await createDbSession('pub_lobby_anon', { type: 'public', whoCanJoin: 'public', status: 'completed', winner: 'Alpha', publish: false });

      const anon = await httpGet(port, '/api/sessions/pub_lobby_anon/lobby');
      expect(anon.statusCode).to.equal(200);
      expect(anon.body.title).to.equal('pub_lobby_anon');
      expect(anon.body.status).to.equal('completed');
      expect(anon.body.entryCount).to.equal(2);
      expect(anon.body.voterCount).to.be.a('number');
      expect(anon.body.winner).to.equal('Alpha');
      expect(anon.body.whoCanJoin).to.equal('public');

      const user = await makeUser('pubviewer@example.com', 'Public Viewer');
      const cookie = `vs_voter=${generateVoterToken(user)}`;
      const signedIn = await httpGet(port, '/api/sessions/pub_lobby_anon/lobby', { Cookie: cookie });
      expect(signedIn.statusCode).to.equal(200);
      expect(signedIn.body.winner).to.equal('Alpha');
    });

    it('gates a secured session still in progress for outsiders but serves participants and admin', async () => {
      createStoreSession('sec_live', { type: 'secured', whoCanJoin: 'allowlist' });
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId: 'sec_live',
        round: { roundIndex: 1, kind: 'pairwise', candidates: ['Alpha', 'Beta'], tally: { Alpha: 1, Beta: 0 }, totalVotes: 1, closedAt: new Date(), resolution: 'majority_win', advanced: null }
      });

      const anon = await httpGet(port, '/api/sessions/sec_live/rounds');
      expect(anon.statusCode).to.equal(404);

      const admin = await httpGet(port, '/api/sessions/sec_live/rounds', { Authorization: `Bearer ${adminToken}` });
      expect(admin.statusCode).to.equal(200);

      const user = await makeUser('liveparticipant@example.com', 'Live Participant');
      await SessionAllowlistEntry.create({ sessionId: 'sec_live', email: 'liveparticipant@example.com' });
      const cookie = `vs_voter=${generateVoterToken(user)}`;
      const participant = await httpGet(port, '/api/sessions/sec_live/rounds', { Cookie: cookie });
      expect(participant.statusCode).to.equal(200);
    });

    it('serves a completed unpublished secured result to an approved participant and the admin, never an outsider', async () => {
      await createDbSession('sec_participant', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed' });
      await saveCompletedResult('sec_participant', { type: 'secured', publish: false, winner: 'Alpha' });

      const user = await makeUser('voter@example.com', 'Voter One');
      await SessionAllowlistEntry.create({ sessionId: 'sec_participant', email: 'voter@example.com' });
      const cookie = `vs_voter=${generateVoterToken(user)}`;

      const participant = await httpGet(port, '/api/sessions/sec_participant/result', { Cookie: cookie });
      expect(participant.statusCode).to.equal(200);
      expect(participant.body.result.winner).to.equal('Alpha');

      const admin = await httpGet(port, '/api/sessions/sec_participant/result', { Authorization: `Bearer ${adminToken}` });
      expect(admin.statusCode).to.equal(200);

      const outsider = await makeUser('outsider@example.com', 'Outsider');
      const outsiderCookie = `vs_voter=${generateVoterToken(outsider)}`;
      const denied = await httpGet(port, '/api/sessions/sec_participant/result', { Cookie: outsiderCookie });
      expect(denied.statusCode).to.equal(404);
    });
  });

  describe('3. Publish / unpublish action (AC-3, AC-4)', () => {
    it('publishes a completed secured result so anyone can read it, then unpublishes it', async () => {
      await createDbSession('sec_publish', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: false });
      await saveCompletedResult('sec_publish', { type: 'secured', publish: false, winner: 'Beta' });

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const ack = new Promise((resolve) => {
        socket.emit('action', {
          type: 'SET_PUBLISH_RESULTS',
          sessionId: 'sec_publish',
          publishResultsPublicly: true,
          token: adminToken
        }, resolve);
      });
      const published = await ack;
      expect(published.success).to.equal(true);
      expect(published.publishResultsPublicly).to.equal(true);

      const anon = await httpGet(port, '/api/sessions/sec_publish/result');
      expect(anon.statusCode).to.equal(200);

      const history = await httpGet(port, '/api/sessions/history');
      expect(history.body.results.map((r) => r.sessionId)).to.include('sec_publish');

      const resultDoc = await Result.findOne({ sessionId: 'sec_publish' }).lean();
      expect(resultDoc.publishResultsPublicly).to.equal(true);
      const sessionDoc = await Session.findOne({ sessionId: 'sec_publish' }).lean();
      expect(sessionDoc.publishResultsPublicly).to.equal(true);

      const ack2 = new Promise((resolve) => {
        socket.emit('action', {
          type: 'SET_PUBLISH_RESULTS',
          sessionId: 'sec_publish',
          publishResultsPublicly: false,
          token: adminToken
        }, resolve);
      });
      const unpublished = await ack2;
      expect(unpublished.success).to.equal(true);

      const anonAgain = await httpGet(port, '/api/sessions/sec_publish/result');
      expect(anonAgain.statusCode).to.equal(404);
    });

    it('allows publishing an archived session (archiving must not strand a result)', async () => {
      await createDbSession('sec_archived', { type: 'secured', whoCanJoin: 'allowlist', status: 'archived', publish: false });
      await saveCompletedResult('sec_archived', { type: 'secured', publish: false, winner: 'Beta' });

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      const ack = new Promise((resolve) => {
        socket.emit('action', {
          type: 'SET_PUBLISH_RESULTS',
          sessionId: 'sec_archived',
          publishResultsPublicly: true,
          token: adminToken
        }, resolve);
      });
      const res = await ack;
      expect(res.success).to.equal(true);
    });

    it('rejects publishing a session that has not completed with SESSION_NOT_COMPLETED', async () => {
      createStoreSession('sec_pending', { type: 'secured', whoCanJoin: 'allowlist' });

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const ack = new Promise((resolve) => {
        socket.emit('action', {
          type: 'SET_PUBLISH_RESULTS',
          sessionId: 'sec_pending',
          publishResultsPublicly: true,
          token: adminToken
        }, resolve);
      });
      const res = await ack;
      expect(res.success).to.equal(false);
      expect(res.error).to.equal('SESSION_NOT_COMPLETED');
    });

    it('rejects a non admin socket at ingress with UNAUTHORIZED', async () => {
      createStoreSession('sec_noauth', { type: 'secured', whoCanJoin: 'allowlist' });
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const errPromise = waitForEvent(socket, 'action_error');
      socket.emit('action', {
        type: 'SET_PUBLISH_RESULTS',
        sessionId: 'sec_noauth',
        publishResultsPublicly: true
      });
      const err = await errPromise;
      expect(err.action).to.equal('SET_PUBLISH_RESULTS');
      expect(err.error).to.equal('UNAUTHORIZED');
    });

    it('acknowledges a publish so the client waits on a real answer, not a timer', async () => {
      // covers: AC-3, AC-12
      // The Results page drives the toggle from the Socket.io acknowledgement,
      // so every path this action can take has to answer. A path that only
      // emitted `action_error` would leave the control spinning until its
      // safety timeout, which is exactly the failure this pins down.
      await createDbSession('sec_ack_ok', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed' });
      await saveCompletedResult('sec_ack_ok', { type: 'secured', publish: false, winner: 'Alpha' });

      const admin = createSocketClient();
      await waitForEvent(admin, 'connect');

      const answered = (payload) => new Promise((resolve) => {
        admin.emit('action', { token: adminToken, ...payload }, resolve);
      });

      // Accepted: the answer carries the value the server stored.
      const ok = await answered({
        type: 'SET_PUBLISH_RESULTS',
        sessionId: 'sec_ack_ok',
        publishResultsPublicly: true
      });
      expect(ok.success).to.equal(true);
      expect(ok.publishResultsPublicly).to.equal(true);

      // Refused at the status gate: still an answer, not silence.
      await createDbSession('sec_ack_open', { type: 'secured', whoCanJoin: 'allowlist', status: 'open' });
      const refused = await answered({
        type: 'SET_PUBLISH_RESULTS',
        sessionId: 'sec_ack_open',
        publishResultsPublicly: true
      });
      expect(refused.success).to.equal(false);
      expect(refused.error).to.equal('SESSION_NOT_COMPLETED');
      expect(refused.message).to.be.a('string').and.not.equal('');

      // Invalid input: answered too.
      const invalid = await answered({
        type: 'SET_PUBLISH_RESULTS',
        sessionId: 'sec_ack_ok',
        publishResultsPublicly: 'yes'
      });
      expect(invalid.success).to.equal(false);
      expect(invalid.error).to.equal('VALIDATION_ERROR');

      // Rejected at ingress for want of an admin token: this is the path that
      // used to emit only, so a lapsed admin token hung the toggle.
      const anon = createSocketClient();
      await waitForEvent(anon, 'connect');
      const unauthenticated = await new Promise((resolve) => {
        anon.emit('action', {
          type: 'SET_PUBLISH_RESULTS',
          sessionId: 'sec_ack_ok',
          publishResultsPublicly: true
        }, resolve);
      });
      expect(unauthenticated.success).to.equal(false);
      expect(unauthenticated.error).to.equal('UNAUTHORIZED');
    });
  });

  describe('4. Admin turnout (AC-7, AC-8)', () => {
    it('lists every round ascending with name and email, and rejects non admins', async () => {
      createStoreSession('turnout_sess', { type: 'secured', whoCanJoin: 'allowlist' });
      const userA = await makeUser('a@example.com', 'Alice');
      const userB = await makeUser('b@example.com', 'Bob');

      await saveCompletedResult('turnout_sess', {
        type: 'secured',
        publish: false,
        winner: 'Alpha',
        rounds: [
          { roundIndex: 1, kind: 'pairwise', candidates: ['Alpha', 'Beta'], tally: { Alpha: 1, Beta: 1 }, totalVotes: 2, closedAt: new Date(), resolution: 'tie_advance', advanced: ['Alpha', 'Beta'] },
          { roundIndex: 2, kind: 'pairwise', candidates: ['Alpha', 'Beta'], tally: { Alpha: 2, Beta: 0 }, totalVotes: 2, closedAt: new Date(), resolution: 'majority_win', advanced: null }
        ]
      });

      await VoteParticipation.create({ sessionId: 'turnout_sess', roundId: 'turnout_sess:::r1', userId: userA._id });
      await VoteParticipation.create({ sessionId: 'turnout_sess', roundId: 'turnout_sess:::r1', userId: userB._id });

      const denied = await httpGet(port, '/api/sessions/turnout_sess/turnout');
      expect(denied.statusCode).to.equal(404);

      const res = await httpGet(port, '/api/sessions/turnout_sess/turnout', {
        Authorization: `Bearer ${adminToken}`
      });
      expect(res.statusCode).to.equal(200);
      expect(res.body.rounds.map((r) => r.roundIndex)).to.deep.equal([1, 2]);
      const round1 = res.body.rounds[0];
      expect(round1.voters.map((v) => v.email).sort()).to.deep.equal(['a@example.com', 'b@example.com']);
      expect(round1.voters.find((v) => v.email === 'a@example.com').name).to.equal('Alice');
      expect(res.body.rounds[1].voters).to.deep.equal([]);
      // No vote choice is ever present.
      expect(JSON.stringify(res.body)).to.not.match(/tally|advanced|resolution/);
    });

    it('pushes session_turnout to an admin socket and rejects a non admin', async () => {
      createStoreSession('turnout_live', { type: 'secured', whoCanJoin: 'allowlist' });
      const user = await makeUser('live@example.com', 'Live Voter');
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId: 'turnout_live',
        round: { roundIndex: 1, kind: 'pairwise', candidates: ['Alpha', 'Beta'], tally: { Alpha: 1, Beta: 0 }, totalVotes: 1, closedAt: new Date(), resolution: 'majority_win', advanced: null }
      });
      await VoteParticipation.create({ sessionId: 'turnout_live', roundId: 'turnout_live:::r1', userId: user._id });

      const adminSocket = createSocketClient({ auth: { token: adminToken } });
      await waitForEvent(adminSocket, 'connect');
      const turnoutPromise = waitForEvent(adminSocket, 'session_turnout');
      adminSocket.emit('subscribe_turnout', { sessionId: 'turnout_live' });
      const payload = await turnoutPromise;
      expect(payload.sessionId).to.equal('turnout_live');
      expect(payload.rounds[0].voters[0].email).to.equal('live@example.com');

      const voterSocket = createSocketClient();
      await waitForEvent(voterSocket, 'connect');
      const errPromise = waitForEvent(voterSocket, 'action_error');
      voterSocket.emit('subscribe_turnout', { sessionId: 'turnout_live' });
      const err = await errPromise;
      expect(err.error).to.equal('UNAUTHORIZED');
    });
  });

  describe('5. Result type backfill (AC-9)', () => {
    it('copies Session.type onto a legacy Result row and treats a missing session as public', async () => {
      await Session.create({
        sessionId: 'legacy_sec',
        title: 'legacy',
        entries: ['Alpha', 'Beta'],
        status: 'completed',
        type: 'secured'
      });
      // Bypass Mongoose defaults to simulate a row created before the field existed.
      await Result.collection.insertOne({
        sessionId: 'legacy_sec',
        title: 'legacy',
        entries: ['Alpha', 'Beta'],
        winner: 'Alpha',
        completedAt: new Date(),
        rounds: []
      });
      await Result.collection.insertOne({
        sessionId: 'legacy_orphan',
        title: 'orphan',
        entries: ['Alpha', 'Beta'],
        winner: 'Alpha',
        completedAt: new Date(),
        rounds: []
      });

      const summary = await repository.backfillResultTypes();
      expect(summary.backfilled).to.equal(2);

      const secured = await Result.findOne({ sessionId: 'legacy_sec' }).lean();
      expect(secured.type).to.equal('secured');
      expect(secured.publishResultsPublicly).to.equal(false);

      const orphan = await Result.findOne({ sessionId: 'legacy_orphan' }).lean();
      expect(orphan.type).to.equal('public');
      expect(orphan.publishResultsPublicly).to.equal(true);

      // Idempotent: a second run finds nothing left to backfill.
      const second = await repository.backfillResultTypes();
      expect(second.scanned).to.equal(0);
    });
  });

  describe('6. Leak guard: no email or allowlist detail on voter facing surfaces (AC-10)', () => {
    it('never emits an email shaped value on the registry, session_state, or REST reads', async () => {
      createStoreSession('leak_public', { type: 'public' });
      createStoreSession('leak_secured', { type: 'secured', whoCanJoin: 'allowlist' });
      await SessionAllowlistEntry.create({ sessionId: 'leak_secured', email: 'secret@example.com' });
      await saveCompletedResult('leak_public', { type: 'public', publish: true, winner: 'Alpha' });

      const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
      const assertNoEmail = (value, label) => {
        const serialized = JSON.stringify(value);
        expect(emailRe.test(serialized), `${label} leaked an email: ${serialized}`).to.equal(false);
      };

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      // Re-request the registry so the assertion runs on a fresh payload.
      const registry = await new Promise((resolve) => {
        socket.once('sessions', resolve);
        socket.emit('sessions');
      });
      assertNoEmail(registry, 'sessions registry');

      const statePromise = waitForEvent(socket, 'session_state');
      socket.emit('subscribe_session', { sessionId: 'leak_public' });
      const sessionState = await statePromise;
      assertNoEmail(sessionState, 'session_state');

      const sessions = await httpGet(port, '/api/sessions');
      assertNoEmail(sessions.body, 'GET /api/sessions');
      const history = await httpGet(port, '/api/sessions/history');
      assertNoEmail(history.body, 'GET /api/sessions/history');
      const rounds = await httpGet(port, '/api/sessions/leak_public/rounds');
      assertNoEmail(rounds.body, 'GET /api/sessions/:id/rounds');
      const lobby = await httpGet(port, '/api/sessions/leak_public/lobby');
      assertNoEmail(lobby.body, 'GET /api/sessions/:id/lobby');

      // Sanity: the secured session's summary is not in the voter registry at all.
      expect(registry.map((s) => s.id)).to.not.include('leak_secured');
    });

    it('carries no email on the secured lobby, on a secured session_state, or in a gated 404 body', async () => {
      // covers: AC-10
      // The guard above only walks the public surfaces. A secured session is the
      // one that actually holds an allowlist, so it is the surface where a leak
      // would happen first.
      createStoreSession('leak_secured_2', { type: 'secured', whoCanJoin: 'allowlist' });
      await SessionAllowlistEntry.create({ sessionId: 'leak_secured_2', email: 'secret2@example.com' });

      const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
      const assertNoEmail = (value, label) => {
        const serialized = JSON.stringify(value);
        expect(emailRe.test(serialized), `${label} leaked an email: ${serialized}`).to.equal(false);
      };

      const securedLobby = await httpGet(port, '/api/sessions/leak_secured_2/lobby');
      assertNoEmail(securedLobby.body, 'secured GET /api/sessions/:id/lobby');

      // An anonymous socket is refused outright on a secured session, and the
      // refusal itself must not describe the roster either.
      const anonSocket = createSocketClient();
      await waitForEvent(anonSocket, 'connect');
      const refusal = new Promise((resolve) => anonSocket.once('action_error', resolve));
      anonSocket.emit('subscribe_session', { sessionId: 'leak_secured_2' });
      const refusalBody = await refusal;
      expect(refusalBody.error).to.equal('NOT_ELIGIBLE');
      assertNoEmail(refusalBody, 'secured subscribe_session refusal');

      // An allowlisted signed in voter who has joined does get the state, so the
      // real secured payload is scanned too, not only the refusal. The secured
      // socket gate wants the server issued session token, so this goes through
      // the real join flow rather than forging one.
      const member = await makeUser('member2@example.com', 'Member Two');
      await SessionAllowlistEntry.create({ sessionId: 'leak_secured_2', email: 'member2@example.com' });
      const memberCookie = `vs_voter=${generateVoterToken(member)}`;

      const joinRes = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/sessions/leak_secured_2/join',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: memberCookie }
      }, { displayName: 'Member Two' });
      expect(joinRes.statusCode).to.equal(200);
      expect(joinRes.body.voterToken).to.be.a('string');

      const memberSocket = createSocketClient({ extraHeaders: { Cookie: memberCookie } });
      await waitForEvent(memberSocket, 'connect');
      const statePromise = waitForEvent(memberSocket, 'session_state');
      memberSocket.emit('subscribe_session', { sessionId: 'leak_secured_2', voterToken: joinRes.body.voterToken });
      const securedState = await statePromise;
      assertNoEmail(securedState, 'secured session_state');

      // A completed secured result an outsider cannot read must not describe
      // itself in the refusal either.
      await createDbSession('leak_secured_done', {
        type: 'secured', whoCanJoin: 'allowlist', status: 'completed', winner: 'Beta', publish: false
      });
      await saveCompletedResult('leak_secured_done', { type: 'secured', publish: false, winner: 'Beta' });
      const gated = await httpGet(port, '/api/sessions/leak_secured_done/result');
      expect(gated.statusCode).to.equal(404);
      assertNoEmail(gated.body, 'gated 404 body');
    });
  });

  // -------------------------------------------------------------------------
  // Gaps closed by /test on 2026-10-04. Each block below covers an acceptance
  // criterion the suite above asserted only indirectly, or only through the
  // manual /check verify pass.
  // -------------------------------------------------------------------------

  describe('7. The publish flag never gates a public session (AC-1)', () => {
    it('keeps a public result readable by anonymous callers after the flag is off on both rows', async () => {
      // covers: AC-1
      // The invariant "a public result is never gated" is only meaningful if it
      // is checked with the flag OFF. With it on, the gate is bypassed for a
      // reason that has nothing to do with session type.
      await createDbSession('pub_flag_off', { type: 'public', whoCanJoin: 'public', status: 'completed', winner: 'Beta', publish: false });
      await saveCompletedResult('pub_flag_off', {
        type: 'public',
        publish: false,
        winner: 'Beta',
        rounds: [{ roundIndex: 1, kind: 'pairwise', candidates: ['Alpha', 'Beta'], tally: { Alpha: 2, Beta: 0 }, totalVotes: 2, closedAt: new Date(), resolution: 'majority_win', advanced: null }]
      });

      const anonResult = await httpGet(port, '/api/sessions/pub_flag_off/result');
      expect(anonResult.statusCode).to.equal(200);
      expect(anonResult.body.result.winner).to.equal('Beta');
      expect(anonResult.body.result.publishResultsPublicly).to.equal(false);

      const anonRounds = await httpGet(port, '/api/sessions/pub_flag_off/rounds');
      expect(anonRounds.statusCode).to.equal(200);
      expect(anonRounds.body.rounds).to.have.lengthOf(1);

      const history = await httpGet(port, '/api/sessions/history');
      expect(history.body.results.map((r) => r.sessionId)).to.include('pub_flag_off');
    });

    it('returns the lobby winner for a public session', async () => {
      // covers: AC-1
      // The lobby gate nulls the winner for a gated secured session. A public
      // session must keep it, otherwise the archive lobby regressed quietly.
      await createDbSession('pub_lobby_win', { type: 'public', whoCanJoin: 'public', status: 'completed', winner: 'Beta', publish: false });
      const lobby = await httpGet(port, '/api/sessions/pub_lobby_win/lobby');
      expect(lobby.statusCode).to.equal(200);
      expect(lobby.body.winner).to.equal('Beta');
    });
  });

  describe('8. Approval mode eligibility, distinct from the allowlist (AC-2)', () => {
    it('serves an approved join request holder and still denies a pending one', async () => {
      // covers: AC-2
      // The suite above only exercised the allowlist path. Approval mode
      // sessions resolve eligibility from SessionJoinRequest instead, so the
      // status filter has to be pinned: approved yes, pending no.
      await createDbSession('sec_approval_mode', { type: 'secured', whoCanJoin: 'approval', status: 'completed' });
      await saveCompletedResult('sec_approval_mode', { type: 'secured', publish: false, winner: 'Alpha' });

      const approved = await makeUser('approved@example.com', 'Approved Voter');
      const pending = await makeUser('pending@example.com', 'Pending Voter');

      await SessionJoinRequest.create({
        sessionId: 'sec_approval_mode',
        userId: approved._id,
        email: 'approved@example.com',
        status: 'approved'
      });
      await SessionJoinRequest.create({
        sessionId: 'sec_approval_mode',
        userId: pending._id,
        email: 'pending@example.com',
        status: 'pending'
      });

      const approvedRead = await httpGet(port, '/api/sessions/sec_approval_mode/result', {
        Cookie: `vs_voter=${generateVoterToken(approved)}`
      });
      expect(approvedRead.statusCode).to.equal(200);
      expect(approvedRead.body.result.winner).to.equal('Alpha');

      const pendingRead = await httpGet(port, '/api/sessions/sec_approval_mode/result', {
        Cookie: `vs_voter=${generateVoterToken(pending)}`
      });
      expect(pendingRead.statusCode, 'a pending request is not an approved participant').to.equal(404);
    });

    it('answers a gated caller exactly like a session that does not exist', async () => {
      // covers: AC-2
      // The spec asks for "the same 404 a missing result returns", so the
      // existence of an unpublished secured session is not disclosed. Same
      // status, same error code, same key set, no result fields.
      await createDbSession('sec_parity', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', winner: 'Beta' });
      await saveCompletedResult('sec_parity', { type: 'secured', publish: false, winner: 'Beta' });

      const gated = await httpGet(port, '/api/sessions/sec_parity/result');
      const missing = await httpGet(port, '/api/sessions/no_such_session_at_all/result');

      expect(gated.statusCode).to.equal(404);
      expect(missing.statusCode).to.equal(404);
      expect(gated.body.error).to.equal(missing.body.error);
      expect(Object.keys(gated.body).sort()).to.deep.equal(Object.keys(missing.body).sort());
      expect(gated.body).to.not.have.property('result');
      expect(JSON.stringify(gated.body)).to.not.match(/Beta|winner|entries/);
    });
  });

  describe('9. SET_PUBLISH_RESULTS input validation and the single write step (AC-3)', () => {
    async function emitPublish(socket, sessionId, publishResultsPublicly) {
      const action = { type: 'SET_PUBLISH_RESULTS', sessionId, token: adminToken };
      if (publishResultsPublicly !== undefined) {
        action.publishResultsPublicly = publishResultsPublicly;
      }
      return await new Promise((resolve) => socket.emit('action', action, resolve));
    }

    it('rejects a publish flag that is not a boolean with VALIDATION_ERROR', async () => {
      // covers: AC-3
      // A truthy string would otherwise persist "yes" and read back as true,
      // so the boolean check has to reject rather than coerce.
      await createDbSession('sec_type_check', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed' });

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      for (const bad of ['true', 1, null, {}]) {
        const res = await emitPublish(socket, 'sec_type_check', bad);
        expect(res.success, `"${String(bad)}" must not be accepted`).to.equal(false);
        expect(res.error).to.equal('VALIDATION_ERROR');
      }

      const omitted = await emitPublish(socket, 'sec_type_check', undefined);
      expect(omitted.error).to.equal('VALIDATION_ERROR');

      const sessionDoc = await Session.findOne({ sessionId: 'sec_type_check' }).lean();
      expect(sessionDoc.publishResultsPublicly).to.equal(false);
    });

    it('rejects a blank session id with VALIDATION_ERROR', async () => {
      // covers: AC-3
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      const res = await emitPublish(socket, '   ', true);
      expect(res.success).to.equal(false);
      expect(res.error).to.equal('VALIDATION_ERROR');
    });

    it('rejects an unknown session with SESSION_NOT_FOUND', async () => {
      // covers: AC-3
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      const res = await emitPublish(socket, 'definitely_not_a_session', true);
      expect(res.success).to.equal(false);
      expect(res.error).to.equal('SESSION_NOT_FOUND');
    });

    it('writes the flag to the Session and the Result in step, both directions', async () => {
      // covers: AC-3
      // Drift between the two copies is the one real risk in denormalising the
      // flag. Asserted on unpublish as well as publish, because the false write
      // is the one a partial failure would leave stuck at true.
      await createDbSession('sec_no_drift', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: false });
      await saveCompletedResult('sec_no_drift', { type: 'secured', publish: false, winner: 'Alpha' });

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const on = await emitPublish(socket, 'sec_no_drift', true);
      expect(on.success).to.equal(true);
      expect((await Session.findOne({ sessionId: 'sec_no_drift' }).lean()).publishResultsPublicly).to.equal(true);
      expect((await Result.findOne({ sessionId: 'sec_no_drift' }).lean()).publishResultsPublicly).to.equal(true);

      const off = await emitPublish(socket, 'sec_no_drift', false);
      expect(off.success).to.equal(true);
      const offSession = await Session.findOne({ sessionId: 'sec_no_drift' }).lean();
      const offResult = await Result.findOne({ sessionId: 'sec_no_drift' }).lean();
      expect(offSession.publishResultsPublicly).to.equal(false);
      expect(offResult.publishResultsPublicly).to.equal(false);
      expect(offSession.publishResultsPublicly, 'the two copies must never drift').to.equal(offResult.publishResultsPublicly);
    });

    it('leaves both copies on the old value when the mirror write fails', async () => {
      // covers: AC-3
      // The drift the review named: a partial failure must not leave the
      // Session flipped and the Result not, or a restart rehydrates a published
      // Session into the store while /history and /result still hide it. The
      // Result row is written first and rolled back when the mirror throws.
      await createDbSession('sec_rollback', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: false });
      await saveCompletedResult('sec_rollback', { type: 'secured', publish: false, winner: 'Alpha' });

      const originalUpdateOne = Session.updateOne;
      Session.updateOne = () => { throw new Error('simulated mirror write failure'); };
      let failed = null;
      try {
        const socket = createSocketClient();
        await waitForEvent(socket, 'connect');
        failed = await new Promise((resolve) => socket.emit('action', {
          type: 'SET_PUBLISH_RESULTS', sessionId: 'sec_rollback', publishResultsPublicly: true, token: adminToken
        }, resolve));
      } finally {
        Session.updateOne = originalUpdateOne;
      }

      expect(failed.success).to.equal(false);
      expect(failed.error).to.equal('DATABASE_ERROR');

      const sessionRow = await Session.findOne({ sessionId: 'sec_rollback' }).lean();
      const resultRow = await Result.findOne({ sessionId: 'sec_rollback' }).lean();
      expect(resultRow.publishResultsPublicly, 'the Result write must be rolled back').to.equal(false);
      expect(sessionRow.publishResultsPublicly).to.equal(false);
      expect(resultRow.publishResultsPublicly, 'the two copies must never drift').to.equal(sessionRow.publishResultsPublicly);

      // The refused publish must not be visible to a reader either.
      const anon = await httpGet(port, '/api/sessions/sec_rollback/result');
      expect(anon.statusCode).to.equal(404);
    });

    it('publishes a completed session that has no Result row yet, without creating one', async () => {
      // covers: AC-3
      // The rollback only has something to undo when a Result row exists. The
      // edge that must not regress: the mirror still flips, and the write does
      // not conjure a Result row out of nothing.
      await createDbSession('sec_no_result_row', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: false });

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      const res = await new Promise((resolve) => socket.emit('action', {
        type: 'SET_PUBLISH_RESULTS', sessionId: 'sec_no_result_row', publishResultsPublicly: true, token: adminToken
      }, resolve));

      expect(res.success).to.equal(true);
      expect((await Session.findOne({ sessionId: 'sec_no_result_row' }).lean()).publishResultsPublicly).to.equal(true);
      expect(await Result.findOne({ sessionId: 'sec_no_result_row' }).lean(), 'no Result row may be invented').to.equal(null);
    });
  });

  describe('10. Publishing opens the rounds read too, and closing it closes both (AC-4)', () => {
    it('serves rounds to an anonymous caller while published and 404s them again once unpublished', async () => {
      // covers: AC-4
      // The publish round trip above only read /result. A secured result that
      // published but kept its rounds private would leak by another route.
      await createDbSession('sec_rounds_open', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: false });
      await saveCompletedResult('sec_rounds_open', {
        type: 'secured',
        publish: false,
        winner: 'Beta',
        rounds: [{ roundIndex: 1, kind: 'pairwise', candidates: ['Alpha', 'Beta'], tally: { Alpha: 1, Beta: 1 }, totalVotes: 2, closedAt: new Date(), resolution: 'tie_advance', advanced: ['Alpha', 'Beta'] }]
      });

      expect((await httpGet(port, '/api/sessions/sec_rounds_open/rounds')).statusCode).to.equal(404);

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      const publish = (value) => new Promise((resolve) => socket.emit('action', {
        type: 'SET_PUBLISH_RESULTS', sessionId: 'sec_rounds_open', publishResultsPublicly: value, token: adminToken
      }, resolve));

      expect((await publish(true)).success).to.equal(true);
      const whilePublished = await httpGet(port, '/api/sessions/sec_rounds_open/rounds');
      expect(whilePublished.statusCode).to.equal(200);
      expect(whilePublished.body.rounds).to.have.lengthOf(1);
      expect((await httpGet(port, '/api/sessions/sec_rounds_open/result')).statusCode).to.equal(200);

      expect((await publish(false)).success).to.equal(true);
      expect((await httpGet(port, '/api/sessions/sec_rounds_open/rounds')).statusCode).to.equal(404);
      expect((await httpGet(port, '/api/sessions/sec_rounds_open/result')).statusCode).to.equal(404);
    });
  });

  describe('11. History membership rules (AC-5)', () => {
    it('omits a result whose session has not completed', async () => {
      // covers: AC-5
      // An in progress session can already have a Result row written by the
      // live snapshot writer. Listing it would put an unfinished tally in the
      // archive.
      await createDbSession('sec_in_progress_row', { type: 'secured', whoCanJoin: 'allowlist', status: 'open' });
      await Result.collection.insertOne({
        sessionId: 'sec_in_progress_row',
        title: 'sec_in_progress_row',
        entries: ['Alpha', 'Beta'],
        winner: 'Alpha',
        completedAt: null,
        type: 'secured',
        publishResultsPublicly: true,
        rounds: []
      });

      const history = await httpGet(port, '/api/sessions/history');
      expect(history.statusCode).to.equal(200);
      expect(history.body.results.map((r) => r.sessionId)).to.not.include('sec_in_progress_row');
    });

    it('lists a completed public result with no official winner', async () => {
      // covers: AC-5
      // A session can conclude with no winner (`no_result`: winner null with a
      // fresh completedAt). AC-5 keys membership off completion, so the row
      // belongs in the archive; the client renders a neutral label for it. This
      // pins the filter in the direction the repository comment claims.
      await createDbSession('pub_no_winner', { type: 'public', whoCanJoin: 'public', status: 'completed', winner: null });
      await saveCompletedResult('pub_no_winner', { type: 'public', publish: true, winner: null });

      const history = await httpGet(port, '/api/sessions/history');
      expect(history.statusCode).to.equal(200);
      const row = history.body.results.find((r) => r.sessionId === 'pub_no_winner');
      expect(row, 'a completed public result with no winner must still be listed').to.not.equal(undefined);
      expect(row.winner).to.equal(null);
    });

    it('omits a completed secured result with no winner while it is unpublished', async () => {
      // covers: AC-5
      // The widened completion filter must not become a hole: the secured side
      // still needs its publish flag, winner or no winner.
      await createDbSession('sec_no_winner', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', winner: null });
      await saveCompletedResult('sec_no_winner', { type: 'secured', publish: false, winner: null });

      const ids = (await httpGet(port, '/api/sessions/history')).body.results.map((r) => r.sessionId);
      expect(ids).to.not.include('sec_no_winner');
    });

    it('lists a published secured result and drops it again on unpublish', async () => {
      // covers: AC-5
      // Membership follows the flag in both directions, asserted on the archive
      // list rather than only on the single result read.
      await createDbSession('sec_archive_member', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: false });
      await saveCompletedResult('sec_archive_member', { type: 'secured', publish: false, winner: 'Alpha' });

      const ids = async () => (await httpGet(port, '/api/sessions/history')).body.results.map((r) => r.sessionId);
      expect(await ids()).to.not.include('sec_archive_member');

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      const publish = (value) => new Promise((resolve) => socket.emit('action', {
        type: 'SET_PUBLISH_RESULTS', sessionId: 'sec_archive_member', publishResultsPublicly: value, token: adminToken
      }, resolve));

      await publish(true);
      expect(await ids()).to.include('sec_archive_member');

      await publish(false);
      expect(await ids()).to.not.include('sec_archive_member');
    });
  });

  describe('12. A live secured session denies a signed in outsider (AC-6)', () => {
    it('404s a signed in non participant while still serving the allowlisted voter and the admin', async () => {
      // covers: AC-6
      // The existing live test covered an anonymous outsider only. Signing in
      // is exactly what an attacker would do first, so the signed in path
      // needs its own assertion.
      createStoreSession('sec_live_outsider', { type: 'secured', whoCanJoin: 'allowlist' });
      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId: 'sec_live_outsider',
        round: { roundIndex: 1, kind: 'pairwise', candidates: ['Alpha', 'Beta'], tally: { Alpha: 1, Beta: 0 }, totalVotes: 1, closedAt: new Date(), resolution: 'majority_win', advanced: null }
      });

      const member = await makeUser('member@example.com', 'Member');
      await SessionAllowlistEntry.create({ sessionId: 'sec_live_outsider', email: 'member@example.com' });
      const outsider = await makeUser('stranger@example.com', 'Stranger');

      const outsiderRead = await httpGet(port, '/api/sessions/sec_live_outsider/rounds', {
        Cookie: `vs_voter=${generateVoterToken(outsider)}`
      });
      expect(outsiderRead.statusCode).to.equal(404);

      const memberRead = await httpGet(port, '/api/sessions/sec_live_outsider/rounds', {
        Cookie: `vs_voter=${generateVoterToken(member)}`
      });
      expect(memberRead.statusCode).to.equal(200);

      const adminRead = await httpGet(port, '/api/sessions/sec_live_outsider/rounds', {
        Authorization: `Bearer ${adminToken}`
      });
      expect(adminRead.statusCode).to.equal(200);
    });
  });

  describe('13. Turnout sourcing and the admin only gate (AC-7, AC-8)', () => {
    afterEach(() => {
      roundManager.resetRounds();
    });

    it('serves a live session from the round manager and derives roundId from the round index', async () => {
      // covers: AC-7
      // Turnout has two sources, the persisted Result for a completed session
      // and the round manager while it runs. Only the persisted one was
      // covered. The roundId shape is the join key against the audit trail, so
      // it is asserted literally rather than by the voter grouping happening
      // to work.
      createStoreSession('turnout_running', { type: 'secured', whoCanJoin: 'allowlist' });
      const voter = await makeUser('running@example.com', 'Running Voter');
      const round = roundManager.initRound('turnout_running', ['Alpha', 'Beta']);
      await VoteParticipation.create({ sessionId: 'turnout_running', roundId: round.roundId, userId: voter._id });

      const res = await httpGet(port, '/api/sessions/turnout_running/turnout', {
        Authorization: `Bearer ${adminToken}`
      });
      expect(res.statusCode).to.equal(200);
      expect(res.body.rounds.map((r) => r.roundIndex)).to.deep.equal([1]);
      expect(res.body.rounds[0].roundId).to.equal('turnout_running:::r1');
      expect(res.body.rounds[0].voters.map((v) => v.email)).to.deep.equal(['running@example.com']);
      expect(JSON.stringify(res.body)).to.not.match(/Alpha|tally|choice|entry/);
    });

    it('never lists an anonymous voter, because the anonymous vote is refused and leaves no audit row', async () => {
      // covers: AC-7
      // The spec's failure case. Anonymous voting is rejected outright, so an
      // anonymous voter has no identity to show and no audit row to be read
      // back from. Asserted end to end against the real socket ingress rather
      // than by inserting rows directly.
      createStoreSession('anon_turnout_sess', { type: 'public', whoCanJoin: 'public' });
      const round = roundManager.initRound('anon_turnout_sess', ['Alpha', 'Beta']);

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      const errPromise = waitForEvent(socket, 'action_error');
      socket.emit('action', {
        type: 'VOTE',
        sessionId: 'anon_turnout_sess',
        entry: 'Alpha'
      });
      const err = await errPromise;
      expect(err.action).to.equal('VOTE');
      expect(err.error).to.equal('VOTER_TOKEN_REQUIRED');

      await new Promise((r) => setTimeout(r, 300));

      const auditRows = await VoteParticipation.find({ sessionId: 'anon_turnout_sess' }).lean();
      expect(auditRows, 'a refused anonymous vote must leave no audit trail').to.have.lengthOf(0);

      const res = await httpGet(port, '/api/sessions/anon_turnout_sess/turnout', {
        Authorization: `Bearer ${adminToken}`
      });
      expect(res.statusCode).to.equal(200);
      const theRound = res.body.rounds.find((r) => r.roundIndex === round.roundIndex);
      expect(theRound.voters).to.deep.equal([]);
    });

    it('404s an approved participant and a signed in outsider on the turnout endpoint', async () => {
      // covers: AC-8
      // Being an approved participant earns the result read, never the turnout
      // read. Turnout carries emails, so it stays admin only even for the
      // people whose emails it would show.
      await createDbSession('sec_turnout_gate', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed' });
      await saveCompletedResult('sec_turnout_gate', { type: 'secured', publish: false, winner: 'Alpha', rounds: [] });

      const participant = await makeUser('participant@example.com', 'Participant');
      await SessionAllowlistEntry.create({ sessionId: 'sec_turnout_gate', email: 'participant@example.com' });
      const outsider = await makeUser('nosy@example.com', 'Nosy');

      const asParticipant = await httpGet(port, '/api/sessions/sec_turnout_gate/turnout', {
        Cookie: `vs_voter=${generateVoterToken(participant)}`
      });
      expect(asParticipant.statusCode).to.equal(404);

      const asOutsider = await httpGet(port, '/api/sessions/sec_turnout_gate/turnout', {
        Cookie: `vs_voter=${generateVoterToken(outsider)}`
      });
      expect(asOutsider.statusCode).to.equal(404);

      const asAdmin = await httpGet(port, '/api/sessions/sec_turnout_gate/turnout', {
        Authorization: `Bearer ${adminToken}`
      });
      expect(asAdmin.statusCode).to.equal(200);
    });

    it('404s a signed in voter subscribing to session_turnout over the socket', async () => {
      // covers: AC-8
      // The socket half of the admin only gate. A voter holding a valid cookie
      // is still not an admin.
      createStoreSession('turnout_sock_gate', { type: 'public', whoCanJoin: 'public' });
      const user = await makeUser('socketgate@example.com', 'Socket Gate');
      const cookie = `vs_voter=${generateVoterToken(user)}`;

      const voterSocket = createSocketClient({ extraHeaders: { Cookie: cookie } });
      await waitForEvent(voterSocket, 'connect');
      const errPromise = waitForEvent(voterSocket, 'action_error');
      voterSocket.emit('subscribe_turnout', { sessionId: 'turnout_sock_gate' });
      const err = await errPromise;
      expect(err.error).to.equal('UNAUTHORIZED');
    });

    it('404s the turnout endpoint for a session that does not exist', async () => {
      // covers: AC-8
      const res = await httpGet(port, '/api/sessions/no_such_session_turnout/turnout', {
        Authorization: `Bearer ${adminToken}`
      });
      expect(res.statusCode).to.equal(404);
      expect(res.body.error).to.equal('SESSION_NOT_FOUND');
    });
  });

  describe('14. Completion writes the visibility fields (AC-9)', () => {
    it('writes the session type onto the new result and keeps a secured result unpublished', async () => {
      // covers: AC-9
      // The backfill covers old rows. This covers new ones: the completion
      // writer is what decides a secured result is born private, so a result
      // written before the action ever runs is the row that matters.
      await createDbSession('sec_persist_new', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: false });
      const securedSession = Map({
        title: 'sec_persist_new',
        entries: List(['Alpha', 'Beta']),
        status: 'completed',
        winner: 'Alpha',
        type: 'secured'
      });

      await persistCompletedResult('sec_persist_new', securedSession);

      const securedRow = await Result.findOne({ sessionId: 'sec_persist_new' }).lean();
      expect(securedRow.type).to.equal('secured');
      expect(securedRow.publishResultsPublicly).to.equal(false);

      await createDbSession('pub_persist_new', { type: 'public', whoCanJoin: 'public', status: 'completed', publish: false });
      const publicSession = Map({
        title: 'pub_persist_new',
        entries: List(['Alpha', 'Beta']),
        status: 'completed',
        winner: 'Beta',
        type: 'public'
      });

      await persistCompletedResult('pub_persist_new', publicSession);

      const publicRow = await Result.findOne({ sessionId: 'pub_persist_new' }).lean();
      expect(publicRow.type, 'the type is sourced from the session, not defaulted').to.equal('public');
    });

    it('falls back to the session type when neither the Session row nor the store names a publish switch', async () => {
      // covers: AC-9, AC-1
      // The only path that reaches the fallback is a session with no publish
      // field anywhere. A public session then lands published, a secured one
      // lands private, which is the fail closed direction.
      await persistCompletedResult('pub_no_switch', Map({
        title: 'pub_no_switch',
        entries: List(['Alpha', 'Beta']),
        status: 'completed',
        winner: 'Alpha',
        type: 'public'
      }));

      const publicRow = await Result.findOne({ sessionId: 'pub_no_switch' }).lean();
      expect(publicRow.type).to.equal('public');
      expect(publicRow.publishResultsPublicly).to.equal(true);

      await persistCompletedResult('sec_no_switch', Map({
        title: 'sec_no_switch',
        entries: List(['Alpha', 'Beta']),
        status: 'completed',
        winner: 'Alpha',
        type: 'secured'
      }));

      const securedRow = await Result.findOne({ sessionId: 'sec_no_switch' }).lean();
      expect(securedRow.type).to.equal('secured');
      expect(securedRow.publishResultsPublicly).to.equal(false);
    });

    it('falls back to public when neither the Session row nor the store names a type', async () => {
      // covers: AC-9
      const saved = await persistCompletedResult('typeless_everywhere', Map({
        title: 'typeless_everywhere',
        entries: List(['Alpha', 'Beta']),
        status: 'completed',
        winner: 'Alpha'
      }));

      expect(saved.type).to.equal('public');
    });

    it('takes the type and the publish switch from the persisted Session row over the live store', async () => {
      // covers: AC-9
      // The persisted Session is the record of what the admin set, so it wins
      // over the live store copy. A result written from a store that has drifted
      // must not contradict the row the admin actually configured.
      await createDbSession('sec_persist_source', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: true });

      await persistCompletedResult('sec_persist_source', Map({
        title: 'sec_persist_source',
        entries: List(['Alpha', 'Beta']),
        status: 'completed',
        winner: 'Alpha',
        type: 'public',
        publishResultsPublicly: false
      }));

      const row = await Result.findOne({ sessionId: 'sec_persist_source' }).lean();
      expect(row.type).to.equal('secured');
      expect(row.publishResultsPublicly).to.equal(true);
    });

    it('honours an explicit publishResultsPublicly of false on the live store session', async () => {
      // covers: AC-9
      // The fallback only applies when the session says nothing at all. An
      // explicit false must not be read as missing and flipped to true.
      await createDbSession('sec_persist_explicit', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: false });

      await persistCompletedResult('sec_persist_explicit', Map({
        title: 'sec_persist_explicit',
        entries: List(['Alpha', 'Beta']),
        status: 'completed',
        winner: 'Beta',
        type: 'secured',
        publishResultsPublicly: false
      }));

      const row = await Result.findOne({ sessionId: 'sec_persist_explicit' }).lean();
      expect(row.publishResultsPublicly).to.equal(false);
    });

    it('rewrites the visibility fields when the same session result is saved again', async () => {
      // covers: AC-9
      // A partial row created by a round push is completed later. The
      // completion write must correct the visibility fields, or the row keeps
      // the defaults it was born with.
      await createDbSession('sec_persist_rewrite', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', publish: false });
      await repository.saveResult({
        sessionId: 'sec_persist_rewrite',
        title: 'sec_persist_rewrite',
        entries: ['Alpha', 'Beta'],
        winner: null
      });
      const partial = await Result.findOne({ sessionId: 'sec_persist_rewrite' }).lean();
      expect(partial.type, 'the partial row starts on the public default').to.equal('public');

      await persistCompletedResult('sec_persist_rewrite', Map({
        title: 'sec_persist_rewrite',
        entries: List(['Alpha', 'Beta']),
        status: 'completed',
        winner: 'Alpha',
        type: 'secured',
        publishResultsPublicly: false
      }));

      const rewritten = await Result.findOne({ sessionId: 'sec_persist_rewrite' }).lean();
      expect(rewritten.type).to.equal('secured');
      expect(rewritten.publishResultsPublicly).to.equal(false);
    });
  });

  describe('14b. A no_result completion writes the visibility fields too (AC-9)', () => {
    async function waitForResultRow(sessionId, attempts = 40) {
      for (let i = 0; i < attempts; i += 1) {
        const row = await Result.findOne({ sessionId }).lean();
        if (row) return row;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    }

    async function runToNoResult(sessionId, { type = 'public', whoCanJoin = 'public' } = {}) {
      createStoreSession(sessionId, { type, whoCanJoin });
      store.dispatch({ type: 'START_SESSION', sessionId });
      const tm = new TimerManager();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const round = roundManager.getCurrentRound(sessionId, store);
        roundManager.closeRoundOnce({ sessionId, roundId: round.roundId, store, timerManager: tm });
        roundManager.expireReveal({ sessionId, roundId: round.roundId, store, timerManager: tm });
      }
      tm.clearAllTimers();
    }

    it('marks a secured no_result result secured and keeps it unpublished', async () => {
      // covers: AC-9, AC-2
      // A tournament that ends without a winner still produces a result row. If
      // the no_result writer skipped the visibility fields, that row would be
      // born on the public default and its round history would leak.
      createDbSession('sec_no_result', { type: 'secured', whoCanJoin: 'allowlist', status: 'pending' });
      await runToNoResult('sec_no_result', { type: 'secured', whoCanJoin: 'allowlist' });

      const row = await waitForResultRow('sec_no_result');
      expect(row, 'the no_result completion must write a result row').to.not.equal(null);
      expect(row.winner).to.equal(null);
      expect(row.type).to.equal('secured');
      expect(row.publishResultsPublicly).to.equal(false);
    });

    it('marks a public no_result result public and published', async () => {
      // covers: AC-9, AC-1
      createDbSession('pub_no_result', { type: 'public', whoCanJoin: 'public', status: 'pending' });
      await runToNoResult('pub_no_result');

      const row = await waitForResultRow('pub_no_result');
      expect(row, 'the no_result completion must write a result row').to.not.equal(null);
      expect(row.type).to.equal('public');
      expect(row.publishResultsPublicly).to.equal(true);
    });

    it('keeps a no_result result out of the history listing while it is secured and unpublished', async () => {
      // covers: AC-5, AC-2
      createDbSession('sec_no_result_hidden', { type: 'secured', whoCanJoin: 'allowlist', status: 'pending' });
      await runToNoResult('sec_no_result_hidden', { type: 'secured', whoCanJoin: 'allowlist' });
      expect(await waitForResultRow('sec_no_result_hidden')).to.not.equal(null);

      const listed = await repository.getCompletedResults();
      expect(listed.map(r => r.sessionId)).to.not.include('sec_no_result_hidden');
    });
  });

  describe('15. Securedness fails closed when the type cannot be resolved (AC-1, AC-2, AC-9)', () => {
    async function insertTypelessResult(sessionId) {
      // Bypass Mongoose defaults: a row the backfill never reached.
      await Result.collection.insertOne({
        sessionId,
        title: sessionId,
        entries: ['Alpha', 'Beta'],
        winner: 'Alpha',
        completedAt: new Date(),
        rounds: []
      });
    }

    it('gates a typeless result whose session cannot be resolved, and still serves the admin', async () => {
      // covers: AC-2, AC-9
      // The exact fail open combination the review named: a legacy row with no
      // type plus a Session that neither the store nor the database can
      // produce. Reading that as public served a secured result to everyone.
      await insertTypelessResult('ghost_sec');

      const anon = await httpGet(port, '/api/sessions/ghost_sec/result');
      expect(anon.statusCode, 'an unresolvable type must never resolve to public').to.equal(404);
      expect(anon.body.result).to.equal(undefined);

      const anonRounds = await httpGet(port, '/api/sessions/ghost_sec/rounds');
      expect(anonRounds.statusCode).to.equal(404);

      const admin = await httpGet(port, '/api/sessions/ghost_sec/result', {
        Authorization: `Bearer ${adminToken}`
      });
      expect(admin.statusCode, 'the admin keeps access so the row can be diagnosed').to.equal(200);
      expect(admin.body.result.winner).to.equal('Alpha');
    });

    it('treats whoCanJoin as a second signal when the session type says public', async () => {
      // covers: AC-2
      // A session gated to an allowlist is secured whatever its `type` column
      // says, so a typeless result behind it stays hidden.
      await Session.create({
        sessionId: 'inconsistent_sec',
        title: 'inconsistent',
        entries: ['Alpha', 'Beta'],
        status: 'completed',
        type: 'public',
        whoCanJoin: 'allowlist'
      });
      await insertTypelessResult('inconsistent_sec');

      const anon = await httpGet(port, '/api/sessions/inconsistent_sec/result');
      expect(anon.statusCode, 'whoCanJoin is the second signal, not type alone').to.equal(404);

      const admin = await httpGet(port, '/api/sessions/inconsistent_sec/result', {
        Authorization: `Bearer ${adminToken}`
      });
      expect(admin.statusCode).to.equal(200);
    });

    it('still serves a typeless result whose session does resolve as public', async () => {
      // covers: AC-1
      // Failing closed must not gate the public archive: a legacy row whose
      // session exists and is public is visible exactly as it was before.
      await createDbSession('legacy_public_ok', { type: 'public', whoCanJoin: 'public', status: 'completed' });
      await insertTypelessResult('legacy_public_ok');

      const anon = await httpGet(port, '/api/sessions/legacy_public_ok/result');
      expect(anon.statusCode, 'a resolved public session stays public').to.equal(200);
      expect(anon.body.result.winner).to.equal('Alpha');
    });

    it('counts the rows a failed backfill left behind', async () => {
      // covers: AC-9
      await insertTypelessResult('untyped_a');
      await insertTypelessResult('untyped_b');
      expect(await repository.countResultsWithoutType()).to.equal(2);

      await repository.backfillResultTypes();
      expect(await repository.countResultsWithoutType()).to.equal(0);
    });

    it('keeps the same gate on the live rounds read as on the completed result read', async () => {
      // covers: AC-2, AC-6
      // The rounds read of a session that is still running runs the same
      // derivation as the completed read, so a session gated to an allowlist is
      // hidden from an outsider there too, whatever its `type` column claims.
      createStoreSession('live_inconsistent', { type: 'public', whoCanJoin: 'allowlist', publishResultsPublicly: false });

      const anon = await httpGet(port, '/api/sessions/live_inconsistent/rounds');
      expect(anon.statusCode, 'the live rounds gate must agree with the completed one').to.equal(404);

      const admin = await httpGet(port, '/api/sessions/live_inconsistent/rounds', {
        Authorization: `Bearer ${adminToken}`
      });
      expect(admin.statusCode).to.equal(200);
    });

    it('reports a join code as secured when the session is gated to an allowlist', async () => {
      // covers: AC-2
      // The join code resolver reads the same derivation, so an allowlist
      // session whose `type` column says public must not be announced to the
      // client as an open one.
      await Session.create({
        sessionId: 'join_inconsistent',
        title: 'Join Inconsistent',
        entries: ['Alpha', 'Beta'],
        status: 'pending',
        type: 'public',
        whoCanJoin: 'allowlist',
        joinCode: 'VRFY99'
      });

      const res = await httpGet(port, '/api/join/VRFY99');
      expect(res.statusCode).to.equal(200);
      expect(res.body.sessionType, 'whoCanJoin must decide the reported type').to.equal('secured');
    });
  });

  describe('16. The archive must not list a row whose type cannot be resolved (AC-2, AC-5)', () => {
    it('omits a typeless result whose session cannot be resolved', async () => {
      // covers: AC-2, AC-5
      // The reads fail closed for this row (section 15), so listing it in the
      // public archive is the same leak from the other direction: the row's
      // winner reaches an anonymous caller who cannot open the result. The
      // archive therefore omits any row it cannot establish as public, and
      // `backfillResultTypes` is what makes a legacy row listable.
      await Result.collection.insertOne({
        sessionId: 'ghost_archive',
        title: 'ghost_archive',
        entries: ['Alpha', 'Beta'],
        winner: 'Alpha',
        completedAt: new Date(),
        rounds: []
      });

      const history = await httpGet(port, '/api/sessions/history');
      expect(history.statusCode).to.equal(200);
      const ids = history.body.results.map((r) => r.sessionId);
      expect(ids, 'a row with no resolvable type must not reach the public archive').to.not.include('ghost_archive');
    });

    it('lists a legacy public row again once the backfill gives it a type', async () => {
      // covers: AC-2, AC-5, AC-9
      // The archive omits a typeless row, so the backfill is the only thing that
      // puts a legacy public result back. Without this, tightening the filter
      // would silently hide every pre-spec public result from the archive with
      // no test failing. The secured half is asserted too, so a backfill that
      // published everything would be caught here too.
      await createDbSession('legacy_public_row', { type: 'public', whoCanJoin: 'public', status: 'completed' });
      await createDbSession('legacy_secured_row', { type: 'secured', whoCanJoin: 'allowlist', status: 'completed' });
      for (const sessionId of ['legacy_public_row', 'legacy_secured_row']) {
        await Result.collection.insertOne({
          sessionId,
          title: sessionId,
          entries: ['Alpha', 'Beta'],
          winner: 'Alpha',
          completedAt: new Date(),
          rounds: []
        });
      }

      const idsBefore = (await httpGet(port, '/api/sessions/history')).body.results.map((r) => r.sessionId);
      expect(idsBefore, 'a typeless public row stays out until it has a type').to.not.include('legacy_public_row');
      expect(idsBefore).to.not.include('legacy_secured_row');

      await repository.backfillResultTypes();

      const idsAfter = (await httpGet(port, '/api/sessions/history')).body.results.map((r) => r.sessionId);
      expect(idsAfter, 'the backfill is what makes a legacy public row listable').to.include('legacy_public_row');
      expect(idsAfter, 'the backfill must not publish a legacy secured row').to.not.include('legacy_secured_row');
    });
  });
});
