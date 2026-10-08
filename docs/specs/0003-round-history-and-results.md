# 0003. Round History and Full Results

**Date**: 2026-09-23
**Status**: Accepted

## Summary

After each pairwise round closes, the server now freezes a snapshot (the matchup, vote counts, resolution, and who advanced) and appends it to a `rounds` array that lives in the `Result` MongoDB document and the in memory Redux session state. The client results page renders an expandable accordion timeline of every round, with a bar chart and vote counts per round, plus a totals panel summarizing votes across all rounds. The history page also shows the full round breakdown for completed sessions. Tallies stay hidden during an active voting round, matching the existing guard.

## Context

The current system records only the final winner when a tournament completes. A `Result` document stores `sessionId`, `title`, `entries`, `winner`, and `completedAt`, but nothing about the individual rounds: which candidates faced off, how the votes split, or how each matchup was resolved. The client results page shows the live pairwise chart for the current round, but once a round advances, that data is gone.

This matters for two reasons. First, voters and spectators want to see how the tournament unfolded, not just the outcome. Second, the admin needs a record for accountability: which rounds were close, which were decisive, and how ties were handled. Without round history, the only audit trail is server logs.

The infrastructure is already in place to capture this. `closeRoundOnce` in `roundManager.js` freezes a `finalVote` snapshot (pair and tally) at the moment of closure. The data exists at the right time; it just needs somewhere to go.

## Requirements

**User stories**:
- As a voter, I want to see every round that has been played so far (matchups, vote counts, who advanced) so I can follow the tournament progression.
- As a voter or spectator, I want to see a totals panel (total votes per candidate across all rounds, plus how many rounds were played) once the session concludes or a round closes.
- As a user browsing the history page, I want to drill into a completed session and see its full round breakdown so I can review how any past tournament unfolded.
- As an admin, I want to see a resolution label on each round (how it was settled) so I have an auditable record.

**Acceptance criteria** (the contract, each criterion is independently checkable):
- **AC-1**: When a round closes (via `closeRoundOnce`), a frozen round snapshot is appended to the session's in memory `rounds` list via an `APPEND_ROUND_RESULT` action. The snapshot contains `roundIndex`, `kind`, `candidates`, `tally`, `totalVotes`, `closedAt`, `resolution`, and `advanced`.
- **AC-2**: Each round snapshot is incrementally persisted to the `Result` document in MongoDB via `$push` to `Result.rounds[]` immediately after the round closes. A partial `Result` document (with `rounds: []`) is created at the first round close if none exists yet.
- **AC-3**: The `rounds[]` data is included in the session state broadcast to connected clients, but only when `roundLifecycle` is `ROUND_CLOSED`, `RESULTS_REVEALED`, or the session status is `completed`. A session recovered from a mid tournament crash also carries its `rounds[]`, because it comes back `pending` with no live round and every snapshot in the list was already broadcast when its round closed. During `VOTING`, `rounds[]` is stripped from the broadcast payload. Three carriers are gated, and they do not share one rule. `rounds[]` is the settled history of rounds that already closed, so it is released as soon as a round closes. `finalVote` is the tally of the round that has just closed and is still waiting for its reveal, so it is released only at a conclusion or a reveal, and the live `vote.tally` follows exactly the same rule as `finalVote`, because at `ROUND_CLOSED` it holds the same frozen numbers. `TIE_PENDING` withholds all three, because a tie awaiting an admin decision is not yet a settled outcome.
- **AC-4**: The client results page renders an expandable accordion timeline where each row shows "Round N: Candidate A vs Candidate B" with a resolution badge. Expanding a round reveals the `ResultsChart` bar chart and per candidate vote counts.
- **AC-5**: A totals panel below the accordion shows total votes per candidate across all rounds and the number of rounds played. It is visible after each round closes during an active session and always visible once the session concludes.
- **AC-6**: The resolution label displays the human readable settlement method for each round (`majority_win` shown as "Majority Win", `tie_advance` as "Tie, Both Advanced").
- **AC-7**: The `/history` detail view fetches round data via `GET /api/sessions/:sessionId/rounds` and renders the same accordion timeline and totals panel as the live results page.
- **AC-8**: On server restart, if a `Result` document with a partial `rounds[]` exists for a recovered session, the round history is loaded back into the Redux state.
- **AC-9**: Tallies in the `rounds[]` array are never visible to clients during an active `VOTING` phase (the existing tally hiding invariant extends to round history).
- **AC-10**: Existing test suites pass; new tests confirm `rounds[]` persistence, totals derivation, and the tally broadcast guard.

