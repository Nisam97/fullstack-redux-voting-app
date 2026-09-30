# Review, develop1, 2026-09-26

**Reviewed by**: inline review on the session model (sonnet). This client has no subagent support, so the planned opus cross model review could not run and this review shares the author model's blind spots. For a true second model, open this diff in another assistant and re-run `/check review`.
**Scope**: feature surfaces for spec 0004 (single ballot mode and tie ladder) on develop1 vs main: `voting-server/src/ballot.js`, `roundManager.js`, `timer.js`, `reducer.js`, `server.js`, `db/models/Result.js`, `db/repository.js`, and the client `voteSlice.js`, `store.js`, `services/socket.js`, `pages/Voting.jsx`, `pages/Admin.jsx`. The branch diff also carries unrelated work; those files were read only where they meet the feature.
**Verdict**: Changes requested

## Summary

The feature is implemented close to the spec. `ballot.js` is a clean, well tested pure module beside an untouched `core.js`, the tie ladder funnels through the idempotent `closeRoundOnce` and `resolveTieAuthoritative` with one exclusive 30 second timer per session, and the admin and voter surfaces render the full ladder. Three things hold it back from an approve: in tournament mode a tie can pin a session in a `TIE_PENDING` limbo forever if the admin closes the tab, the 30 second automatic coin flip (AC-9) has no test at all, and the client shows live per candidate tallies during `VOTING`, which breaks the project rule that tallies stay hidden during an active round.

## Blockers

None.

## Major

### 🟠 Tournament mode can strand a session in TIE_PENDING with no decisive ladder exit, `voting-server/src/roundManager.js:669` and `voting-server/src/core.js:12`

**Problem**: In single ballot mode the ladder is safe: a second tie re-runs the tied subset, and any runoff re-tie re-enters `TIE_PENDING` where the admin window or the auto coin flip ends it. In tournament mode, `START_RUNOFF` only clears the tally and `tieCount` goes to 1, so a re-tie also lands in `TIE_PENDING`. A coin flip or admin pick resolves the session there. But if the admin never acts and the browser tab closes, the 30 second timer fires and resolves it, so the real trap is this: `RESOLVE_TIE` and `TERMINATE_NO_RESULT` always complete the whole session (reducer sets `status: completed`), while `resolveAdvanced` in roundManager (line 407) still returns both tied candidates as advancing (`[a, b]`) for pairwise rounds, mirroring `core.getWinners`. In the old core model a tie requeues both candidates and the tournament continues; the new reducer path instead ends the session outright. The two models of "what a tie means" now coexist, and which one you get depends on whether the tie was the first (requeue via `NEXT`) or the second (session ends).

**Why it matters**: A seven candidate tournament that ties twice silently ends with one candidate picked by coin flip, instead of continuing the bracket the pairwise engine was designed for. The behavior is deterministic, so it will not corrupt data, but it contradicts the spec's framing that the ladder exists to reach a winner "of the matchup", and the `tie_advance` plus requeue path right next to it makes the inconsistency visible in round history: two identical 1 to 1 tallies resolve as `tie_advance` (session continues) then `coin_flip` (session ends).

**Suggested fix**: Pick one semantic for tournament mode and make the code agree. Either treat `TIE_PENDING` as a single matchup concept and, on resolution, dispatch a pairwise rematch or advancement of the chosen winner rather than completing the session, or document in the spec that a second consecutive tie in any mode ends the session. The resolver already knows `votingMode`, so the branch is cheap; the choice is a product decision the author should make deliberately.

### 🟠 AC-9, the 30 second automatic coin flip, has no test, `voting-server/test/single_ballot_and_tie_ladder_spec.js` (missing)

**Problem**: The describe block at line 391 claims AC-9 in its title, but every test in it resolves the tie manually. `handleTiePendingExpiry` (timer.js line 566) and the `setTimeout` that drives it are never exercised. Nothing asserts that expiry picks a tied candidate, records resolution `coin_flip`, completes the session, and clears the timer. The scope row for this feature says done when "every tie path (rematch, admin decision, auto coin flip) is covered by tests".

**Why it matters**: This is the only fully automatic decision the server makes on a clock, and it is the path every abandoned session takes. A regression here (a stale closure resolving the wrong round, the timer not firing because it was cleared by the `isInactive` branch, a double flip racing an admin pick) would be invisible to the suite. The timer uses a real `setTimeout`, so a test can arm a 30 ms timer by passing a short duration, which the production code already accepts (`finalDuration` is whatever number the caller passes).

