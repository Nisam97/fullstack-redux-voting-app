# 0005. Eligibility and Presence Management

**Date**: 2026-09-27
**Revised**: 2026-09-27 (critique pass: coupled invariants, snapshot ordering, serializer enforcement, AC-6 quorum rewrite)
**Status**: Accepted

## Summary

This specification establishes server authoritative voter presence tracking and per round eligibility snapshots managed directly within the VoteSphere backend Redux store. The server tracks active socket connections per voter token inside the session state and captures an immutable snapshot of eligible connected voters at the moment each round starts. Disconnected voters leave the early close calculation after a ten second grace window, ensuring ghost voters who abandon the session do not stall tournament progression. Public late joiners can vote if the current round remains open, but they do not count in the early close quorum until the next round begins. All presence state is sanitized before broadcasting so voter tokens never leak over the network.

## Context

VoteSphere previously relied on a cumulative joined voter counter to determine when all participants had submitted votes. That counter incremented each time a participant joined the lobby, but it never decremented when a browser tab closed, network connection dropped, or voter navigated away. In live tests, a single participant leaving created a ghost voter. Because the total registered count remained high, early round completion could never trigger, forcing all remaining participants to wait out the entire round countdown timer.

Furthermore, public sessions allow participants to join at any point in time. When a new participant joined mid round, the headcount denominator expanded immediately. If the original voters had already voted, the new joiner inadvertently blocked round advancement until they cast a ballot or the timer expired.

The backend requires an authoritative presence and eligibility mechanism that aligns with VoteSphere's single source of truth architecture. By managing presence and eligibility snapshots directly in the Immutable.js Redux store, all state transitions remain pure, predictable, and traceable through standard action dispatches, while sanitization guards prevent voter tokens from leaking over socket broadcasts.

## Requirements

**User stories**:
- As a voter in an active session, I want rounds to close early as soon as all currently active participants have voted, so that abandoned browsers do not force me to wait for the timer.
- As a voter who experiences a brief network hiccup, I want a ten second grace period to reconnect without being discarded from the round.
- As a late joiner entering an ongoing tournament, I want to cast my ballot if the round is still active, without delaying other participants who already finished.
- As an admin, I want to see the live count of active connected voters alongside total registrations in the lobby and voting screens.

**Acceptance criteria**:
- **AC-1**: When each new round initializes, the server dispatches an action to record an immutable round snapshot in the Redux store containing the set of voter tokens connected to the session at that instant.
- **AC-2**: The backend Redux store manages voter presence inside each session, recording active socket identifiers, a last seen timestamp, and a disconnected timestamp set when all sockets for a token close.
- **AC-3**: A voter who disconnects remains in the active round denominator during a ten second grace window. Once ten seconds elapse without reconnection, that voter is excluded from the early close turnout calculation.
- **AC-4**: A voter disconnected for more than ten seconds who reconnects before the round closes is restored to the active connected state, and any valid vote they cast before round close is accepted and tallied exactly once. Vote acceptance for reconnected voters relies on the existing duplicate vote keys surviving for the session lifetime (see Coupled invariants); nothing in this feature may shorten or bypass that key lifetime.
- **AC-5**: A public voter joining mid round is excluded from the current round snapshot denominator, preventing them from delaying early close. Any vote cast by a late joiner during the open round is accepted, and the voter enters the eligibility snapshot starting with the subsequent round.
- **AC-6**: Early close quorum is snapshot relative. The round may close early only when at least one active snapshot voter exists and every active snapshot voter has cast a vote. The former flat two-voter floor is removed: a two-voter snapshot whose second voter has passed the grace window closes on the remaining voter's ballot, and a single-voter snapshot closes on that voter's ballot. Zero active snapshot voters always inhibits early close (AC-7), which is the guard against premature advancement. See "Resolving the AC-6 floor vs the tie ladder conflict" under Decision.
- **AC-7**: If no active snapshot voter exists (all disconnected past the grace window and none voted), early close is inhibited, allowing the authoritative round timer to run to normal expiry without premature termination.
- **AC-8**: The server sanitizes presence state in `serializeSessionState`, broadcasting a `presence_update` event with `sessionId`, `connectedCount`, and `totalVoters` to the session room on connect, disconnect, and registration, and augmenting `lobby_update` with `connectedCount`. The client lobby and voting arena display the live active count.
- **AC-9**: `SNAPSHOT_ROUND_ELIGIBILITY` dispatches exactly once per roundId from the authoritative round-opening path in `roundManager.js`, after the round identity is current and before the voting timer is armed or any `canCompleteEarly` evaluation for that roundId. Repeat dispatches for the same roundId are no-ops. Every tie ladder step that opens a fresh roundId (`zero_vote_replay`, `runoff`, `tie_advance` rematch) takes its own snapshot; `TIE_PENDING` and `RESULTS_REVEALED` take none.
- **AC-10**: Sanitized broadcast guarantee, enforced by tests: `serializeSessionState` builds client payloads from an explicit allowlist (or strips `presence` and `snapshots` wholesale), and `presence_update` / `lobby_update` carry only the documented count fields. Negative tests assert that serialized payloads and captured socket events contain no voter token substrings, no socket identifiers, and no presence or snapshot structures, for a session holding at least one presence record.

