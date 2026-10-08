# voting-server

## Overview

The authoritative VoteSphere backend. It owns all tournament state in an Immutable.js Redux store, serves REST for auth, lobby, and history, drives real time state and actions over Socket.io, and persists sessions and completed results to MongoDB. Every decision that matters, tallies, round advancement, timers, and duplicate vote rejection, is made here.

## Key files

| File | Owns |
|---|---|
| `index.js` | Startup order: Mongo connect, store, session recovery, seeding, listen, graceful shutdown |
| `src/server.js` | HTTP and Socket.io wiring, REST routes, action ingress, auth, and broadcast guards |
| `src/core.js` | Protected pure tournament math (`setEntries`, `next`, `vote`) |
| `src/ballot.js` | Pure functional single ballot math (2 to 6 candidates), keeping `core.js` unchanged |
| `src/reducer.js` | Immutable reducer for every session action |
| `src/store.js` | Redux store factory |
| `src/roundManager.js` | Round lifecycle, participation tracking, `closeRoundOnce` gate |
| `src/timer.js` | `TimerManager` for voting and reveal countdowns |
| `src/auth/admin.js` | Single seeded admin, bcrypt hashing, JWT issue and verify |
| `src/auth/voter.js` | Session scoped voter tokens, duplicate vote blocking, headcount, token revocation |
| `src/db/connection.js` | Mongo connect, disconnect, `isConnected` |
| `src/db/persistence.js` | Store subscriber persistence and startup recovery |
| `src/db/repository.js` | Query layer with the monotonic status update guard, the result visibility filter, the publish mirror write, and the `Result.type` backfill |
| `src/db/models/` | Mongoose schemas: `Session`, `Result`, `User`, `OtpChallenge`, `SessionAllowlistEntry`, `SessionJoinRequest`, `VoteParticipation` |
| `src/utils/joinCode.js` | 6 character join code generation, alphabet validation, and collision retries |
| `src/bootstrap.js` | Seed sessions (`sess_default`, `sess_horror`) |

## Conventions

- Every session scoped action carries `sessionId`. The reducer keys all state under `sessions.<sessionId>` and returns state unchanged for an unknown or malformed id rather than throwing.
- `core.js` stays byte identical. New behavior layers around it as auth, persistence, timers, or transport.
- Single ballot mode (2 to 6 candidates) uses pure functions in `ballot.js` (`initBallot`, `voteBallot`, plurality winners, runoff) rather than `core.js`.
- Privileged action types live in `ADMIN_ACTION_TYPES` in `server.js`. Add any new admin only action there or the ingress guard will reject it.
- Timers are server authoritative and exclusive per session. A voting timer and a reveal timer never run at the same time.
- Persistence is fire and forget through a store subscriber. It must never block a request or throw into the request path, and every write guards on `isConnected()`.
- Round closure funnels through the idempotent `closeRoundOnce`. Both timer expiry and full voter turnout call it, and it disarms timers so duplicate `NEXT` dispatches are impossible.
- Voter presence is managed in the Redux store (`RECORD_PRESENCE_CONNECT`, `RECORD_PRESENCE_DISCONNECT`, `PURGE_SESSION_PRESENCE`) per session and voter token. Round start freezes an immutable snapshot of connected tokens (`SNAPSHOT_ROUND_ELIGIBILITY`).
- Early close quorum is snapshot relative (`computeEligibility`) with a 10 second disconnect grace window. Zero active snapshot voters inhibits early close (`ZERO_ACTIVE_VOTERS`), while timer expiry is exempt so abandoned rooms terminate naturally.
- All presence broadcasts are sanitized to public counts (`connectedCount`, `totalVoters`); voter tokens, socket IDs, and presence internals are never broadcast.
- Results and tallies stay hidden during an active round. The shared guard gates three carriers by two rules across socket and REST endpoints: `rounds[]` releases the moment a round closes (`ROUND_CLOSED`), at a reveal, at a conclusion, and for a `pending` recovery holding settled rounds with no live round, while `finalVote` and the live vote tally release only at a reveal or a conclusion, and `TIE_PENDING` withholds all three.
- The `Session` schema persists `timerDuration` as an integer from 5 to 300, default 30, and it survives a restart via `recoverSessionsFromDb()`.
- Secured eligibility lives in one gate (`resolveSessionAccess` plus `evaluateSecuredEligibility`) shared by the REST join endpoint and the `join_session` socket event. Add a join path? Call that gate, never reimplement the allowlist or approval check inline.
- Removing a participant revokes the token itself through `revokeSessionVoter`, not just the headcount entry. Every removal route (lobby remove, deferred remove at `NEXT`, an allowlist paste that drops a joined email, a `whoCanJoin` mode switch) goes through the single `revokeAndDisconnectVoter` helper so they cannot drift apart.
- The `VOTE` handler re-checks eligibility for secured sessions as defence in depth, and fails closed when the lookup cannot complete. It skips that recheck while the voter's token sits in `pendingRemovalsBySession`, so a mid round removal does not cut the voter off during the round that was meant to remain theirs.
- Result visibility has exactly one decision point, `resolveResultVisibility`, shared by the history archive, the result and rounds reads, and the whole lobby read. Add a read path? Call it, never reimplement the matrix. It fails closed: a result with no resolvable type is gated as secured, because reading a missing type as public is what leaked secured tallies.
- A secured lobby read that the caller may not see answers the same 404 as an unknown session id, with the same body, on both the in memory path and the MongoDB fallback path. It is never a 200 with a reduced body: nulling one field while still serving the title, status, `whoCanJoin`, and the counts confirmed the session existed, which is the whole signal the 404 withholds. The lobby's unknown session message must not echo the requested id, or the two bodies can only match for a single id.
- `Result.type` and `Result.publishResultsPublicly` are the read side of the matrix and are mirrored from `Session` on every completion write. `getCompletedResults` filters on the `Result` row alone, so a `Result` with no `type` is deliberately left out of the public archive until `backfillResultTypes()` (run at startup) fills it.
- `setPublishResultsPublicly` writes the `Result` row first, then the `Session` mirror, and rolls the `Result` row back if the mirror write fails. This deployment runs standalone MongoDB with no multi document transactions, so the compensating write is the honest equivalent. Do not "simplify" it into two independent writes.
- `SET_PUBLISH_RESULTS` is accepted on an archived session, because archiving happens after completion and must not strand a result. Status validation belongs in the action handler, not the reducer.
- A failed `backfillResultTypes()` in `index.js` is logged loudly, with `countResultsWithoutType()` reporting how many rows are still untyped. Never swallow it in a silent warn: an untyped row is gated as secured, so a quiet failure is a visibility outage the operator cannot see.
- Client facing failures are machine readable `action_error` events carrying `{ action, error }` (`UNAUTHORIZED`, `INVALID_TOKEN`, `VOTER_TOKEN_REQUIRED`, `DUPLICATE_VOTE`, `ROUND_CLOSED`).
- Tests live in `test/*_spec.js` and are collected by `test/runner.cjs` (Mocha, chai, chai-immutable, mongodb-memory-server), run under `@babel/register`.

