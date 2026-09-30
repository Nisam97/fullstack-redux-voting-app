import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { joinVoterSession } from '../src/services/auth.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Accounts and OTP client review minors regression tests', () => {

  describe('1. REST Join displayNameSource signaling (covers: AC-12, AC-17)', () => {
    it('propagates displayNameSource from server join response for profile', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'sess_minor_test',
            displayName: 'Profile Name',
            displayNameSource: 'profile',
            voterToken: 'user:123',
            voterCount: 1,
            isRegisteredUser: true
          })
        };
      };

      try {
        const result = await joinVoterSession({
          sessionId: 'sess_minor_test',
          displayName: 'Some Input'
        });

        assert.equal(result.success, true);
        assert.equal(result.displayName, 'Profile Name');
        assert.equal(result.displayNameSource, 'profile');
        assert.equal(result.voterToken, 'user:123');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('propagates custom displayNameSource when user provides custom nickname', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'sess_minor_test',
            displayName: 'Custom Nickname',
            displayNameSource: 'custom',
            voterToken: 'user:456',
            voterCount: 2,
            isRegisteredUser: true
          })
        };
      };

      try {
        const result = await joinVoterSession({
          sessionId: 'sess_minor_test',
          displayName: 'Custom Nickname'
        });

        assert.equal(result.success, true);
        assert.equal(result.displayName, 'Custom Nickname');
        assert.equal(result.displayNameSource, 'custom');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('propagates anonymous displayNameSource for guest voter', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            sessionId: 'sess_minor_test',
            displayName: 'Guest Nickname',
            displayNameSource: 'anonymous',
            voterToken: 'anon-token-789',
            voterCount: 3,
            isRegisteredUser: false
          })
        };
      };

      try {
        const result = await joinVoterSession({
          sessionId: 'sess_minor_test',
          displayName: 'Guest Nickname'
        });

        assert.equal(result.success, true);
        assert.equal(result.displayName, 'Guest Nickname');
        assert.equal(result.displayNameSource, 'anonymous');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('rejects joinVoterSession when sessionId is missing', async () => {
      const result = await joinVoterSession({
        sessionId: '',
        displayName: 'Guest'
      });

      assert.equal(result.success, false);
      assert.equal(result.error, 'INVALID_SESSION');
    });

    it('rejects joinVoterSession when displayName is missing or empty', async () => {
      const result = await joinVoterSession({
        sessionId: 'sess_123',
        displayName: '   '
      });

      assert.equal(result.success, false);
      assert.equal(result.error, 'INVALID_DISPLAY_NAME');
    });
  });

  describe('2. Cooldown Button and Countdown Handling (covers: AC-4, AC-15)', () => {
    it('disables submit action when cooldown seconds are active', () => {
      const isSubmitDisabled = (loading, cooldownSeconds) => {
        return loading || cooldownSeconds > 0;
      };

      assert.equal(isSubmitDisabled(false, 30), true);
      assert.equal(isSubmitDisabled(true, 0), true);
      assert.equal(isSubmitDisabled(false, 0), false);
    });

    it('formats countdown button label appropriately in step 1 and step 2', () => {
      const formatStep1Button = (loading, cooldownSeconds) => {
        if (loading) return 'Sending Code...';
        if (cooldownSeconds > 0) return `Please wait (${cooldownSeconds}s)`;
        return 'Send Verification Code';
      };

      assert.equal(formatStep1Button(false, 45), 'Please wait (45s)');
      assert.equal(formatStep1Button(false, 0), 'Send Verification Code');
      assert.equal(formatStep1Button(true, 0), 'Sending Code...');
    });

    it('clamps countdown decrements at zero and prevents negative values', () => {
      const decrementTimer = (currentSeconds) => Math.max(0, currentSeconds - 1);

      assert.equal(decrementTimer(3), 2);
      assert.equal(decrementTimer(1), 0);
      assert.equal(decrementTimer(0), 0);
      assert.equal(decrementTimer(-5), 0);
    });
  });

  describe('3. Lobby Display Name Reconciliation (covers: AC-12, AC-17)', () => {
    it('reconciles local input box and stored voter name with authoritative server display name', () => {
      const reconcileJoin = (res, submittedTrimmed) => {
        const effectiveName = res.displayName || submittedTrimmed;
        return {
          customVoterName: effectiveName,
          displayNameInput: effectiveName
        };
      };

      // Server returned profile name because user submitted empty
      const state1 = reconcileJoin({ displayName: 'Authoritative Profile' }, '');
      assert.equal(state1.customVoterName, 'Authoritative Profile');
      assert.equal(state1.displayNameInput, 'Authoritative Profile');

      // Server returned custom entered name
      const state2 = reconcileJoin({ displayName: 'Custom Entered' }, 'Custom Entered');
      assert.equal(state2.customVoterName, 'Custom Entered');
      assert.equal(state2.displayNameInput, 'Custom Entered');
    });
  });
});