## Options considered

### Option 1: Redux store managed presence and eligibility snapshots

Manage presence records and round snapshots directly within the Immutable.js session state in the backend Redux store. Socket events in the transport layer dispatch pure Redux actions (`RECORD_PRESENCE_CONNECT`, `RECORD_PRESENCE_DISCONNECT`, `SNAPSHOT_ROUND_ELIGIBILITY`). The existing `serializeSessionState` serializer sanitizes presence to public safe counts before broadcasting.

**Pros**:
- Single source of truth: all session state lives in the authoritative Redux store.
- Pure state transitions: presence updates follow existing immutable reducer patterns without loose mutable variables.
- Clean integration with existing store subscribers and broadcast guards.
- Preserves the byte identical integrity of `core.js`.

**Cons**:
- Frequent socket connects and disconnects dispatch actions to the store, creating small state transitions.

### Option 2: Standalone in memory mutable JavaScript Maps outside Redux

Build a separate module using native JavaScript `Map` and `Set` objects outside the Redux store to manage presence.

**Pros**:
- Avoids dispatching Redux actions for transient transport events.

**Cons**:
- Splits backend truth across two separate state systems (Redux store and external module).
- Harder to serialize and synchronize state during round transitions.

### Option 3: MongoDB heartbeat persistence with time to live indices

Persist presence heartbeats to MongoDB collections with short time to live index expiration.

**Pros**:
- Survives process restarts.

**Cons**:
- High database write load and latency.
- MongoDB background cleanup runs on sixty second cycles, making ten second disconnect grace enforcement inaccurate.

### Option 4: Retain the flat two-voter early close floor with a tie ladder exception

Keep AC-6 as originally drafted (minimum two active voters) and add a special case permitting early close with fewer active voters only inside tie ladder replay rounds.

**Pros**:
- Preserves the original single-voter protection verbatim.

**Cons**:
- Still starves ordinary (non replay) two-voter sessions whenever one voter passes the grace window, forcing the full timer on every subsequent round.
- A second quorum rule that only applies inside the tie ladder multiplies test surface and couples eligibility math to ladder state.

**Decision note**: rejected in favor of the snapshot relative quorum in AC-6, which prevents premature advancement structurally (frozen snapshot plus zero-active inhibition) rather than through a numeric floor.

## Decision

**Chosen option**: Option 1: Redux store managed presence and eligibility snapshots

Manage presence and eligibility snapshots inside the backend Redux store under each session's Immutable.js state, with transport level socket mapping in `server.js` and public count sanitization in `serializeSessionState`.

### Resolving the AC-6 floor vs the tie ladder conflict