## Gotchas

- A running MongoDB is required. `npm start` fails fast if Mongo is unreachable. The test suite spins up mongodb-memory-server, so it needs no local Mongo.
- Startup recovery resets interrupted `open` sessions back to `pending`. Never assume an open session survives a server restart.
- Votes arriving during `ROUND_CLOSED` or `RESULTS_REVEALED` are rejected at ingress with `ROUND_CLOSED`. Do not add a path that bypasses this.
- The original candidate roster is protected from being overwritten by round queue reductions via the `isTournamentProgression` guard in `db/persistence.js`. Changing that guard will corrupt contestant lists.
- Archived sessions are terminal. The reducer refuses `START_SESSION` and `NEXT` once a session is archived.
- A signed in voter token is the string `user:<userId>`, and one identity can hold tokens in several sessions at once. `validateVoterToken` also accepts a token through the `voter.sessionId === normSession` shortcut, so deleting only the `tokensBySession` entry leaves the token valid. Revocation must delete from `votersByToken` as well.
- Tournament mode treats a tied matchup as one bracket match. A first tie requeues the pair (START_REMATCH, immediate rematch); a second consecutive tie opens TIE_PENDING, and RESOLVE_TIE keeps the chosen winner in the vote pair, eliminates the tied loser, and lets `core.next` regrow the bracket from the untouched entries queue. Resolution never completes a tournament session directly; only a decisive `core.next` winner does.
- An empty tournament round is a 0:0 tie and travels the same ladder (never a silent `core.next` auto advance). A dead session is bounded to one ladder run: rematch, then a second empty round terminates as `no_result`. A decisive voted round resets tieCount and zeroVoteCount, so the next matchup starts a fresh ladder. Tie detection in NEXT reads the pre advance pair; round identity for a new matchup is initialized exactly once by the ladder advance (the timer subscriber only fills a gap).

## Agent skills

- [mongodb-connection](.agents/skills/mongodb-connection/): `mongodb/agent-skills`, connection pooling, timeouts, and connection failure diagnosis. Use it when touching `src/db/connection.js`.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
