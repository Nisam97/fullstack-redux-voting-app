# 0004. Single Ballot Mode and Tie Ladder

**Date**: 2026-09-26
**Status**: Accepted

## Summary

This decision adds single ballot voting for sessions with two to six candidates and introduces an authoritative tie ladder across all sessions. Single ballot mode presents all candidates on a single ballot card rather than running sequential elimination rounds, and plurality of votes decides the winner. When a tie or zero vote round occurs, the server executes a structured ladder: a zero vote round replays once before ending as no result, a first tie triggers an immediate runoff or rematch, and a second consecutive tie opens a thirty second admin resolution window before falling back to an automatic server coin flip.

## Context

The original VoteSphere core engine was designed strictly for pairwise tournament brackets. Candidates face off two at a time, winners advance to the next round, and ties simply push both contestants back into the queue. This pairwise structure works well for large tournaments, but it feels clumsy and slow when a session has only three or four candidates. Users expect to see all contenders on one screen and cast a single vote.

Furthermore, ties and inactive rooms currently lack a deterministic resolution strategy. A tie in the final round can cycle endlessly without closure. If voters walk away and zero votes are cast during a timer period, the round closes without meaningful participation.

To resolve these issues, we need two coordinated features. First, a pure single ballot algorithm capable of running beside the protected thirty nine line core tournament module without modifying its pinned code. Second, an authoritative tie ladder that guarantees deterministic closure for any tied or inactive matchup through automatic rematches, administrator intervention, and random coin flips.

## Requirements

**User stories**:
* As a voter in a small session (two to six candidates), I want to see all candidates on one ballot and cast a single vote so that the winner is decided quickly.
* As an administrator, I want an automatic tie ladder that replays ties and alerts me if a tie persists, allowing me to pick the winner or trigger a coin flip.
* As an administrator, I want abandoned sessions with zero votes to be handled gracefully so that dead sessions do not linger indefinitely.
* As a spectator or voter, I want to see how every round was settled (majority win, runoff, admin pick, coin flip, or no result) in the session history.

**Acceptance criteria**:
* **AC-1**: When a session has two to six candidates and single ballot voting mode is selected, the server initializes voting through a new pure module `ballot.js` where all candidate entries appear in `vote.candidates` (with `vote.pair` preserved as an alias for backward compatibility), while `core.js` remains unmodified with its pinned SHA-256 hash intact.
* **AC-2**: In single ballot mode, voters can cast one vote for any of the active candidates, and the client voting screen displays all active candidates in a responsive grid.
* **AC-3**: When a single ballot round closes with a candidate having strictly more votes than all rivals, that candidate is declared winner with round resolution recorded as `majority_win`; if reveal duration is greater than zero, the session transitions through `RESULTS_REVEALED` so voters view the final tally before the session marks status as completed.
* **AC-4**: When a round closes with zero total votes cast, the server records the round resolution as `zero_vote_replay` and replays the round once with a fresh timer without advancing the candidate roster; if the replayed round also receives zero votes, the session completes with winner set to null and resolution recorded as `no_result`.
* **AC-5**: When a round closes with a tie for first place (tie count zero), single ballot mode launches a runoff round containing only the tied candidates with resolution recorded as `runoff`; pairwise tournament mode launches an immediate rematch of the tied pair with resolution recorded as `tie_advance`.
* **AC-6**: When a runoff or rematch ties again (tie count one), the server sets `roundLifecycle` to `TIE_PENDING`, broadcasts the `tie_pending` event with round details, and starts an authoritative thirty second countdown timer.
* **AC-7**: While in `TIE_PENDING`, the administrator interface renders a tie resolution banner with a thirty second countdown and controls to either Pick Winner or trigger Coin Flip, dispatching the authenticated action `RESOLVE_TIE`.
* **AC-8**: If the administrator dispatches `RESOLVE_TIE` with choice `pick` and a valid tied candidate, that candidate is declared winner with resolution recorded as `admin_pick`; if choice is `coin_flip`, the server picks one of the tied leaders at random with resolution recorded as `coin_flip`.
* **AC-9**: If the thirty second administrator tie timer expires without administrator input, the server automatically executes a secure coin flip among the tied leaders, setting resolution to `coin_flip` and concluding the matchup.
* **AC-10**: Every completed round snapshot appended to the in memory session state and persisted to MongoDB `Result.rounds[]` accurately stores round index, kind (`single_ballot` or `pairwise`), candidate list, frozen tally, and the resolution enum value.

## Options considered

### Option 1: Modify core.js directly to handle multi candidate arrays and tie branching