**Suggested fix**: Add one integration test: reach `TIE_PENDING` with a short timer duration, do not send `RESOLVE_TIE`, assert after expiry that `status` is `completed`, the winner is one of the tied candidates, the last round's resolution is `coin_flip`, and the tie pending timer is gone. A second assertion that a manual `RESOLVE_TIE` arriving just before expiry still wins (the admin path must clear the timer) would cover the race the spec calls out as idempotent.

### 🟠 Live tallies are rendered to voters during an active round, `voting-client/src/pages/Voting.jsx:596` and `voting-server/src/server.js:192`

**Problem**: The socket broadcast sends the full serialized session, including `vote.tally`, whenever the round lifecycle is `VOTING`. The shared guard `applyTallyVisibilityGuard` strips only `rounds` and `finalVote`. On the client, the active ballot grid passes `tally={voteState?.tally?.[cand]}` into `VoteCard`, which renders a numeric vote count for every candidate the moment the tally is numeric. The diff shows these tally props on the active grid are touched in this change (the grid itself is new), so this is in scope.

**Why it matters**: Both AGENTS.md files state results and tallies stay hidden during an active round, and the client gotcha file says "Do not read tallies or percentages from `vote` while `roundLifecycle` is `VOTING`". A voter who votes first sees live standings and can coordinate or bandwagon; this is exactly the leak the guard was built to prevent. The existing `tally_visibility_guard_spec` tests `rounds` and `finalVote`, not `vote.tally`, so the suite green lights a violation of the written rule.

**Suggested fix**: Decide the intended behavior and align all three layers. If tallies must be hidden, stop passing the live tally into the voting grid (pass `undefined` until `RESULTS_REVEALED`) and optionally strip `vote.tally` from the broadcast during `VOTING`, keeping a hidden `hasVoted` signal so the UI can still confirm the voter's own choice. If showing live counts is now a deliberate product choice for this feature, update the AGENTS.md rules and the guard spec so the code and the contract agree.

## Minor

### 🟡 Default voting mode in the reducer ignores the 2 to 6 candidate rule, `voting-server/src/reducer.js:48`

**Problem**: The reducer stores `votingMode: action.votingMode || 'tournament'`, while the spec says sessions with 2 to 6 candidates default to `single_ballot`. In practice the server's create handler always computes and injects the derived mode before dispatching, so the gap is only reachable by a direct store dispatch that skips ingress (tests, scripts, recovery replay paths that rebuild from a document lacking the field).

**Why it matters**: The spec's invariant says the default applies unless overridden, and `SINGLE_BALLOT_MAX` exists in `src/constants.js` for exactly this derivation. A replayed or hand built session with three candidates would silently run as a tournament.

**Suggested fix**: Derive in the reducer as a fallback: `action.votingMode || (entriesList.size >= 2 && entriesList.size <= SINGLE_BALLOT_MAX ? 'single_ballot' : 'tournament')`. The persistence layer already does this same fallback at lines 127 and 437, so the reducer would match it.

### 🟡 START_REMATCH is unreachable and duplicates START_RUNOFF, `voting-server/src/roundManager.js:1011`

**Problem**: `executePendingRoundAdvance` has a full `START_REMATCH` branch that dispatches `START_RUNOFF` and initializes a pairwise round, but no code path ever sets `pendingAction.type` to `START_REMATCH`; the tournament tie branch uses `NEXT_TOURNAMENT` and single ballot uses `START_RUNOFF`.

**Why it matters**: Dead code in a 1450 line orchestration file invites drift: the branch looks like the pairwise rematch path from the spec, a future reader may wire a tie to it believing it is tested, and it can never run today.

**Suggested fix**: Either delete the branch or use it: route the tournament first tie to `START_REMATCH` instead of `NEXT_TOURNAMENT` if the intended design is a same pair rematch rather than a core requeue. One of the two, with a test.

### 🟡 Tie pending round snapshot is derived from a pre resolution session, `voting-server/src/roundManager.js:1172`

**Problem**: `resolveTieAuthoritative` calls `deriveRoundSnapshot(session, ...)` using the `session` captured before `store.dispatch(RESOLVE_TIE)`. The `RESOLVE_TIE` reducer does not touch `rounds`, so the snapshot's `roundIndex` and kind are still correct, but the pattern differs from `NEXT_TOURNAMENT`, which re-reads post dispatch state. The `alreadyAppended` check also reads `store.getState()` after dispatch, so the two reads are inconsistent about which state they trust.

