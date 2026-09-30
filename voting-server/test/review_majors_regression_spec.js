import { expect } from 'chai';
import makeStore from '../src/store.js';
import { isOriginAllowed, getAllowedCorsOrigins } from '../src/server.js';
import { buildVoteKey, canCastVote, recordVote, clearVoters, registerVoter } from '../src/auth/voter.js';
import {
  verifyAdminCredentials,
  getIpThrottleWaitMs,
  getUnknownIdentifierThrottleWaitMs,
  clearAttemptThrottle,
  clearAdmin,
  seedAdmin
} from '../src/auth/admin.js';

describe('Regression: review major fixes', () => {
  describe('CORS origin allowlist', () => {
    const ORIGINAL_ENV = process.env.CORS_ALLOWED_ORIGINS;

    afterEach(() => {
      if (ORIGINAL_ENV === undefined) {
        delete process.env.CORS_ALLOWED_ORIGINS;
      } else {
        process.env.CORS_ALLOWED_ORIGINS = ORIGINAL_ENV;
      }
    });

    it('allows origins on the configured list', () => {
      process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173,https://app.example.com';
      expect(isOriginAllowed('http://localhost:5173')).to.be.true;
      expect(isOriginAllowed('https://app.example.com')).to.be.true;
    });

    it('rejects origins not on the list and missing origins', () => {
      process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
      expect(isOriginAllowed('https://evil.example.com')).to.be.false;
      expect(isOriginAllowed(undefined)).to.be.false;
    });

    it('defaults to the local dev client when env is unset', () => {
      delete process.env.CORS_ALLOWED_ORIGINS;
      expect(getAllowedCorsOrigins()).to.deep.equal(['http://localhost:5173', 'http://127.0.0.1:5173']);
      expect(isOriginAllowed('http://localhost:5173')).to.be.true;
    });

    it('supports the development wildcard', () => {
      process.env.CORS_ALLOWED_ORIGINS = '*';
      expect(isOriginAllowed('https://anything.example.com')).to.be.true;
    });
  });

  describe('round-scoped duplicate vote keys', () => {
    beforeEach(() => {
      clearVoters();
    });

    it('scopes the vote key by roundId when provided', () => {
      const keyR1 = buildVoteKey('sess_x', ['A', 'B'], 'token1', 'sess_x:::r1');
      const keyR2 = buildVoteKey('sess_x', ['A', 'B'], 'token1', 'sess_x:::r2');
      expect(keyR1).to.not.equal(keyR2);
      expect(keyR1).to.equal('sess_x:::sess_x:::r1:::A:::B:::token1');
    });

    it('keeps the legacy pair scoped shape when roundId is omitted', () => {
      expect(buildVoteKey('sess_x', ['A', 'B'], 'token1')).to.equal('sess_x:::A:::B:::token1');
    });

    it('normalizes pair order regardless of presentation order', () => {
      expect(buildVoteKey('s', ['B', 'A'], 't', 's:::r1')).to.equal(buildVoteKey('s', ['A', 'B'], 't', 's:::r1'));
    });

    it('accepts a vote in a later round for a pair already voted in an earlier round', () => {
      const store = makeStore();
      store.dispatch({ type: 'CREATE_SESSION', sessionId: 'sess_rep', title: 'R', entries: ['Alpha', 'Beta', 'Gamma'] });
      const voter = registerVoter({ sessionId: 'sess_rep', displayName: 'V', store });
      const token = voter.voter.sessionToken;
      const pair = ['Alpha', 'Beta'];

      const round1 = canCastVote({ sessionToken: token, sessionId: 'sess_rep', pair, roundId: 'sess_rep:::r1' });
      expect(round1.allowed).to.be.true;
      recordVote(round1.voteKey);

      const dupeRound1 = canCastVote({ sessionToken: token, sessionId: 'sess_rep', pair, roundId: 'sess_rep:::r1' });
      expect(dupeRound1.allowed).to.be.false;
      expect(dupeRound1.error).to.equal('DUPLICATE_VOTE');

      const round2 = canCastVote({ sessionToken: token, sessionId: 'sess_rep', pair, roundId: 'sess_rep:::r2' });
      expect(round2.allowed).to.be.true;
    });
  });

  describe('async bcrypt and login throttling', () => {
    beforeEach(() => {
      clearAdmin();
      clearAttemptThrottle();
      seedAdmin();
    });

    afterEach(() => {
      clearAttemptThrottle();
      clearAdmin();
    });

    it('verifies valid credentials asynchronously', async () => {
      const result = await verifyAdminCredentials('admin', 'adminPassword123!');
      expect(result.valid).to.be.true;
      expect(result.admin.username).to.equal('admin');
    });

    it('rejects bad credentials asynchronously', async () => {
      const result = await verifyAdminCredentials('admin', 'wrong');
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('INVALID_CREDENTIALS');
    });

    it('throttles after five consecutive failures with exponential backoff', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await verifyAdminCredentials('admin', 'wrong', { clientIp: '203.0.113.77' });
        expect(result.throttled).to.not.be.true;
      }
      expect(getIpThrottleWaitMs('203.0.113.77')).to.be.greaterThan(0);

      const blocked = await verifyAdminCredentials('admin', 'adminPassword123!', { clientIp: '203.0.113.77' });
      expect(blocked.valid).to.be.false;
      expect(blocked.error).to.equal('TOO_MANY_ATTEMPTS');
      expect(blocked.throttled).to.be.true;
    });

    it('keeps throttle state below the threshold', async () => {
      for (let i = 0; i < 3; i++) {
        await verifyAdminCredentials('admin', 'wrong', { clientIp: '203.0.113.78' });
      }
      expect(getIpThrottleWaitMs('203.0.113.78')).to.equal(0);
    });

    it('does not throttle a different address', async () => {
      for (let i = 0; i < 6; i++) {
        await verifyAdminCredentials('admin', 'wrong', { clientIp: '203.0.113.79' });
      }
      expect(getIpThrottleWaitMs('203.0.113.79')).to.be.greaterThan(0);
      // Another address keeps its own cold bucket
      expect(getIpThrottleWaitMs('203.0.113.80')).to.equal(0);
    });
  });
});