Extend `core.js` so that `vote` accepts arbitrary candidate lists and `next` branches into rematch or coin flip routines.

**Pros**:
* Keeps all voting math inside a single file.

**Cons**:
* Violates the foundational architectural constraint that `core.js` is a protected thirty nine line pure module with a pinned SHA-256 checksum.
* Mixing multi candidate state with tournament bracket progression complicates bracket invariant reasoning.

### Option 2: Sibling pure module ballot.js with roundManager tie ladder orchestration

Build `ballot.js` as an independent pure module that manages single ballot state transitions, and orchestrate the multi step tie ladder inside `roundManager.js` and `timer.js`.

**Pros**:
* Preserves `core.js` byte for byte without altering its checksum or existing unit test suite.
* Clean separation of concerns: pure functional voting math lives in `ballot.js`, while server authoritative timers, socket broadcasts, and admin authorization remain in `roundManager.js`.
* Reuses existing Redux store architecture, `ROUND_LIFECYCLE` states, and Result persistence.

**Cons**:
* Requires `roundManager.js` and `reducer.js` to branch on `session.votingMode`.

### Option 3: Client driven tie resolution and runoff triggers

Allow the administrator client or voter client to compute ties, trigger runoffs, and prompt administrator decisions directly.

**Pros**:
* Reduces backend state machine complexity.

**Cons**:
* Breaks the core architectural rule that the server is strictly authoritative.
* Vulnerable to race conditions, dropped socket connections, or client manipulation.

## Decision

**Chosen option**: Option 2: Sibling pure module ballot.js with roundManager tie ladder orchestration.

`voting-server/src/ballot.js` will provide pure functions for single ballot initialization, vote accumulation, plurality winner detection, and runoff derivation. The tie ladder will be orchestrated authoritatively by `roundManager.js`, which manages the transition sequence across normal voting, runoff rematches, zero vote replays, administrator tie windows, and coin flips.

## Rationale

This approach honors the inviolable project rule regarding `core.js`. By implementing single ballot mechanics in an isolated pure module, we guarantee that existing tournament bracket tests and mechanics continue running without regression. Orchestrating the tie ladder in `roundManager.js` ensures that timer expiry, full voter turnout, and administrator socket actions all converge through the same idempotent closure path, preventing split brain resolutions and race conditions.

## Feature design

**Data model sketch**:

In memory Redux session state (`sessions.<sessionId>`):

| Field | Type | Description |
|---|---|---|
| `votingMode` | String | `'single_ballot'` or `'tournament'`. Defaults to `'single_ballot'` if candidate count is between two and six. |
| `roundLifecycle` | String | `'VOTING'`, `'ROUND_CLOSED'`, `'RESULTS_REVEALED'`, or `'TIE_PENDING'`. |
| `tieCount` | Number | Consecutive tie counter for current matchup (zero initially, one on first tie, reset on decisive win). |
| `zeroVoteCount` | Number | Consecutive zero vote round counter (zero initially, one on first zero vote round). |
| `tiePending` | Map or null | Active tie window data: `{ roundId, candidates: List, expiresAt: Number, startedAt: Number, duration: 30 }`. |
| `vote` | Map | Single ballot vote shape: `Map({ candidates: List([c1, c2, ...]), pair: List([c1, c2]), tally: Map() })`. |

Result schema snapshot (`Result.rounds[]` in MongoDB):

| Field | Type | Description |
|---|---|---|
| `roundIndex` | Number | Monotonic round counter. |
| `kind` | String | `'pairwise'` or `'single_ballot'`. |
| `candidates` | Array of Strings | Contenders in this round. |
| `tally` | Object | Map of candidate name to integer vote count. |
| `totalVotes` | Number | Sum of all votes cast. |
| `closedAt` | Date | Timestamp of round closure. |
| `resolution` | String | Enum: `'majority_win'`, `'tie_advance'`, `'runoff'`, `'admin_pick'`, `'coin_flip'`, `'no_result'`, `'zero_vote_replay'`. |
| `advanced` | Array or null | Winning candidate(s) advancing, or null if session concludes. |

**State transitions**:

