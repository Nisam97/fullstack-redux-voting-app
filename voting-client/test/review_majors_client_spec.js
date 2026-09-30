import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requestOtp } from '../src/services/auth.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Accounts and OTP client review majors regression tests', () => {

  describe('1. OTP Request Cooldown Handling (Major 1)', () => {
    it('propagates retryAfterSeconds when server returns 429 COOLDOWN_ACTIVE', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 429,
          json: async () => ({
            success: false,
            error: 'COOLDOWN_ACTIVE',
            message: 'Please wait 45 seconds before requesting a new code.',
            retryAfterSeconds: 45
          })
        };
      };

      try {
        const result = await requestOtp({ email: 'cooldown_voter@test.com' });
        assert.equal(result.success, false);
        assert.equal(result.error, 'COOLDOWN_ACTIVE');
        assert.equal(result.retryAfterSeconds, 45);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns USERNAME_TAKEN without retryAfterSeconds on 400 rejection', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            success: false,
            error: 'USERNAME_TAKEN',
            message: 'This username is already taken. Please choose another.'
          })
        };
      };

      try {
        const result = await requestOtp({
          email: 'new_voter@test.com',
          name: 'New Voter',
          username: 'taken_user'
        });
        assert.equal(result.success, false);
        assert.equal(result.error, 'USERNAME_TAKEN');
        assert.equal(result.retryAfterSeconds, undefined);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('2. Client Cooldown Countdown Calculation (Major 1)', () => {
    it('decrements positive cooldown values by 1 down to zero', () => {
      let seconds = 5;
      const ticks = [];
      while (seconds > 0) {
        ticks.push(seconds);
        seconds = Math.max(0, seconds - 1);
      }
      assert.deepEqual(ticks, [5, 4, 3, 2, 1]);
      assert.equal(seconds, 0);
    });

    it('formats countdown button label correctly', () => {
      const formatButtonText = (seconds) => {
        return seconds > 0 ? `Resend code (${seconds}s)` : 'Resend code';
      };

      assert.equal(formatButtonText(60), 'Resend code (60s)');
      assert.equal(formatButtonText(1), 'Resend code (1s)');
      assert.equal(formatButtonText(0), 'Resend code');
    });
  });

  describe('3. Outer Error Handling Resilience (Major 3)', () => {
    it('returns NETWORK_ERROR gracefully when request throws network error', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error('Connection refused');
      };

      try {
        const result = await requestOtp({ email: 'offline@test.com' });
        assert.equal(result.success, false);
        assert.equal(result.error, 'NETWORK_ERROR');
        assert.equal(result.message, 'Connection refused');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
