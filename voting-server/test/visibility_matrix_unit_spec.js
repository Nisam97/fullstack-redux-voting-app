import { expect } from 'chai';
import mongoose from 'mongoose';
import { fromJS } from 'immutable';

import {
  filterSessionsForCaller,
  getAdminTokenFromRequest,
  getSocketSessionsSummary,
  resolveResultVisibility,
  isApprovedParticipant
} from '../src/server.js';
import { generateAdminToken } from '../src/auth/admin.js';
import { generateVoterToken } from '../src/auth/voterCookie.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import SessionAllowlistEntry from '../src/db/models/SessionAllowlistEntry.js';
import SessionJoinRequest from '../src/db/models/SessionJoinRequest.js';

// Unit level guards for the visibility helpers exported from src/server.js.
// The same behaviour is exercised end to end in visibility_and_privacy_spec.js;
// this file pins the matrix itself, so a change to one caller cannot silently
// change what any of them decides. Covers AC-1, AC-2, AC-4 and AC-6 of spec 0008.

describe('Visibility helpers exported from src/server.js (Spec 0008)', function () {
  this.timeout(15000);

  let adminToken;

  const summaryEntry = (id, type) => ({ id, sessionId: id, title: id, type });

  before(async function () {
    this.timeout(120000);
    await setupTestDb();
    adminToken = generateAdminToken({ username: 'admin', email: 'admin@example.com' });
  });

  after(async function () {
    this.timeout(30000);
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  describe('filterSessionsForCaller', () => {
    const summary = [
      summaryEntry('pub_one', 'public'),
      summaryEntry('sec_allow', 'secured'),
      summaryEntry('sec_approval', 'secured')
    ];

    it('gives an admin the full registry, the same array it was handed', () => {
      expect(filterSessionsForCaller(summary, true)).to.equal(summary);
    });

    it('drops every secured session from a voter caller', () => {
      const visible = filterSessionsForCaller(summary, false);

      expect(visible.map(s => s.sessionId)).to.deep.equal(['pub_one']);
    });

    it('keeps a summary entry that names no type, because the summary always sets one', () => {
      const untyped = [summaryEntry('no_type', undefined)];

      expect(filterSessionsForCaller(untyped, false)).to.have.lengthOf(1);
    });

    it('returns an empty list unchanged for an empty registry', () => {
      expect(filterSessionsForCaller([], false)).to.deep.equal([]);
      expect(filterSessionsForCaller([], true)).to.deep.equal([]);
    });
  });

  describe('getAdminTokenFromRequest', () => {
    it('strips the Bearer prefix from an Authorization header', () => {
      const req = { headers: { authorization: 'Bearer abc.def.ghi' } };

      expect(getAdminTokenFromRequest(req)).to.equal('abc.def.ghi');
    });

    it('returns a bare header value untouched, which is the pattern GET /api/sessions uses', () => {
      const req = { headers: { authorization: 'abc.def.ghi' } };

      expect(getAdminTokenFromRequest(req)).to.equal('abc.def.ghi');
    });

    it('returns null when the request carries no Authorization header', () => {
      expect(getAdminTokenFromRequest({ headers: {} })).to.equal(null);
      expect(getAdminTokenFromRequest({ headers: { authorization: '' } })).to.equal(null);
      expect(getAdminTokenFromRequest({ headers: { authorization: 'Bearer ' } })).to.equal(null);
    });

    it('returns null for a request with no headers at all, rather than throwing', () => {
      expect(getAdminTokenFromRequest({})).to.equal(null);
      expect(getAdminTokenFromRequest(null)).to.equal(null);
      expect(getAdminTokenFromRequest(undefined)).to.equal(null);
    });

    it('leaves a lowercase bearer prefix in the token, so it fails verification instead of passing', () => {
      const req = { headers: { authorization: 'bearer abc.def.ghi' } };

      expect(getAdminTokenFromRequest(req)).to.equal('bearer abc.def.ghi');
    });
  });

  describe('getSocketSessionsSummary', () => {
    const stateWith = () => fromJS({
      sessions: {
        pub_one: { id: 'pub_one', title: 'Public', status: 'pending', entries: [], type: 'public' },
        sec_one: { id: 'sec_one', title: 'Secured', status: 'pending', entries: [], type: 'secured' }
      }
    });

    it('hides the secured session from a socket with no admin token anywhere', () => {
      const summary = getSocketSessionsSummary({ data: {}, handshake: {} }, stateWith());

      expect(summary.map(s => s.sessionId)).to.deep.equal(['pub_one']);
    });

    it('shows the secured session to a socket that carries a valid admin token on socket.data', () => {
      const socket = { data: { adminToken }, handshake: {} };

      expect(getSocketSessionsSummary(socket, stateWith()).map(s => s.sessionId))
        .to.deep.equal(['pub_one', 'sec_one']);
    });

    it('shows the secured session to a socket that authenticated in the handshake', () => {
      const socket = { data: {}, handshake: { auth: { token: adminToken } } };

      expect(getSocketSessionsSummary(socket, stateWith()).map(s => s.sessionId))
        .to.deep.equal(['pub_one', 'sec_one']);
    });

    it('still hides the secured session from a socket carrying a tampered admin token', () => {
      const socket = { data: { adminToken: `${adminToken}tampered` }, handshake: {} };

      expect(getSocketSessionsSummary(socket, stateWith()).map(s => s.sessionId))
        .to.deep.equal(['pub_one']);
    });

    it('returns an empty list for a state that is not an Immutable map', () => {
      expect(getSocketSessionsSummary({ data: {} }, null)).to.deep.equal([]);
    });
  });

  describe('isApprovedParticipant', () => {
    it('is false for a session with no allowlist entry and no approved request', async () => {
      const strangerId = new mongoose.Types.ObjectId();

      expect(await isApprovedParticipant({
        sessionId: 'sec_one', voterUserId: String(strangerId), voterEmail: 'nobody@example.com'
      })).to.equal(false);
    });

    it('is false when no session id is supplied', async () => {
      expect(await isApprovedParticipant({
        voterUserId: String(new mongoose.Types.ObjectId()), voterEmail: 'a@example.com'
      })).to.equal(false);
    });

    it('fails closed when the lookup itself throws, rather than passing the caller through', async () => {
      // A userId that cannot be cast makes Mongoose throw. The catch must deny,
      // because the only safe reading of a failed eligibility lookup is no.
      expect(await isApprovedParticipant({
        sessionId: 'sec_one', voterUserId: 'not-an-object-id', voterEmail: 'someone@example.com'
      })).to.equal(false);
    });

    it('is true for an email on the allowlist, matched case insensitively', async () => {
      await SessionAllowlistEntry.create({ sessionId: 'sec_one', email: 'member@example.com' });

      expect(await isApprovedParticipant({
        sessionId: 'sec_one', voterEmail: '  MEMBER@Example.com  '
      })).to.equal(true);
    });

    it('is true for a holder of an approved join request', async () => {
      const userId = new mongoose.Types.ObjectId();
      await SessionJoinRequest.create({
        sessionId: 'sec_one', userId, email: 'req@example.com', status: 'approved'
      });

      expect(await isApprovedParticipant({ sessionId: 'sec_one', voterUserId: String(userId) }))
        .to.equal(true);
    });

    it('is false for a pending or rejected join request', async () => {
      const pendingUser = new mongoose.Types.ObjectId();
      const rejectedUser = new mongoose.Types.ObjectId();
      await SessionJoinRequest.create({
        sessionId: 'sec_one', userId: pendingUser, email: 'pending@example.com', status: 'pending'
      });
      await SessionJoinRequest.create({
        sessionId: 'sec_one', userId: rejectedUser, email: 'rejected@example.com', status: 'rejected'
      });

      expect(await isApprovedParticipant({ sessionId: 'sec_one', voterUserId: String(pendingUser) })).to.equal(false);
      expect(await isApprovedParticipant({ sessionId: 'sec_one', voterUserId: String(rejectedUser) })).to.equal(false);
    });

    it('does not let an allowlist entry from another session stand in', async () => {
      await SessionAllowlistEntry.create({ sessionId: 'sec_other', email: 'member@example.com' });

      expect(await isApprovedParticipant({ sessionId: 'sec_one', voterEmail: 'member@example.com' }))
        .to.equal(false);
    });
  });

  describe('resolveResultVisibility', () => {
    const securedResult = (overrides = {}) => ({
      sessionId: 'sec_one',
      type: 'secured',
      publishResultsPublicly: false,
      ...overrides
    });

    it('always serves a public result, to anyone, with no token at all (AC-1)', async () => {
      const decision = await resolveResultVisibility({ result: { sessionId: 'pub_one', type: 'public' } });

      expect(decision).to.deep.equal({ visible: true, viewerKind: 'public', type: 'public' });
    });

    it('still serves a public result whose publish switch is off, because that flag never gates public (AC-1)', async () => {
      const decision = await resolveResultVisibility({
        result: { sessionId: 'pub_one', type: 'public', publishResultsPublicly: false }
      });

      expect(decision.visible).to.equal(true);
      expect(decision.viewerKind).to.equal('public');
    });

    it('serves a published secured result to an anonymous caller as public (AC-4)', async () => {
      const decision = await resolveResultVisibility({
        result: securedResult({ publishResultsPublicly: true })
      });

      expect(decision).to.deep.equal({ visible: true, viewerKind: 'public', type: 'secured' });
    });

    it('denies an anonymous caller on an unpublished secured result (AC-2)', async () => {
      const decision = await resolveResultVisibility({ result: securedResult() });

      expect(decision).to.deep.equal({ visible: false, viewerKind: 'denied', type: 'secured' });
    });

    it('denies a bogus or tampered admin token on an unpublished secured result (AC-2)', async () => {
      const bogus = await resolveResultVisibility({
        result: securedResult(), adminToken: 'not.a.jwt'
      });
      const tampered = await resolveResultVisibility({
        result: securedResult(), adminToken: `${adminToken}tampered`
      });

      expect(bogus.visible).to.equal(false);
      expect(tampered.visible).to.equal(false);
    });

    it('serves a valid admin token on an unpublished secured result as admin (AC-2)', async () => {
      const decision = await resolveResultVisibility({ result: securedResult(), adminToken });

      expect(decision).to.deep.equal({ visible: true, viewerKind: 'admin', type: 'secured' });
    });

    it('serves an allowlisted participant on an unpublished secured result as participant (AC-2)', async () => {
      await SessionAllowlistEntry.create({ sessionId: 'sec_one', email: 'member@example.com' });
      const voterCookie = generateVoterToken({ _id: 'u_member', email: 'member@example.com' });

      const decision = await resolveResultVisibility({ result: securedResult(), voterCookie });

      expect(decision).to.deep.equal({ visible: true, viewerKind: 'participant', type: 'secured' });
    });

    it('denies a signed in outsider who joined nothing (AC-2, AC-6)', async () => {
      const outsiderId = new mongoose.Types.ObjectId();
      const voterCookie = generateVoterToken({ _id: outsiderId, email: 'outsider@example.com' });

      const decision = await resolveResultVisibility({ result: securedResult(), voterCookie });

      expect(decision.visible).to.equal(false);
      expect(decision.viewerKind).to.equal('denied');
    });

    it('denies a signed in outsider even when they are allowlisted on a different session (AC-6)', async () => {
      const outsiderId = new mongoose.Types.ObjectId();
      await SessionAllowlistEntry.create({ sessionId: 'sec_other', email: 'outsider@example.com' });
      const voterCookie = generateVoterToken({ _id: outsiderId, email: 'outsider@example.com' });

      const decision = await resolveResultVisibility({ result: securedResult(), voterCookie });

      expect(decision.visible).to.equal(false);
    });

    it('serves an approved join request holder who is not on the allowlist (AC-2)', async () => {
      const approverId = new mongoose.Types.ObjectId();
      await SessionJoinRequest.create({
        sessionId: 'sec_one', userId: approverId, email: 'approver@example.com', status: 'approved'
      });
      const voterCookie = generateVoterToken({ _id: approverId, email: 'approver@example.com' });

      const decision = await resolveResultVisibility({ result: securedResult(), voterCookie });

      expect(decision).to.deep.equal({ visible: true, viewerKind: 'participant', type: 'secured' });
    });

    it('denies a forged voter cookie on an unpublished secured result (AC-2)', async () => {
      const decision = await resolveResultVisibility({
        result: securedResult(), voterCookie: 'user:u_member'
      });

      expect(decision.visible).to.equal(false);
    });

    it('falls back to the session type when the result row carries none (AC-9)', async () => {
      const decision = await resolveResultVisibility({
        result: { sessionId: 'sec_one', publishResultsPublicly: false },
        sessionType: 'public'
      });

      expect(decision).to.deep.equal({ visible: true, viewerKind: 'public', type: 'public' });
    });

    it('fails closed when neither the result nor the session yields a type (AC-1, AC-2, AC-9)', async () => {
      const decision = await resolveResultVisibility({
        result: { sessionId: 'ghost_sec', publishResultsPublicly: false }
      });

      expect(decision).to.deep.equal({ visible: false, viewerKind: 'denied', type: 'secured' });
    });

    it('fails closed on an empty result for a live secured session (AC-6)', async () => {
      const decision = await resolveResultVisibility({ result: null, sessionType: null });

      expect(decision.visible).to.equal(false);
      expect(decision.type).to.equal('secured');
    });

    it('serves the admin a typeless result it cannot classify (AC-9)', async () => {
      const decision = await resolveResultVisibility({
        result: { sessionId: 'ghost_sec' }, adminToken
      });

      expect(decision).to.deep.equal({ visible: true, viewerKind: 'admin', type: 'secured' });
    });

    it('reports the admin as admin even when the result is public, because public short circuits first', async () => {
      const decision = await resolveResultVisibility({
        result: { sessionId: 'pub_one', type: 'public' }, adminToken
      });

      expect(decision.viewerKind).to.equal('public');
    });
  });
});