```
[VOTING]
   │
   ├─► (Total votes = 0)
   │      ├─► (zeroVoteCount = 0) ──► Replay round once [VOTING] (resolution: zero_vote_replay)
   │      └─► (zeroVoteCount = 1) ──► Complete session [COMPLETED] (winner: null, resolution: no_result)
   │
   ├─► (Decisive winner) ──► [RESULTS_REVEALED] ──► Advance or Complete [COMPLETED] (resolution: majority_win)
   │
   └─► (Tie for first place)
          ├─► (tieCount = 0) ──► Rematch or Runoff [VOTING] (resolution: runoff / tie_advance)
          └─► (tieCount = 1) ──► [TIE_PENDING] (30 second timer armed)
                                    │
                                    ├─► Admin Pick ──► Complete (resolution: admin_pick)
                                    ├─► Admin Flip ──► Complete (resolution: coin_flip)
                                    └─► 30s Timeout ──► Auto Flip ──► Complete (resolution: coin_flip)
```

**API surface**:

Socket.io Actions and Events:

| Surface | Direction | Payload | Auth | Errors and Guards |
|---|---|---|---|---|
| `CREATE_SESSION` | Client to Server | `{ sessionId, title, entries, votingMode, timerDuration }` | Admin JWT | Rejects duplicate session ID |
| `VOTE` | Client to Server | `{ sessionId, entry }` (token attached by middleware) | Session Voter Token | Rejects invalid entry, duplicate vote, or closed lifecycle |
| `RESOLVE_TIE` | Client to Server | `{ sessionId, roundId, choice: 'pick' \| 'coin_flip', winner?: string }` | Admin JWT | Rejects if lifecycle is not `TIE_PENDING`, or roundId is stale, or winner not among tied candidates |
| `tie_pending` | Server to Session Room | `{ sessionId, roundId, candidates, duration: 30, expiresAt }` | Public to room | Broadcast when `TIE_PENDING` initiates |
| `session_state` | Server to Session Room | Normalized session map with `roundLifecycle` and sanitized `tiePending` | Public to room | Tallies stripped during `VOTING` |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Initialize round | `round.kind` | Derived from `session.votingMode` ('single_ballot' or 'tournament') |
| Initialize round | `round.candidates` | All session entries for initial single ballot round; tied subset for runoff; active pair for tournament |
| Close round | `round.resolution` | Evaluated in `closeRoundOnce` from frozen tally counts, `tieCount`, and `zeroVoteCount` |
| Close round | `zeroVoteCount` | Incremented when `totalVotes === 0`, reset to zero on any vote cast |
| Close round | `tieCount` | Incremented on consecutive tie for first place, reset on decisive win |
| Admin tie window | `tiePending.candidates` | Tied leader list extracted from frozen round tally |
| Coin flip | Selected winner | Cryptographic pseudo random selection from `tiePending.candidates` (`crypto.randomInt`) |
| Auto coin flip | Expiry trigger | `TimerManager.startTiePendingTimer` callback firing at thirty seconds |

**Key invariants**:

* The SHA-256 checksum and line count of `voting-server/src/core.js` remain strictly unaltered.
* Single ballot mode defaults automatically for sessions created with two to six entries unless explicitly overridden.
* A voter can vote at most once per round; double vote blocking applies to composite key `${sessionId}:::${roundId}:::${sortedCandidates}:::${voterToken}`.
* In `TIE_PENDING`, voter voting inputs are disabled, and only the authenticated administrator or the authoritative timer expiration can resolve the tie.
* A zero vote replay can occur at most once consecutively; a second consecutive zero vote round always terminates the session with `no_result`.
* Round closure and tie resolution are strictly idempotent; concurrent timer expiry and administrator action cannot advance or resolve the same round twice.
* In tournament mode a resolved tie advances the chosen winner one bracket step and eliminates the tied loser; the winner and the untouched queue regrow the bracket through `core.next` on the rematch round's closure, so the ladder always ends the session with a decisive champion rather than a resolution picked mid bracket. A first tie requeues the tied pair for an immediate rematch; a second consecutive tie opens the admin window.
* An empty tournament round is a 0:0 tie between the active pair and travels the same ladder as a voted tie; it never silently auto advances through `core.next`. A dead session (no votes ever cast) is bounded to one ladder run: rematch, then a second empty round terminates the session as `no_result`. A decisive voted round resets both ladder counters, so the next matchup starts a fresh ladder.
* Exactly one round identity exists per matchup: the ladder advance initializes it and the timer subscriber only initializes when no open round is held, so persisted `Result.rounds[]` indexes stay contiguous with no holes.
* The live `vote.tally` is stripped from every broadcast while a round is active (the same guard that hides `rounds` and `finalVote`); voters see their own vote confirmed and the frozen tally appears at `RESULTS_REVEALED` or on completion.

**Security model**:

