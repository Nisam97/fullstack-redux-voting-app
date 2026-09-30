# Review, develop1, 2026-09-28

**Reviewed by**: Buffy, inline (Freebuff client has no subagent support; author on sonnet, so the reviewer shares the author model family. This is a degraded review, not the cross model guarantee. For a truly independent pass, switch your model and rerun `/check review`.)
**Scope**: 14 feature files on branch develop1 vs main, eligibility and presence surfaces only (reducer.js, roundManager.js, server.js, timer.js, auth/voter.js, constants.js, persistence.js, client socket.js, voteSlice.js, Lobby.jsx, Voting.jsx, plus the four presence test suites)
**Verdict**: Blocked

## Summary

Spec 0005 ships a complete presence and eligibility data layer: the reducer holds presence records and frozen round snapshots, the serializer is an explicit allowlist with negative tests, the transport has a reverse index with correct invalidation, and the client renders a live count badge. But the feature never runs in production. Nothing on the server ever dispatches `SNAPSHOT_ROUND_ELIGIBILITY`, the shipped browser client never emits the events that record presence, and the one live early close evaluation ignores presence entirely and keeps the old flat two voter floor. All three wiring seams are missed at once, so the ghost voter problem that motivated the spec still exists for real users, while every unit test passes because the tests drive the actions by hand.

## Blockers

### 🔴 No production path ever dispatches `SNAPSHOT_ROUND_ELIGIBILITY`, `voting-server/src/roundManager.js:680`

**Problem**: The reducer case (reducer.js:532) and the `snapshotRoundEligibility()` helper exist, but no production code calls the helper. The spec pins the single dispatch site as the authoritative round opening path in `roundManager.js` after the round identity is current and before the timer arms (AC-9). `initRound` and every ladder advance path (`REPLAY_ZERO_VOTE`, `START_RUNOFF`, `START_REMATCH`, `COMPLETE_SINGLE_BALLOT` rearm) initialize rounds without ever snapshotting. The call sites found for the helper are tests and the verify drivers only.

**Why it matters**: AC-1 and AC-9 are unmet in the running system. Snapshots stay empty for every real round, so the entire snapshot relative quorum (AC-6) is unreachable, and the "vote for a roundId with no snapshot is rejected as stale" rule has nothing to reject against.

**Suggested fix**: Call `snapshotRoundEligibility(sessionId, roundId, store)` inside the round opening sequence: right after each `initRound` that opens a fresh roundId, and before `timerManager.startTimer` arms the round. Cover `initRound` itself plus the ladder re entry paths so every fresh roundId gets exactly one snapshot.

### 🔴 The shipped browser client never records presence, `voting-client/src/services/socket.js:102`

**Problem**: The server records presence on the socket `join_session` event (server.js:1103) and on `subscribe_session` when the payload carries a voter token (server.js:1170, 1203). The client never emits `join_session` at all, and both of its `subscribe_session` emissions send only `{ sessionId }`. The voter token lives in session storage and rides along with `VOTE` actions; it is never attached to the socket subscription or handshake. So for real users `RECORD_PRESENCE_CONNECT` never fires, presence stays empty, `connectedCount` renders as zero or nothing, and the grace window logic has no data to work with.

**Why it matters**: AC-2 and AC-8 are unmet for the shipped UI. The lobby badge and arena header never show a live count, disconnects never mark anyone disconnected, and the early close denominator can never shrink. The verify drivers passed because they speak the socket protocol directly, which is exactly the surface the real client skips.

**Suggested fix**: After a successful `joinVoterSession`, emit `join_session` over the socket (or include the stored token in the `subscribe_session` payload) so the server validates it and records presence. Restore it on the reconnect path in `connectSocketToStore` so reconnection after a drop reattaches the token.

### 🔴 The production early close evaluation ignores presence and keeps the flat two voter floor, `voting-server/src/server.js:1847`

**Problem**: The only production call is `roundManager.canCompleteEarly({ sessionId, roundId: currentRoundId })`. With no `store` and no `presence`, the `storeHasPresence` probe in `canCompleteEarly` (roundManager.js:563) is false, so it takes the legacy branch: `getVoterCount(sessionId)` with a floor of 2 (roundManager.js:571 to 585), and `hasAllVotersVoted` compares raw submission counts against the total registered headcount. The snapshot relative quorum in `computeEligibility` never evaluates in the live path.

**Why it matters**: This is the original bug restated in the spec Context section. A voter whose tab is closed still sits in `tokensBySession`, so the denominator stays high and early close never triggers; a single voter session can never close early at all. AC-3, AC-5, AC-6, and AC-7 all fail in production even though their unit tests pass.

**Suggested fix**: Pass the store (and the resolved presence and snapshot, or let `canCompleteEarly` read them from the store) at server.js:1847 so the snapshot relative branch runs. Once Blockers 1 and 2 land, the store presence probe will be true and the pure helper takes over.

## Major

### 🟠 Fallback snapshot synthesis contradicts AC-9 and matches voters by display name prefix, `voting-server/src/roundManager.js:573`

