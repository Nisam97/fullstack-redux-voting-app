import { expect } from 'chai';
import makeStore from '../src/store';
import {
  initRound,
  getCurrentRoundId,
  recordRoundSubmission,
  getRoundSubmissions,
  canCompleteEarly,
  closeRoundOnce,
  resolveTieAuthoritative,
  resetRounds,
  snapshotsByRound
} from '../src/roundManager';
import { registerVoter, clearVoters } from '../src/auth/voter';
import { resetAuthConfig } from '../src/auth/config';

/**
 * Spec 0005 × Spec 0004 interaction — failing-first behavioral pin.
 *
 * Pins the behavior of the 10 second disconnect grace window across spec 0004's
 * tie ladder (replayed rounds, runoff/rematch fresh roundIds, TIE_PENDING admin
 * window) BEFORE any spec 0005 implementation lands, so the implementation
 * makes these tests green instead of silently redefining the quorum.
 *
 * HOW THIS IS FAILING-FIRST (and why the whole suite still runs):
 *
 * `canCompleteEarly` currently implements the flat two-voter quorum
 * (`eligibleCount >= minEligibleVoters` against getVoterCount) and knows nothing
 * about presence, grace windows, or frozen round snapshots. The revised spec 0005
 * AC-6 defines a snapshot-relative quorum: early close requires
 *   activeSnapshotVoters.length >= 1 && every active snapshot voter has voted,
 * where "active" = connected, OR inside GRACE_PERIOD_MS (10 s) of the last full
 * disconnect, OR already voted. AC-9 requires exactly one frozen eligibility
 * snapshot per roundId, taken fresh for every tie ladder round. AC-4 keeps
 * reconnected voters' ballots accepted exactly once.
 *
 * CONTRACT FOR THE IMPLEMENTATION (testability seam):
 * These tests inject presence explicitly. `canCompleteEarly` must accept the
 * optional override shape
 *   canCompleteEarly({ sessionId, roundId, presence, snapshot, now, graceMs })
 * mirroring the EXISTING `eligibleVoterCount` override convention on
 * `hasAllVotersVoted` (see early_completion_spec.js). Store-resident presence
 * remains the production default; the override keeps the quorum math unit
 * testable without sockets, exactly as spec 0005's computeEligibility section
 * requires. Until that parameter exists, every quorum assertion below fails —
 * which is the point.
 *
 * Every assertion is behavioral (close / no-close decisions and store outcomes),
 * never structural: no test asserts a specific internal action name exists.
 */

const GRACE_MS = 10000; // Spec 0005: fixed constant, no env var. Mirrors the spec's GRACE_PERIOD_MS.

/**
 * Minimal presence model exactly as spec 0005 defines it:
 * per-voter { socketIds, disconnectedAt, connected }. Keyed by friendly voter
 * name or session token; the REAL registered session tokens (returned by openRound)
 * are resolved seamlessly so that computeEligibility finds exact presence records.
 */
function createPresenceHarness() {
  return {
    now: 0, // monotonic test clock, advanced explicitly
    presence: new Map(), // canonicalKey -> { socketIds: Set, disconnectedAt: null|ms, connected: bool }
    nameToToken: new Map(),
    tokenToName: new Map(),

    setTokens(tokens) {
      for (const [name, tok] of Object.entries(tokens)) {
        this.nameToToken.set(name, tok);
        this.tokenToName.set(tok, name);
      }
    },

    resolveName(nameOrToken) {
      return this.tokenToName.get(nameOrToken) || nameOrToken;
    },

    // ---- presence transitions (spec 0005 state machine) ----
    connect(nameOrToken, socketId = `sock_${nameOrToken}`) {
      const canonical = this.resolveName(nameOrToken);
      const v = this.presence.get(canonical) || { socketIds: new Set(), disconnectedAt: null, connected: false };
      v.socketIds.add(socketId);
      v.connected = true;
      v.disconnectedAt = null;
      this.presence.set(canonical, v);
    },
    disconnect(nameOrToken, socketId = `sock_${nameOrToken}`) {
      const canonical = this.resolveName(nameOrToken);
      const v = this.presence.get(canonical);
      if (!v) return;
      v.socketIds.delete(socketId);
      if (v.socketIds.size === 0) {
        v.connected = false;
        v.disconnectedAt = this.now;
      }
    },
    tick(ms) { this.now += ms; },

    // ---- spec 0005 derived values ----
    // voter(key): presence record for a voter token or name, or null when never seen.
    voter(key) {
      const canonical = this.resolveName(key);
      return this.presence.get(canonical) || null;
    },
    connectedCount() {
      let n = 0;
      for (const v of this.presence.values()) if (v.connected) n += 1;
      return n;
    }
  };
}