The original flat rule ("at least two active voters required for early close") collides with spec 0004's tie ladder. A two-voter session that ties enters a rematch or runoff with a fresh roundId; if one voter's tab is gone past the grace window, the flat floor means the round can never early close and always burns its full timer, for every ladder step, forever. The same session is also slower to terminate than a healthy session, inverting the intent of both specs.

The flat floor was a proxy for the real invariant. What actually prevents premature advancement is:

1. **Frozen snapshots** (AC-1, AC-5): the denominator is fixed at round start, so voters who have not yet joined never count, no matter how fast the current voters vote.
2. **Zero-active inhibition** (AC-7): an empty active set can never trigger early close, so an abandoned room always waits out the timer.

Given those two, the numeric floor adds nothing except starvation. AC-6 is therefore rewritten as the snapshot relative quorum: every active snapshot voter has voted, and the active set is non-empty. The worst exposure of the new rule, a single active voter advancing rounds alone, is bounded: that voter can still cast only one vote per round (duplicate vote keys are unchanged), and the round's tally is identical to what the timer expiry would have frozen. It changes pacing, never outcomes.

## Rationale

Storing presence directly in the Redux store adheres to the core architecture defined in `AGENTS.md`: "Backend state is an Immutable.js Map keyed `sessions.<sessionId>`. Reducers return new state, never mutate, and every session scoped action carries `sessionId`."

This approach eliminates fragmented state. Socket events cleanly dispatch domain actions, the store updates immutably, and the serializer derives `connectedCount` and `totalVoters` automatically. Raw voter tokens and socket IDs remain strictly server side and are stripped before payloads reach the network.

The snapshot relative quorum keeps one uniform eligibility rule across normal rounds and every tie ladder step, so the ladder in spec 0004 can terminate on the same terms as ordinary play.

## Feature design

**Data model sketch**:

Backend Redux State Structure (Immutable.js Map under `sessions.<sessionId>`):

```javascript
sessions: {
  [sessionId]: Map({
    // Existing session fields...
    presence: Map({
      [voterToken]: Map({
        socketIds: Set([socketId1, socketId2]),
        lastSeenAt: 1718000000000,        // epoch ms, display only
        disconnectedAt: null,             // monotonic ms, grace arithmetic only
        connected: true
      })
    }),
    snapshots: Map({
      [roundId]: Map({
        roundId: "sess_1:::r1",
        createdAt: 1718000000000,
        eligibleVoterKeys: Set([voterToken1, voterToken2]),
        snapshotCount: 2
      })
    })
  })
}
```

Transport Layer Lookup (`voting-server/src/server.js`):
- `socketToVoter`: Map<socketId, { sessionId, voterToken }> (ephemeral in memory reverse index to resolve socket disconnects in O(1) time). Invalidation is mandatory: entries are deleted on socket disconnect and when the session reaches a terminal state (see Coupled invariants).

**State transitions**:

Presence Actions and Transitions:
1. `RECORD_PRESENCE_CONNECT`:
   - Payload: `{ sessionId, voterToken, socketId, timestamp }`
   - Reducer adds `socketId` to the voter's `socketIds` Set.
   - Sets `connected` to true, `lastSeenAt` to `timestamp`, and `disconnectedAt` to null.
2. `RECORD_PRESENCE_DISCONNECT`:
   - Payload: `{ sessionId, voterToken, socketId, timestamp }`
   - Reducer removes `socketId` from the voter's `socketIds` Set.
   - If remaining `socketIds` is empty, sets `connected` to false and `disconnectedAt` to `timestamp` (monotonic ms).
3. `SNAPSHOT_ROUND_ELIGIBILITY`:
   - Payload: `{ sessionId, roundId, timestamp }`
   - Reducer filters the current `presence` Map for voters where `connected === true`.
   - Freezes that set of voter tokens into `snapshots.<roundId>`. Idempotent: a snapshot already frozen for the roundId is never replaced (AC-9).

### Snapshot dispatch ordering rules

These rules implement AC-9 and remove the timing ambiguity the critique identified:

- **Single dispatch site**: snapshots are dispatched only from the authoritative round-opening path in `roundManager.js` — the same code path that initializes the pair (or single ballot candidate set) for a new roundId. Never from `timer.js` ticks, never from the client, never from the socket layer.
- **Ordering within round open**: for a new roundId the sequence is (1) the round identity becomes current, (2) `SNAPSHOT_ROUND_ELIGIBILITY` dispatches, (3) the voting timer arms, (4) `canCompleteEarly` may first run for that roundId. A vote arriving for a roundId whose snapshot does not yet exist is rejected as stale, matching the AGENTS.md stale-callback rule.
- **Exactly once per roundId**: the reducer freezes the first snapshot for a roundId and ignores repeats.
- **Tie ladder (spec 0004)**: every ladder step that opens a fresh roundId — `zero_vote_replay`, `runoff`, `tie_advance` rematch, and the round that follows `TIE_PENDING` resolution — takes a new snapshot at its own round start. Previous rounds' snapshots are immutable history and are never reused or mutated.
- **`TIE_PENDING` is not a round**: no snapshot is taken during the thirty second admin resolution window. Joins and departures during `TIE_PENDING` are captured only by the next round's snapshot.
- **`RESULTS_REVEALED` between rounds**: the next round's snapshot happens when that round actually opens, not at reveal start.
- **Server restart**: `recoverSessionsFromDb` resets open sessions to pending, so the first post restart round re-snapshots naturally. Snapshots are process local and are not persisted (see Coupled invariants).

### Round early close evaluation

`canCompleteEarly` in `roundManager.js` is rewritten around a pure core helper, `computeEligibility(snapshot, presence, submittedTokens, now, graceMs)`, so the quorum math is unit testable without sockets or store scaffolding:

1. Reads `session.getIn(['snapshots', roundId])` from the Redux store.
2. If no snapshot exists for a current roundId, that is an ordering bug (AC-9); log loudly and fall back to connected voters from presence. The fallback exists only to fail safe, and its known deviation (it includes mid round joiners) is covered by the ordering tests.
3. Classifies each snapshot voter as **active** when any of: currently connected, within `GRACE_PERIOD_MS` of `disconnectedAt` on the monotonic clock, or already present in the round's submission ledger.
4. Early close succeeds when `activeSnapshotVoters.length >= 1` and every active snapshot voter has voted (AC-6, AC-7).

### Coupled invariants and source of truth

The critique flagged that this feature's correctness silently depends on three existing module level registries. This section pins those couplings so future changes cannot break them unnoticed.

**Registry ownership**:

| Registry | Location | Owns | This feature's obligation |
|---|---|---|---|
| `tokensBySession` / `votersByToken` | `auth/voter.js` | Registered voters per session; source of `getVoterCount` and `totalVoters` | Presence keys must always be a subset (enforced by dispatching presence actions only after `validateVoterToken`) |
| `recordedVotes` | `auth/voter.js` | Duplicate vote composite keys | Must survive the whole round for AC-4; `releaseSessionVoters` is only called on terminal transitions, never on disconnects |
| `submissionsByRound` | `roundManager.js` | Per round submission ledger (the only "has voted" source) | `computeEligibility` reads it; no parallel voted-set is ever built from presence |
| `presence` / `snapshots` | Redux store (new) | Who is connected now; who was eligible at round start | Sole authority for connectivity and snapshot eligibility; nothing else may track it |
| `socketToVoter` | `server.js` (new, ephemeral) | socketId → voter resolution | Deleted on disconnect and on terminal purge; never outlives its socket |

**Assertable invariants** (enforced in `presence_spec.js`):
1. `presence` keys ⊆ registered tokens for the session.
2. `snapshot.eligibleVoterKeys` ⊆ `presence` keys at snapshot time; snapshots are frozen thereafter.
3. Serialized `connectedCount` equals the count of `connected === true` presence entries, and `connectedCount <= presence.size <= totalVoters`.
4. Non-empty `socketIds` ⇒ `connected === true` and `disconnectedAt === null`; empty `socketIds` ⇒ `connected === false` and `disconnectedAt !== null`.
5. Every `submissionsByRound` member for a round is a registered token of that session.
6. `socketToVoter` holds no entries for closed sockets or purged sessions.
7. Grace arithmetic (`now - disconnectedAt < GRACE_PERIOD_MS`) uses the monotonic clock domain only; `lastSeenAt` (epoch) is never compared against `disconnectedAt` (monotonic). `now` is injected into `computeEligibility` so tests control time.