**Problem**: When no stored snapshot exists, `canCompleteEarly` synthesizes one: for round 1 it uses every registered display name prefix, otherwise it uses currently connected presence, and it caches the synthesized array into `snapshotsByRound` permanently (roundManager.js:596). The spec says a missing snapshot is an ordering bug to log loudly, with a fallback that includes mid round joiners as a known deviation. The display name matching goes further: `checkVoted` and `getPresenceRecord` map a snapshot key to submissions and presence via `displayName === key || displayName.startsWith(key + '_')` (roundManager.js:457, 490). Two voters named `Vikram` and `Vikram_2` both count as `Vikram`.

**Why it matters**: A name prefix heuristic in the quorum path can credit one voter's ballot to another and freeze the wrong denominator into the cache. Today the branch is unreachable in production only because Blocker 3 never gets there; the moment the wiring is fixed, this becomes the live default for any round where the snapshot dispatch lags a vote.

**Suggested fix**: When the wiring from the blockers lands, delete the synthesis and the display name matching, log loudly on a missing snapshot, and return false so the timer expiry closes the round. Keying everything by voter token (as the reducer and the ledger already do) removes the heuristic entirely.

### 🟠 The zero active voters guard in `closeRoundOnce` does not implement AC-7, `voting-server/src/roundManager.js:808`

**Problem**: The guard refuses closure when `getVoterCount(sessionId) >= 2 && preCheckTotalVotes === 0 && roundSubmissionsCount === 0 && !timerManager`. It keys on the total registered count, not on the active snapshot voter set, and only applies when no timer manager is passed, which today means only the early close call site. AC-7 specifies inhibition when no active snapshot voter exists, regardless of the registered count, and a timer expiry close of an abandoned room is exactly the premature advancement the AC wants prevented.

**Why it matters**: The guard as written can both under protect (a one voter or two voter abandoned session is exempt from the guard because of the `>= 2` floor) and never fire on the timer path (timerManager is always passed there). It is currently dead in production; when Blocker 3 lands it will run with the wrong inputs.

**Suggested fix**: Re key the guard on `computeEligibility` output: if the snapshot exists and `activeCount === 0`, refuse closure. Decide explicitly whether timer expiry should be exempt (the spec text suggests inhibition applies to early close, with the timer as the natural close), and encode that choice in one place with a test.

## Minor

### 🟡 Votes are not rejected for a roundId with no snapshot, `voting-server/src/roundManager.js:310`

`recordRoundSubmission` checks the token and the closed rounds set but never the snapshot. The spec's ordering rule says a vote for a roundId whose snapshot does not yet exist is rejected as stale. Add the check once Blocker 1 guarantees snapshots exist.

### 🟡 The legacy quorum floor of 2 survives in `hasAllVotersVoted` and the fallback branch, `voting-server/src/roundManager.js:399`

AC-6 removes the flat floor, but the legacy path (the one production uses today) keeps it. If the fallback branch is kept deliberately for no presence environments, document that it intentionally deviates from AC-6; otherwise the two code paths disagree about when a round may close.

### 🟡 Presence adds per session serialization work on every state change, `voting-server/src/server.js:962`

Each connect and disconnect dispatch changes the session reference, so the subscriber re serializes both the previous and current session and compares JSON. For a session with heavy connect and disconnect churn this doubles serialization work per flap. The spec lists debounce as out of scope for v1, so this is a note, not a request.

## Nits

- ⚪ `voting-server/src/roundManager.js:411`, `computeEligibility` accepts both positional and object signatures and sniffs shapes (Immutable, Set, Array, plain object) for each argument. Pick the object form the spec pinned and delete the positional path.
- ⚪ `voting-server/src/roundManager.js:552`, optional chaining appears here while every other store access in the file is guarded manually. Pick one style.
- ⚪ `voting-server/src/server.js:1847`, the early close call runs the full resolution inline in the vote handler; once the store is passed it will also read state twice. Fine to leave, but a small helper would read better.

## Strengths

- `serializeSessionState` is a true allowlist with explicit deletes for `presence` and `snapshots`, and the negative tests assert no token or socket id substrings. AC-10 is enforced the way the spec asked, by test rather than convention.
- The reducer presence transitions are clean Immutable updates. Multi tab handling through the `socketIds` set is correct, and the socket ids connected versus disconnected invariant holds.
- Clock domains are respected: `disconnectedAt` uses the monotonic clock in the disconnect handler, `lastSeenAt` stays epoch, and grace arithmetic never mixes them.
- `socketToVoter` invalidation on disconnect and on terminal purge matches the coupling table, and `PURGE_SESSION_PRESENCE` runs in a microtask guarded by a real terminal transition.
- The failing first behavioral pin in `grace_window_tie_ladder_spec.js` (7 red until the quorum lands) is a genuinely good practice, and it correctly predicted the injection seam that Blocker 3 skipped.

## Test coverage

The four presence suites are substantive: reducer transitions and invariants, serializer negatives, snapshot idempotence and ladder independence, late joiner and reconnect, plus the grace window tie ladder pin. What no test does is drive a real `startServer` with a real socket client joining the way the browser does. Every suite dispatches the presence and snapshot actions by hand, which is why three missing wires passed green. The client suite covers the malicious payload normalization guard but not the subscription payload. The repo's own Tracer Bullet rule asks for one real strand through the full stack; that strand is exactly what is missing, and one integration test that joins through the shipped client path would have caught all three blockers.