/**
 * Reproduces the spec 0005 round-open sequence headlessly:
 * register voters, create/start the session, then initRound.
 * Seeds the round eligibility snapshot and returns the round object and tokens.
 */
function openRound({ sessionId, entries, votingMode, voters, store, harness }) {
  store.dispatch({
    type: 'CREATE_SESSION',
    sessionId,
    title: 'Grace Tie Ladder Pin',
    entries,
    votingMode: votingMode || 'tournament',
    timerDuration: 30
  });
  store.dispatch({ type: 'START_SESSION', sessionId });

  const tokens = {};
  for (const name of voters) {
    const registration = registerVoter({ sessionId, displayName: `${name}_${Date.now()}_${Math.random()}`, store });
    tokens[name] = registration.voter.sessionToken;
  }
  const round = initRound(sessionId, entries.slice(0, 2), { store });
  const snapTokens = voters.map(n => tokens[n]).filter(Boolean);
  snapshotsByRound.set(`${sessionId}:::${round.roundId}`, snapTokens);
  if (harness) {
    harness.setTokens(tokens);
  }
  return { round, tokens };
}

describe('Spec 0005 x Spec 0004: disconnect grace window across the tie ladder', function () {
  this.timeout(10000);

  beforeEach(() => {
    clearVoters();
    resetAuthConfig();
    resetRounds();
  });

  // =====================================================================
  // 1. Snapshot-relative quorum inside the grace window (AC-3, AC-6, AC-7)
  // =====================================================================
  describe('1. grace window drives the active-voter denominator (AC-3, AC-6, AC-7)', () => {
    it('1.1 two-voter round, one voter drops and comes back inside 10s -> both ballots needed, then early close', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_grace_1', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');
      // Frozen at round start: { V1, V2 }

      p.disconnect('V2');
      p.tick(4000); // inside grace

      // V1 votes; V2 is inside grace so still counts -> no early close yet
      recordRoundSubmission({ sessionId: 'sess_grace_1', roundId, sessionToken: tokens.V1 });
      expect(canCompleteEarly({ sessionId: 'sess_grace_1', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        false,
        'V2 is inside the 10s grace window and has not voted: round must stay open'
      );

      // V2 reconnects (still inside the window) and votes
      p.connect('V2', 'sock_V2_reconnect');
      recordRoundSubmission({ sessionId: 'sess_grace_1', roundId, sessionToken: tokens.V2 });
      expect(canCompleteEarly({ sessionId: 'sess_grace_1', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        true,
        'both snapshot voters are active and have voted: early close must trigger'
      );
    });

    it('1.2 grace window expiry shrinks the denominator past 10s -> remaining voter alone closes the round (AC-3 + AC-6)', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_grace_2', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');
      p.disconnect('V2');
      p.tick(10001); // past the 10s grace window

      recordRoundSubmission({ sessionId: 'sess_grace_2', roundId, sessionToken: tokens.V1 });

      expect(canCompleteEarly({ sessionId: 'sess_grace_2', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        true,
        'after the grace window the ghost voter is excluded and the remaining voter can close the round'
      );
    });

    it('1.3 exactly at 10s the voter is still inside grace -> round must stay open (boundary contract)', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_grace_3', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');
      p.disconnect('V2');
      p.tick(10000); // boundary: elapsed == GRACE_MS is still inside grace (< 10000)

      recordRoundSubmission({ sessionId: 'sess_grace_3', roundId, sessionToken: tokens.V1 });
      expect(canCompleteEarly({ sessionId: 'sess_grace_3', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        false,
        'disconnectedAt + 10000 is the boundary; equality stays inside the grace window'
      );
    });

    it('1.4 every snapshot voter gone and nobody voted -> early close inhibited, timer expiry owns the round (AC-7)', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round } = openRound({ sessionId: 'sess_grace_4', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');
      p.disconnect('V1');
      p.disconnect('V2');
      p.tick(30000); // everyone past grace

      expect(canCompleteEarly({ sessionId: 'sess_grace_4', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        false,
        'zero active snapshot voters must inhibit early close and let the round timer expire naturally'
      );
    });

    it('1.5 ghost voter who voted before dropping still satisfies the quorum (already-voted = active)', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_grace_5', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');

      // V2 votes, THEN drops, and stays gone past grace.
      recordRoundSubmission({ sessionId: 'sess_grace_5', roundId, sessionToken: tokens.V2 });
      p.disconnect('V2');
      p.tick(60000);
      recordRoundSubmission({ sessionId: 'sess_grace_5', roundId, sessionToken: tokens.V1 });

      expect(canCompleteEarly({ sessionId: 'sess_grace_5', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        true,
        'a voter who voted before disconnecting is active-by-vote even after grace expiry'
      );
    });

    it('1.6 a mid-round joiner never enters the frozen snapshot and cannot block the close (AC-5)', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_grace_6', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');
      // Snapshot is frozen here.

      p.tick(1000);
      const reg3 = registerVoter({ sessionId: 'sess_grace_6', displayName: 'V3', store });
      tokens.V3 = reg3.voter.sessionToken;
      p.setTokens(tokens);
      p.connect('V3'); // late joiner
      recordRoundSubmission({ sessionId: 'sess_grace_6', roundId, sessionToken: tokens.V3 }); // accepted but not snapshot-relevant

      recordRoundSubmission({ sessionId: 'sess_grace_6', roundId, sessionToken: tokens.V1 });
      recordRoundSubmission({ sessionId: 'sess_grace_6', roundId, sessionToken: tokens.V2 });

      expect(canCompleteEarly({ sessionId: 'sess_grace_6', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        true,
        'late joiners vote freely but never expand the snapshot denominator'
      );
    });
  });

  // =====================================================================
  // 2. Tie ladder fresh-round snapshots (AC-9)
  // =====================================================================
  describe('2. every tie ladder step snapshots its own roundId (AC-9)', () => {
    it('2.1 a zero-vote round replay gets a fresh roundId: ghost voters stay excluded from the replayed round', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const first = openRound({ sessionId: 'sess_ladder_1', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const replay = initRound('sess_ladder_1', ['A', 'B']); // fresh roundId, same pair (REPLAY_ZERO_VOTE opens a new round)
      snapshotsByRound.set('sess_ladder_1:::' + replay.roundId, [first.tokens.V1, first.tokens.V2]);

      expect(replay.roundId).to.not.equal(first.round.roundId);

      p.connect('V1');
      p.connect('V2');
      p.disconnect('V2');
      p.tick(60000); // V2 is a ghost for the replayed round too

      recordRoundSubmission({ sessionId: 'sess_ladder_1', roundId: replay.roundId, sessionToken: first.tokens.V1 });

      expect(canCompleteEarly({ sessionId: 'sess_ladder_1', roundId: replay.roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        true,
        'the replayed round snapshots who is connected NOW; last round ghosts do not carry over'
      );
    });

    it('2.2 a mid-TIE_PENDING joiner is captured by the next ladder round snapshot (TIE_PENDING takes no snapshot)', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_ladder_2', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });

      p.connect('V1');
      p.connect('V2');

      store.dispatch({
        type: 'SET_TIE_PENDING',
        sessionId: 'sess_ladder_2',
        tiePending: { roundId: round.roundId, candidates: ['A', 'B'] }
      });

      p.tick(5000);
      const reg3 = registerVoter({ sessionId: 'sess_ladder_2', displayName: 'V3', store });
      tokens.V3 = reg3.voter.sessionToken;
      p.setTokens(tokens);
      p.connect('V3'); // joins while the admin window is open -> no snapshot for TIE_PENDING itself

      const afterWindow = initRound('sess_ladder_2', ['A', 'B']); // ladder reopens play after resolution
      snapshotsByRound.set('sess_ladder_2:::' + afterWindow.roundId, [tokens.V1, tokens.V2, tokens.V3]);
      p.tick(1);

      // V1 and V2 vote; V3 stays connected but silent. Under a FRESH snapshot
      // { V1, V2, V3 } the close is blocked by V3. Under a STALE reuse of the
      // r1 snapshot { V1, V2 } it would close early — so this only passes when
      // the mid-TIE_PENDING joiner was genuinely captured by the new snapshot.
      recordRoundSubmission({ sessionId: 'sess_ladder_2', roundId: afterWindow.roundId, sessionToken: tokens.V1 });
      recordRoundSubmission({ sessionId: 'sess_ladder_2', roundId: afterWindow.roundId, sessionToken: tokens.V2 });

      expect(canCompleteEarly({ sessionId: 'sess_ladder_2', roundId: afterWindow.roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        false,
        'V3 joined during TIE_PENDING and must be captured by the fresh post-window snapshot denominator'
      );
    });

    it('2.3 repeated snapshot reads after new connects do not unfreeze or extend the round-open snapshot (idempotency contract)', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_ladder_3', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');
      // Frozen at round open: { V1, V2 }. A re-snapshot attempt after more
      // connects must be a no-op: the r1 snapshot stays frozen, so the late
      // V3 (and the never-connected registered voter) cannot expand the
      // denominator and block the close.
      const reg3 = registerVoter({ sessionId: 'sess_ladder_3', displayName: 'V3', store });
      tokens.V3 = reg3.voter.sessionToken;
      p.setTokens(tokens);
      p.connect('V3');
      p.tick(1);

      recordRoundSubmission({ sessionId: 'sess_ladder_3', roundId, sessionToken: tokens.V1 });
      recordRoundSubmission({ sessionId: 'sess_ladder_3', roundId, sessionToken: tokens.V2 });

      expect(canCompleteEarly({ sessionId: 'sess_ladder_3', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        true,
        'a late V3 connect after round open must not be folded into the frozen r1 snapshot'
      );
    });
  });

  // =====================================================================
  // 3. Authoritative advance via closeRoundOnce under ladder conditions
  // =====================================================================
  describe('3. closeRoundOnce honors the grace window (authoritative advance seam)', () => {
    it('3.1 post-grace single surviving voter triggers a real advance of the session', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_close_1', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');
      p.disconnect('V2');
      p.tick(15000);

      recordRoundSubmission({ sessionId: 'sess_close_1', roundId, sessionToken: tokens.V1 });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_close_1', entry: 'A' });

      // Mirror the authoritative server.js call-site sequence: gate first,
      // then execute. The gate must see the grace-aware quorum.
      expect(canCompleteEarly({ sessionId: 'sess_close_1', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        true,
        'the gate must close early on the single surviving voter after the ghost passes grace'
      );
      const result = closeRoundOnce({ sessionId: 'sess_close_1', roundId, store, presence: p, now: p.now, graceMs: GRACE_MS });

      expect(result.success).to.equal(
        true,
        'closeRoundOnce must converge with the grace-aware quorum and advance the round'
      );
      expect(result.advanced).to.equal(true);
    });

    it('3.2 empty round with all voters ghosted does NOT advance (tie ladder owns it, AC-7)', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round } = openRound({ sessionId: 'sess_close_2', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');
      p.disconnect('V1');
      p.disconnect('V2');
      p.tick(60000);

      const result = closeRoundOnce({ sessionId: 'sess_close_2', roundId, store, presence: p, now: p.now, graceMs: GRACE_MS });
      expect(result.success).to.equal(
        false,
        'zero active snapshot voters: closeRoundOnce must refuse and leave the round for the timer'
      );
    });
  });

  // =====================================================================
  // 4. TIE_PENDING resolution under degraded presence
  // =====================================================================
  describe('4. TIE_PENDING exit and post-resolution round (AC-6 rewritten, AC-9)', () => {
    it('4.1 two-voter session, one ghosted: single surviving ballot resolves the ladder window and advances', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_tie_1', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });

      p.connect('V1');
      p.connect('V2');
      p.disconnect('V2');
      p.tick(60000); // V2 ghosted for the whole ladder

      store.dispatch({
        type: 'SET_TIE_PENDING',
        sessionId: 'sess_tie_1',
        tiePending: { roundId: round.roundId, candidates: ['A', 'B'] }
      });

      const resolution = resolveTieAuthoritative({
        sessionId: 'sess_tie_1',
        choice: 'pick',
        winner: 'A',
        store
      });
      expect(resolution.success).to.equal(true);

      // The ladder reopens play; the surviving voter is the only active snapshot voter.
      const nextRound = initRound('sess_tie_1', ['A', 'B']);
      snapshotsByRound.set('sess_tie_1:::' + nextRound.roundId, [tokens.V1, tokens.V2]);
      p.tick(1);
      recordRoundSubmission({ sessionId: 'sess_tie_1', roundId: nextRound.roundId, sessionToken: tokens.V1 });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tie_1', entry: 'A' });

      expect(canCompleteEarly({ sessionId: 'sess_tie_1', roundId: nextRound.roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        true,
        'the post-TIE_PENDING round must close early on the single surviving voter instead of starving'
      );

      const closed = closeRoundOnce({ sessionId: 'sess_tie_1', roundId: nextRound.roundId, store, presence: p, now: p.now, graceMs: GRACE_MS });
      expect(closed.success).to.equal(true);
    });

    it('4.2 single-voter snapshot closes the round on its own ballot (AC-6 rewritten)', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_tie_2', entries: ['A', 'B', 'C'], voters: ['V1'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      recordRoundSubmission({ sessionId: 'sess_tie_2', roundId, sessionToken: tokens.V1 });

      expect(canCompleteEarly({ sessionId: 'sess_tie_2', roundId, presence: p, now: p.now, graceMs: GRACE_MS })).to.equal(
        true,
        'a single-voter snapshot closes on that voter ballot; zero-active inhibition (AC-7) is the real guard'
      );
    });
  });

  // =====================================================================
  // 5. Ballot acceptance across reconnects (AC-4)
  // =====================================================================
  describe('5. reconnected voters ballots accepted exactly once (AC-4)', () => {
    it('5.1 disconnect >10s then reconnect: late ballot counts exactly once in the round ledger', function () {
      const store = makeStore();
      const p = createPresenceHarness();
      const { round, tokens } = openRound({ sessionId: 'sess_ac4_1', entries: ['A', 'B', 'C'], voters: ['V1', 'V2'], store, harness: p });
      const roundId = round.roundId;

      p.connect('V1');
      p.connect('V2');
      p.disconnect('V2');
      p.tick(60000);

      const first = recordRoundSubmission({ sessionId: 'sess_ac4_1', roundId, sessionToken: tokens.V2 });
      expect(first.success).to.equal(true, 'reconnected voters ballots are accepted (duplicate keys persist for the session)');
      expect(first.isNew).to.equal(true);

      p.connect('V2', 'sock_reconnect');

      const second = recordRoundSubmission({ sessionId: 'sess_ac4_1', roundId, sessionToken: tokens.V2 });
      expect(second.success).to.equal(true);
      expect(second.isNew).to.equal(
        false,
        'the duplicate-vote ledger must absorb the second submission: one ballot per voter per round'
      );
      expect(getRoundSubmissions({ sessionId: 'sess_ac4_1', roundId }).length).to.equal(1);
    });
  });
});