**Lifecycle coupling**:
- `roundManager.resetRounds()` clears `snapshots` bookkeeping alongside `submissionsByRound` (per session and global variants).
- The terminal-state purge in `server.js` (`releaseSessionVoters`) also purges `presence`, `snapshots`, and `socketToVoter` entries for the session.
- `clearVoters()` (tests) leaves no dangling cross references in the new structures.

**Drift policy**: drift is prevented by construction — there is exactly one dispatch path from the socket layer into presence, and the invariants above are test assertions, not runtime repair loops. No reconciliation pass in v1.

**API surface**:

Socket.io Transport and Events:

| Event Name | Direction | Payload | Description |
|---|---|---|---|
| `subscribe_session` | Client to Server | `{ sessionId, voterToken? }` | Client joins room, dispatches `RECORD_PRESENCE_CONNECT` |
| `join_session` | Client to Server | `{ sessionId, displayName }` | Client registers voter, dispatches `RECORD_PRESENCE_CONNECT` |
| `disconnect` | Internal Transport | (none) | Socket disconnects, dispatches `RECORD_PRESENCE_DISCONNECT` |
| `presence_update` | Server to Client | `{ sessionId, connectedCount, totalVoters }` | Broadcast sanitized counts to session room |
| `lobby_update` | Server to Client | `{ sessionId, voterCount, connectedCount }` | Augmented lobby event with live connected count |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `RECORD_PRESENCE_CONNECT` | `voter.socketIds` | Socket.io transport connection `socket.id` |
| `RECORD_PRESENCE_CONNECT` | `voter.voterKey` | Verified voter token from handshake, cookie, or subscription |
| `RECORD_PRESENCE_DISCONNECT` | `voter.disconnectedAt` | Monotonic clock timestamp when last socket closes |
| `SNAPSHOT_ROUND_ELIGIBILITY` | `snapshot.eligibleVoterKeys` | Keys in `session.presence` with `connected === true` at round start |
| `canCompleteEarly` | `activeSnapshotVoters` | `computeEligibility` output: snapshot voters connected, in grace window, or in the submission ledger |
| `canCompleteEarly` | has-voted checks | `submissionsByRound` membership (existing ledger, never derived from presence) |
| `serializeSessionState` | `connectedCount` | Count of keys in `session.presence` with `connected === true` |
| `serializeSessionState` | `totalVoters` | Total tokens in `tokensBySession` from `getVoterCount(sessionId)` |

**Key invariants**:
- The voter set in each `snapshot` is frozen when `SNAPSHOT_ROUND_ELIGIBILITY` dispatches and is never mutated.
- A voter is marked connected if their `socketIds` set contains at least one active socket identifier.
- A disconnected voter whose monotonic `disconnectedAt` is within `GRACE_PERIOD_MS` is included in the early close denominator.
- A voter who casts a vote is always counted in the submission tally, even if their disconnect grace period expired.
- Early close quorum is snapshot relative: at least one active snapshot voter, all of whom have voted (AC-6). Zero active voters inhibits early close (AC-7).
- Terminal session state (completed or archived) purges presence, snapshots, and the transport reverse index from the process.