## Options considered

### Option 1: Embed rounds in the Result document (incremental $push)

Append each round snapshot to `Result.rounds[]` via `$push` immediately after round closure. Create a partial `Result` document at first round close. The `Result` document becomes the single source of truth for both the final outcome and the round by round history.

**Pros**:
- Single document for all session results, simple to query and display
- Incremental persistence survives server crashes (partial results preserved)
- Stays well within the 16 MB BSON limit for any realistic tournament (30 rounds at ~200 bytes each is under 10 KB)

**Cons**:
- The `Result` document is created before the session completes, so `persistCompletedResult` must handle the case where the doc already exists and just needs `winner` and `completedAt` set

### Option 2: Separate RoundResult collection

One document per round per session in a new collection. Join at query time.

**Pros**:
- Clean separation, each round is independently addressable

**Cons**:
- Requires a join or multiple queries to assemble the timeline
- More documents to manage, index, and clean up
- Overkill for an array that maxes out at ~30 elements

### Option 3: Persist only at session completion

Collect round snapshots in server memory during the session, bulk write the entire `rounds[]` to the `Result` document when the session completes.

**Pros**:
- Simpler write pattern, one bulk operation

**Cons**:
- A server crash mid tournament loses all round history
- Cannot show round history for sessions recovered after a restart

## Decision

**Chosen option**: Option 1: Embed rounds in the Result document (incremental $push)

Each round snapshot is appended to `Result.rounds[]` via `$push` immediately after `closeRoundOnce` freezes the tally. A partial `Result` document is created at the first round close if one does not already exist. On session completion, `persistCompletedResult` detects the existing document and updates it with `winner` and `completedAt` rather than creating a duplicate.

### Amendment: the broadcast guard at `ROUND_CLOSED` (2026-10-05)

`AC-3` has always named `ROUND_CLOSED` as a state where `rounds[]` is included, but the guard in `server.js` released history only at `RESULTS_REVEALED` and at completion, and a unit test pinned that stricter behaviour. Reviewed and settled: **the code was wrong, not the contract.** `rounds[]` is the history of rounds that have already closed, and `closeRoundOnce` freezes that tally before it sets the lifecycle, so nothing accrues between the close and the reveal. Withholding it buys no privacy, and it leaves a latent trap for any client written against `AC-3`.

`finalVote` is deliberately *not* released at `ROUND_CLOSED`, and neither is the live `vote.tally`. Both carry the round that has just closed and is still waiting for its reveal, and the project rule is that a frozen tally appears at the reveal or at completion. So the three carriers are gated by two rules rather than by one flag, which is the change this amendment makes to the contract text, the key invariants, the build plan and the value sourcing table. An inline cross check of this amendment is what surfaced the third carrier: a single `tallyVisible` flag would have satisfied the `rounds[]` half of `AC-3` while quietly publishing the just closed round's tally through `vote.tally` one tick before its reveal.

One honest caveat, recorded so nobody reads this as a user visible fix. `ROUND_CLOSED` is assigned by `closeRoundOnce` and overwritten with `RESULTS_REVEALED` in the same tick, because `resolveRevealDuration` clamps to a minimum of 1 second and `timerManager.startRevealTimer` is always present in a supported configuration. No broadcast has ever been observed carrying `ROUND_CLOSED`, so this amendment closes a divergence between code and contract rather than a reported symptom. It matters for the day the state becomes observable: a degraded reveal timer, a future pause or resume, or the crash resume work in [0009](../specs/0009-crash-resume-round-state/index.md) that can restore a lifecycle from the database. At that point the contract already says the right thing and no client breaks.

Options weighed and rejected: keep the stricter code and amend `AC-3` down to `RESULTS_REVEALED` and completion, which is a smaller diff but pins an accidental behaviour into the contract and hides the reason from the next reader; or release `finalVote` at `ROUND_CLOSED` too, which gives the simplest possible rule, "strip only during `VOTING`", at the cost of publishing a round's result before its reveal.

## Rationale

Incremental persistence is the only option that survives server crashes without losing round history. Since the `Result` document already exists as the completion artifact, extending it with a `rounds[]` array keeps the data model simple and avoids cross collection joins. The BSON size concern is academic: the largest realistic tournament (15 candidates, 14 rounds, each ~200 bytes) produces under 3 KB of round data. Option 2 adds operational complexity for no benefit at this scale. Option 3 trades crash safety for write simplicity, which is the wrong trade when the whole point is preserving history.

