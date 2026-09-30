import jwt from 'jsonwebtoken';
import { expect } from 'chai';
import http from 'http';
import { io as Client } from 'socket.io-client';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import User from '../src/db/models/User.js';
import OtpChallenge from '../src/db/models/OtpChallenge.js';
import { createChallenge, verifyChallenge, isCooldownActive, isChallengeLocked, cancelChallenge } from '../src/auth/otp.js';
import { generateVoterToken, verifyVoterToken, buildVoterCookieHeader, buildClearVoterCookieHeader, getVoterJwtSecret } from '../src/auth/voterCookie.js';
import { registerVoter, validateVoterToken, canCastVote, buildVoteKey, clearVoters } from '../src/auth/voter.js';
import { sendOtpEmail, setTransport } from '../src/email/transport.js';
import startServer from '../src/server.js';
import makeStore from '../src/store.js';

function httpRequest(options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', chunk => { rawData += chunk; });
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

describe('Feature 7: Accounts and OTP Authentication Contract', function() {
  this.timeout(15000);

  let io;
  let port;
  let store;
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

  before(async () => {
    await setupTestDb();
    await User.init();
    await OtpChallenge.init();
    store = makeStore();
    io = startServer(store, 0);
    const addr = io.httpServer ? io.httpServer.address() : null;
    port = addr ? addr.port : 8090;
  });

  after(async () => {
    if (io) {
      await new Promise(resolve => io.close(resolve));
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

  describe('1. Mongoose Models & Validation (AC-1, AC-3, AC-14)', () => {
    it('creates a valid User document with lowercase email and username constraints', async () => {
      const user = await User.create({
        email: 'VOTER@EXAMPLE.COM',
        username: 'alice_voter',
        name: 'Alice Cooper'
      });
      expect(user.email).to.equal('voter@example.com');
      expect(user.username).to.equal('alice_voter');
      expect(user.name).to.equal('Alice Cooper');
      expect(user.createdAt).to.be.an.instanceOf(Date);
    });

    it('rejects duplicate email and duplicate username', async () => {
      await User.create({
        email: 'test@example.com',
        username: 'test_user',
        name: 'User One'
      });

      let errDuplicateEmail = null;
      try {
        await User.create({
          email: 'test@example.com',
          username: 'other_user',
          name: 'User Two'
        });
      } catch (err) {
        errDuplicateEmail = err;
      }
      expect(errDuplicateEmail).to.not.be.null;

      let errDuplicateUsername = null;
      try {
        await User.create({
          email: 'different@example.com',
          username: 'test_user',
          name: 'User Three'
        });
      } catch (err) {
        errDuplicateUsername = err;
      }
      expect(errDuplicateUsername).to.not.be.null;
    });

    it('creates OtpChallenge with TTL index and attempts default 0', async () => {
      const challenge = await OtpChallenge.create({
        email: 'voter@example.com',
        codeHash: 'fakehash',
        salt: 'fakesalt',
        expiresAt: new Date(Date.now() + 600000),
        lastSentAt: new Date(),
        pendingName: 'Bob',
        pendingUsername: 'bob_the_voter'
      });

      expect(challenge.attempts).to.equal(0);
      expect(challenge.consumedAt).to.be.null;
      expect(challenge.pendingName).to.equal('Bob');
      expect(challenge.pendingUsername).to.equal('bob_the_voter');
    });
  });

  describe('2. OTP Service Logic: Challenge Creation, Cooldown, Lock, & Verification (AC-3, AC-4, AC-14)', () => {
    it('generates 6-digit code, hashes it, and stores challenge', async () => {
      const result = await createChallenge({
        email: 'voter@test.com',
        name: 'Charlie',
        username: 'charlie_v'
      });

      expect(result.success).to.be.true;
      expect(result.code).to.match(/^\d{6}$/);

      const challenge = await OtpChallenge.findOne({ email: 'voter@test.com' });
      expect(challenge).to.not.be.null;
      expect(challenge.codeHash).to.not.equal(result.code);
      expect(challenge.pendingName).to.equal('Charlie');
    });

    it('enforces 60-second cooldown on subsequent request (AC-4)', async () => {
      const first = await createChallenge({ email: 'cooldown@test.com' });
      expect(first.success).to.be.true;

      const second = await createChallenge({ email: 'cooldown@test.com' });
      expect(second.success).to.be.false;
      expect(second.error).to.equal('COOLDOWN_ACTIVE');
      expect(second.retryAfterSeconds).to.be.greaterThan(0);
    });

    it('rejects taken username at OTP request time (AC-14)', async () => {
      await User.create({
        email: 'existing@test.com',
        username: 'taken_handle',
        name: 'Existing'
      });

      const res = await createChallenge({
        email: 'newbie@test.com',
        name: 'Newbie',
        username: 'taken_handle'
      });

      expect(res.success).to.be.false;
      expect(res.error).to.equal('USERNAME_TAKEN');
    });

    it('locks challenge after 5 incorrect verify attempts (AC-3)', async () => {
      const created = await createChallenge({ email: 'attacker@test.com' });
      const realCode = created.code;
      const wrongCode = realCode === '123456' ? '654321' : '123456';

      for (let i = 1; i <= 4; i++) {
        const v = await verifyChallenge({ email: 'attacker@test.com', code: wrongCode });
        expect(v.success).to.be.false;
        expect(v.error).to.equal('INVALID_CODE');
        expect(v.remainingAttempts).to.equal(5 - i);
      }

      // 5th attempt locks it
      const fifth = await verifyChallenge({ email: 'attacker@test.com', code: wrongCode });
      expect(fifth.success).to.be.false;
      expect(fifth.error).to.equal('CHALLENGE_LOCKED');

      // Subsequent attempt with even the CORRECT code is rejected
      const sixth = await verifyChallenge({ email: 'attacker@test.com', code: realCode });
      expect(sixth.success).to.be.false;
      expect(sixth.error).to.equal('CHALLENGE_LOCKED');
    });

    it('consumes OTP on successful verify, preventing replay (AC-3)', async () => {
      const created = await createChallenge({
        email: 'replayer@test.com',
        name: 'Replayer',
        username: 'replayer_user'
      });
      const code = created.code;

      const firstVerify = await verifyChallenge({ email: 'replayer@test.com', code });
      expect(firstVerify.success).to.be.true;
      expect(firstVerify.isNewUser).to.be.true;
      expect(firstVerify.user.email).to.equal('replayer@test.com');

      const secondVerify = await verifyChallenge({ email: 'replayer@test.com', code });
      expect(secondVerify.success).to.be.false;
      expect(secondVerify.error).to.equal('CODE_ALREADY_USED');
    });
  });

  describe('3. REST Endpoints: OTP Request, Verify, & Cookies (AC-1, AC-2, AC-5, AC-6, AC-7, AC-11)', () => {
    it('POST /api/auth/otp/request returns generic response and does NOT leak code (AC-5, AC-6)', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/otp/request',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        email: 'dan@example.com',
        name: 'Dan',
        username: 'dan_the_man'
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.message).to.equal('If an account exists or can be created, a code was sent.');
      expect(res.body.code).to.be.undefined;
    });

    it('POST /api/auth/otp/verify sets signed httpOnly vs_voter cookie and returns profile (AC-1, AC-7)', async () => {
      // Create challenge directly so we know the code
      const challenge = await createChallenge({
        email: 'eva@example.com',
        name: 'Eva Green',
        username: 'eva_green'
      });

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/otp/verify',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        email: 'eva@example.com',
        code: challenge.code
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.user.email).to.equal('eva@example.com');
      expect(res.body.user.name).to.equal('Eva Green');
      expect(res.body.isNewUser).to.be.true;

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).to.be.an('array');
      const voterCookie = setCookie.find(c => c.startsWith('vs_voter='));
      expect(voterCookie).to.not.be.undefined;
      expect(voterCookie).to.include('HttpOnly');
      expect(voterCookie).to.include('SameSite=Lax');
      expect(voterCookie).to.include('Max-Age=');
    });

    it('returning voter logs in without password and receives vs_voter cookie (AC-2)', async () => {
      await User.create({
        email: 'returning@example.com',
        name: 'Returning Voter',
        username: 'returning_voter'
      });

      const challenge = await createChallenge({ email: 'returning@example.com' });

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/otp/verify',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        email: 'returning@example.com',
        code: challenge.code
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.isNewUser).to.be.false;
      expect(res.body.user.name).to.equal('Returning Voter');
      const setCookie = res.headers['set-cookie'];
      expect(setCookie.some(c => c.startsWith('vs_voter='))).to.be.true;
    });

    it('reflects CORS credentials header for allowed client origin (AC-11)', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/otp/request',
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST'
        }
      });

      expect(res.statusCode).to.equal(204);
      expect(res.headers['access-control-allow-origin']).to.equal('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).to.equal('true');
    });
  });

  describe('4. REST Endpoints: Voter /me, Profile Update, & Logout (AC-8, AC-9, AC-10)', () => {
    let authCookie;
    let userId;

    beforeEach(async () => {
      const user = await User.create({
        email: 'profile_tester@example.com',
        name: 'Profile Tester',
        username: 'profile_test'
      });
      userId = String(user._id);
      const token = generateVoterToken(user);
      authCookie = `vs_voter=${encodeURIComponent(token)}`;
    });

    it('GET /api/auth/voter/me returns profile when valid cookie is present (AC-8)', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/voter/me',
        method: 'GET',
        headers: { Cookie: authCookie }
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.user.email).to.equal('profile_tester@example.com');
      expect(res.body.user.username).to.equal('profile_test');
    });

    it('GET /api/auth/voter/me returns 401 without cookie (AC-8)', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/voter/me',
        method: 'GET'
      });

      expect(res.statusCode).to.equal(401);
      expect(res.body.success).to.be.false;
    });

    it('POST /api/auth/profile updates display name and username (AC-9)', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/profile',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie
        }
      }, {
        name: 'Updated Name',
        username: 'updated_user'
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.user.name).to.equal('Updated Name');
      expect(res.body.user.username).to.equal('updated_user');

      const refreshed = await User.findById(userId);
      expect(refreshed.name).to.equal('Updated Name');
      expect(refreshed.username).to.equal('updated_user');
    });

    it('POST /api/auth/profile rejects taken username with 409 (AC-9)', async () => {
      await User.create({
        email: 'other@example.com',
        username: 'taken_user',
        name: 'Other'
      });

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/profile',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie
        }
      }, {
        username: 'taken_user'
      });

      expect(res.statusCode).to.equal(409);
      expect(res.body.error).to.equal('USERNAME_TAKEN');
    });

    it('POST /api/auth/logout clears vs_voter cookie with Max-Age=0 (AC-10)', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/logout',
        method: 'POST',
        headers: { Cookie: authCookie }
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).to.be.an('array');
      const cleared = setCookie.find(c => c.startsWith('vs_voter='));
      expect(cleared).to.include('Max-Age=0');
    });
  });

  describe('5. Signed-in Voter Session Join & Duplicate Vote Prevention (AC-12, AC-13)', () => {
    let testUser;
    let authCookie;
    const sessionId = 'sess_test_otp_join';

    beforeEach(async () => {
      testUser = await User.create({
        email: 'session_voter@example.com',
        name: 'Signed In Voter',
        username: 'signed_voter'
      });
      const token = generateVoterToken(testUser);
      authCookie = `vs_voter=${encodeURIComponent(token)}`;

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'OTP Session',
        entries: ['Option A', 'Option B']
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId
      });
    });

    it('signed in voter joins session using user:userId key without setting per-session cookie (AC-12)', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: authCookie
        }
      }, {});

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.voterToken).to.equal(`user:${testUser._id}`);
      expect(res.body.displayName).to.equal('Signed In Voter'); // Pre-filled from profile!
      expect(res.body.isRegisteredUser).to.be.true;

      // Crucial AC-12 requirement: No per-session cookie is set for signed-in voters!
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).to.be.undefined;
    });

    it('anonymous voter joins same session and receives per-session cookie (AC-12)', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        displayName: 'Anon'
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.voterToken).to.not.include('user:');
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).to.be.an('array');
      expect(setCookie[0]).to.include(`voter_token_${sessionId}=`);
    });

    it('duplicate vote key uses composite user:userId shape (AC-13)', () => {
      const key = buildVoteKey(sessionId, ['Option A', 'Option B'], `user:${testUser._id}`, 'r1');
      expect(key).to.equal(`${sessionId}:::r1:::Option A:::Option B:::user:${testUser._id}`);
    });
  });

  describe('6. Security, Token Tampering & Expiry Hardening (AC-7, AC-8)', () => {
    it('verifyVoterToken rejects tampered token signatures', () => {
      const validToken = jwt.sign(
        { userId: 'usr_tamper', email: 'tamper@test.com', role: 'voter' },
        getVoterJwtSecret(),
        { expiresIn: '1h' }
      );
      const forgedToken = jwt.sign(
        { userId: 'usr_tamper', email: 'tamper@test.com', role: 'voter' },
        'wrong_secret_key',
        { expiresIn: '1h' }
      );

      const validCheck = verifyVoterToken(validToken);
      expect(validCheck.valid).to.be.true;

      const forgedCheck = verifyVoterToken(forgedToken);
      expect(forgedCheck.valid).to.be.false;
      expect(forgedCheck.error).to.equal('INVALID_TOKEN');
    });

    it('verifyVoterToken detects and rejects expired tokens', () => {
      const expiredToken = jwt.sign(
        { userId: 'usr_expired', email: 'expired@test.com', role: 'voter' },
        getVoterJwtSecret(),
        { expiresIn: '-1s' }
      );

      const check = verifyVoterToken(expiredToken);
      expect(check.valid).to.be.false;
      expect(check.error).to.equal('TOKEN_EXPIRED');
    });

    it('verifyVoterToken rejects tokens missing voter role or userId', () => {
      const noRole = jwt.sign({ userId: 'usr_norole' }, getVoterJwtSecret());
      expect(verifyVoterToken(noRole).valid).to.be.false;

      const wrongRole = jwt.sign({ userId: 'usr_wrong', role: 'admin' }, getVoterJwtSecret());
      expect(verifyVoterToken(wrongRole).valid).to.be.false;

      const noUser = jwt.sign({ role: 'voter' }, getVoterJwtSecret());
      expect(verifyVoterToken(noUser).valid).to.be.false;
    });

    it('verifyVoterToken handles null, undefined, or empty token inputs', () => {
      expect(verifyVoterToken(null).valid).to.be.false;
      expect(verifyVoterToken(undefined).valid).to.be.false;
      expect(verifyVoterToken('').valid).to.be.false;
      expect(verifyVoterToken(12345).valid).to.be.false;
    });

    it('GET /api/auth/voter/me returns 401 on tampered vs_voter cookie', async () => {
      const forgedToken = jwt.sign(
        { userId: 'usr_hacker', email: 'hacker@test.com', role: 'voter' },
        'unauthorized_secret'
      );

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/voter/me',
        method: 'GET',
        headers: { Cookie: `vs_voter=${encodeURIComponent(forgedToken)}` }
      });

      expect(res.statusCode).to.equal(401);
      expect(res.body.success).to.be.false;
      expect(res.body.error).to.equal('INVALID_TOKEN');
    });

    it('GET /api/auth/voter/me returns 401 on expired vs_voter cookie', async () => {
      const expiredToken = jwt.sign(
        { userId: 'usr_stale', email: 'stale@test.com', role: 'voter' },
        getVoterJwtSecret(),
        { expiresIn: '-10s' }
      );

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/voter/me',
        method: 'GET',
        headers: { Cookie: `vs_voter=${encodeURIComponent(expiredToken)}` }
      });

      expect(res.statusCode).to.equal(401);
      expect(res.body.success).to.be.false;
    });
  });

  describe('7. OTP Service Edge Cases, Error States & Integrity (AC-1, AC-3, AC-5, AC-6, AC-14)', () => {
    it('createChallenge rejects invalid or malformed email addresses', async () => {
      const badEmails = ['', 'not-an-email', '@missinguser.com', 'user@', null, undefined];
      for (const email of badEmails) {
        const res = await createChallenge({ email });
        expect(res.success).to.be.false;
        expect(res.error).to.equal('INVALID_EMAIL');
      }
    });

    it('createChallenge rejects invalid username formats and lengths', async () => {
      const badUsernames = ['ab', 'a'.repeat(21), 'has spaces', 'bad!symbols'];
      for (const username of badUsernames) {
        const res = await createChallenge({
          email: 'valid@test.com',
          username
        });
        expect(res.success).to.be.false;
        expect(res.error).to.equal('INVALID_USERNAME');
      }
    });

    it('createChallenge with already registered email discards pending fields (AC-5)', async () => {
      await User.create({
        email: 'original@example.com',
        name: 'Original Name',
        username: 'original_user'
      });

      const res = await createChallenge({
        email: 'original@example.com',
        name: 'Attempted Hijack Name',
        username: 'hijack_user'
      });

      expect(res.success).to.be.true;

      const challenge = await OtpChallenge.findOne({ email: 'original@example.com' });
      expect(challenge.pendingName).to.be.null;
      expect(challenge.pendingUsername).to.be.null;

      const verifyRes = await verifyChallenge({
        email: 'original@example.com',
        code: res.code
      });

      expect(verifyRes.success).to.be.true;
      expect(verifyRes.isNewUser).to.be.false;
      expect(verifyRes.user.name).to.equal('Original Name');
      expect(verifyRes.user.username).to.equal('original_user');
    });

    it('verifyChallenge rejects expired challenges with CODE_EXPIRED', async () => {
      const challenge = await createChallenge({ email: 'expired_otp@test.com' });
      expect(challenge.success).to.be.true;

      // Manually backdate the challenge expiration
      await OtpChallenge.updateOne(
        { email: 'expired_otp@test.com' },
        { expiresAt: new Date(Date.now() - 5000) }
      );

      const verifyRes = await verifyChallenge({
        email: 'expired_otp@test.com',
        code: challenge.code
      });

      expect(verifyRes.success).to.be.false;
      expect(verifyRes.error).to.equal('CODE_EXPIRED');
    });

    it('verifyChallenge rejects non-digit or wrong length code format', async () => {
      const badCodes = ['12345', '1234567', 'abcdef', '12 456', '', null, undefined];
      for (const code of badCodes) {
        const res = await verifyChallenge({
          email: 'test@example.com',
          code
        });
        expect(res.success).to.be.false;
        expect(res.error).to.equal('INVALID_CODE_FORMAT');
      }
    });

    it('verifyChallenge returns INVALID_OR_EXPIRED_CODE when challenge is missing', async () => {
      const res = await verifyChallenge({
        email: 'nonexistent@test.com',
        code: '123456'
      });
      expect(res.success).to.be.false;
      expect(res.error).to.equal('INVALID_OR_EXPIRED_CODE');
    });

    it('createChallenge returns challengeId and cancelChallenge deletes it', async () => {
      const challenge = await createChallenge({ email: 'cancel_test@example.com' });
      expect(challenge.success).to.be.true;
      expect(challenge.challengeId).to.not.be.undefined;

      const docBefore = await OtpChallenge.findById(challenge.challengeId);
      expect(docBefore).to.not.be.null;

      await cancelChallenge(challenge.challengeId);

      const docAfter = await OtpChallenge.findById(challenge.challengeId);
      expect(docAfter).to.be.null;

      // cancelChallenge safely handles null or undefined without throwing
      await cancelChallenge(null);
      await cancelChallenge(undefined);
    });
  });

  describe('8. REST Endpoints Input Validation & Error Handling (AC-1, AC-8, AC-9)', () => {
    it('POST /api/auth/otp/request returns 400 for missing or invalid email', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/otp/request',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        email: 'not-valid'
      });

      expect(res.statusCode).to.equal(400);
      expect(res.body.success).to.be.false;
      expect(res.body.error).to.equal('INVALID_EMAIL');
    });

    it('POST /api/auth/otp/verify returns 400 for missing email or code', async () => {
      const resMissingCode = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/otp/verify',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        email: 'valid@example.com'
      });

      expect(resMissingCode.statusCode).to.equal(400);
      expect(resMissingCode.body.error).to.equal('INVALID_CODE_FORMAT');

      const resMissingEmail = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/otp/verify',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        code: '123456'
      });

      expect(resMissingEmail.statusCode).to.equal(400);
      expect(resMissingEmail.body.error).to.equal('INVALID_EMAIL');
    });

    it('POST /api/auth/profile returns 400 when username format is invalid', async () => {
      const user = await User.create({
        email: 'prof_val@example.com',
        name: 'Profile Val',
        username: 'prof_val'
      });
      const cookie = `vs_voter=${encodeURIComponent(generateVoterToken(user))}`;

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/profile',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie
        }
      }, {
        username: 'invalid user name!'
      });

      expect(res.statusCode).to.equal(400);
      expect(res.body.error).to.equal('INVALID_USERNAME');
    });

    it('POST /api/auth/profile returns 400 when name exceeds 80 characters', async () => {
      const user = await User.create({
        email: 'prof_long@example.com',
        name: 'Profile Long',
        username: 'prof_long'
      });
      const cookie = `vs_voter=${encodeURIComponent(generateVoterToken(user))}`;

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/profile',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie
        }
      }, {
        name: 'A'.repeat(81)
      });

      expect(res.statusCode).to.equal(400);
      expect(res.body.error).to.equal('INVALID_DISPLAY_NAME');
    });
  });

  describe('9. Nodemailer Transport Fallback & Delivery (AC-1)', () => {
    afterEach(() => {
      setTransport(null);
    });

    it('sendOtpEmail logs to console when SMTP is unconfigured and returns mode console', async () => {
      setTransport(null);
      const res = await sendOtpEmail('test_console@example.com', '654321');
      expect(res.success).to.be.true;
      expect(res.mode).to.equal('console');
    });

    it('sendOtpEmail uses configured nodemailer transport to send email', async () => {
      let sentMailOptions = null;
      const mockTransport = {
        sendMail: async (options) => {
          sentMailOptions = options;
          return { messageId: 'mock-123' };
        }
      };

      setTransport(mockTransport);
      const res = await sendOtpEmail('recipient@example.com', '112233');

      expect(res.success).to.be.true;
      expect(res.mode).to.equal('smtp');
      expect(sentMailOptions).to.not.be.null;
      expect(sentMailOptions.to).to.equal('recipient@example.com');
      expect(sentMailOptions.text).to.include('112233');
      expect(sentMailOptions.html).to.include('112233');
    });

    it('sendOtpEmail handles transport failure gracefully without throwing', async () => {
      const failingTransport = {
        sendMail: async () => {
          throw new Error('SMTP connection timed out');
        }
      };

      setTransport(failingTransport);
      const res = await sendOtpEmail('fail@example.com', '998877');

      expect(res.success).to.be.false;
      expect(res.mode).to.equal('smtp');
      expect(res.error).to.include('SMTP connection timed out');
    });

    it('POST /api/auth/otp/request returns 502 EMAIL_DELIVERY_FAILED and deletes challenge when delivery fails', async () => {
      const failingTransport = {
        sendMail: async () => {
          throw new Error('SMTP connection timed out');
        }
      };
      setTransport(failingTransport);

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/otp/request',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        email: 'smtp_fail@example.com'
      });

      expect(res.statusCode).to.equal(502);
      expect(res.body.success).to.be.false;
      expect(res.body.error).to.equal('EMAIL_DELIVERY_FAILED');

      // Verify the challenge was deleted so cooldown is not burned
      const challenge = await OtpChallenge.findOne({ email: 'smtp_fail@example.com' });
      expect(challenge).to.be.null;

      // Restoring transport allows immediate retry without 429 COOLDOWN_ACTIVE
      setTransport(null);
      const retryRes = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/otp/request',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        email: 'smtp_fail@example.com'
      });

      expect(retryRes.statusCode).to.equal(200);
      expect(retryRes.body.success).to.be.true;
    });
  });

  describe('10. Socket Voter Identity Trust & Forgery Protection (AC-12, AC-13)', () => {
    let testSessionId;

    beforeEach(async () => {
      testSessionId = 'sess_socket_sec';
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: testSessionId,
        title: 'Socket Security Session',
        entries: ['Option A', 'Option B'],
        mode: 'single_ballot'
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId: testSessionId
      });
    });

    it('join_session ignores client supplied userId and assigns anonymous token when unauthenticated', (done) => {
      const socket = createSocketClient();
      socket.on('connect', () => {
        socket.emit('join_session', {
          sessionId: testSessionId,
          displayName: 'Mallory',
          userId: 'victim_user_123'
        }, (res) => {
          expect(res.success).to.be.true;
          expect(res.voterToken).to.be.a('string');
          expect(res.voterToken).to.not.equal('user:victim_user_123');
          expect(res.voterToken).to.not.include('user:');
          done();
        });
      });
    });

    it('rejects VOTE with forged user: token when socket has no verified voter cookie', (done) => {
      const victimId = 'victim_legit_456';
      registerVoter({
        sessionId: testSessionId,
        displayName: 'Victim',
        store,
        userId: victimId
      });

      const socket = createSocketClient();
      socket.on('connect', () => {
        socket.on('action_error', (err) => {
          expect(err.action).to.equal('VOTE');
          expect(err.error).to.equal('FORBIDDEN_VOTER_TOKEN');
          done();
        });

        socket.emit('action', {
          type: 'VOTE',
          sessionId: testSessionId,
          entry: 'Option A',
          voterToken: `user:${victimId}`
        });
      });
    });

    it('rejects VOTE with another user: token when socket is authenticated as a different user', async () => {
      const userA = await User.create({
        email: 'user_a_sec@example.com',
        username: 'user_a_sec',
        name: 'User A'
      });
      const tokenA = generateVoterToken(userA);

      const victimId = 'victim_other_789';
      registerVoter({
        sessionId: testSessionId,
        displayName: 'Victim Other',
        store,
        userId: victimId
      });

      const socket = createSocketClient({
        extraHeaders: {
          cookie: `vs_voter=${encodeURIComponent(tokenA)}`
        }
      });

      await new Promise((resolve, reject) => {
        socket.on('connect', () => {
          socket.on('action_error', (err) => {
            try {
              expect(err.action).to.equal('VOTE');
              expect(err.error).to.equal('FORBIDDEN_VOTER_TOKEN');
              resolve();
            } catch (e) {
              reject(e);
            }
          });

          socket.emit('action', {
            type: 'VOTE',
            sessionId: testSessionId,
            entry: 'Option A',
            voterToken: `user:${victimId}`
          });
        });
      });
    });

    it('subscribe_session ignores forged user: voterToken candidate when unauthenticated', async () => {
      const victimId = 'victim_sub_101';
      registerVoter({
        sessionId: testSessionId,
        displayName: 'Victim Sub',
        store,
        userId: victimId
      });

      const socket = createSocketClient();
      await new Promise((resolve) => socket.on('connect', resolve));

      // Attempt to subscribe with forged user token
      socket.emit('subscribe_session', {
        sessionId: testSessionId,
        voterToken: `user:${victimId}`
      });

      await new Promise((r) => setTimeout(r, 200));

      // Presence in store should NOT map socket to user:victim_sub_101
      const state = store.getState();
      const session = state.getIn(['sessions', testSessionId]);
      const presence = session ? session.get('presence') : null;
      const victimPresence = presence ? presence.get(`user:${victimId}`) : null;
      expect(victimPresence).to.be.undefined;
    });

    it('legitimate signed in voter casts vote and vote is recorded under user:userId composite key', async () => {
      const userLegit = await User.create({
        email: 'legit_voter@example.com',
        username: 'legit_voter',
        name: 'Legit Voter'
      });
      const token = generateVoterToken(userLegit);
      const userId = String(userLegit._id);

      registerVoter({
        sessionId: testSessionId,
        displayName: 'Legit Voter',
        store,
        userId
      });

      const socket = createSocketClient({
        extraHeaders: {
          cookie: `vs_voter=${encodeURIComponent(token)}`
        }
      });
      await new Promise((resolve) => socket.on('connect', resolve));

      let actionError = null;
      socket.on('action_error', (err) => { actionError = err; });

      socket.emit('action', {
        type: 'VOTE',
        sessionId: testSessionId,
        entry: 'Option A'
      });

      await new Promise((r) => setTimeout(r, 300));
      expect(actionError).to.be.null;

      // Duplicate vote should now be rejected as DUPLICATE_VOTE
      const dupPromise = new Promise((resolve) => {
        socket.once('action_error', resolve);
      });

      socket.emit('action', {
        type: 'VOTE',
        sessionId: testSessionId,
        entry: 'Option A'
      });

      const dupError = await dupPromise;
      expect(dupError.action).to.equal('VOTE');
      expect(dupError.error).to.equal('DUPLICATE_VOTE');
    });
  });
});

