import { expect } from 'chai';
import http from 'http';
import makeStore from '../src/store.js';
import startServer, {
  checkOtpRequestRateLimit,
  resetOtpRequestRateLimit,
  resetJoinRateLimit,
  OTP_RATE_LIMIT_MAX_PER_EMAIL,
  OTP_RATE_LIMIT_MAX_PER_IP,
  OTP_RATE_LIMIT_WINDOW_MS,
  JOIN_RATE_LIMIT_MAX,
  JOIN_RATE_LIMIT_WINDOW_MS
} from '../src/server.js';
import Session from '../src/db/models/Session.js';
import User from '../src/db/models/User.js';
import OtpChallenge from '../src/db/models/OtpChallenge.js';
import { setTransport } from '../src/email/transport.js';
import { consumeFixedWindow, createFixedWindowStore } from '../src/utils/rateLimit.js';
import {
  DEFAULT_MIN_RESPONSE_MS,
  getMinResponseMs,
  padToMinimumDuration,
  remainingResponsePadMs
} from '../src/utils/timing.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';

/**
 * Phase 9 hardening.
 *
 * Two things are pinned here. First, that the OTP request route enforces both
 * of its ceilings (5 per hour per email address, 20 per hour per client
 * address) and that the two keys are charged independently. Second, that the
 * OTP request route and the join code resolver answer a hit and a miss in the
 * same time band, so the clock cannot be turned back into the oracle the
 * generic response body refuses to be.
 */
