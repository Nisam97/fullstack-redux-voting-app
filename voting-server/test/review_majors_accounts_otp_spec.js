import { expect } from 'chai';
import http from 'http';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import User from '../src/db/models/User.js';
import OtpChallenge from '../src/db/models/OtpChallenge.js';
import { createChallenge } from '../src/auth/otp.js';
import { validateVoterJwtSecret, resetVoterSecretWarning } from '../src/auth/voterCookie.js';
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

describe('Accounts and OTP review majors regression suite', function() {
  this.timeout(15000);

  let io;
  let port;
  let store;

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
  });

  describe('Major 1: Cooldown ordering and taken username isolation', () => {
    it('returns COOLDOWN_ACTIVE when resending during active cooldown even if username is taken', async () => {
      await User.create({
        email: 'other@example.com',
        username: 'taken_name',
        name: 'Other User'
      });

      const first = await createChallenge({
        email: 'voter1@example.com',
        name: 'Voter One',
        username: 'voter_one'
      });
      expect(first.success).to.be.true;

      const resend = await createChallenge({
        email: 'voter1@example.com',
        name: 'Voter One',
        username: 'taken_name'
      });

      expect(resend.success).to.be.false;
      expect(resend.error).to.equal('COOLDOWN_ACTIVE');
      expect(resend.retryAfterSeconds).to.be.greaterThan(0);
    });

    it('rejecting a taken username does not burn cooldown or create a challenge doc', async () => {
      await User.create({
        email: 'existing@example.com',
        username: 'reserved_name',
        name: 'Existing Person'
      });

      const attempt = await createChallenge({
        email: 'fresh@example.com',
        name: 'Fresh Voter',
        username: 'reserved_name'
      });

      expect(attempt.success).to.be.false;
      expect(attempt.error).to.equal('USERNAME_TAKEN');

      const count = await OtpChallenge.countDocuments({ email: 'fresh@example.com' });
      expect(count).to.equal(0);

      const immediateRetry = await createChallenge({
        email: 'fresh@example.com',
        name: 'Fresh Voter',
        username: 'fresh_name'
      });
      expect(immediateRetry.success).to.be.true;
    });
  });

  describe('Major 2: Voter JWT secret validation and warnings', () => {
    it('throws in production when VOTER_JWT_SECRET is missing', () => {
      expect(() => {
        validateVoterJwtSecret({ NODE_ENV: 'production' });
      }).to.throw(/VOTER_JWT_SECRET environment variable is required in production/);
    });

    it('warns once in development when VOTER_JWT_SECRET is missing and returns false', () => {
      resetVoterSecretWarning();
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (msg) => warnings.push(msg);

      try {
        const result1 = validateVoterJwtSecret({ NODE_ENV: 'development' });
        const result2 = validateVoterJwtSecret({ NODE_ENV: 'development' });

        expect(result1).to.be.false;
        expect(result2).to.be.false;
        expect(warnings.length).to.equal(1);
        expect(warnings[0]).to.include('VOTER_JWT_SECRET is not set');
      } finally {
        console.warn = originalWarn;
      }
    });

    it('returns true when VOTER_JWT_SECRET is configured', () => {
      const result = validateVoterJwtSecret({
        NODE_ENV: 'production',
        VOTER_JWT_SECRET: 'super_secret_test_key_12345'
      });
      expect(result).to.be.true;
    });
  });

  describe('Major 3: Outer error handling on OTP routes', () => {
    it('returns 500 with generic error and does not crash when request encounters unexpected error', async () => {
      const originalFindOne = OtpChallenge.findOne;
      OtpChallenge.findOne = () => {
        throw new Error('Simulated database blip during OTP request');
      };

      try {
        const res = await httpRequest({
          hostname: 'localhost',
          port,
          path: '/api/auth/otp/request',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, {
          email: 'crash_test@example.com'
        });

        expect(res.statusCode).to.equal(500);
        expect(res.body.success).to.be.false;
        expect(res.body.error).to.equal('INTERNAL_SERVER_ERROR');
      } finally {
        OtpChallenge.findOne = originalFindOne;
      }
    });

    it('returns 500 with generic error when verify encounters unexpected error', async () => {
      const originalFindOne = OtpChallenge.findOne;
      OtpChallenge.findOne = () => {
        throw new Error('Simulated database blip during OTP verify');
      };

      try {
        const res = await httpRequest({
          hostname: 'localhost',
          port,
          path: '/api/auth/otp/verify',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, {
          email: 'crash_test2@example.com',
          code: '123456'
        });

        expect(res.statusCode).to.equal(500);
        expect(res.body.success).to.be.false;
        expect(res.body.error).to.equal('INTERNAL_SERVER_ERROR');
      } finally {
        OtpChallenge.findOne = originalFindOne;
      }
    });
  });
});
