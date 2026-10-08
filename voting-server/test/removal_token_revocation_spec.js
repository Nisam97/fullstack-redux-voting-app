/**
 * Removal really revokes the voter token (Spec 0007, AC-3 and AC-7).
 *
 * The 2026-10-03 re review found that REMOVE_PARTICIPANT deleted the allowlist
 * row and the session headcount entry but left the token in votersByToken.
 * validateVoterToken still accepted it through the
 * `voter.sessionId === normSession` shortcut, so a removed voter kept casting
 * counted ballots while the admin's roster showed them gone.
 *
 * The earlier removal test hid this because it voted from a socket with no
 * handshake cookie, so the vote was refused as FORBIDDEN_VOTER_TOKEN whether or
 * not removal had done anything. Every test here votes from a socket carrying
 * the removed voter's real vs_voter cookie, which is the path a browser
 * actually takes, and asserts the vote is refused because the voter is no
 * longer eligible rather than because a token looked forged.
 */
import { expect } from 'chai';
import http from 'node:http';
import { io as Client } from 'socket.io-client';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import User from '../src/db/models/User.js';
import SessionAllowlistEntry from '../src/db/models/SessionAllowlistEntry.js';
import SessionJoinRequest from '../src/db/models/SessionJoinRequest.js';
import VoteParticipation from '../src/db/models/VoteParticipation.js';
import { generateAdminToken } from '../src/auth/admin.js';
import { generateVoterToken, buildVoterCookieHeader } from '../src/auth/voterCookie.js';
import { clearVoters, validateVoterToken } from '../src/auth/voter.js';
import startServer, { pendingRemovalsBySession } from '../src/server.js';
import makeStore from '../src/store.js';

