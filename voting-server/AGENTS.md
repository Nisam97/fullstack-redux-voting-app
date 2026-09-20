# voting-server

## Overview

The authoritative VoteSphere backend. It owns all tournament state in an Immutable.js Redux store, serves REST for auth, lobby, and history, drives real time state and actions over Socket.io, and persists sessions and completed results to MongoDB. Every decision that matters, tallies, round advancement, timers, and duplicate vote rejection, is made here.

## Key files

| File | Owns |
|---|---|
| `index.js` | Startup order: Mongo connect, store, session recovery, seeding, listen, graceful shutdown |
| `src/server.js` | HTTP and Socket.io wiring, REST routes, action ingress and authorization (950 lines, the hub) |
| `src/core.js` | Protected pure tournament math (`setEntries`, `next`, `vote`) |
| `src/reducer.js` | Immutable reducer for every session action |
| `src/store.js` | Redux store factory |
| `src/roundManager.js` | Round lifecycle, participation tracking, `closeRoundOnce` gate |
| `src/timer.js` | `TimerManager` for voting and reveal countdowns |
| `src/auth/admin.js` | Single seeded admin, bcrypt hashing, JWT issue and verify |
| `src/auth/voter.js` | Session scoped voter tokens, duplicate vote blocking, headcount |
| `src/db/connection.js` | Mongo connect, disconnect, `isConnected` |
| `src/db/persistence.js` | Store subscriber persistence and startup recovery |
| `src/db/repository.js` | Query layer with the monotonic status update guard |
| `src/db/models/` | Mongoose `Session` and `Result` schemas |
| `src/bootstrap.js` | Seed sessions (`sess_default`, `sess_horror`) |

## Conventions

- Every session scoped action carries `sessionId`. The reducer keys all state under `sessions.<sessionId>` and returns state unchanged for an unknown or malformed id rather than throwing.
- `core.js` stays byte identical. New behavior layers around it as auth, persistence, timers, or transport.
- Privileged action types live in `ADMIN_ACTION_TYPES` in `server.js`. Add any new admin only action there or the ingress guard will reject it.
- Timers are server authoritative and exclusive per session. A voting timer and a reveal timer never run at the same time.
- Persistence is fire and forget through a store subscriber. It must never block a request or throw into the request path, and every write guards on `isConnected()`.
- Round closure funnels through the idempotent `closeRoundOnce`. Both timer expiry and full voter turnout call it, and it disarms timers so duplicate `NEXT` dispatches are impossible.
- The `Session` schema persists `timerDuration` as an integer from 5 to 300, default 30, and it survives a restart via `recoverSessionsFromDb()`.
- Client facing failures are machine readable `action_error` events carrying `{ action, error }` (`UNAUTHORIZED`, `INVALID_TOKEN`, `VOTER_TOKEN_REQUIRED`, `DUPLICATE_VOTE`, `ROUND_CLOSED`).
- Tests live in `test/*_spec.js` and are collected by `test/runner.cjs` (Mocha, chai, chai-immutable, mongodb-memory-server), run under `@babel/register`.

## Gotchas

- A running MongoDB is required. `npm start` fails fast if Mongo is unreachable. The test suite spins up mongodb-memory-server, so it needs no local Mongo.
- Startup recovery resets interrupted `open` sessions back to `pending`. Never assume an open session survives a server restart.
- Votes arriving during `ROUND_CLOSED` or `RESULTS_REVEALED` are rejected at ingress with `ROUND_CLOSED`. Do not add a path that bypasses this.
- The original candidate roster is protected from being overwritten by round queue reductions via the `isTournamentProgression` guard in `db/persistence.js`. Changing that guard will corrupt contestant lists.
- Archived sessions are terminal. The reducer refuses `START_SESSION` and `NEXT` once a session is archived.

## Agent skills

- [mongodb-connection](.agents/skills/mongodb-connection/): `mongodb/agent-skills`, connection pooling, timeouts, and connection failure diagnosis. Use it when touching `src/db/connection.js`.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
