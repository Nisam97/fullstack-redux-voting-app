import { expect } from 'chai';
import { fromJS } from 'immutable';

import {
  registerVoter,
  validateVoterToken,
  revokeSessionVoter,
  revokeSessionVoters,
  clearVoters,
  votersByToken,
  tokensBySession,
  getVoterCount
} from '../src/auth/voter';

// Unit level guards for the two revocation helpers in src/auth/voter.js.
// The end to end behaviour they produce is covered in
// removal_token_revocation_spec.js; this file pins the module contract itself,
// which is what an allowlist paste, a mode switch and an approval rejection all
// call. Covers AC-3 and AC-8 of spec 0007.

describe('Voter token revocation helpers (src/auth/voter.js)', function () {
  const storeFor = sessionIds => ({
    getState: () => fromJS({
      sessions: sessionIds.reduce((acc, id) => {
        acc[id] = { id, status: 'pending', entries: [] };
        return acc;
      }, {})
    })
  });

  const join = (sessionId, userId, displayName = 'Voter') =>
    registerVoter({ sessionId, userId, displayName, store: storeFor([sessionId]) });

  const joinAnonymous = (sessionId, displayName = 'Anon') =>
    registerVoter({ sessionId, displayName, store: storeFor([sessionId]) });

  beforeEach(() => {
    clearVoters();
  });

  after(() => {
    clearVoters();
  });

  describe('revokeSessionVoter', () => {
    it('removes the token from the voter table so validation fails afterwards', () => {
      const { voter } = join('sess_a', 'u1');

      expect(revokeSessionVoter('sess_a', 'u1')).to.equal(true);
      expect(validateVoterToken(voter.sessionToken, 'sess_a')).to.deep.include({
        valid: false,
        error: 'INVALID_TOKEN'
      });
    });

    it('removes the token from the session index too, so it cannot pass the join shortcut', () => {
      const { voter } = join('sess_a', 'u1');

      revokeSessionVoter('sess_a', 'u1');

      // A token left only in tokensBySession still validates, because
      // validateVoterToken treats index membership as proof of a join. That is
      // the exact hole this helper closes, so assert the index is empty.
      expect(tokensBySession.get('sess_a').has(voter.sessionToken)).to.equal(false);
      expect(getVoterCount('sess_a')).to.equal(0);
    });

    it('returns false and revokes nothing when the session id or user id is missing', () => {
      join('sess_a', 'u1');

      expect(revokeSessionVoter('', 'u1')).to.equal(false);
      expect(revokeSessionVoter(null, 'u1')).to.equal(false);
      expect(revokeSessionVoter('sess_a', '')).to.equal(false);
      expect(revokeSessionVoter('sess_a', null)).to.equal(false);
      expect(revokeSessionVoter('sess_a', '   ')).to.equal(false);
      expect(getVoterCount('sess_a')).to.equal(1);
    });

    it('returns false for a user who never joined that session', () => {
      join('sess_a', 'u1');

      expect(revokeSessionVoter('sess_a', 'someone_else')).to.equal(false);
      expect(revokeSessionVoter('sess_other', 'u1')).to.equal(false);
      expect(validateVoterToken('user:u1', 'sess_a')).to.deep.include({ valid: true });
    });

    it('trims whitespace around the session id and the user id', () => {
      const { voter } = join('sess_a', 'u1');

      expect(revokeSessionVoter('  sess_a  ', '  u1  ')).to.equal(true);
      expect(validateVoterToken(voter.sessionToken, 'sess_a')).to.deep.include({ valid: false });
    });

    it('is idempotent, so a second removal reports nothing to do', () => {
      join('sess_a', 'u1');

      expect(revokeSessionVoter('sess_a', 'u1')).to.equal(true);
      expect(revokeSessionVoter('sess_a', 'u1')).to.equal(false);
    });

    it('keeps the token alive in a second session the same voter legitimately joined', () => {
      const first = join('sess_a', 'u1');
      const second = join('sess_b', 'u1');

      // The roster entry is shared, so revocation is refused and the token
      // survives for the session that still needs it.
      expect(revokeSessionVoter('sess_a', 'u1')).to.equal(false);
      expect(validateVoterToken(first.voter.sessionToken, 'sess_b')).to.deep.include({ valid: true });

      // The session scoped index entry for sess_a is dropped either way, so
      // sess_a stops counting this voter.
      expect(getVoterCount('sess_a')).to.equal(0);
      expect(getVoterCount('sess_b')).to.equal(1);
      expect(second.voter.sessionToken).to.equal(first.voter.sessionToken);
    });

    it('leaves an anonymous voter alone, because a display name is not an identity', () => {
      const { voter } = joinAnonymous('sess_a', 'Anon');

      expect(revokeSessionVoter('sess_a', 'Anon')).to.equal(false);
      expect(validateVoterToken(voter.sessionToken, 'sess_a')).to.deep.include({ valid: true });
    });
  });

  describe('revokeSessionVoters', () => {
    it('revokes every signed in voter in the session and returns the count', () => {
      join('sess_a', 'u1');
      join('sess_a', 'u2');
      join('sess_a', 'u3');

      expect(revokeSessionVoters('sess_a')).to.equal(3);
      expect(getVoterCount('sess_a')).to.equal(0);
      expect(validateVoterToken('user:u1', 'sess_a')).to.deep.include({ valid: false });
      expect(validateVoterToken('user:u3', 'sess_a')).to.deep.include({ valid: false });
    });

    it('returns 0 for a missing, blank or non string session id', () => {
      join('sess_a', 'u1');

      expect(revokeSessionVoters(undefined)).to.equal(0);
      expect(revokeSessionVoters('')).to.equal(0);
      expect(revokeSessionVoters(null)).to.equal(0);
      expect(revokeSessionVoters(42)).to.equal(0);
      expect(getVoterCount('sess_a')).to.equal(1);
    });

    it('returns 0 for a session nobody joined', () => {
      join('sess_a', 'u1');

      expect(revokeSessionVoters('sess_never_used')).to.equal(0);
    });

    it('skips anonymous voters and leaves their tokens working', () => {
      join('sess_a', 'u1');
      const anon = joinAnonymous('sess_a', 'Anon');

      expect(revokeSessionVoters('sess_a')).to.equal(1);
      expect(validateVoterToken(anon.voter.sessionToken, 'sess_a')).to.deep.include({ valid: true });
      expect(getVoterCount('sess_a')).to.equal(1);
    });

    it('leaves a token that another session still shares alive, and does not count it', () => {
      join('sess_a', 'u1');
      join('sess_b', 'u1');
      join('sess_a', 'u2');

      expect(revokeSessionVoters('sess_a')).to.equal(1);
      expect(validateVoterToken('user:u1', 'sess_b')).to.deep.include({ valid: true });
      expect(validateVoterToken('user:u2', 'sess_a')).to.deep.include({ valid: false });
      expect(getVoterCount('sess_a')).to.equal(1);
    });

    it('does not touch another session when it runs on one session', () => {
      join('sess_a', 'u1');
      join('sess_b', 'u2');

      revokeSessionVoters('sess_a');

      expect(validateVoterToken('user:u2', 'sess_b')).to.deep.include({ valid: true });
      expect(getVoterCount('sess_b')).to.equal(1);
    });

    it('is idempotent, so a second pass reports nothing to do', () => {
      join('sess_a', 'u1');
      join('sess_a', 'u2');

      expect(revokeSessionVoters('sess_a')).to.equal(2);
      expect(revokeSessionVoters('sess_a')).to.equal(0);
    });

    it('trims whitespace around the session id', () => {
      join('sess_a', 'u1');

      expect(revokeSessionVoters('  sess_a  ')).to.equal(1);
      expect(getVoterCount('sess_a')).to.equal(0);
    });

    it('leaves the voter table free of the revoked tokens', () => {
      join('sess_a', 'u1');
      join('sess_a', 'u2');

      revokeSessionVoters('sess_a');

      expect(votersByToken.has('user:u1')).to.equal(false);
      expect(votersByToken.has('user:u2')).to.equal(false);
    });
  });
});