**Why it matters**: It works today because the reducer does not mutate rounds on resolution, but any future reducer change that appends or reindexes rounds during resolution would make the derived snapshot stale or duplicated silently.

**Suggested fix**: Re-read the session from the post dispatch state for the snapshot derivation, matching the `NEXT_TOURNAMENT` branch, or add a comment stating that the pre dispatch capture is deliberate because resolution never mutates rounds.

### 🟡 Voter side tie banner depends on the room timer event arriving, `voting-client/src/pages/Voting.jsx:386`

**Problem**: The voter's tie pending card renders `tiePending.candidates` from the `tie_pending` event and the countdown from `tiePending.expiresAt`. The server emits that event only when `closeRoundOnce` runs with an `io` instance; the `timer_state` event with status `tie_pending` carries no candidates. `handleSetTiePending` falls back to `existing.vote?.candidates`, which after a runoff is the tied pair, so it usually works, but a voter who subscribes between the event and their join relies entirely on the `session_state` `tiePending` field persisting through `normalizeSession`.

**Why it matters**: The fallback chain is three deep across two event types, and the voter display degrades to a generic message rather than an error if any link fails. It is resilient by accident, not by design.

**Suggested fix**: Acceptable to leave, but worth one line in the client AGENTS.md gotchas documenting that `tie_pending` and `timer_state` status `tie_pending` are two sources for the same state, and that `session_state.tiePending` is the durable one.

### 🟡 Admin pick silently defaults to the first tied candidate, `voting-client/src/pages/Admin.jsx:1199`

**Problem**: The pick button sends `selectedTieWinner || managingCandidates[0]`, so an admin who opens the panel and immediately clicks Confirm Pick declares the first listed candidate the winner without an explicit selection.

**Why it matters**: It is a one click accidental declaration with no undo; the session completes immediately. The server would accept it because the candidate is valid.

**Suggested fix**: Disable Confirm Pick until `selectedTieWinner` is explicitly chosen, or add a confirmation step. The dropdown already shows the first candidate as its visual value, which invites the misclick.

## Nits

- ⚪ `voting-server/src/reducer.js:285`, the `RESOLVE_TIE` reducer ignores `action.choice`; the resolution label is computed only in roundManager. Harmless now, but a direct dispatch of `RESOLVE_TIE` with no resolution field in the action produces a completed session with no resolution recorded anywhere, worth a guard or a comment.
- ⚪ `voting-server/src/ballot.js:31`, `voteBallot` silently returns the unchanged state for an invalid entry. Fine for a pure module called behind ingress validation, but a `debug` style rejection signal would make misuse in tests louder.
- ⚪ `voting-server/src/roundManager.js:693`, the tie pending duration 30 is hardcoded here and in `startTiePendingTimer`'s default and in several client fallbacks. A `TIE_PENDING_DURATION` constant beside `SINGLE_BALLOT_MAX` would give the magic number one home.

## Strengths

- The ladder's core guarantee is genuinely well built: every closure path (timer expiry, full turnout, admin action, auto flip) funnels through `closeRoundOnce` and `resolveTieAuthoritative`, the round id guards make stale callbacks no-ops, and the single `activeTiePendingTimers` entry per session makes duplicate timers structurally impossible.
- `ballot.js` is exactly what the spec ordered: a small pure module, cleanly separated from the protected `core.js`, with a dedicated unit suite.
- The ingress security tests for `RESOLVE_TIE` (anonymous rejection, invalid choice, wrong lifecycle, winner not tied, stale round id) are precise and read like a security checklist.
- The `RESOLVE_TIE` action is correctly registered in `ADMIN_ACTION_TYPES` and `ALLOWED_ACTION_TYPES` on the server and in `REMOTE_ACTION_TYPES` with admin token enrichment on the client; the auth chain is complete end to end.
- `core.js` verifies intact at 35 lines, SHA-256 `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`.

## Test coverage

Strong where it exists: pure ballot math, single ballot lifecycle, zero vote replay and termination, first tie runoff, `TIE_PENDING` entry, admin pick, manual coin flip, and all five `RESOLVE_TIE` rejection paths are covered, plus a client suite for normalization, reducer transitions, and selectors. The gaps that matter: no test drives the 30 second expiry (AC-9), no test covers a tournament mode session reaching `TIE_PENDING` (the strand the biggest finding sits on), and the tally visibility suite does not assert anything about `vote.tally` during `VOTING`. The client `package.json` test script correctly enumerates the new `single_ballot_tie_ladder_client_spec.js`.
