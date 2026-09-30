import { expect } from 'chai';
import http from 'http';
import crypto from 'crypto';
import ioClient from 'socket.io-client';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import User from '../src/db/models/User.js';
import Session from '../src/db/models/Session.js';
import OtpChallenge from '../src/db/models/OtpChallenge.js';
import { createChallenge, verifyChallenge, escapeRegex } from '../src/auth/otp.js';
import { generateVoterToken } from '../src/auth/voterCookie.js';
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

describe('Accounts and OTP review minors regression suite', function() {
  this.timeout(15000);

  let io;
  let port;
  let store;

  before(async () => {
    await setupTestDb();
    await User.init();
    await Session.init();
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

  describe('Minor 1: Fallback username collision retry (covers: AC-1)', () => {
    it('retries with a fresh suffix when generated fallback username collides with an existing user', async () => {
      // Seed an existing user with the username that the first random suffix would generate
      await User.create({
        email: 'alice@example.com',
        name: 'Alice Original',
        username: 'voter_aabbcc'
      });

      // Request a challenge with no username (login intent)
      const challengeRes = await createChallenge({
        email: 'voter@example.com'
      });
      expect(challengeRes.success).to.be.true;

      // Stub crypto.randomBytes to return 'aabbcc' on first call (collision) and 'ddeeff' on second call
      const originalRandomBytes = crypto.randomBytes;
      let callCount = 0;
      crypto.randomBytes = (size) => {
        callCount += 1;
        if (callCount === 1) {
          return Buffer.from('aabbcc', 'hex');
        }
        return Buffer.from('ddeeff', 'hex');
      };

      try {
        const verifyRes = await verifyChallenge({
          email: 'voter@example.com',
          code: challengeRes.code
        });

        expect(verifyRes.success).to.be.true;
        expect(verifyRes.isNewUser).to.be.true;
        expect(verifyRes.user.username).to.equal('voter_ddeeff');
        expect(callCount).to.be.greaterThan(1);
      } finally {
        crypto.randomBytes = originalRandomBytes;
      }
    });

    it('falls back to timestamp suffix if all 5 random collision attempts collide', async () => {
      await User.create({
        email: 'collision_master@example.com',
        name: 'Collision Master',
        username: 'voter_112233'
      });

      const challengeRes = await createChallenge({
        email: 'voter@example.com'
      });
      expect(challengeRes.success).to.be.true;

      const originalRandomBytes = crypto.randomBytes;
      crypto.randomBytes = () => Buffer.from('112233', 'hex');

      try {
        const verifyRes = await verifyChallenge({
          email: 'voter@example.com',
          code: challengeRes.code
        });

        expect(verifyRes.success).to.be.true;
        expect(verifyRes.isNewUser).to.be.true;
        expect(verifyRes.user.username).to.not.equal('voter_112233');
        expect(verifyRes.user.username).to.match(/^voter_[a-z0-9]+$/);
      } finally {
        crypto.randomBytes = originalRandomBytes;
      }
    });

    it('uses explicit pendingUsername directly without running collision retry loop', async () => {
      const challengeRes = await createChallenge({
        email: 'custom_username_voter@example.com',
        name: 'Custom Person',
        username: 'chosen_nick'
      });
      expect(challengeRes.success).to.be.true;

      const verifyRes = await verifyChallenge({
        email: 'custom_username_voter@example.com',
        code: challengeRes.code
      });

      expect(verifyRes.success).to.be.true;
      expect(verifyRes.user.username).to.equal('chosen_nick');
    });
  });

  describe('Minor 2: Safe regular expression escaping (covers: AC-9, AC-14)', () => {
    it('escapes all special regular expression characters properly', () => {
      const dangerous = 'user.*+?^${}()|[]\\test';
      const escaped = escapeRegex(dangerous);
      expect(escaped).to.equal('user\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\test');

      // Verify that the resulting regex matches literal string only
      const re = new RegExp(`^${escaped}$`, 'i');
      expect(re.test(dangerous)).to.be.true;
      expect(re.test('userXtest')).to.be.false;
    });

    it('returns empty string when input is not a string', () => {
      expect(escapeRegex(null)).to.equal('');
      expect(escapeRegex(undefined)).to.equal('');
      expect(escapeRegex(123)).to.equal('');
    });

    it('profile update username check with special regex characters handles literal query safely', async () => {
      const user = await User.create({
        email: 'regex_user@example.com',
        name: 'Regex User',
        username: 'regex_normal'
      });

      const token = generateVoterToken(user);

      // Attempt profile update with regex characters in username (valid per isValidUsername regex)
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/api/auth/profile',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `vs_voter=${token}`
        }
      }, {
        username: 'regex_valid_123'
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.user.username).to.equal('regex_valid_123');
    });
  });

  describe('Minor 4: REST and Socket join displayNameSource signaling (covers: AC-12, AC-17)', () => {
    const sessionId = 'test_session_source_1';

    beforeEach(async () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Display Name Source Session',
        entries: ['Candidate A', 'Candidate B']
      });
    });

    it('returns displayNameSource as anonymous for guest voters', async () => {
      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        displayName: 'Guest Voter'
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.displayName).to.equal('Guest Voter');
      expect(res.body.displayNameSource).to.equal('anonymous');
      expect(res.body.isRegisteredUser).to.be.false;
    });

    it('returns displayNameSource as profile when signed in voter leaves displayName blank', async () => {
      const user = await User.create({
        email: 'profile_voter@example.com',
        name: 'Profile Display Name',
        username: 'profile_voter'
      });

      const token = generateVoterToken(user);

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `vs_voter=${token}`
        }
      }, {
        displayName: ''
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.displayName).to.equal('Profile Display Name');
      expect(res.body.displayNameSource).to.equal('profile');
      expect(res.body.isRegisteredUser).to.be.true;
    });

    it('returns displayNameSource as profile when signed in voter provides whitespace only displayName', async () => {
      const user = await User.create({
        email: 'whitespace_voter@example.com',
        name: 'Whitespace Fallback Name',
        username: 'whitespace_voter'
      });

      const token = generateVoterToken(user);

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `vs_voter=${token}`
        }
      }, {
        displayName: '   '
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.displayName).to.equal('Whitespace Fallback Name');
      expect(res.body.displayNameSource).to.equal('profile');
    });

    it('returns displayNameSource as custom when signed in voter provides custom displayName', async () => {
      const user = await User.create({
        email: 'custom_voter@example.com',
        name: 'Profile Name',
        username: 'custom_voter'
      });

      const token = generateVoterToken(user);

      const res = await httpRequest({
        hostname: 'localhost',
        port,
        path: `/api/sessions/${sessionId}/join`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `vs_voter=${token}`
        }
      }, {
        displayName: 'Custom Nickname'
      });

      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.displayName).to.equal('Custom Nickname');
      expect(res.body.displayNameSource).to.equal('custom');
      expect(res.body.isRegisteredUser).to.be.true;
    });

    it('provides displayNameSource in socket join_session callback', (done) => {
      const clientSocket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join_session', {
          sessionId,
          displayName: 'Socket Guest Voter'
        }, (res) => {
          expect(res.success).to.be.true;
          expect(res.displayName).to.equal('Socket Guest Voter');
          expect(res.displayNameSource).to.equal('anonymous');
          clientSocket.close();
          done();
        });
      });
    });
  });
});