* `RESOLVE_TIE` is registered in `ADMIN_ACTION_TYPES` in `server.js` and strictly requires a verified administrator JWT.
* The voter interface displays the tie countdown and tied candidate names but provides no resolution controls.
* Voter tokens and secrets are never emitted in `tie_pending` or state payloads.

**Configuration required**:

* None. Uses existing MongoDB connection, Redux architecture, and Socket.io channels.

**Critical test scenarios**:

* Single ballot standard victory: Four candidates, voters cast votes, decisive plurality winner completes session, verifies **AC-1**, **AC-2**, **AC-3**.
* Zero vote single replay and termination: First round with zero votes triggers replay with fresh timer; second round with zero votes completes session as `no_result`, verifies **AC-4**.
* First tie runoff and rematch: Single ballot tie leads to runoff round with only tied contenders; tournament mode tie leads to immediate pairwise rematch, verifies **AC-5**.
* Second tie triggers administrator window: Rematch or runoff tying again enters `TIE_PENDING` with thirty second timer, verifies **AC-6**, **AC-7**.
* Administrator pick winner resolution: Administrator dispatches `RESOLVE_TIE` with choice `pick`, candidate wins with resolution `admin_pick`, verifies **AC-8**.
* Administrator coin flip resolution: Administrator dispatches `RESOLVE_TIE` with choice `coin_flip`, server selects winner at random with resolution `coin_flip`, verifies **AC-8**.
* Authoritative timeout coin flip: Administrator does not respond within thirty seconds, server automatically flips coin and advances session, verifies **AC-9**.
* Round history integrity: Every round records snapshot with proper `kind` and `resolution` enum in database, verifies **AC-10**.

## Build plan

1. Create pure `voting-server/src/ballot.js` module with candidate validation, vote recording, plurality tallying, and runoff selection; verify pinned `core.js` checksum remains identical, satisfies **AC-1**, **AC-2**.
2. Update `voting-server/src/reducer.js` and `roundManager.js` to support `votingMode: 'single_ballot'`, single ballot round initialization, and multi candidate vote acceptance, satisfies **AC-1**, **AC-3**.
3. Implement zero vote detection in `roundManager.js`, handling first replay (`zero_vote_replay`) and terminal closure (`no_result`), satisfies **AC-4**.
4. Implement first tie ladder handling in `roundManager.js`, dispatching single ballot runoff and pairwise immediate rematch (`runoff` and `tie_advance`), satisfies **AC-5**.
5. Implement second tie ladder handling in `roundManager.js` and `timer.js`, entering `roundLifecycle: 'TIE_PENDING'`, broadcasting `tie_pending`, and arming the thirty second timer, satisfies **AC-6**.
6. Implement `RESOLVE_TIE` action handler in `server.js` and `reducer.js` with admin JWT authorization, pick winner logic, and manual coin flip logic, satisfies **AC-7**, **AC-8**.
7. Implement automatic server coin flip on thirty second timer expiration in `timer.js` and `roundManager.js`, satisfies **AC-9**.
8. Extend client `voteSlice.js`, selectors, and Socket.io service for `votingMode`, `TIE_PENDING`, and `tie_pending` event handling, satisfies **AC-6**, **AC-7**.
9. Update client `Voting.jsx` to render multi candidate grid in single ballot mode and show tie pending waiting state, satisfies **AC-2**, **AC-6**.
10. Build administrator tie resolution panel in `Admin.jsx` with thirty second countdown, Pick Winner dropdown, and Coin Flip button, satisfies **AC-7**, **AC-8**.
11. Update Result schema and history views to display new resolution labels (`runoff`, `admin_pick`, `coin_flip`, `no_result`, `zero_vote_replay`), satisfies **AC-10**.
12. Write comprehensive unit and integration tests across server and client for all tie ladder branches and single ballot voting, satisfies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-8**, **AC-9**, **AC-10**.

## Consequences

**Positive**:
* Small sessions with two to six candidates can now complete in a single round without tedious pairwise rounds.
* Eliminates infinite tie loops and deadlocks through deterministic multi step tie breaking.
* Unattended sessions with zero votes exit cleanly instead of hanging open.
* Provides full transparency in round history regarding how close matchups were settled.

**Negative / tradeoffs**:
* Adds new lifecycle state `TIE_PENDING` that client views and store selectors must account for.
* Requires timer management to handle an additional thirty second administrator resolution countdown.

**Neutral**:
* Administrator workflows now include an interactive tie resolution panel when a second consecutive tie occurs.

## Follow-up

- [x] Verify test suite runs cleanly under Mocha runner in `voting-server` and Node test runner in `voting-client`.
