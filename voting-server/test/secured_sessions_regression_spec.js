/**
 * Regression guards for spec 0007, Secured Sessions.
 *
 * These lock in the invariants the feature depends on but that a functional
 * test does not naturally protect, because each one still passes when the
 * invariant is quietly removed:
 *
 *   1. All five secured session admin actions stay registered in
 *      ADMIN_ACTION_TYPES. Dropping one there makes the server reject it at
 *      ingress, and the client fails silently with no error anywhere.
 *   2. The VoteParticipation schema never gains a vote choice field. The whole
 *      point of the audit trail is that it records who voted, never for whom.
 *   3. session_participants stays admin only, so a voter socket can never read
 *      the email roster of a secured session.
 *   4. SET_ALLOWLIST reports line numbered validation errors and refuses an
 *      all invalid paste as a no op rather than emptying the roster.
 *   5. join_session runs the same eligibility gate as the REST join endpoint,
 *      so the socket path cannot walk past the allowlist or the approval queue.
 *   6. subscribe_session only admits an admin socket or a voter holding a
 *      server issued token into a secured session room.
 *   7. GET /api/sessions hides secured sessions and their join codes from
 *      anonymous callers, the same rule the socket registry already follows.
 *   8. Once START_SESSION has locked the roster, no new voter and no new join
 *      request gets in, while a voter who already joined may still rejoin.
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
import { clearVoters } from '../src/auth/voter.js';
import startServer, { ADMIN_ACTION_TYPES, isSocketAdmin } from '../src/server.js';
import makeStore from '../src/store.js';

describe('Secured sessions regression guards (Spec 0007)', function () {
  this.timeout(15000);

  let io;
  let port;
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

  // Waits for the ack the admin action handler sends back on the action event.
  function emitWithAck(socket, action, timeoutMs = 3000) {
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

  async function createSecuredSession(sessionId, whoCanJoin = 'allowlist') {
    const socket = createSocketClient();
    await waitForEvent(socket, 'connect');
    socket.emit('action', {
      type: 'CREATE_SESSION',
      sessionId,
      title: `Regression ${sessionId}`,
      entries: ['Option 1', 'Option 2'],
      sessionType: 'secured',
      whoCanJoin,
      token: adminToken
    });
    // CREATE_SESSION dispatches without acking; the store is the only truth.
    await new Promise((r) => setTimeout(r, 250));
    return socket;
  }

  // Acks the join_session socket event, which is the socket twin of
  // POST /api/sessions/:sessionId/join.
  function joinSession(socket, payload, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for join_session ack')), timeoutMs);
      socket.emit('join_session', payload, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  async function createPublicSession(sessionId) {
    const socket = createSocketClient();
    await waitForEvent(socket, 'connect');
    socket.emit('action', {
      type: 'CREATE_SESSION',
      sessionId,
      title: `Public ${sessionId}`,
      entries: ['Option 1', 'Option 2'],
      sessionType: 'public',
      whoCanJoin: 'public',
      token: adminToken
    });
    await new Promise((r) => setTimeout(r, 250));
    return socket;
  }

  function voterSocketFor(user) {
    return createSocketClient({
      extraHeaders: { Cookie: buildVoterCookieHeader(generateVoterToken(user)) }
    });
  }

  before(async () => {
    await setupTestDb();
    await User.init();
    await SessionAllowlistEntry.init();
    await SessionJoinRequest.init();
    await VoteParticipation.init();

    const store = makeStore();
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

  afterEach(() => {
    while (clients.length > 0) {
      const s = clients.pop();
      if (s.connected) s.disconnect();
    }
  });

  describe('1. Secured admin actions stay registered at ingress', () => {
    it('registers all five secured session action names in ADMIN_ACTION_TYPES', () => {
      // A removal here is invisible until an admin clicks the button, so the
      // registration is asserted directly rather than inferred from a UI path.
      const required = [
        'SET_ALLOWLIST',
        'APPROVE_PARTICIPANT',
        'REJECT_PARTICIPANT',
        'REMOVE_PARTICIPANT',
        'SET_WHO_CAN_JOIN'
      ];
      const missing = required.filter((name) => !ADMIN_ACTION_TYPES.has(name));
      expect(missing).to.deep.equal(
        [],
        `ingress would reject these secured actions: ${missing.join(', ')}`
      );
    });

    it('keeps the original lifecycle actions registered alongside the secured ones', () => {
      const lifecycle = [
        'CREATE_SESSION',
        'START_SESSION',
        'ARCHIVE_SESSION',
        'SET_ENTRIES',
        'NEXT'
      ];
      const missing = lifecycle.filter((name) => !ADMIN_ACTION_TYPES.has(name));
      expect(missing).to.deep.equal([], `ingress would reject these lifecycle actions: ${missing.join(', ')}`);
    });

    it('isSocketAdmin is false for a socket with no admin token anywhere', () => {
      expect(isSocketAdmin({ data: {}, handshake: {} })).to.be.false;
      expect(isSocketAdmin({})).to.be.false;
      expect(isSocketAdmin(null)).to.be.false;
    });

    it('isSocketAdmin accepts the admin JWT from the handshake auth, which is what the client now sends', () => {
      const socket = { data: {}, handshake: { auth: { token: adminToken } } };
      expect(isSocketAdmin(socket)).to.be.true;
      expect(socket.data.isAdmin).to.be.true;
    });

    it('isSocketAdmin refuses a tampered or bogus token', () => {
      expect(isSocketAdmin({ data: {}, handshake: { auth: { token: 'not.a.jwt' } } })).to.be.false;
    });
  });

  describe('2. VoteParticipation records that a vote happened, never for whom', () => {
    it('has exactly the audit fields and no vote choice field', () => {
      // The single most damaging regression this feature could take: a vote
      // choice appearing in the audit collection would make it a secret ballot
      // record, defeating the point of a per voter turnout trail.
      // __v is Mongoose's own version key, not a domain field.
      const fields = Object.keys(VoteParticipation.schema.paths)
        .filter((f) => f !== '__v')
        .sort();
      expect(fields).to.deep.equal(['_id', 'createdAt', 'roundId', 'sessionId', 'userId']);
    });

    it('has no field whose name suggests the vote choice, under any spelling', () => {
      // Belt and braces: if someone adds an oddly named choice field, the exact
      // field list test above would need editing too. This one fails on intent.
      const banned = ['entry', 'choice', 'votedFor', 'vote', 'selected', 'winner', 'option', 'candidate'];
      const fields = Object.keys(VoteParticipation.schema.paths).map((f) => f.toLowerCase());
      const offending = fields.filter((f) => banned.includes(f));
      expect(offending, `VoteParticipation must not record the vote choice, found: ${offending.join(', ')}`)
        .to.deep.equal([]);
    });

    it('rejects an attempt to store a vote choice, because the field does not exist', async () => {
      const user = await User.create({
        email: 'audit@example.com',
        username: 'audituser',
        name: 'Audit User'
      });

      // Mongoose strict mode drops undeclared paths, so the choice is silently
      // discarded rather than persisted. The assertion is on what came back.
      const doc = await VoteParticipation.create({
        sessionId: 'sec_audit',
        roundId: 'sec_audit:::r0',
        userId: user._id,
        entry: 'Option 1',
        choice: 'Option 1',
        votedFor: 'Option 1'
      });

      expect(doc.entry).to.be.undefined;
      expect(doc.choice).to.be.undefined;
      expect(doc.votedFor).to.be.undefined;

      const persisted = await VoteParticipation.findById(doc._id).lean();
      expect(Object.keys(persisted).sort()).to.deep.equal(
        ['_id', 'createdAt', 'roundId', 'sessionId', 'userId', '__v'].sort()
      );
    });

    it('keeps the unique index on session, round and user, which is the duplicate vote guard', () => {
      const indexes = VoteParticipation.schema.indexes();
      const unique = indexes.find(
        ([fields]) => fields.sessionId === 1 && fields.roundId === 1 && fields.userId === 1
      );
      expect(unique, 'the compound unique index is what blocks a second vote in a round').to.not.be.undefined;
      expect(unique[1].unique).to.be.true;
    });

    it('refuses a second record for the same session, round and user', async () => {
      const user = await User.create({
        email: 'dupe@example.com',
        username: 'dupeuser',
        name: 'Dupe User'
      });

      await VoteParticipation.create({
        sessionId: 'sec_dupe',
        roundId: 'sec_dupe:::r0',
        userId: user._id
      });

      let secondFailed = false;
      try {
        await VoteParticipation.create({
          sessionId: 'sec_dupe',
          roundId: 'sec_dupe:::r0',
          userId: user._id
        });
      } catch {
        secondFailed = true;
      }

      expect(secondFailed, 'a duplicate vote in one round must be rejected by the unique index').to.be.true;
      expect(await VoteParticipation.countDocuments({ sessionId: 'sec_dupe' })).to.equal(1);
    });
  });

  describe('3. The participant roster stays admin only', () => {
    it('refuses subscribe_participants from an anonymous socket and sends it nothing', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      let rosterReceived = null;
      socket.on('session_participants', (data) => { rosterReceived = data; });

      const err = await new Promise((resolve) => {
        socket.emit('subscribe_participants', { sessionId: 'sec_roster' });
        socket.once('action_error', resolve);
      });

      expect(err.action).to.equal('subscribe_participants');
      expect(err.error).to.equal('UNAUTHORIZED');
      expect(rosterReceived, 'a non admin socket must never receive the roster').to.be.null;
    });

    it('refuses subscribe_participants when the payload carries a bogus admin token', async () => {
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      let rosterReceived = null;
      socket.on('session_participants', (data) => { rosterReceived = data; });

      const err = await new Promise((resolve) => {
        socket.emit('subscribe_participants', { sessionId: 'sec_roster', token: 'forged.token.value' });
        socket.once('action_error', resolve);
      });

      expect(err.error).to.equal('UNAUTHORIZED');
      expect(rosterReceived).to.be.null;
    });

    it('refuses a voter socket authenticated only by its vs_voter cookie', async () => {
      // A real signed in voter is the most likely attacker here, since they
      // hold a valid identity for the platform but are not the admin.
      const sessionId = 'sec_roster_voter';
      await createSecuredSession(sessionId, 'allowlist');

      const user = await User.create({
        email: 'nosy@example.com',
        username: 'nosy',
        name: 'Nosy Voter'
      });
      const cookie = buildVoterCookieHeader(generateVoterToken(user));

      const socket = createSocketClient({ extraHeaders: { Cookie: cookie } });
      await waitForEvent(socket, 'connect');

      let rosterReceived = null;
      socket.on('session_participants', (data) => { rosterReceived = data; });

      const err = await new Promise((resolve) => {
        socket.emit('subscribe_participants', { sessionId });
        socket.once('action_error', resolve);
      });

      expect(err.error).to.equal('UNAUTHORIZED');
      expect(rosterReceived, 'a signed in voter must not read the email roster').to.be.null;
    });

    it('serves the roster to an admin socket, with the emails it needs', async () => {
      const sessionId = 'sec_roster_admin';
      await createSecuredSession(sessionId, 'allowlist');

      const adminSocket = createSocketClient();
      await waitForEvent(adminSocket, 'connect');

      const roster = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for session_participants')), 3000);
        adminSocket.once('session_participants', (data) => {
          clearTimeout(timer);
          resolve(data);
        });
        adminSocket.emit('subscribe_participants', { sessionId, token: adminToken });
      });

      expect(roster.sessionId).to.equal(sessionId);
      expect(roster.mode).to.equal('allowlist');
      expect(roster.counts).to.have.property('allowlistedCount');
      expect(roster.counts).to.have.property('joinedCount');
      expect(roster.entries).to.be.an('array');
    });
  });

  describe('4. SET_ALLOWLIST validation reporting', () => {
    it('reports the 1 based line number of each invalid entry and still stores the valid ones', async () => {
      const sessionId = 'sec_allowlist_lines';
      const socket = await createSecuredSession(sessionId, 'allowlist');

      const ack = await emitWithAck(socket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: [
          'good@example.com',
          'not-an-email',
          'also-good@example.com',
          'still bad'
        ],
        token: adminToken
      });

      expect(ack.success).to.be.true;
      expect(ack.added).to.equal(2);
      expect(ack.invalid).to.be.an('array').with.lengthOf(2);
      expect(ack.invalid.map((i) => i.line).sort()).to.deep.equal([2, 4], 'line numbers are 1 based and match the paste');
      expect(ack.invalid[0]).to.have.property('email');
      expect(ack.invalid[0]).to.have.property('reason');

      const stored = (await SessionAllowlistEntry.find({ sessionId })).map((d) => d.email).sort();
      expect(stored).to.deep.equal(['also-good@example.com', 'good@example.com']);
    });

    it('reports the source line number when the paste is a newline separated CSV string', async () => {
      const sessionId = 'sec_allowlist_csv';
      const socket = await createSecuredSession(sessionId, 'allowlist');

      const ack = await emitWithAck(socket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: 'csv-one@example.com\nbroken\ncsv-two@example.com',
        token: adminToken
      });

      expect(ack.success).to.be.true;
      expect(ack.added).to.equal(2);
      expect(ack.invalid).to.be.an('array').with.lengthOf(1);
      expect(ack.invalid[0].line).to.equal(2, 'the broken entry is on the second line of the paste');
    });

    it('refuses an all invalid paste with ALL_INVALID and leaves the roster untouched', async () => {
      // The dangerous alternative would be treating an empty result as an empty
      // roster, which would revoke access for every already allowlisted voter
      // because of one bad paste.
      const sessionId = 'sec_allowlist_all_invalid';
      const socket = await createSecuredSession(sessionId, 'allowlist');

      const first = await emitWithAck(socket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['keeper@example.com', 'keeper2@example.com'],
        token: adminToken
      });
      expect(first.success).to.be.true;
      expect(first.added).to.equal(2);

      const before = (await SessionAllowlistEntry.find({ sessionId })).map((d) => d.email).sort();
      expect(before).to.deep.equal(['keeper2@example.com', 'keeper@example.com'].sort());

      const second = await emitWithAck(socket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['bad-one', 'bad-two', 'bad three'],
        token: adminToken
      });

      expect(second.success).to.be.false;
      expect(second.error).to.equal('ALL_INVALID');
      expect(second.invalid).to.be.an('array').with.lengthOf(3, 'every bad line must be reported, not just the first');

      const after = (await SessionAllowlistEntry.find({ sessionId })).map((d) => d.email).sort();
      expect(after, 'an all invalid paste must be a no op on the roster').to.deep.equal(before);
    });

    it('replaces the roster by diff, keeping unchanged entries', async () => {
      const sessionId = 'sec_allowlist_diff';
      const socket = await createSecuredSession(sessionId, 'allowlist');

      await emitWithAck(socket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['stay@example.com', 'drop@example.com'],
        token: adminToken
      });

      const ack = await emitWithAck(socket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['stay@example.com', 'added@example.com'],
        token: adminToken
      });

      expect(ack.success).to.be.true;
      expect(ack.added).to.equal(1);
      expect(ack.removed).to.equal(1);

      const stored = (await SessionAllowlistEntry.find({ sessionId })).map((d) => d.email).sort();
      expect(stored).to.deep.equal(['added@example.com', 'stay@example.com']);
    });

    it('deduplicates a repeated email to a single roster entry', async () => {
      const sessionId = 'sec_allowlist_dedupe';
      const socket = await createSecuredSession(sessionId, 'allowlist');

      const ack = await emitWithAck(socket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['Same@Example.com', 'same@example.com', ' SAME@EXAMPLE.COM '],
        token: adminToken
      });

      expect(ack.success).to.be.true;
      expect(ack.added).to.equal(1, 'case and whitespace variants are one entry');

      const stored = await SessionAllowlistEntry.find({ sessionId });
      expect(stored).to.have.lengthOf(1);
      expect(stored[0].email).to.equal('same@example.com');
    });

    it('refuses to change the allowlist of a public session', async () => {
      const sessionId = 'pub_allowlist_refused';
      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Public Session',
        entries: ['A', 'B'],
        sessionType: 'public',
        whoCanJoin: 'public',
        token: adminToken
      });
      await new Promise((r) => setTimeout(r, 250));

      const ack = await emitWithAck(socket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['someone@example.com'],
        token: adminToken
      });

      expect(ack.success).to.be.false;
      expect(ack.error).to.equal('INVALID_SESSION_TYPE');
      expect(await SessionAllowlistEntry.countDocuments({ sessionId })).to.equal(0);
    });
  });

  describe('5. join_session runs the same gate as the REST join endpoint', () => {
    // The socket join path used to call registerVoter directly, so anyone who
    // knew a session id walked straight past the allowlist and the queue. The
    // REST endpoint and this event now share one eligibility helper.
    it('refuses an anonymous socket on an allowlist session', async () => {
      const sessionId = 'sec_socket_gate_anon';
      await createSecuredSession(sessionId, 'allowlist');

      const voter = createSocketClient();
      await waitForEvent(voter, 'connect');

      const ack = await joinSession(voter, { sessionId, displayName: 'Gate Crasher' });

      expect(ack.success).to.be.false;
      expect(ack.error).to.equal('AUTHENTICATION_REQUIRED');
      expect(ack.voterToken, 'no voter token may be issued without eligibility').to.be.undefined;
    });

    it('refuses a signed in voter who is not on the allowlist', async () => {
      const sessionId = 'sec_socket_gate_offlist';
      const adminSocket = await createSecuredSession(sessionId, 'allowlist');
      await emitWithAck(adminSocket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: 'onlist@example.com',
        token: adminToken
      });

      const outsider = await User.create({
        email: 'outsider@example.com',
        username: 'outsider',
        name: 'Outsider Voter'
      });
      const socket = voterSocketFor(outsider);
      await waitForEvent(socket, 'connect');

      const ack = await joinSession(socket, { sessionId, displayName: 'Outsider Voter' });

      expect(ack.success).to.be.false;
      expect(ack.error).to.equal('NOT_ON_ALLOWLIST');
    });

    it('admits an allowlisted voter, so the gate is not simply shut', async () => {
      const sessionId = 'sec_socket_gate_onlist';
      const adminSocket = await createSecuredSession(sessionId, 'allowlist');
      await emitWithAck(adminSocket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: 'onlist@example.com',
        token: adminToken
      });

      const member = await User.create({
        email: 'onlist@example.com',
        username: 'member',
        name: 'On List Voter'
      });
      const socket = voterSocketFor(member);
      await waitForEvent(socket, 'connect');

      const ack = await joinSession(socket, { sessionId });

      expect(ack.success).to.be.true;
      expect(ack.voterToken).to.be.a('string');
    });

    it('returns pending approval first in approval mode, then admits once approved', async () => {
      const sessionId = 'sec_socket_gate_approval';
      const adminSocket = await createSecuredSession(sessionId, 'approval');

      const requester = await User.create({
        email: 'requester@example.com',
        username: 'requester',
        name: 'Requesting Voter'
      });
      const socket = voterSocketFor(requester);
      await waitForEvent(socket, 'connect');

      const pending = await joinSession(socket, { sessionId, displayName: 'Requesting Voter' });
      expect(pending.success).to.be.true;
      expect(pending.status).to.equal('pending_approval');
      expect(pending.voterToken, 'a pending voter must not hold a token').to.be.undefined;

      const request = await SessionJoinRequest.findOne({ sessionId });
      expect(request, 'the request is still created through the socket path').to.not.be.null;

      const decision = await emitWithAck(adminSocket, {
        type: 'APPROVE_PARTICIPANT',
        sessionId,
        requestId: String(request._id),
        token: adminToken
      });
      expect(decision.success).to.be.true;

      const approved = await joinSession(socket, { sessionId, displayName: 'Requesting Voter' });
      expect(approved.success).to.be.true;
      expect(approved.voterToken).to.be.a('string');
    });

    it('leaves the anonymous join of a public session untouched', async () => {
      const sessionId = 'sec_socket_gate_public';
      await createPublicSession(sessionId);

      const voter = createSocketClient();
      await waitForEvent(voter, 'connect');

      const ack = await joinSession(voter, { sessionId, displayName: 'Anonymous Voter' });

      expect(ack.success).to.be.true;
      expect(ack.voterToken).to.be.a('string');
    });
  });

  describe('6. the secured session room stays closed to outsiders', () => {
    // subscribe_session used to join the room before it looked at any token,
    // so anyone with a session id read the live state of a secured session.
    function requestSessionState(socket, payload, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for session_state')), timeoutMs);
        socket.once('session_state', (data) => {
          clearTimeout(timer);
          resolve(data);
        });
        socket.emit('subscribe_session', payload);
      });
    }

    it('refuses an anonymous socket and sends it no session_state', async () => {
      const sessionId = 'sec_room_gate_anon';
      await createSecuredSession(sessionId, 'allowlist');

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      let stateReceived = null;
      socket.on('session_state', (data) => {
        if (data && data.id === sessionId) stateReceived = data;
      });

      const err = await new Promise((resolve) => {
        socket.emit('subscribe_session', { sessionId });
        socket.once('action_error', resolve);
      });

      expect(err.action).to.equal('subscribe_session');
      expect(err.error).to.equal('NOT_ELIGIBLE');

      await new Promise((r) => setTimeout(r, 250));
      expect(stateReceived, 'an outsider must never receive the secured session state').to.be.null;
    });

    it('serves the room to an allowlisted voter who holds a token', async () => {
      const sessionId = 'sec_room_gate_member';
      const adminSocket = await createSecuredSession(sessionId, 'allowlist');
      await emitWithAck(adminSocket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: 'room@example.com',
        token: adminToken
      });

      const member = await User.create({
        email: 'room@example.com',
        username: 'roommember',
        name: 'Room Member'
      });
      const socket = voterSocketFor(member);
      await waitForEvent(socket, 'connect');

      const ack = await joinSession(socket, { sessionId });
      expect(ack.success).to.be.true;

      const state = await requestSessionState(socket, { sessionId, voterToken: ack.voterToken });
      expect(state.id).to.equal(sessionId);
    });

    it('serves the room to an admin socket, so the panel can still manage it', async () => {
      const sessionId = 'sec_room_gate_admin';
      await createSecuredSession(sessionId, 'allowlist');

      const adminSocket = createSocketClient({ auth: { token: adminToken } });
      await waitForEvent(adminSocket, 'connect');

      const state = await requestSessionState(adminSocket, { sessionId });
      expect(state.id).to.equal(sessionId);
    });

    it('leaves the anonymous room join of a public session untouched', async () => {
      const sessionId = 'sec_room_gate_public';
      await createPublicSession(sessionId);

      const socket = createSocketClient();
      await waitForEvent(socket, 'connect');

      const state = await requestSessionState(socket, { sessionId });
      expect(state.id).to.equal(sessionId);
    });
  });

  describe('7. GET /api/sessions hides secured sessions from anonymous callers', () => {
    // The socket registry already filters these. The REST discovery route did
    // not, which handed out every secured session id and join code.
    async function fetchRegistry(headers = {}) {
      const res = await fetch(`http://localhost:${port}/api/sessions`, { headers });
      expect(res.status).to.equal(200);
      return res.json();
    }

    it('returns no secured session to an anonymous caller', async () => {
      await createSecuredSession('sec_listing_hidden', 'allowlist');
      await createPublicSession('sec_listing_open');

      const body = await fetchRegistry();

      expect(body.success).to.be.true;
      expect(body.sessions.some((s) => s.type === 'secured'), 'a secured session must never appear').to.be.false;
      expect(body.sessions.some((s) => s.id === 'sec_listing_open'), 'public sessions stay visible').to.be.true;
      expect(body.count).to.equal(body.sessions.length);
    });

    it('still lists them for a caller holding the admin JWT', async () => {
      await createSecuredSession('sec_listing_admin', 'allowlist');

      const body = await fetchRegistry({ Authorization: `Bearer ${adminToken}` });

      expect(body.sessions.some((s) => s.type === 'secured'), 'the admin must still see the full registry').to.be.true;
    });
  });

  describe('8. the roster locks at Start, so new joins are refused', () => {
    // AC-8 and the spec invariant: after START_SESSION no new joins and no new
    // join requests are accepted. This was the only entry point in the review
    // with no test at all, so the lock could drift without anyone noticing.
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
        if (bodyData) {
          req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
        }
        req.end();
      });
    }

    function joinOverRest(sessionId, user, displayName) {
      return httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${encodeURIComponent(sessionId)}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: buildVoterCookieHeader(generateVoterToken(user))
        }
      }, { displayName });
    }

    // START_SESSION dispatches without acking, so success is observed on the
    // registry broadcast. The listener needs an admin handshake, because the
    // registry hides secured sessions from unauthenticated sockets.
    async function waitForSessionOpen(sessionId, timeoutMs = 3000) {
      const socket = createSocketClient({ auth: { token: adminToken } });
      await waitForEvent(socket, 'connect');

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${sessionId} to open`)), timeoutMs);
        function onSessions(list) {
          const found = (list || []).find((s) => s.id === sessionId);
          if (found && found.status === 'open') {
            clearTimeout(timer);
            socket.off('sessions', onSessions);
            resolve(socket);
          }
        }
        socket.on('sessions', onSessions);
        socket.emit('sessions');
        socket.emit('action', { type: 'START_SESSION', sessionId, token: adminToken });
      });
    }

    async function createUser(email, username, name) {
      return User.create({ email, username, name });
    }

    // Creates a secured session, puts two voters on the allowlist, lets the
    // early one in, then starts the session so the roster is locked.
    async function openSecuredSession(sessionId) {
      const adminSocket = await createSecuredSession(sessionId, 'allowlist');
      await emitWithAck(adminSocket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: 'early@example.com, late@example.com',
        token: adminToken
      });

      const early = await createUser('early@example.com', 'early_voter', 'Early Voter');
      const earlySocket = voterSocketFor(early);
      await waitForEvent(earlySocket, 'connect');
      const earlyJoin = await joinSession(earlySocket, { sessionId });
      expect(earlyJoin.success, 'the early voter must get in so Start is allowed').to.be.true;

      await waitForSessionOpen(sessionId);

      const late = await createUser('late@example.com', 'late_voter', 'Late Voter');
      return { adminSocket, early, earlySocket, earlyJoin, late };
    }

    it('refuses a late allowlisted voter over REST once the session is open', async () => {
      const sessionId = 'sec_lock_rest';
      const { late } = await openSecuredSession(sessionId);

      const res = await joinOverRest(sessionId, late, 'Late Voter');

      expect(res.statusCode, 'the roster is locked, not merely filtered').to.equal(409);
      expect(res.body.error).to.equal('SESSION_STARTED');
      expect(res.body.voterToken, 'no voter token may be issued after Start').to.be.undefined;
    });

    it('refuses the same voter over the join_session socket event', async () => {
      const sessionId = 'sec_lock_socket';
      const { late } = await openSecuredSession(sessionId);

      const socket = voterSocketFor(late);
      await waitForEvent(socket, 'connect');

      const ack = await joinSession(socket, { sessionId, displayName: 'Late Voter' });

      expect(ack.success).to.be.false;
      expect(ack.error).to.equal('SESSION_STARTED');
      expect(ack.voterToken).to.be.undefined;
    });

    it('closes the approval queue at Start without creating a request', async () => {
      const sessionId = 'sec_lock_approval';
      const adminSocket = await createSecuredSession(sessionId, 'approval');

      const early = await createUser('early@example.com', 'early_approver', 'Early Voter');
      const earlySocket = voterSocketFor(early);
      await waitForEvent(earlySocket, 'connect');
      const pending = await joinSession(earlySocket, { sessionId, displayName: 'Early Voter' });
      expect(pending.status).to.equal('pending_approval');

      const request = await SessionJoinRequest.findOne({ sessionId });
      await emitWithAck(adminSocket, {
        type: 'APPROVE_PARTICIPANT',
        sessionId,
        requestId: String(request._id),
        token: adminToken
      });
      const admitted = await joinSession(earlySocket, { sessionId, displayName: 'Early Voter' });
      expect(admitted.success).to.be.true;

      await waitForSessionOpen(sessionId);

      const late = await createUser('late@example.com', 'late_approver', 'Late Voter');
      const res = await joinOverRest(sessionId, late, 'Late Voter');

      expect(res.statusCode).to.equal(409);
      expect(res.body.error).to.equal('SESSION_STARTED');
      expect(await SessionJoinRequest.countDocuments({ sessionId, userId: late._id }),
        'a request must not be created after Start').to.equal(0);
    });

    it('lets a voter who already joined rejoin after Start', async () => {
      // Clearing browser storage mid session must not lock out a participant
      // who was legitimately admitted before Start.
      const sessionId = 'sec_lock_rejoin';
      const { early } = await openSecuredSession(sessionId);

      const res = await joinOverRest(sessionId, early, 'Early Voter');

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.voterToken).to.equal(`user:${String(early._id)}`);
    });

    it('leaves public sessions alone: an anonymous voter still joins after Start', async () => {
      const sessionId = 'sec_lock_public';
      await createPublicSession(sessionId);

      await waitForSessionOpen(sessionId);

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${encodeURIComponent(sessionId)}/join`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { displayName: 'Anonymous Voter' });

      expect(res.statusCode).to.equal(200);
      expect(res.body.voterToken).to.be.a('string');
    });
  });
  // AC-15: "Socket identity for secured session lobby and vote sockets comes
  // from the vs_voter handshake cookie only. The server never trusts a client
  // sent email or userId; it derives identity from the verified JWT in
  // socket.data.userId."
  //
  // Nothing else in the suite pins that. Every other secured test uses the
  // correct identity anyway, so removing the cookie derivation and reading
  // payload.userId instead would leave all of them green. That is the worst
  // shape of regression: an impersonation hole with a passing suite.
  describe('9. Socket identity comes from the cookie only, never the payload (AC-15)', () => {
    // Resolves once the session reads as open on the admin registry broadcast.
    // The watcher is connected and listening before this promise is handed
    // back, so the caller can emit START_SESSION immediately afterwards and
    // still not race past its own listener.
    function openWatcher(sessionId, timeoutMs = 4000) {
      const watcher = createSocketClient({ auth: { token: adminToken } });
      // The listener is attached synchronously, before the connect await. The
      // registry sends its first broadcast the moment the socket comes up, so
      // attaching after awaiting connect misses it and the promise never
      // settles. Attaching first is what makes this deterministic.
      const opened = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${sessionId} to open`)),
          timeoutMs
        );
        function onSessions(list) {
          const found = (list || []).find((s) => s.id === sessionId);
          if (found && found.status === 'open') {
            clearTimeout(timer);
            watcher.off('sessions', onSessions);
            resolve();
          }
        }
        watcher.on('sessions', onSessions);
      });
      return opened;
    }

    it('registers the cookie holder even when the payload claims a different userId', async () => {
      // covers: AC-15
      const sessionId = 'sec_identity_cookie_wins';
      const adminSocket = await createSecuredSession(sessionId, 'allowlist');
      await emitWithAck(adminSocket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['cookie.owner@example.com', 'target.victim@example.com'],
        token: adminToken
      });

      const owner = await User.create({
        email: 'cookie.owner@example.com',
        username: 'cookieowner',
        name: 'Cookie Owner'
      });
      const victim = await User.create({
        email: 'target.victim@example.com',
        username: 'targetvictim',
        name: 'Target Victim'
      });

      const socket = voterSocketFor(owner);
      await waitForEvent(socket, 'connect');

      // The payload asserts the identity of somebody else entirely.
      const ack = await joinSession(socket, {
        sessionId,
        userId: String(victim._id),
        email: victim.email
      });

      expect(ack.success, 'the cookie holder must still be admitted').to.be.true;
      // The issued token is the one the server derived from the verified
      // cookie, so the spoofed userId bought the attacker nothing.
      expect(ack.voterToken).to.equal(`user:${owner._id}`);
      expect(ack.voterToken).to.not.equal(`user:${victim._id}`);
    });

    it('gates the join on the cookie holder, not on the email in the payload', async () => {
      // covers: AC-4, AC-15. Eligibility must follow the derived identity too,
      // or a spoofed email would walk past the allowlist.
      const sessionId = 'sec_identity_gate';
      const adminSocket = await createSecuredSession(sessionId, 'allowlist');
      await emitWithAck(adminSocket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: ['listed.person@example.com'],
        token: adminToken
      });

      const outsider = await User.create({
        email: 'not.listed@example.com',
        username: 'notlisted',
        name: 'Not Listed'
      });
      const listed = await User.create({
        email: 'listed.person@example.com',
        username: 'listedperson',
        name: 'Listed Person'
      });

      const socket = voterSocketFor(outsider);
      await waitForEvent(socket, 'connect');

      // Claiming to be on the allowlist must not help.
      const ack = await joinSession(socket, {
        sessionId,
        email: listed.email,
        userId: String(listed._id)
      });

      expect(ack.success).to.be.false;
      expect(ack.error).to.equal('NOT_ON_ALLOWLIST');
    });

    it('records the vote under the cookie identity on a secured session', async () => {
      // covers: AC-12, AC-15. The participation audit trail is only trustworthy
      // if the userId written into it comes from the verified cookie.
      const sessionId = 'sec_identity_vote';
      const adminSocket = await createSecuredSession(sessionId, 'allowlist');
      await emitWithAck(adminSocket, {
        type: 'SET_ALLOWLIST',
        sessionId,
        emails: 'voter.identity@example.com',
        token: adminToken
      });

      const voter = await User.create({
        email: 'voter.identity@example.com',
        username: 'voteridentity',
        name: 'Voter Identity'
      });
      const other = await User.create({
        email: 'other.identity@example.com',
        username: 'otheridentity',
        name: 'Other Identity'
      });

      const socket = voterSocketFor(voter);
      await waitForEvent(socket, 'connect');

      const joinAck = await joinSession(socket, {
        sessionId,
        userId: String(other._id),
        email: other.email
      });
      expect(joinAck.voterToken).to.equal(`user:${voter._id}`);

      const opened = openWatcher(sessionId);
      adminSocket.emit('action', { type: 'START_SESSION', sessionId, token: adminToken });
      await opened;

      // Cast a real ballot from the cookie socket, claiming the other identity
      // in the payload, so the record proves where the userId came from.
      socket.emit('action', {
        type: 'VOTE',
        sessionId,
        userId: String(other._id),
        entry: 'Option 1'
      });
      await new Promise((r) => setTimeout(r, 800));

      const doc = await VoteParticipation.findOne({ sessionId }).lean();
      expect(doc, 'a secured vote must write a participation record').to.not.be.null;
      expect(String(doc.userId), 'recorded under the cookie identity, not the claimed one')
        .to.equal(String(voter._id));
      expect(doc).to.not.have.property('entry');
      expect(doc).to.not.have.property('vote');
    });
  });
});