describe('Phase 9: Hardening — rate limits and response timing', function () {
  this.timeout(30000);

  let server;
  let store;
  let port;
  // The shared suite raises the OTP ceilings so unrelated specs are never
  // refused. This spec is the one that has to prove the real ceilings apply.
  const savedEmailCeiling = process.env.OTP_RATE_LIMIT_MAX_PER_EMAIL;
  const savedIpCeiling = process.env.OTP_RATE_LIMIT_MAX_PER_IP;

  function request({ method, path, headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      const payload = body === null ? null : JSON.stringify(body);
      const startedAt = process.hrtime.bigint();
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: {
            ...(payload
              ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
              : {}),
            ...headers
          }
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            let parsed = raw;
            try {
              parsed = JSON.parse(raw);
            } catch {
              // keep as string
            }
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed, durationMs });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  before(async function () {
    this.timeout(120000);
    process.env.OTP_RATE_LIMIT_MAX_PER_EMAIL = String(OTP_RATE_LIMIT_MAX_PER_EMAIL);
    process.env.OTP_RATE_LIMIT_MAX_PER_IP = String(OTP_RATE_LIMIT_MAX_PER_IP);
    await setupTestDb();
    await User.init();
    await OtpChallenge.init();
  });

  after(async function () {
    this.timeout(30000);
    if (savedEmailCeiling === undefined) {
      delete process.env.OTP_RATE_LIMIT_MAX_PER_EMAIL;
    } else {
      process.env.OTP_RATE_LIMIT_MAX_PER_EMAIL = savedEmailCeiling;
    }
    if (savedIpCeiling === undefined) {
      delete process.env.OTP_RATE_LIMIT_MAX_PER_IP;
    } else {
      process.env.OTP_RATE_LIMIT_MAX_PER_IP = savedIpCeiling;
    }
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    resetOtpRequestRateLimit();
    resetJoinRateLimit();
    // Force the console fallback so an OTP request never waits on an SMTP
    // handshake this test machine cannot reach.
    setTransport(null);
    store = makeStore();
    server = startServer(store, 0);
    port = server.httpServer.address().port;
  });

  afterEach((done) => {
    if (server && server.httpServer) {
      server.httpServer.close(done);
    } else {
      done();
    }
  });

  describe('consumeFixedWindow', () => {
    it('allows exactly max attempts then refuses with a retry hint', () => {
      const buckets = createFixedWindowStore();
      const options = { windowMs: 1000, max: 3, now: 5000 };

      expect(consumeFixedWindow(buckets, 'k', options).allowed).to.equal(true);
      expect(consumeFixedWindow(buckets, 'k', options).allowed).to.equal(true);
      expect(consumeFixedWindow(buckets, 'k', options).allowed).to.equal(true);

      const blocked = consumeFixedWindow(buckets, 'k', options);
      expect(blocked.allowed).to.equal(false);
      expect(blocked.retryAfterMs).to.be.greaterThan(0);
    });

    it('rolls the window over once windowMs has elapsed', () => {
      const buckets = createFixedWindowStore();
      const options = { windowMs: 1000, max: 1, now: 0 };

      expect(consumeFixedWindow(buckets, 'k', options).allowed).to.equal(true);
      expect(consumeFixedWindow(buckets, 'k', { ...options, now: 500 }).allowed).to.equal(false);
      expect(consumeFixedWindow(buckets, 'k', { ...options, now: 1000 }).allowed).to.equal(true);
    });

    it('keeps keys independent and collapses an empty key into one bucket', () => {
      const buckets = createFixedWindowStore();
      const options = { windowMs: 60000, max: 1 };

      expect(consumeFixedWindow(buckets, 'a', options).allowed).to.equal(true);
      expect(consumeFixedWindow(buckets, 'b', options).allowed).to.equal(true);
      expect(consumeFixedWindow(buckets, 'a', options).allowed).to.equal(false);

      expect(consumeFixedWindow(buckets, '', options).allowed).to.equal(true);
      expect(consumeFixedWindow(buckets, null, options).allowed).to.equal(false);
    });

    it('keeps two stores isolated, so resetting one limiter never disturbs another', () => {
      // Each protected key space gets its own store by design (the header
      // comment pin it). If two limiters shared a bucket map, clearing the join
      // limiter would hand OTP senders a fresh budget.
      const otpBuckets = createFixedWindowStore();
      const joinBuckets = createFixedWindowStore();
      const options = { windowMs: 60000, max: 1, now: 1000 };

      expect(consumeFixedWindow(otpBuckets, 'ip-1', options).allowed).to.equal(true);
      expect(consumeFixedWindow(joinBuckets, 'ip-1', options).allowed).to.equal(true);

      joinBuckets.clear();

      expect(
        consumeFixedWindow(otpBuckets, 'ip-1', { ...options, now: 2000 }).allowed,
        'a sibling store being emptied must not reopen an exhausted OTP bucket'
      ).to.equal(false);
    });

    it('charges a rejected attempt too, so pacing cannot hold a key open forever', () => {
      const buckets = createFixedWindowStore();
      const options = { windowMs: 10000, max: 1 };

      expect(consumeFixedWindow(buckets, 'k', { ...options, now: 0 }).allowed).to.equal(true);
      expect(consumeFixedWindow(buckets, 'k', { ...options, now: 100 }).allowed).to.equal(false);
      // Even refused calls advance the bucket, so the ceiling cannot be
      // held open indefinitely by spacing just under the window.
      expect(consumeFixedWindow(buckets, 'k', { ...options, now: 9999 }).allowed).to.equal(false);
      expect(consumeFixedWindow(buckets, 'k', { ...options, now: 10001 }).allowed).to.equal(true);
    });

    it('reports remaining budget and never a negative retry hint', () => {
      const buckets = createFixedWindowStore();
      const options = { windowMs: 1000, max: 3, now: 0 };

      const first = consumeFixedWindow(buckets, 'k', options);
      expect(first.remaining).to.equal(2);
      const second = consumeFixedWindow(buckets, 'k', options);
      expect(second.remaining).to.equal(1);
      const third = consumeFixedWindow(buckets, 'k', options);
      expect(third.remaining).to.equal(0);

      const blocked = consumeFixedWindow(buckets, 'k', { ...options, now: 999 });
      expect(blocked.remaining).to.equal(0);
      expect(blocked.retryAfterMs, 'an honest Retry-After can never be zero or negative').to.be.greaterThan(0);
    });

    it('answers an exhausted bucket in a fresh window with a full budget', () => {
      const buckets = createFixedWindowStore();
      const options = { windowMs: 1000, max: 2 };

      expect(consumeFixedWindow(buckets, 'k', { ...options, now: 0 }).allowed).to.equal(true);
      expect(consumeFixedWindow(buckets, 'k', { ...options, now: 0 }).allowed).to.equal(true);
      expect(consumeFixedWindow(buckets, 'k', { ...options, now: 500 }).allowed).to.equal(false);

      const fresh = consumeFixedWindow(buckets, 'k', { ...options, now: 1500 });
      expect(fresh.allowed).to.equal(true);
      expect(fresh.remaining, 'the new window starts with a full budget minus the slot just used').to.equal(1);
      expect(fresh.retryAfterMs).to.equal(0);
    });
  });

  describe('response timing helper', () => {
    const savedFloor = process.env.API_MIN_RESPONSE_MS;

    afterEach(() => {
      if (savedFloor === undefined) {
        delete process.env.API_MIN_RESPONSE_MS;
      } else {
        process.env.API_MIN_RESPONSE_MS = savedFloor;
      }
    });

    it('defaults the floor and reads an override, ignoring a junk value', () => {
      expect(getMinResponseMs({})).to.equal(DEFAULT_MIN_RESPONSE_MS);
      expect(getMinResponseMs({ API_MIN_RESPONSE_MS: '250' })).to.equal(250);
      expect(getMinResponseMs({ API_MIN_RESPONSE_MS: '0' })).to.equal(0);
      expect(getMinResponseMs({ API_MIN_RESPONSE_MS: 'nonsense' })).to.equal(DEFAULT_MIN_RESPONSE_MS);

      delete process.env.API_MIN_RESPONSE_MS;
      expect(getMinResponseMs()).to.equal(DEFAULT_MIN_RESPONSE_MS);
    });

    it('ignores a negative override so the parity guard cannot be silently disabled', () => {
      // parseInt('-50') is finite and greater than zero is not checked in the
      // helper, so consider what the code does: only raw >= 0 is accepted.
      expect(getMinResponseMs({ API_MIN_RESPONSE_MS: '-50' })).to.equal(DEFAULT_MIN_RESPONSE_MS);
    });

    it('reports the remainder owed and zero once the floor has elapsed', () => {
      expect(remainingResponsePadMs(1000, 100, 1050)).to.equal(50);
      expect(remainingResponsePadMs(1000, 100, 1099)).to.equal(1);
      expect(remainingResponsePadMs(1000, 100, 1100)).to.equal(0);
      expect(remainingResponsePadMs(1000, 100, 5000)).to.equal(0);
      expect(remainingResponsePadMs(0, 0, 12345)).to.equal(0);
    });

    it('holds a fast call open and returns immediately for an already slow one', async () => {
      const fastStart = Date.now();
      await padToMinimumDuration(fastStart, 60);
      expect(Date.now() - fastStart).to.be.at.least(55);

      const slowStart = Date.now() - 500;
      const before = Date.now();
      await padToMinimumDuration(slowStart, 60);
      expect(Date.now() - before).to.be.lessThan(30);
    });
  });

  describe('OTP request rate limits', () => {
    it('caps an email address at five requests per window and refuses the sixth', () => {
      resetOtpRequestRateLimit();
      const email = 'voter@example.com';
      const clientIp = '10.0.0.1';

      for (let i = 1; i <= OTP_RATE_LIMIT_MAX_PER_EMAIL; i++) {
        expect(
          checkOtpRequestRateLimit({ email, clientIp }).allowed,
          `attempt ${i} should be allowed`
        ).to.equal(true);
      }

      const blocked = checkOtpRequestRateLimit({ email, clientIp });
      expect(blocked.allowed).to.equal(false);
      expect(blocked.retryAfterMs).to.be.greaterThan(0);
      expect(blocked.retryAfterMs).to.be.at.most(OTP_RATE_LIMIT_WINDOW_MS);
    });

    it('charges the email key, so another address on the same client is untouched', () => {
      resetOtpRequestRateLimit();
      const clientIp = '10.0.0.9';
      for (let i = 0; i < OTP_RATE_LIMIT_MAX_PER_EMAIL; i++) {
        checkOtpRequestRateLimit({ email: 'capped@example.com', clientIp });
      }

      expect(checkOtpRequestRateLimit({ email: 'capped@example.com', clientIp }).allowed).to.equal(false);
      expect(checkOtpRequestRateLimit({ email: 'fresh@example.com', clientIp }).allowed).to.equal(true);
    });

    it('caps a client address at twenty requests per window across a rotating email', () => {
      resetOtpRequestRateLimit();
      const clientIp = '10.0.0.2';

      for (let i = 0; i < OTP_RATE_LIMIT_MAX_PER_IP; i++) {
        expect(
          checkOtpRequestRateLimit({ email: `rotating-${i}@example.com`, clientIp }).allowed,
          `attempt ${i + 1} should be allowed`
        ).to.equal(true);
      }

      const blocked = checkOtpRequestRateLimit({ email: 'last@example.com', clientIp });
      expect(blocked.allowed).to.equal(false);
      // A different client address keeps its own budget.
      expect(checkOtpRequestRateLimit({ email: 'last@example.com', clientIp: '10.0.0.3' }).allowed).to.equal(true);
    });

    it('charges the client address even when no usable email key is supplied', () => {
      resetOtpRequestRateLimit();
      const clientIp = '10.0.0.4';
      for (let i = 0; i < OTP_RATE_LIMIT_MAX_PER_IP; i++) {
        expect(checkOtpRequestRateLimit({ clientIp }).allowed).to.equal(true);
      }
      expect(checkOtpRequestRateLimit({ clientIp }).allowed).to.equal(false);
    });

    it('answers the sixth request for one email with RATE_LIMITED and a Retry-After header', async () => {
      const email = 'rate.limit@example.com';

      const first = await request({ method: 'POST', path: '/api/auth/otp/request', body: { email } });
      expect(first.statusCode).to.equal(200);

      // Attempts two through five are refused by the per email resend cooldown,
      // which is the pre existing behaviour and confirms the limiter let them
      // through rather than swallowing them.
      for (let i = 2; i <= OTP_RATE_LIMIT_MAX_PER_EMAIL; i++) {
        const res = await request({ method: 'POST', path: '/api/auth/otp/request', body: { email } });
        expect(res.statusCode).to.equal(429);
        expect(res.body.error).to.equal('COOLDOWN_ACTIVE');
      }

      const sixth = await request({ method: 'POST', path: '/api/auth/otp/request', body: { email } });
      expect(sixth.statusCode).to.equal(429);
      expect(sixth.body.error).to.equal('RATE_LIMITED');
      expect(sixth.body.success).to.equal(false);
      expect(Number(sixth.headers['retry-after'])).to.be.greaterThan(0);
    });

    it('keys the per client budget on the real address unless TRUST_PROXY is set', async () => {
      process.env.TRUST_PROXY = 'true';
      try {
        for (let i = 0; i < OTP_RATE_LIMIT_MAX_PER_EMAIL; i++) {
          await request({
            method: 'POST',
            path: '/api/auth/otp/request',
            body: { email: 'shared@example.com' },
            headers: { 'x-forwarded-for': '198.51.100.1' }
          });
        }

        const blockedSameEmail = await request({
          method: 'POST',
          path: '/api/auth/otp/request',
          body: { email: 'shared@example.com' },
          headers: { 'x-forwarded-for': '198.51.100.1' }
        });
        expect(blockedSameEmail.body.error).to.equal('RATE_LIMITED');

        // Same email from a second address: still capped by the email key.
        const blockedSecondIp = await request({
          method: 'POST',
          path: '/api/auth/otp/request',
          body: { email: 'shared@example.com' },
          headers: { 'x-forwarded-for': '198.51.100.2' }
        });
        expect(blockedSecondIp.body.error).to.equal('RATE_LIMITED');

        // A fresh email from that second address has its own budget.
        const fresh = await request({
          method: 'POST',
          path: '/api/auth/otp/request',
          body: { email: 'unrelated@example.com' },
          headers: { 'x-forwarded-for': '198.51.100.2' }
        });
        expect(fresh.statusCode).to.equal(200);
      } finally {
        delete process.env.TRUST_PROXY;
      }
    });

    it('pins the join resolver ceilings alongside the OTP ones', () => {
      expect(JOIN_RATE_LIMIT_MAX).to.equal(30);
      expect(JOIN_RATE_LIMIT_WINDOW_MS).to.equal(60000);
      expect(OTP_RATE_LIMIT_MAX_PER_EMAIL).to.equal(5);
      expect(OTP_RATE_LIMIT_MAX_PER_IP).to.equal(20);
      expect(OTP_RATE_LIMIT_WINDOW_MS).to.equal(3600000);
    });
  });

  describe('response timing parity', () => {
    const FLOOR = 120;
    const savedFloor = process.env.API_MIN_RESPONSE_MS;

    before(() => {
      process.env.API_MIN_RESPONSE_MS = String(FLOOR);
    });

    after(() => {
      if (savedFloor === undefined) {
        delete process.env.API_MIN_RESPONSE_MS;
      } else {
        process.env.API_MIN_RESPONSE_MS = savedFloor;
      }
    });

    it('answers a live join code and an unknown join code in the same time band', async () => {
      await Session.create({
        sessionId: 'sess_timing',
        title: 'Timing Session',
        entries: ['Ada', 'Grace'],
        status: 'pending',
        type: 'public',
        votingMode: 'single_ballot',
        joinCode: 'T1M1NG'
      });

      const hit = await request({ method: 'GET', path: '/api/join/T1M1NG' });
      const miss = await request({ method: 'GET', path: '/api/join/ZZZZZZ' });

      expect(hit.statusCode).to.equal(200);
      expect(miss.statusCode).to.equal(404);
      expect(hit.body).to.not.deep.equal(miss.body);
      // Without the floor both of these land in single digit milliseconds and
      // the difference is what leaks; the floor is what makes them match.
      expect(hit.durationMs).to.be.at.least(FLOOR - 30);
      expect(miss.durationMs).to.be.at.least(FLOOR - 30);
      expect(Math.abs(hit.durationMs - miss.durationMs)).to.be.at.most(80);
    });

    it('answers an OTP request for a registered and an unregistered address in the same time band', async () => {
      await User.create({ email: 'known@example.com', name: 'Known Voter', username: 'known_voter' });

      const registered = await request({
        method: 'POST',
        path: '/api/auth/otp/request',
        body: { email: 'known@example.com' }
      });
      const stranger = await request({
        method: 'POST',
        path: '/api/auth/otp/request',
        body: { email: 'stranger@example.com' }
      });

      // Both bodies are identical by design, so the clock is the only signal.
      expect(registered.statusCode).to.equal(200);
      expect(stranger.statusCode).to.equal(200);
      expect(registered.body).to.deep.equal(stranger.body);
      expect(registered.durationMs).to.be.at.least(FLOOR - 30);
      expect(stranger.durationMs).to.be.at.least(FLOOR - 30);
      expect(Math.abs(registered.durationMs - stranger.durationMs)).to.be.at.most(80);
    });

    it('pads the refusal paths too, so a throttled answer is not faster than an accepted one', async () => {
      const malformed = await request({ method: 'GET', path: '/api/join/NOPE' });
      expect(malformed.statusCode).to.equal(404);
      expect(malformed.durationMs).to.be.at.least(FLOOR - 30);
    });
  });
});
