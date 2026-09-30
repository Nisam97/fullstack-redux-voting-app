import { expect } from 'chai';
import http from 'http';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import {
  registerVoter,
  canCastVote,
  recordVote,
  buildVoteKey,
  releaseSessionVoters,
  clearVoters,
  getVoterCount
} from '../src/auth/voter.js';

/**
 * Regression specs for the review minor fixes:
 * 1. Session-scoped memory cleanup (releaseSessionVoters on terminal states).
 * 2. EADDRINUSE is handled instead of crashing with an unhandled error event.
 * 3. Voter cookie is set with HttpOnly (and Secure over HTTPS).
 */

function joinViaRest(port, sessionId, displayName) {
  return fetch(`http://127.0.0.1:${port}/api/sessions/${encodeURIComponent(sessionId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName })
  });
}

describe('Regression: review minor fixes', () => {
  describe('session-scoped memory cleanup', () => {
    beforeEach(() => {
      clearVoters();
    });

    it('drops tokens, headcount index, and recorded vote keys for one session', () => {
      const sessionId = 'sess_cleanup_full';
      const a = registerVoter({ sessionId, displayName: 'Ada' });
      const b = registerVoter({ sessionId, displayName: 'Bo' });
      expect(a.success && b.success).to.be.true;
      expect(getVoterCount(sessionId)).to.equal(2);

      const keyA = buildVoteKey(sessionId, ['X', 'Y'], a.voter.sessionToken, `${sessionId}:::r1`);
      const keyB = buildVoteKey(sessionId, ['X', 'Y'], b.voter.sessionToken, `${sessionId}:::r1`);
      recordVote(keyA);
      recordVote(keyB);

      // Both voters already voted in this round
      expect(canCastVote({
        sessionToken: a.voter.sessionToken,
        sessionId,
        pair: ['X', 'Y'],
        roundId: `${sessionId}:::r1`
      }).allowed).to.be.false;

      const freed = releaseSessionVoters(sessionId);
      expect(freed.removedTokens).to.equal(2);
      expect(freed.removedVoteKeys).to.equal(2);
      expect(getVoterCount(sessionId)).to.equal(0);
      expect(canCastVote({
        sessionToken: a.voter.sessionToken,
        sessionId,
        pair: ['X', 'Y'],
        roundId: `${sessionId}:::r1`
      }).error).to.equal('INVALID_TOKEN');
    });

    it('isolates cleanup by session: other sessions keep their voters and keys', () => {
      const victim = 'sess_cleanup_victim';
      const survivor = 'sess_cleanup_survivor';
      const v = registerVoter({ sessionId: victim, displayName: 'Vanish' });
      const s = registerVoter({ sessionId: survivor, displayName: 'Stay' });
      recordVote(buildVoteKey(victim, ['A', 'B'], v.voter.sessionToken, `${victim}:::r1`));
      recordVote(buildVoteKey(survivor, ['A', 'B'], s.voter.sessionToken, `${survivor}:::r1`));

      releaseSessionVoters(victim);

      expect(getVoterCount(victim)).to.equal(0);
      expect(getVoterCount(survivor)).to.equal(1);
      expect(canCastVote({
        sessionToken: s.voter.sessionToken,
        sessionId: survivor,
        pair: ['A', 'B'],
        roundId: `${survivor}:::r1`
      }).allowed).to.be.false;
      expect(canCastVote({
        sessionToken: s.voter.sessionToken,
        sessionId: survivor,
        pair: ['A', 'B'],
        roundId: `${survivor}:::r2`
      }).allowed).to.be.true;
    });

    it('cleans up legacy pair-scoped vote keys too (no roundId part)', () => {
      const sessionId = 'sess_cleanup_legacy';
      const voter = registerVoter({ sessionId, displayName: 'Legacy' });
      recordVote(buildVoteKey(sessionId, ['A', 'B'], voter.voter.sessionToken));

      const freed = releaseSessionVoters(sessionId);
      expect(freed.removedTokens).to.equal(1);
      expect(freed.removedVoteKeys).to.equal(1);
    });

    it('tolerates unknown or invalid session ids', () => {
      expect(releaseSessionVoters('sess_never_existed')).to.deep.equal({ removedTokens: 0, removedVoteKeys: 0 });
      expect(releaseSessionVoters('')).to.deep.equal({ removedTokens: 0, removedVoteKeys: 0 });
      expect(releaseSessionVoters(null)).to.deep.equal({ removedTokens: 0, removedVoteKeys: 0 });
    });

    it('server subscriber releases voters when a session archives', async function () {
      this.timeout(5000);
      const store = makeStore();
      const sessionId = 'sess_subscriber_release';

      // Seed the session through the store (the same path bootstrap uses),
      // then attach the real server subscriber via startServer.
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Release subscriber',
        entries: ['A', 'B']
      });
      const io = startServer(store, 0);
      const port = io.httpServer.address().port;

      const joinResponse = await joinViaRest(port, sessionId, 'Transient');
      expect(joinResponse.status).to.equal(200);
      expect(getVoterCount(sessionId)).to.equal(1);

      // Archive: a terminal state transition must release the registry
      store.dispatch({ type: 'ARCHIVE_SESSION', sessionId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(getVoterCount(sessionId)).to.equal(0);

      await new Promise((resolve) => io.close(resolve));
    });

    it('server subscriber releases voters when a session completes with a winner', async function () {
      this.timeout(5000);
      const store = makeStore();
      const sessionId = 'sess_subscriber_winner';

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Release on completion',
        entries: ['A', 'B']
      });
      const io = startServer(store, 0);
      const port = io.httpServer.address().port;

      const joinResponse = await joinViaRest(port, sessionId, 'Finisher');
      expect(joinResponse.status).to.equal(200);
      expect(getVoterCount(sessionId)).to.equal(1);
      const { voterToken } = await joinResponse.json();

      // Start the session (creates the active pair), vote so the pair resolves
      // to a single winner (an empty tally would be a tie and advance both),
      // then advance to completion.
      store.dispatch({ type: 'START_SESSION', sessionId, token: 'test' });
      store.dispatch({ type: 'VOTE', sessionId, entry: 'A', voterToken });
      store.dispatch({ type: 'NEXT', sessionId, token: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const sessions = store.getState().get('sessions');
      const completed = sessions.get(sessionId);
      // With 2 entries a single NEXT crowns the winner and completes the session
      if (completed && completed.get('winner')) {
        expect(getVoterCount(sessionId)).to.equal(0);
      } else {
        // Reducer shape changed: fail loudly rather than silently skip
        expect.fail('expected the 2-entry session to complete with a winner after NEXT');
      }

      await new Promise((resolve) => io.close(resolve));
    });
  });

  describe('EADDRINUSE handling', () => {
    it('calls the error handler instead of crashing on a busy port', async function () {
      this.timeout(10000);
      // Bind the blocker without a host so it takes the wildcard, matching
      // what startServer binds to (a loopback-only blocker does not conflict
      // with a wildcard listen on Windows).
      const blocker = http.createServer();
      await new Promise((resolve) => blocker.listen(0, resolve));
      const busyPort = blocker.address().port;

      const store = makeStore();
      const originalExit = process.exit;
      let exitCode = null;
      let errorHandlerRan = false;
      process.exit = (code) => {
        exitCode = code;
        errorHandlerRan = true;
        // Do not actually exit; the handler must have stopped side effects itself.
      };

      try {
        startServer(store, busyPort);
        // Give the async 'error' event a moment to fire
        await new Promise((resolve) => setTimeout(resolve, 300));
      } finally {
        process.exit = originalExit;
      }

      expect(errorHandlerRan).to.be.true;
      expect(exitCode).to.equal(1);

      await new Promise((resolve) => blocker.close(resolve));
    });
  });

  describe('voter cookie flags', () => {
    it('sets HttpOnly and omits Secure over plain HTTP join', async function () {
      this.timeout(10000);
      const store = makeStore();
      const sessionId = 'sess_cookie_flags';

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId,
        title: 'Cookie flags',
        entries: ['A', 'B']
      });
      const io = startServer(store, 0);
      const port = io.httpServer.address().port;

      const response = await joinViaRest(port, sessionId, 'Cookie Tester');
      expect(response.status).to.equal(200);

      const setCookie = response.headers.get('set-cookie') || '';
      expect(setCookie).to.include('HttpOnly');
      expect(setCookie).to.include('SameSite=Lax');
      expect(setCookie).to.not.include('Secure');

      await new Promise((resolve) => io.close(resolve));
    });
  });
});