**Security model**:
- Every voter token provided during socket subscription or handshake must pass `validateVoterToken(token, sessionId)` before a presence action is dispatched.
- Unverified sockets cannot claim voter tokens or manipulate presence tallies.
- `serializeSessionState` moves from pass-through serialization to an explicit allowlist: client payloads are constructed from known session fields only, and `presence` / `snapshots` are stripped wholesale. Unknown future session fields never reach the network by default.
- `presence_update` emits exactly `{ sessionId, connectedCount, totalVoters }`; `lobby_update` adds `connectedCount` as a number to the existing payload. Raw voter tokens and socket IDs are never sent to clients.
- Enforcement is by test, not convention (AC-10): negative tests serialize a session holding real presence records and assert the payload contains no token substring, no socket id, and no `presence` / `snapshots` keys; captured socket events are asserted key-by-key.
- Single active voter exposure: under the snapshot relative quorum one voter can advance rounds alone, but duplicate vote keys bound their influence to one ballot per round; pacing changes, outcomes do not.

**Configuration required**:
- No new environment variables. The grace period is exported once as `GRACE_PERIOD_MS = 10_000` from `voting-server/src/constants.js` and imported by the reducer, `computeEligibility`, and tests; no literal `10000` appears in logic code.
- Grace arithmetic runs on the server's monotonic clock (`process.hrtime.bigint()` derived ms), immune to NTP steps; epoch timestamps are display only.

**Critical test scenarios**:
- Happy path: Three voters connected at round start, all three cast votes within five seconds, early close triggers immediately, verifies **AC-1**, **AC-2**, **AC-3**, **AC-6**.
- Disconnect grace period: Voter disconnects, within eight seconds remaining voters vote, round does not close early because disconnected voter is still within grace period, verifies **AC-3**, **AC-6**.
- Ghost voter exclusion: Voter disconnects, eleven seconds elapse, remaining two voters vote, early close triggers because disconnected voter is excluded, verifies **AC-3**, **AC-6**.
- Late joiner exclusion: Two voters connected at round start, third voter joins mid round, the two original voters vote, round closes early without waiting for the late joiner, verifies **AC-5**.
- Reconnected voter voting: Voter's socket drops, reconnects while round is open, submits vote, vote is accepted and counted exactly once, verifies **AC-4**.
- Total disconnect timeout: All connected voters disconnect without voting during an active round, active set is empty, early close does not trigger, round timer expires naturally, verifies **AC-7**.
- Single voter snapshot: One voter connected at round start votes, round closes early on that ballot, verifies **AC-6**.
- Two-voter post grace early close: One of two voters leaves past the grace window, remaining voter votes, round closes early on one ballot, verifies **AC-6** (the former flat floor would have starved this).
- Tie replay fresh snapshot: A `tie_advance` rematch opens a new roundId and snapshots only currently connected voters; voters absent during the prior round's `TIE_PENDING` window join before the rematch opens and appear in the new snapshot, verifies **AC-9**.
- Snapshot idempotence and ordering: A second `SNAPSHOT_ROUND_ELIGIBILITY` for the same roundId is a no-op; a vote for a roundId with no snapshot is rejected as stale, verifies **AC-9**.
- Serializer negative: With presence records holding real tokens and socket ids, `serializeSessionState` output and captured `session_state`, `presence_update`, and `lobby_update` events contain no token substrings, no socket ids, and no presence or snapshot structures, verifies **AC-10**.
- Client normalization guard: A hand crafted malicious `session_state` containing `voterToken` and `presence` fields does not reach the client Redux store, verifies **AC-10**.
- Multi tab connection: Voter opens two tabs, closes one tab, presence remains active, verifies **AC-2**.
- Client indicator update: Client receives `presence_update` and updates header counter, verifies **AC-8**.
- Terminal purge: Session completes; `presence`, `snapshots`, and `socketToVoter` entries for the session are gone, verifies the coupled invariants.

## Build plan

