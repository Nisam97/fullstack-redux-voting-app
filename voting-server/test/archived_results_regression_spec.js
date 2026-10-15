import { expect } from 'chai';
import http from 'http';
import makeStore from '../src/store.js';
import startServer, { serializeSessionState } from '../src/server.js';
import { clearAdmin, seedAdmin, generateAdminToken } from '../src/auth/admin.js';
import { clearVoters } from '../src/auth/voter.js';
import { resetAuthConfig } from '../src/auth/config.js';
import roundManager, { closeRoundOnce, resetRounds } from '../src/roundManager.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';

/**
 * Regression: after a public session is completed and archived, the admin must
 * still read the full per round results (panel and CSV export both key off
 * these reads), and the turnout round list must contain only rounds that
 * actually ran.
 *
 * Two failure modes covered here:
 * 1. The shared tally visibility guard treats only `completed` as concluded,
 *    so an archived session lost `rounds` from the socket broadcast and from
 *    GET /api/sessions/:id/rounds (spec 0003 AC-3: settled history is released
 *    at a conclusion; archiving is a post completion action).
 * 2. buildSessionTurnout consulted the live round manager for a concluded
 *    session. The single ballot completion path re-arms the next round
 *    identity after the win, so turnout (and its CSV export) listed an extra
 *    round that never took place (spec 0008 AC-7: completed sessions take
 *    round identity from the persisted snapshots only).
 */

function requestHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body;
        try {
          body = JSON.parse(data);
        } catch {
          body = data;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Archived session results (round history guard + turnout round list)', function () {
  this.timeout(20000);

  let server;
  let port;
  let store;
  let adminToken;

  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    clearAdmin();
    clearVoters();
    resetAuthConfig();
    resetRounds();
    const admin = seedAdmin({
      username: 'admin',
      email: 'admin@votesphere.local',
      password: 'Password123!'
    });
    adminToken = generateAdminToken(admin);

    store = makeStore();
    port = 9700 + Math.floor(Math.random() * 200);
    server = startServer(store, { port, autoRecover: false });
    await wait(50);
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  // Drives the real terminal shape: completion removes roundLifecycle/
  // finalVote/revealTimer and sets the winner, then the admin archives.
  async function seedArchivedCompletedSession() {
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_arch_guard',
      title: 'Archived Guard',
      entries: ['Alpha', 'Beta'],
      votingMode: 'single_ballot'
    });
    store.dispatch({ type: 'START_SESSION', sessionId: 'sess_arch_guard' });
    store.dispatch({
      type: 'APPEND_ROUND_RESULT',
      sessionId: 'sess_arch_guard',
      round: {
        roundIndex: 1,
        kind: 'single_ballot',
        candidates: ['Alpha', 'Beta'],
        tally: { Alpha: 3, Beta: 1 },
        totalVotes: 4,
        closedAt: new Date().toISOString(),
        resolution: 'majority_win',
        advanced: null
      }
    });
    store.dispatch({
      type: 'RESOLVE_TIE',
      sessionId: 'sess_arch_guard',
      roundId: 'sess_arch_guard:::r1',
      winner: 'Alpha',
      resolution: 'majority_win'
    });
    store.dispatch({ type: 'ARCHIVE_SESSION', sessionId: 'sess_arch_guard' });

    const session = store.getState().getIn(['sessions', 'sess_arch_guard']);
    expect(session.get('status')).to.equal('archived');
    expect(session.get('roundLifecycle'), 'completion removes roundLifecycle').to.equal(undefined);
    await wait(200);
    return session;
  }

  it('keeps the settled round history in the socket broadcast after ARCHIVE_SESSION', async () => {
    await seedArchivedCompletedSession();
    const session = store.getState().getIn(['sessions', 'sess_arch_guard']);

    // The socket broadcast must still carry the settled history: the client
    // round timeline is fed from `session_state`, and the archive payload
    // keeps `roundIndex`, which makes normalizeSession drop its local rounds
    // whenever `rounds` is missing from the payload.
    const payload = serializeSessionState(session);
    expect(payload.rounds, 'archived session_state must carry rounds').to.be.an('array').with.lengthOf(1);
    expect(payload.rounds[0].tally).to.deep.equal({ Alpha: 3, Beta: 1 });
  });

  it('keeps GET /rounds readable after ARCHIVE_SESSION (store path)', async () => {
    await seedArchivedCompletedSession();

    // GET /rounds must return the history for an archived session that is
    // still in the store (spec 0003 AC-3, spec 0008 AC-7).
    const res = await requestHttp(`http://localhost:${port}/api/sessions/sess_arch_guard/rounds`);
    expect(res.statusCode).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.rounds, 'rounds endpoint must list the settled rounds').to.have.lengthOf(1);
    expect(res.body.rounds[0].candidates).to.deep.equal(['Alpha', 'Beta']);
    expect(res.body.rounds[0].tally).to.deep.equal({ Alpha: 3, Beta: 1 });
    expect(res.body.rounds[0].resolution).to.equal('majority_win');
  });

  // Drives the real single ballot flow: round identity, a real vote, a real
  // close (which completes the session and re-arms the next round identity),
  // then the admin archives.
  async function seedCompletedArchivedTurnoutSession() {
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_arch_turnout',
      title: 'Turnout Guard',
      entries: ['Alpha', 'Beta', 'Gamma'],
      votingMode: 'single_ballot'
    });
    store.dispatch({ type: 'START_SESSION', sessionId: 'sess_arch_turnout' });

    // The vote path resolves the round identity first; this creates round 1.
    const roundId = roundManager.getCurrentRoundId('sess_arch_turnout', store);
    expect(roundId).to.equal('sess_arch_turnout:::r1');

    store.dispatch({
      type: 'VOTE',
      sessionId: 'sess_arch_turnout',
      entry: 'Alpha'
    });

    // Close round 1 for real. Single ballot decisive majority completes the
    // session, and the completion path re-arms a fresh round identity for a
    // possible restart of the same session id.
    const closeResult = closeRoundOnce({
      sessionId: 'sess_arch_turnout',
      roundId,
      store,
      isTimerExpiry: true
    });
    expect(closeResult.success, `close must succeed, got ${closeResult.reason}`).to.be.true;

    // Let the fire and forget persistence settle (status write, result write).
    await wait(300);

    const session = store.getState().getIn(['sessions', 'sess_arch_turnout']);
    expect(session.get('status')).to.equal('completed');
    expect(session.get('winner')).to.equal('Alpha');

    store.dispatch({ type: 'ARCHIVE_SESSION', sessionId: 'sess_arch_turnout' });
    return session;
  }

  it('keeps the executed round readable through GET /rounds after single ballot completion and archive', async () => {
    await seedCompletedArchivedTurnoutSession();

    // Control: the result read carries the persisted snapshots.
    const resultRes = await requestHttp(`http://localhost:${port}/api/sessions/sess_arch_turnout/result`);
    expect(resultRes.statusCode).to.equal(200);
    expect(resultRes.body.result.rounds).to.have.lengthOf(1);
    expect(resultRes.body.result.rounds[0].tally).to.deep.equal({ Alpha: 1 });

    // The round history read must still return the executed round with its
    // full breakdown after archive (spec 0003 AC-3, spec 0008 AC-7).
    const roundsRes = await requestHttp(`http://localhost:${port}/api/sessions/sess_arch_turnout/rounds`);
    expect(roundsRes.statusCode).to.equal(200);
    expect(roundsRes.body.rounds, 'archived rounds read must list executed rounds').to.have.lengthOf(1);
    expect(roundsRes.body.rounds[0].tally).to.deep.equal({ Alpha: 1 });
  });

  it('lists only rounds that actually ran in turnout after a single ballot session completes and is archived', async () => {
    await seedCompletedArchivedTurnoutSession();

    // Turnout drives the admin per round panel and its CSV export. It must
    // contain round 1 only: round 2 was re-armed by the completion path but
    // never took place.
    const turnoutRes = await requestHttp(`http://localhost:${port}/api/sessions/sess_arch_turnout/turnout`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(turnoutRes.statusCode).to.equal(200);
    expect(turnoutRes.body.success).to.be.true;
    const indexes = turnoutRes.body.rounds.map((r) => r.roundIndex);
    expect(indexes, 'turnout must not list unexecuted rounds').to.deep.equal([1]);
    expect(turnoutRes.body.rounds[0].roundId).to.equal('sess_arch_turnout:::r1');
  });
});