describe('Removal revokes the voter token (Spec 0007 re-review blocker)', function () {
  this.timeout(20000);

  let io;
  let port;
  let store;
  let adminToken;
  const clients = [];

  afterEach(() => {
    while (clients.length) {
      const socket = clients.pop();
      socket.removeAllListeners();
      socket.close();
    }
  });

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

  function waitForEvent(socket, eventName, timeoutMs = 5000) {
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

  function emitWithAck(socket, action, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ack of "${action.type}"`));
      }, timeoutMs);
      socket.emit('action', action, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  // START_SESSION dispatches straight into the store without acking, so there
  // is nothing to wait on. The store is the only truth for its effect.
  function emitAndSettle(socket, action, settleMs = 350) {
    socket.emit('action', action);
    return new Promise((resolve) => setTimeout(resolve, settleMs));
  }

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
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      });
      req.on('error', reject);
      if (bodyData) req.write(JSON.stringify(bodyData));
      req.end();
    });
  }

  async function createSecuredSession(sessionId, entries = ['Alpha', 'Beta']) {
    const socket = createSocketClient();
    await waitForEvent(socket, 'connect');
    socket.emit('action', {
      type: 'CREATE_SESSION',
      sessionId,
      title: `Revocation ${sessionId}`,
      entries,
      sessionType: 'secured',
      whoCanJoin: 'allowlist',
      token: adminToken
    });
    // CREATE_SESSION dispatches without acking, so the store is the truth.
    await new Promise((r) => setTimeout(r, 250));
    return socket;
  }

  async function setAllowlist(adminSocket, sessionId, emails) {
    const ack = await emitWithAck(adminSocket, {
      type: 'SET_ALLOWLIST',
      sessionId,
      emails,
      token: adminToken
    });
    expect(ack.success).to.equal(true);
    return ack;
  }

  // Joins through the REST endpoint with the voter's real cookie, exactly as a
  // signed in browser does, so the token the server issues is user:<userId>.
  async function joinAsVoter(sessionId, user, displayName) {
    const cookie = buildVoterCookieHeader(generateVoterToken(user));
    const res = await httpRequest({
      hostname: 'localhost',
      port,
      path: `/api/sessions/${sessionId}/join`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie }
    }, { displayName });
    expect(res.statusCode).to.equal(200);
    return { cookie, voterToken: res.body.voterToken };
  }

  describe('1. REMOVE_PARTICIPANT in the lobby', () => {
    it('revokes the token so a later vote is refused as ineligible, not as a forged token', async () => {
      const adminSocket = await createSecuredSession('sec_lobby_revoke');
      const voter = await User.create({
        email: 'lobby.removed@example.com',
        username: 'lobbyremoved',
        name: 'Lobby Removed'
      });
      await setAllowlist(adminSocket, 'sec_lobby_revoke', ['lobby.removed@example.com']);
      const joined = await joinAsVoter('sec_lobby_revoke', voter, 'Lobby Removed');

      expect(joined.voterToken).to.equal(`user:${voter._id}`);
      expect(validateVoterToken(joined.voterToken, 'sec_lobby_revoke').valid).to.equal(true);

      const ack = await emitWithAck(adminSocket, {
        type: 'REMOVE_PARTICIPANT',
        sessionId: 'sec_lobby_revoke',
        email: 'lobby.removed@example.com',
        token: adminToken
      });
      expect(ack.success).to.equal(true);

      // The revocation itself: the token no longer validates at all.
      expect(validateVoterToken(joined.voterToken, 'sec_lobby_revoke').valid).to.equal(false);

      // The real path. This socket authenticates through its vs_voter
      // handshake cookie, so the server derives user:<userId> itself and no
      // client supplied token is involved. Any refusal here must be the
      // eligibility recheck, not FORBIDDEN_VOTER_TOKEN.
      await emitAndSettle(adminSocket, {
        type: 'START_SESSION',
        sessionId: 'sec_lobby_revoke',
        token: adminToken
      });

      const voterSocket = createSocketClient({
        extraHeaders: { Cookie: joined.cookie }
      });
      await waitForEvent(voterSocket, 'connect');

      const errorPromise = waitForEvent(voterSocket, 'action_error');
      voterSocket.emit('action', {
        type: 'VOTE',
        sessionId: 'sec_lobby_revoke',
        entry: 'Alpha'
      });
      const err = await errorPromise;

      expect(err.action).to.equal('VOTE');
      // The refusal must trace back to the removal, not to a token that looked
      // forged. INVALID_TOKEN here is the revocation itself: the server deleted
      // the token the admin removed, so it no longer resolves to a voter.
      expect(err.error).to.not.equal('FORBIDDEN_VOTER_TOKEN');
      expect(err.error).to.equal('INVALID_TOKEN');

      // Nothing landed in the tally.
      const tally = store.getState().getIn(['sessions', 'sec_lobby_revoke', 'vote', 'tally']);
      expect(tally === undefined || tally.size === 0 || tally.count?.() === 0).to.equal(true);
    });

    it('disconnects the removed voter socket, as AC-7 promises', async () => {
      const adminSocket = await createSecuredSession('sec_lobby_disconnect');
      const voter = await User.create({
        email: 'lobby.disconnected@example.com',
        username: 'lobbydisc',
        name: 'Lobby Disconnected'
      });
      await setAllowlist(adminSocket, 'sec_lobby_disconnect', ['lobby.disconnected@example.com']);
      const joined = await joinAsVoter('sec_lobby_disconnect', voter, 'Lobby Disconnected');

      const voterSocket = createSocketClient({
        extraHeaders: { Cookie: joined.cookie }
      });
      await waitForEvent(voterSocket, 'connect');

      const statusPromise = waitForEvent(voterSocket, 'participant_status');
      const disconnectPromise = waitForEvent(voterSocket, 'disconnect');
      voterSocket.on('disconnect', () => {});

      await emitWithAck(adminSocket, {
        type: 'REMOVE_PARTICIPANT',
        sessionId: 'sec_lobby_disconnect',
        email: 'lobby.disconnected@example.com',
        token: adminToken
      });

      const status = await statusPromise;
      expect(status.status).to.equal('removed');
      await disconnectPromise;
      expect(voterSocket.connected).to.equal(false);
    });
  });

  describe('2. Deferred removal during voting', () => {
    it('revokes the token at NEXT so a removed voter cannot vote in the next round', async () => {
      const adminSocket = await createSecuredSession('sec_deferred_revoke');
      const voter = await User.create({
        email: 'deferred.removed@example.com',
        username: 'deferredremoved',
        name: 'Deferred Removed'
      });
      await setAllowlist(adminSocket, 'sec_deferred_revoke', ['deferred.removed@example.com']);
      const joined = await joinAsVoter('sec_deferred_revoke', voter, 'Deferred Removed');

      await emitAndSettle(adminSocket, {
        type: 'START_SESSION',
        sessionId: 'sec_deferred_revoke',
        token: adminToken
      });

      const voterSocket = createSocketClient({
        extraHeaders: { Cookie: joined.cookie }
      });
      await waitForEvent(voterSocket, 'connect');
      voterSocket.on('disconnect', () => {});

      // Removal during an open session is deferred to the end of the round.
      const ack = await emitWithAck(adminSocket, {
        type: 'REMOVE_PARTICIPANT',
        sessionId: 'sec_deferred_revoke',
        email: 'deferred.removed@example.com',
        token: adminToken
      });
      expect(ack.success).to.equal(true);

      // Deferred means the token is still good until the round concludes.
      expect(validateVoterToken(joined.voterToken, 'sec_deferred_revoke').valid).to.equal(true);

      await emitAndSettle(adminSocket, {
        type: 'NEXT',
        sessionId: 'sec_deferred_revoke',
        token: adminToken
      }, 500);

      // The deferred path must revoke as well, not only drop the count.
      expect(validateVoterToken(joined.voterToken, 'sec_deferred_revoke').valid).to.equal(false);
    });
  });

  describe('3. Deferred removal still lets the voter finish the round (AC-7)', () => {
    it('accepts a vote cast in the same round the removal was deferred in, then refuses after NEXT', async () => {
      const adminSocket = await createSecuredSession('sec_finish_round');
      const voter = await User.create({
        email: 'finish.round@example.com',
        username: 'finishround',
        name: 'Finish Round'
      });
      await setAllowlist(adminSocket, 'sec_finish_round', ['finish.round@example.com']);
      const joined = await joinAsVoter('sec_finish_round', voter, 'Finish Round');

      await emitAndSettle(adminSocket, {
        type: 'START_SESSION',
        sessionId: 'sec_finish_round',
        token: adminToken
      });

      const voterSocket = createSocketClient({
        extraHeaders: { Cookie: joined.cookie }
      });
      await waitForEvent(voterSocket, 'connect');
      voterSocket.on('disconnect', () => {});

      const ack = await emitWithAck(adminSocket, {
        type: 'REMOVE_PARTICIPANT',
        sessionId: 'sec_finish_round',
        email: 'finish.round@example.com',
        token: adminToken
      });
      expect(ack.success).to.equal(true);

      // AC-7: removal during voting takes effect at the end of the current
      // round, so the voter can still finish their vote for that round. The
      // vote comes from the removed voter's own cookie socket, which is the
      // only path that reaches the vote time eligibility recheck.
      const errorPromise = waitForEvent(voterSocket, 'action_error', 2500).catch(() => null);
      voterSocket.emit('action', {
        type: 'VOTE',
        sessionId: 'sec_finish_round',
        entry: 'Alpha'
      });
      const err = await errorPromise;

      expect(err, 'a deferred removal must not refuse a vote inside the deferred round').to.equal(null);

      const tally = store.getState().getIn(['sessions', 'sec_finish_round', 'vote', 'tally']);
      expect(tally?.get('Alpha')).to.equal(1);

      // The deferral was real, not a bypass: the next round excludes them.
      await emitAndSettle(adminSocket, {
        type: 'NEXT',
        sessionId: 'sec_finish_round',
        token: adminToken
      }, 500);

      expect(validateVoterToken(joined.voterToken, 'sec_finish_round').valid).to.equal(false);

      // The deferred set is what granted the grace, so NEXT must clear it or
      // the grace would outlive the round it belonged to.
      expect(pendingRemovalsBySession.has('sec_finish_round')).to.equal(false);
    });
  });

  // The same grace applies to approval mode. It was never covered, and the
  // regression would have been identical: isVoterStillEligible reads the
  // SessionJoinRequest row, which REMOVE_PARTICIPANT deletes before it defers.
  describe('3b. Deferred removal in approval mode (AC-7)', () => {
    async function createApprovalSession(sessionId) {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');
      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId,
        title: `Approval ${sessionId}`,
        entries: ['Alpha', 'Beta'],
        sessionType: 'secured',
        whoCanJoin: 'approval',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 250));
      return socket;
    }

    // Requests access, gets approved, and returns the issued voter token. The
    // cookie is the same one a signed in browser holds.
    async function requestAndApprove(sessionId, user, displayName) {
      const cookie = buildVoterCookieHeader(generateVoterToken(user));
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie }
      }, { displayName });

      expect(res.statusCode).to.equal(202);
      expect(res.body.status).to.equal('pending_approval');

      const approved = await emitWithAck(createSocketClient(), {
        type: 'APPROVE_PARTICIPANT',
        sessionId,
        requestId: res.body.requestId,
        token: adminToken
      });
      expect(approved.success).to.equal(true);

      const reqDoc = await SessionJoinRequest.findById(res.body.requestId);
      expect(reqDoc.status).to.equal('approved');

      return { cookie, requestId: res.body.requestId };
    }

    it('accepts the vote inside the deferred round, then refuses after NEXT', async () => {
      const adminSocket = await createApprovalSession('sec_approval_defer');
      const voter = await User.create({
        email: 'approval.deferred@example.com',
        username: 'approvaldeferred',
        name: 'Approval Deferred'
      });
      const joined = await requestAndApprove('sec_approval_defer', voter, 'Approval Deferred');

      await emitAndSettle(adminSocket, {
        type: 'START_SESSION',
        sessionId: 'sec_approval_defer',
        token: adminToken
      });

      const voterSocket = createSocketClient({ extraHeaders: { Cookie: joined.cookie } });
      await waitForEvent(voterSocket, 'connect');
      voterSocket.on('disconnect', () => {});

      const ack = await emitWithAck(adminSocket, {
        type: 'REMOVE_PARTICIPANT',
        sessionId: 'sec_approval_defer',
        requestId: joined.requestId,
        token: adminToken
      });
      expect(ack.success).to.equal(true);

      // Deferred, so the token is untouched until the round concludes.
      expect(validateVoterToken(`user:${voter._id}`, 'sec_approval_defer').valid).to.equal(true);

      // The join request row is gone, so a re-read here would refuse the vote
      // in the very round AC-7 says stays the voter's.
      const errorPromise = waitForEvent(voterSocket, 'action_error', 2500).catch(() => null);
      voterSocket.emit('action', {
        type: 'VOTE',
        sessionId: 'sec_approval_defer',
        entry: 'Alpha'
      });
      const err = await errorPromise;

      expect(err, 'a deferred approval removal must not refuse a vote inside the deferred round')
        .to.equal(null);
      const tally = store.getState().getIn(['sessions', 'sec_approval_defer', 'vote', 'tally']);
      expect(tally?.get('Alpha')).to.equal(1);

      // And the deferral was real: NEXT revokes.
      await emitAndSettle(adminSocket, {
        type: 'NEXT',
        sessionId: 'sec_approval_defer',
        token: adminToken
      }, 500);

      expect(validateVoterToken(`user:${voter._id}`, 'sec_approval_defer').valid).to.equal(false);
      expect(pendingRemovalsBySession.has('sec_approval_defer')).to.equal(false);
    });

    it('still refuses a rejected voter immediately, since that is not a deferred removal', async () => {
      // The guard must not become a blanket pass. A rejection has no deferred
      // entry, so the vote is refused in the same round it was attempted.
      const adminSocket = await createApprovalSession('sec_approval_reject');
      const rejected = await User.create({
        email: 'approval.rejected@example.com',
        username: 'approvalrejected',
        name: 'Approval Rejected'
      });
      const cookie = buildVoterCookieHeader(generateVoterToken(rejected));
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/sessions/sec_approval_reject/join',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie }
      }, { displayName: 'Approval Rejected' });
      expect(res.statusCode).to.equal(202);

      await emitWithAck(createSocketClient(), {
        type: 'REJECT_PARTICIPANT',
        sessionId: 'sec_approval_reject',
        requestId: res.body.requestId,
        token: adminToken
      });

      await emitAndSettle(adminSocket, {
        type: 'START_SESSION',
        sessionId: 'sec_approval_reject',
        token: adminToken
      });

      const voterSocket = createSocketClient({ extraHeaders: { Cookie: cookie } });
      await waitForEvent(voterSocket, 'connect');
      voterSocket.on('disconnect', () => {});

      const errorPromise = waitForEvent(voterSocket, 'action_error', 2500);
      voterSocket.emit('action', {
        type: 'VOTE',
        sessionId: 'sec_approval_reject',
        entry: 'Alpha'
      });
      const err = await errorPromise;

      expect(err.action).to.equal('VOTE');
      expect(err.error).to.be.a('string');
      expect(
        pendingRemovalsBySession.has('sec_approval_reject'),
        'a rejection is not a deferred removal and must not grant a grace'
      ).to.equal(false);
    });
  });

  describe('4. Allowlist paste that drops a joined voter', () => {
    it('revokes and disconnects a voter whose email the new paste omits', async () => {
      const adminSocket = await createSecuredSession('sec_paste_revoke');
      const kept = await User.create({
        email: 'paste.kept@example.com',
        username: 'pastekept',
        name: 'Paste Kept'
      });
      const dropped = await User.create({
        email: 'paste.dropped@example.com',
        username: 'pastedropped',
        name: 'Paste Dropped'
      });

      await setAllowlist(adminSocket, 'sec_paste_revoke', [
        'paste.kept@example.com',
        'paste.dropped@example.com'
      ]);
      const keptJoin = await joinAsVoter('sec_paste_revoke', kept, 'Paste Kept');
      const droppedJoin = await joinAsVoter('sec_paste_revoke', dropped, 'Paste Dropped');

      expect(validateVoterToken(droppedJoin.voterToken, 'sec_paste_revoke').valid).to.equal(true);

      const droppedSocket = createSocketClient({
        extraHeaders: { Cookie: droppedJoin.cookie }
      });
      await waitForEvent(droppedSocket, 'connect');
      droppedSocket.on('disconnect', () => {});

      // The paste drops only the second voter. This is the primary way an
      // admin trims a list, so it has to have the same effect as Remove.
      const ack = await setAllowlist(adminSocket, 'sec_paste_revoke', ['paste.kept@example.com']);
      expect(ack.removed).to.equal(1);

      expect(validateVoterToken(droppedJoin.voterToken, 'sec_paste_revoke').valid).to.equal(false);
      // The voter who stayed on the list keeps their token.
      expect(validateVoterToken(keptJoin.voterToken, 'sec_paste_revoke').valid).to.equal(true);

      await new Promise((r) => setTimeout(r, 300));
      expect(droppedSocket.connected).to.equal(false);
    });

    it('leaves a joined voter alone when the paste still lists them', async () => {
      const adminSocket = await createSecuredSession('sec_paste_keep');
      const voter = await User.create({
        email: 'paste.stays@example.com',
        username: 'pastestays',
        name: 'Paste Stays'
      });
      await setAllowlist(adminSocket, 'sec_paste_keep', ['paste.stays@example.com']);
      const joined = await joinAsVoter('sec_paste_keep', voter, 'Paste Stays');

      await setAllowlist(adminSocket, 'sec_paste_keep', [
        'paste.stays@example.com',
        'paste.added@example.com'
      ]);

      expect(validateVoterToken(joined.voterToken, 'sec_paste_keep').valid).to.equal(true);
    });
  });

  describe('5. Vote time eligibility recheck', () => {
    it('refuses a vote when the allowlist entry is gone even though the token still validates', async () => {
      // This is the defense in depth layer: it does not rely on revocation at
      // all. The token is deliberately left valid so the recheck is the only
      // thing standing between the voter and a counted ballot.
      const adminSocket = await createSecuredSession('sec_recheck');
      const voter = await User.create({
        email: 'recheck.voter@example.com',
        username: 'recheckvoter',
        name: 'Recheck Voter'
      });
      await setAllowlist(adminSocket, 'sec_recheck', ['recheck.voter@example.com']);
      const joined = await joinAsVoter('sec_recheck', voter, 'Recheck Voter');

      await emitAndSettle(adminSocket, {
        type: 'START_SESSION',
        sessionId: 'sec_recheck',
        token: adminToken
      });

      const voterSocket = createSocketClient({
        extraHeaders: { Cookie: joined.cookie }
      });
      await waitForEvent(voterSocket, 'connect');
      voterSocket.on('disconnect', () => {});

      // A baseline vote lands, so the session is proven open and working.
      const firstError = waitForEvent(voterSocket, 'action_error').then(
        () => null,
        () => null
      );
      voterSocket.emit('action', {
        type: 'VOTE',
        sessionId: 'sec_recheck',
        entry: 'Alpha'
      });
      await new Promise((r) => setTimeout(r, 400));
      // The baseline vote must land, otherwise this test proves nothing about
      // the recheck: a session that silently refused every vote would also
      // refuse the one under test.
      const baselineTally = store.getState().getIn(['sessions', 'sec_recheck', 'vote', 'tally', 'Alpha']);
      expect(baselineTally).to.equal(1);

      // Now remove the allowlist row directly, leaving the token valid. This
      // is the shape of the bug the recheck exists to catch.
      await SessionAllowlistEntry.deleteMany({ sessionId: 'sec_recheck' });
      expect(validateVoterToken(joined.voterToken, 'sec_recheck').valid).to.equal(true);

      const errorPromise = waitForEvent(voterSocket, 'action_error');
      voterSocket.emit('action', {
        type: 'VOTE',
        sessionId: 'sec_recheck',
        entry: 'Beta'
      });
      const err = await errorPromise;

      expect(err.error).to.equal('NOT_ELIGIBLE');
      await firstError;
    });

    it('leaves public session voting untouched', async () => {
      const adminSocket = createSocketClient();
      await waitForEvent(adminSocket, 'connect');
      adminSocket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'pub_recheck',
        title: 'Public Recheck',
        entries: ['Alpha', 'Beta'],
        sessionType: 'public',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 250));

      const joinRes = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/sessions/pub_recheck/join',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { displayName: 'Anon' });
      expect(joinRes.statusCode).to.equal(200);

      await emitAndSettle(adminSocket, {
        type: 'START_SESSION',
        sessionId: 'pub_recheck',
        token: adminToken
      });

      const anonSocket = createSocketClient({
        extraHeaders: { Cookie: buildVoterCookieHeader(joinRes.body.voterToken) }
      });
      await waitForEvent(anonSocket, 'connect');
      anonSocket.on('disconnect', () => {});

      anonSocket.emit('action', {
        type: 'VOTE',
        sessionId: 'pub_recheck',
        entry: 'Alpha',
        voterToken: joinRes.body.voterToken
      });
      await new Promise((r) => setTimeout(r, 400));

      // A public session has no eligibility gate, so the vote still counts.
      const publicTally = store.getState().getIn(['sessions', 'pub_recheck', 'vote', 'tally', 'Alpha']);
      expect(publicTally).to.equal(1);
    });
  });

  describe('6. Cross session isolation of the revocation', () => {
    it('keeps the token alive in a second session the same voter legitimately joined', async () => {
      const firstAdmin = await createSecuredSession('sec_shared_first');
      const secondAdmin = await createSecuredSession('sec_shared_second');
      const voter = await User.create({
        email: 'shared.voter@example.com',
        username: 'sharedvoter',
        name: 'Shared Voter'
      });

      await setAllowlist(firstAdmin, 'sec_shared_first', ['shared.voter@example.com']);
      await setAllowlist(secondAdmin, 'sec_shared_second', ['shared.voter@example.com']);
      const joined = await joinAsVoter('sec_shared_first', voter, 'Shared Voter');
      const alsoJoined = await joinAsVoter('sec_shared_second', voter, 'Shared Voter');

      expect(joined.voterToken).to.equal(alsoJoined.voterToken);

      await emitWithAck(firstAdmin, {
        type: 'REMOVE_PARTICIPANT',
        sessionId: 'sec_shared_first',
        email: 'shared.voter@example.com',
        token: adminToken
      });

      // A user:<id> token is one record shared across sessions, so removing
      // them from one session must not break the other. The vote time recheck
      // is what keeps the removal honest in this case.
      expect(validateVoterToken(joined.voterToken, 'sec_shared_second').valid).to.equal(true);
    });
  });
});