1. Export `GRACE_PERIOD_MS` from `voting-server/src/constants.js`; extend the backend reducer in `voting-server/src/reducer.js` to handle `RECORD_PRESENCE_CONNECT`, `RECORD_PRESENCE_DISCONNECT`, and `SNAPSHOT_ROUND_ELIGIBILITY` (idempotent per roundId) using Immutable.js Maps and Sets with monotonic `disconnectedAt`, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-9**.
2. Wire transport level reverse index (with invalidation on disconnect and terminal purge) and presence action dispatches on socket connect, disconnect, and subscription in `voting-server/src/server.js`, satisfies **AC-2**, **AC-8**.
3. Convert `serializeSessionState` in `voting-server/src/server.js` to allowlist construction, add `presence_update` and the augmented `lobby_update`, and write the serializer negative enforcement tests, satisfies **AC-8**, **AC-10**.
4. Dispatch `SNAPSHOT_ROUND_ELIGIBILITY` from the round-opening path in the `roundManager.js` / `timer.js` sequence per the ordering rules, and rewrite `canCompleteEarly` around the pure `computeEligibility(snapshot, presence, submittedTokens, now, graceMs)` helper implementing the snapshot relative quorum, satisfies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**, **AC-9**.
5. Update client Redux state in `voting-client/src/redux/voteSlice.js` and socket listeners in `voting-client/src/services/socket.js` to process `presence_update`, display live active voter counts in the lobby and voting header, and pass the malicious payload normalization test, satisfies **AC-8**, **AC-10**.
6. Implement automated unit and integration tests in `voting-server/test/presence_spec.js` (reducer transitions, coupled invariants, serializer negatives) and `voting-server/test/eligibility_integration_spec.js` (ordering rules, tie ladder interplay, quorum scenarios), satisfies **AC-1** through **AC-10**.

## Consequences

**Positive**:
- Single source of truth: all presence and eligibility state lives within the authoritative Redux store, with the couplings to `tokensBySession`, `submissionsByRound`, and `recordedVotes` pinned by asserted invariants.
- Ghost voters who leave sessions no longer stall tournaments or force participants to wait out timers.
- Sudden network interruptions up to ten seconds do not prematurely disqualify voters from participating.
- Late joiners can vote if they arrive before round close, but cannot hold the round hostage.
- Spec 0004's tie ladder is unblocked: replayed, runoff, and rematch rounds terminate on the same quorum terms as ordinary rounds.
- Complete privacy protection: voter tokens and socket IDs are scrubbed before broadcasts, with the guarantee enforced by negative tests rather than convention.

**Negative / tradeoffs**:
- Frequent socket connection and disconnection events dispatch actions to the Redux store; each dispatch re-serializes changed sessions for broadcast, so flapping clients multiply full-state emissions (debounce is a possible follow-up, not in v1 scope).
- A voter who disconnects and does not return within ten seconds will see the round advance if all other active voters cast ballots quickly.
- A single active voter can advance rounds alone under the snapshot relative quorum; influence is bounded to one vote per round by duplicate vote keys.
- Presence records persist for the session lifetime and grow with distinct visitor tokens; long-lived public sessions with heavy token churn are unbounded (see Follow-up).

**Neutral**:
- Server authoritative architecture remains unchanged.
- Pure tournament core module `voting-server/src/core.js` remains completely untouched.
- Registered voter accounting (`tokensBySession`) and the duplicate vote guard (`recordedVotes`) keep their existing semantics.

## Follow-up

- [ ] Verify that client UI layout comfortably accommodates the active voter count badge across mobile and desktop breakpoints.
- [ ] Evaluate a mid-session cap or garbage collection policy for presence entries in long-lived public sessions (token churn growth), including whether join rate limiting should extend to `registerVoter`.

## Migration plan

**Strategy**: In place domain enhancement. No database schema changes, no migration scripts, and no data transforms required.
**Phases**:
1. Phase 1: Deploy presence reducer logic, the snapshot ordering rules, and the rewritten round manager quorum on the server. Existing socket clients continue functioning with backward compatible events.
2. Phase 2: Update client components to consume and render the new `presence_update` events.
**Rollback**: Reverting to prior commits restores static headcount checks without data corruption; snapshots are process local, so no persisted state needs cleaning.
**Risks**: Transient disconnects during high latency spikes could trigger early close if a voter exceeds the ten second window; the monotonic clock removes wall clock skew from this risk but not genuine long drops. The known ordering bug surface (missing snapshot fallback includes mid round joiners) is covered by AC-9 tests rather than runtime repair.