## Feature design

**Data model sketch**:

Round snapshot (embedded subdocument in `Result.rounds[]`):

| Field | Type | Required | Description |
|---|---|---|---|
| `roundIndex` | Number | yes | Monotonic (1, 2, 3, …), from `roundManager` |
| `kind` | String enum | yes | `pairwise` (future: `single_ballot`) |
| `candidates` | [String] | yes | The two candidate names in server order |
| `tally` | Object | yes | `{ candidateName: voteCount }` frozen at close |
| `totalVotes` | Number | yes | Sum of tally values |
| `closedAt` | Date | yes | Timestamp of round closure |
| `resolution` | String enum | yes | `majority_win`, `tie_advance` (future: `runoff`, `admin_pick`, `coin_flip`, `no_result`, `zero_vote_replay`) |
| `advanced` | [String] or null | yes | Candidates advancing (1 or 2 entries); null for final round |

Result schema extension:

| Field | Type | Default | Description |
|---|---|---|---|
| `rounds` | [roundSnapshotSchema] | `[]` | Ordered array of round snapshots |

No new indexes required; `rounds[]` is read as part of the parent `Result` document, never queried independently.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/sessions/:sessionId/rounds` | GET | `sessionId` (URL param) | `{ success, rounds, sessionId }` | none (public sessions) | 404 (no result found) |

Socket actions (server dispatched, never from client):

| Action | Payload | Trigger |
|---|---|---|
| `APPEND_ROUND_RESULT` | `{ sessionId, round: { roundIndex, kind, candidates, tally, totalVotes, closedAt, resolution, advanced } }` | After `closeRoundOnce` freezes the tally and `NEXT` advances the tournament |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `APPEND_ROUND_RESULT` | `roundIndex` | `roundManager.getCurrentRound().roundIndex` |
| `APPEND_ROUND_RESULT` | `kind` | Hardcoded `"pairwise"` (the only mode today) |
| `APPEND_ROUND_RESULT` | `candidates` | `closeRoundOnce.finalVote.pair` |
| `APPEND_ROUND_RESULT` | `tally` | `closeRoundOnce.finalVote.tally` |
| `APPEND_ROUND_RESULT` | `totalVotes` | Derived: sum of `tally` values |
| `APPEND_ROUND_RESULT` | `closedAt` | `closeRoundOnce.finalVote.closedAt` |
| `APPEND_ROUND_RESULT` | `resolution` | Derived from `tally`: if one candidate has more votes, `majority_win`; if tied, `tie_advance` |
| `APPEND_ROUND_RESULT` | `advanced` | Derived after `NEXT` dispatches: read the post `next()` session state. If `winner` is set, this was the final round and `advanced` is `null`. Otherwise, derive from the frozen tally using the same logic as `core.getWinners`: one candidate with more votes gives `[winner]`; a tie gives `[both]` |
| Totals panel | Total votes per candidate | Derived: client sums each candidate's votes across all rounds in `rounds[]` |
| Totals panel | Rounds played | Derived: `rounds.length` |
| GET `/api/sessions/:sessionId/rounds` | `rounds` | `Result.findOne({ sessionId }).select('rounds sessionId')` |
| Broadcast guard | Whether to include `rounds[]` | `roundLifecycle` value from session state (`VOTING` → strip, else include); a recovered `pending` session with no live round also includes its settled history |
| Broadcast guard | Whether to include `finalVote` | `roundLifecycle` is `RESULTS_REVEALED` or the session is `completed`; withheld at `VOTING`, `ROUND_CLOSED` and `TIE_PENDING`, because it carries the round that has not been revealed yet |
| Broadcast guard | Whether to include the live `vote.tally` | Same source as `finalVote`, and the same rule: withheld at `VOTING`, `ROUND_CLOSED` and `TIE_PENDING`, emptied to `{}` rather than deleted, so the client keeps the vote shape |

**Key invariants**:
- A round snapshot is appended exactly once per round closure (idempotent via `roundIndex` monotonicity: if `rounds[]` already contains a snapshot with the same `roundIndex`, skip the append).
- `rounds[]` is never mutated after append. Snapshots are frozen and immutable.
- The `Result` document is created on first round close with `rounds: []` and `winner: null`. `persistCompletedResult` on session completion detects the existing doc and sets `winner` and `completedAt` without overwriting `rounds`.
- `rounds[]` is stripped from the session broadcast payload when `roundLifecycle` is `VOTING`. A recovered session with no live round is not a `VOTING` case: its settled history is already public, so it is served rather than withheld.
- `rounds[]` and `finalVote` are gated separately. `rounds[]` releases when a round closes, because `closeRoundOnce` has already frozen that tally and nothing accrues between the close and the reveal. `finalVote` releases only at a reveal or a conclusion, so the current round's result is never published before its reveal. The live `vote.tally` follows `finalVote`, since at `ROUND_CLOSED` it holds the same frozen numbers, and is emptied to `{}` rather than deleted so the client keeps the vote shape. Do not collapse these into a single flag; that is what made the implementation stricter than this contract, and it would also publish the just closed round's tally through `vote.tally` while still withholding it through `finalVote`.
- The two read paths need different amounts of work. The socket payload carries all three carriers, so the guard has to separate them. The `GET /rounds` endpoint passes only `{ status, rounds }`, so releasing history at `ROUND_CLOSED` changes its response and nothing else there.
- No client change is needed for this amendment. `getGuardedResultsPresentation` already maps `roundLifecycle` `ROUND_CLOSED` to the `RESULTS_REVEALED` visibility state, so the results page is already prepared to render history in that state. The server was the only side withholding it.
- `core.js` is not modified.

**Security model**:
- `APPEND_ROUND_RESULT` is server internal only (never accepted from a client socket). It does not need to be in `ADMIN_ACTION_TYPES` because it is dispatched directly by the server, not via the socket ingress.
- The `GET /api/sessions/:sessionId/rounds` endpoint returns data for public sessions only (secured session gating is deferred to Phase 8: Visibility and Privacy).
- No new authentication or authorization concerns.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: run a 3 round tournament, verify `Result.rounds[]` has 3 entries with correct `roundIndex`, `tally`, `resolution`, and `advanced`, verifies **AC-1**, **AC-2**
- Tally guard: during `VOTING` lifecycle, verify the session broadcast omits `rounds[]`, verifies **AC-3**, **AC-9**
- Idempotency: dispatch `APPEND_ROUND_RESULT` twice with the same `roundIndex`, verify `rounds[]` has only one entry, verifies **AC-1**
- Completion: verify `persistCompletedResult` finds the existing `Result` doc (created at first round close) and adds `winner` + `completedAt` without overwriting `rounds`, verifies **AC-2**
- REST endpoint: `GET /api/sessions/:sessionId/rounds` returns the rounds array for a completed session, 404 for unknown session, verifies **AC-7**
- Recovery: restart the server mid tournament, verify the recovered session loads `rounds[]` from the partial `Result` document, verifies **AC-8**
- Totals derivation: given a `rounds[]` with known tallies, verify the client utility correctly sums votes per candidate and counts rounds, verifies **AC-5**

## Build plan

Ordered as Tracer Bullet slices: each task delivers a thin end to end strand through the full stack.

1. **Result schema extension and round snapshot persistence** — Add `rounds` array to the `Result` Mongoose schema with the round snapshot subdocument schema. Add a `pushRoundToResult` function in `repository.js` that does `$push` (with upsert to create the `Result` doc if needed). Update `persistCompletedResult` to detect an existing `Result` doc and `$set` only `winner` and `completedAt` instead of `$setOnInsert` on the whole document. Satisfies **AC-2**.

2. **APPEND_ROUND_RESULT reducer and server dispatch** — Add `APPEND_ROUND_RESULT` case to `reducer.js` that appends a round snapshot to `sessions.<sessionId>.rounds` (an Immutable List), guarded by `roundIndex` idempotency. Dispatch `APPEND_ROUND_RESULT` from the caller of `closeRoundOnce` in `server.js` after both the close and the subsequent `NEXT` dispatch, deriving `resolution` from the frozen tally and `advanced` from the post `next()` session state (if `winner` is set, `advanced` is `null`; otherwise the candidates who survived). Register `APPEND_ROUND_RESULT` in the client's `LOCAL_ACTION_TYPES` so it is never echoed back. Satisfies **AC-1**.

3. **Broadcast guard: strip rounds during VOTING** — In the session state serialization (the subscriber that broadcasts to clients in `server.js`), strip the `rounds` key from the payload when `roundLifecycle` is `VOTING`. Include it in all other lifecycle states and when the session status is `completed`. Gate the other two carriers separately and identically to each other: strip `finalVote` and empty `vote.tally` during `VOTING`, `ROUND_CLOSED` and `TIE_PENDING`, and release them only at `RESULTS_REVEALED` or a conclusion. Satisfies **AC-3**, **AC-9**.

4. **Client state: store rounds in voteSlice and derive totals** — Add `rounds` to the normalized session state in `voteSlice.js`. Add selectors: `selectSessionRounds(state, sessionId)`, `selectRoundTotals(state, sessionId)` (aggregates votes per candidate across all rounds and returns rounds played count). Add a `deriveTotals(rounds)` utility in `resultsUtils.js`. Satisfies **AC-5**.

5. **Results page: accordion timeline and totals panel** — Create a `RoundTimeline` component (accordion rows, each with "Round N: Candidate A vs Candidate B" and a resolution badge; expanding reveals `ResultsChart` and vote counts). Create a `TotalsPanel` component. Wire both into the existing results page, respecting the tally visibility guard (hidden during `VOTING`). Satisfies **AC-4**, **AC-5**, **AC-6**.

6. **REST endpoint and history detail page** — Add `GET /api/sessions/:sessionId/rounds` in `server.js` that queries `Result.findOne({ sessionId })` and returns `{ success: true, rounds, sessionId }` or 404. Update the history detail view to fetch and display the same accordion timeline and totals panel for completed sessions. Satisfies **AC-7**.

7. **Recovery: load rounds from Result on startup** — In `recoverSessionsFromDb`, after loading a session, check for a matching `Result` document with a non empty `rounds[]`. If found, dispatch `APPEND_ROUND_RESULT` for each recovered round to rebuild the in memory history. Satisfies **AC-8**.

8. **Tests: round persistence, totals, and broadcast guard** — Server tests: `rounds[]` persistence via `pushRoundToResult`, idempotent `APPEND_ROUND_RESULT`, `persistCompletedResult` with pre existing `Result` doc, broadcast guard during `VOTING`. Client tests: `deriveTotals` utility, `selectSessionRounds` selector. Satisfies **AC-10**.

## Consequences

**Positive**:
- Full tournament audit trail: every matchup, tally, and resolution is preserved and queryable
- Incremental persistence means partial results survive server crashes
- The history page becomes genuinely useful for reviewing how tournaments unfolded

**Negative / tradeoffs**:
- The `Result` document is now created before session completion (at first round close), which changes the current assumption that `Result` exists only for completed sessions. `persistCompletedResult` and any code that checks `Result` existence to infer completion must be updated.
- The session broadcast payload grows with each round (roughly 200 bytes per round). For a 30 round tournament this adds ~6 KB, negligible for Socket.io but worth noting.

**Neutral**:
- The `APPEND_ROUND_RESULT` action is a new server internal action type. It must be registered in the client's `LOCAL_ACTION_TYPES` to prevent echo, following the existing pattern.
- The resolution enum is defined with future values (`runoff`, `admin_pick`, `coin_flip`, `no_result`, `zero_vote_replay`) that are not yet populated. Phase 4 (single ballot) will populate them without a schema migration.

## Follow-up

- [x] Phase 8 (Visibility and Privacy) must gate `GET /api/sessions/:sessionId/rounds` for secured sessions (only approved participants and admin).
- [x] Align the guard in `applyTallyVisibilityGuard` with the amended `AC-3`: release `rounds[]` at `ROUND_CLOSED`, and keep `finalVote` and the live `vote.tally` withheld there. The existing guard test that asserts both carriers are stripped at `ROUND_CLOSED` has to be split per carrier rather than deleted, and a third case has to assert that the `vote` shape survives with an emptied tally.
- [x] Re-run `/check verify round history and full results` after that change. The current `verify.md` records `ROUND_CLOSED` as never observed in a broadcast and treats the criterion as holding on the states that actually occur; that note has to be refreshed against the split test.
- [x] `TIE_PENDING` withholding is now stated in `AC-3` rather than left implicit, but it is asserted only indirectly. Give it its own case when the tie ladder spec next grows.
- [x] Run `/sync` after the guard changes. The root `AGENTS.md` rule describing `applyTallyVisibilityGuard` currently says it withholds `rounds` and `finalVote` together, which is exactly the wording this amendment corrects; leaving it would have the next task read a rule the code no longer follows.
- [x] When Phase 4 (Single Ballot Mode) ships, the `resolution` field will need to populate the additional enum values (`runoff`, `admin_pick`, `coin_flip`, `no_result`, `zero_vote_replay`).

## Migration plan

**Strategy**: no migration needed
The `rounds` field is added to the `Result` schema with a default of `[]`. Existing `Result` documents (which have no `rounds` field) will read as `rounds: []` due to Mongoose defaults. No backfill is needed because historical sessions have no round data to reconstruct.
