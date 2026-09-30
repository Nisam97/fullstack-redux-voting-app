import { expect } from 'chai';
import {
  verifyAdminCredentials,
  getIpThrottleWaitMs,
  getUnknownIdentifierThrottleWaitMs,
  normalizeClientIp,
  clearAttemptThrottle,
  clearAdmin,
  seedAdmin
} from '../src/auth/admin.js';
import { resolveClientIp } from '../src/server.js';

/**
 * Regression specs for the IP-keyed login throttle with a shared pool for
 * unknown identifiers.
 *
 * Threat model: an attacker previously evaded per-identifier throttling by
 * rotating the identifier they presented. With IP keying they can no longer do
 * that from one address, and the shared unknown identifier pool closes the
 * remaining hole of rotating both identifiers and source addresses.
 */
describe('Regression: IP-keyed login throttle', () => {
  beforeEach(() => {
    clearAdmin();
    clearAttemptThrottle();
    seedAdmin();
  });

  afterEach(() => {
    clearAttemptThrottle();
    clearAdmin();
  });

  describe('normalizeClientIp', () => {
    it('lowercases, strips IPv4 mapped IPv6 prefixes and trailing ports on IPv4', () => {
      expect(normalizeClientIp('::ffff:127.0.0.1')).to.equal('127.0.0.1');
      expect(normalizeClientIp('::FFFF:192.168.1.9')).to.equal('192.168.1.9');
      expect(normalizeClientIp('203.0.113.7:51900')).to.equal('203.0.113.7');
      expect(normalizeClientIp(' 2001:DB8::1 ')).to.equal('2001:db8::1');
    });

    it('collapses empty or unusable input into one shared bucket', () => {
      expect(normalizeClientIp('')).to.equal('unknown-client');
      expect(normalizeClientIp(null)).to.equal('unknown-client');
      expect(normalizeClientIp(undefined)).to.equal('unknown-client');
    });
  });

  describe('resolveClientIp', () => {
    afterEach(() => {
      delete process.env.TRUST_PROXY;
    });

    it('uses the socket address by default and ignores a client sent x-forwarded-for', () => {
      delete process.env.TRUST_PROXY;
      const ip = resolveClientIp({ 'x-forwarded-for': '9.9.9.9' }, '127.0.0.1');
      expect(ip).to.equal('127.0.0.1');
    });

    it('trusts x-forwarded-for only when TRUST_PROXY=true', () => {
      process.env.TRUST_PROXY = 'true';
      const ip = resolveClientIp({ 'x-forwarded-for': '203.0.113.4, 10.0.0.1' }, '127.0.0.1');
      expect(ip).to.equal('203.0.113.4');
      expect(resolveClientIp({}, '127.0.0.1')).to.equal('127.0.0.1');
    });
  });

  describe('per-IP buckets', () => {
    it('throttles after five failures from one address regardless of the identifier presented', async () => {
      const ip = '198.51.100.10';
      // The old evasion: rotate identifiers, every bucket stays cold
      for (let i = 0; i < 5; i++) {
        const result = await verifyAdminCredentials(`rotating-user-${i}`, 'wrong', { clientIp: ip });
        expect(result.error).to.not.equal('TOO_MANY_ATTEMPTS');
      }
      // Same address is now throttled no matter which identifier it presents
      const blocked = await verifyAdminCredentials('admin', 'adminPassword123!', { clientIp: ip });
      expect(blocked.error).to.equal('TOO_MANY_ATTEMPTS');
      expect(getIpThrottleWaitMs(ip)).to.be.greaterThan(0);
    });

    it('never lets one address lock out another address', async () => {
      const attacker = '198.51.100.11';
      for (let i = 0; i < 6; i++) {
        await verifyAdminCredentials('admin', 'wrong', { clientIp: attacker });
      }
      const victim = await verifyAdminCredentials('admin', 'adminPassword123!', { clientIp: '198.51.100.12' });
      expect(victim.valid).to.be.true;
    });

    it('resets the IP bucket after a successful login once the backoff elapses', async function () {
      this.timeout(8000);
      const ip = '198.51.100.13';
      for (let i = 0; i < 5; i++) {
        await verifyAdminCredentials('admin', 'wrong', { clientIp: ip });
      }
      expect(getIpThrottleWaitMs(ip)).to.be.greaterThan(0);
      // Hot bucket blocks even correct credentials until the backoff elapses
      const blocked = await verifyAdminCredentials('admin', 'adminPassword123!', { clientIp: ip });
      expect(blocked.error).to.equal('TOO_MANY_ATTEMPTS');

      await new Promise((r) => setTimeout(r, 1100));
      const ok = await verifyAdminCredentials('admin', 'adminPassword123!', { clientIp: ip });
      expect(ok.valid).to.be.true;
      expect(getIpThrottleWaitMs(ip)).to.equal(0);
      // The bucket was truly reset: one fresh wrong attempt must not throttle
      await verifyAdminCredentials('admin', 'wrong', { clientIp: ip });
      expect(getIpThrottleWaitMs(ip)).to.equal(0);
    });
  });

  describe('shared unknown identifier pool', () => {
    it('pools failures against unknown identifiers and gates unknown names from any address', async () => {
      // Five distinct addresses, five distinct unknown identifiers, one wrong password each
      for (let i = 0; i < 5; i++) {
        const r = await verifyAdminCredentials(`ghost-${i}`, 'wrong', { clientIp: `198.51.100.100.${i}` });
        expect(r.error).to.equal('INVALID_CREDENTIALS');
      }
      expect(getUnknownIdentifierThrottleWaitMs()).to.be.greaterThan(0);
      // A sixth, never-seen address trying any unknown identifier is gated
      const gated = await verifyAdminCredentials('brand-new-ghost', 'wrong', { clientIp: '198.51.100.200' });
      expect(gated.error).to.equal('TOO_MANY_ATTEMPTS');
    });

    it('never applies the shared pool to the real admin identifier', async () => {
      for (let i = 0; i < 6; i++) {
        await verifyAdminCredentials(`ghost-${i}`, 'wrong', { clientIp: `198.51.100.101.${i}` });
      }
      expect(getUnknownIdentifierThrottleWaitMs()).to.be.greaterThan(0);
      // The admin identifier, presenting correct credentials, from a cold IP still succeeds
      const ok = await verifyAdminCredentials('admin', 'adminPassword123!', { clientIp: '198.51.100.201' });
      expect(ok.valid).to.be.true;
      // ...and success clears the shared pool so unknown identifiers breathe again
      expect(getUnknownIdentifierThrottleWaitMs()).to.equal(0);
    });
  });

  describe('missing input handling', () => {
    it('counts missing identifiers against the shared pool and the IP', async () => {
      const r = await verifyAdminCredentials('', '', { clientIp: '198.51.100.30' });
      expect(r.valid).to.be.false;
      expect(r.error).to.equal('INVALID_CREDENTIALS');
      expect(getIpThrottleWaitMs('198.51.100.30')).to.equal(0);
      // One failure is below the threshold, so no wait yet; but the pool counted it
      expect(getUnknownIdentifierThrottleWaitMs()).to.equal(0);
      for (let i = 0; i < 5; i++) {
        await verifyAdminCredentials('', '', { clientIp: '198.51.100.31' });
      }
      expect(getUnknownIdentifierThrottleWaitMs()).to.be.greaterThan(0);
    });
  });
});
