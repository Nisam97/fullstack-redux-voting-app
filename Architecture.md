# VoteSphere Architecture

This document describes the current implementation of VoteSphere, as verified against the source code in this repository. Every statement here traces to the code. If this document and the code disagree, the code is right and this document is stale.

## 1.1 Project Overview

**Project name:** VoteSphere

**Purpose:** VoteSphere is a real time voting platform for groups. It runs two kinds of contests:

* **Tournament (pairwise) mode:** candidates face each other one matchup at a time. Round winners stay in the pool until one undisputed champion remains. Used when a session has 7 or more entries.
* **Single ballot mode:** every candidate appears on one ballot and the highest vote count wins, with built in runoff handling for ties. Used automatically when a session has 2 to 6 entries (the constant `SINGLE_BALLOT_MAX = 6` in `voting-server/src/constants.js` decides this at session creation).

**Major user roles:**

| Role | What they do |
| ---- | ------------ |
| Administrator (session host) | Signs in at `/login` with the seeded admin credential, creates and manages sessions, starts voting, resolves ties, manages participants of secured sessions, publishes results, archives sessions |
| Anonymous voter | Joins a public session with only a display name, no account |
| Signed in voter | Holds a voter account created with an emailed one time password (OTP), needed to join secured sessions |
| Public viewer | Browses `/`, `/join`, `/history` without any account |

**Major workflows:**

1. Admin creates a session, shares the 6 character join code or QR link, voters wait in the lobby, admin starts the session, rounds run on a server timer, results are revealed per round, a champion emerges, the result is stored in MongoDB, and the admin may archive the session.
2. Secured sessions add an access gate: the admin pastes an allowlist of emails, or lets voters request to join and decides each request. Only approved voters can join and vote.
3. Completed results land in a public history archive, except secured results, which stay private to approved participants and the admin until the admin publishes them.

## 1.2 Technology Stack

All versions below are the ones pinned in the two `package.json` files.

| Concern | Technology |
| ------- | ---------- |
| Frontend framework | React 19 (ES modules, JSX) |
| Frontend state | Redux Toolkit 2 (`@reduxjs/toolkit`), React Redux 9 |
| Routing | React Router DOM 7 (`react-router-dom`) |
| Charts | Recharts 3 |
| Real time client | Socket.io client 4 (`socket.io-client`), websocket transport with polling fallback |
| Icons and QR | `lucide-react`, `react-icons`, `qrcode` (lobby and admin share codes) |
| Styling | Plain CSS files per component and page (no CSS framework) |
| Frontend build tool | Vite 8 (`vite`, `@vitejs/plugin-react`) |
| Frontend lint | ESLint 10 with `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh` |
| Backend runtime | Node.js 18 or newer, ECMAScript modules, `@babel/register` for startup |
| Backend HTTP | Node built in `http` module (no Express); routes are hand matched on the URL path |
| Backend state | Redux 5 (`createStore`) over Immutable.js 3 (`Map`, `List`, `Set`) |
| Real time server | Socket.io 4 (`socket.io`) |
| Database | MongoDB, reached through Mongoose 9 |
| Admin auth | `jsonwebtoken` (JWT) and `bcrypt` (password hash) |
| Voter auth | Email OTP codes (6 digits), `jsonwebtoken` for the `vs_voter` HttpOnly cookie |
| Email delivery | Nodemailer 10 over SMTP, with a console fallback when `SMTP_HOST` is empty |
| Allowlist parsing | `csv-parse` (comma or newline separated email pastes) |
| Backend tests | Mocha 10, Chai 4, `chai-immutable`, `mongodb-memory-server` 11, `socket.io-client` (dev) |
| Frontend tests | Node built in test runner (`node --test`) for logic specs; Vitest 5 with jsdom 29, Testing Library React 16, `axe-core` 4 for component specs |

## 1.3 High-Level Architecture

The server is authoritative. The client renders server state and emits intent. Nothing about voting math, quorum, timers, or round advancement happens in the browser.

```text
Browser (React 19 + Redux Toolkit, port 5173)
  |
  |  REST fetch (JSON, credentials for cookies)
  |  Socket.io (websocket with polling fallback, port 8090)
  v
Node HTTP + Socket.io server (voting-server/src/server.js)
  |
  |  ingress guard (action allowlist, JWT checks)
  v
Redux store over Immutable.js (sessions.<sessionId> maps)
  |
  +--> pure engine core.js (protected, 39 lines, pinned SHA-256)
  +--> ballot.js (single ballot math)
  +--> roundManager.js (round lifecycle, tie ladder, eligibility)
  +--> timer.js (round, reveal and tie pending clocks)
  |
  |  store subscriber compares snapshots
  v
MongoDB via Mongoose (sessions, results, users, OTP challenges,
allowlist entries, join requests, vote participation)
```

Data flows one way: a client action reaches the server over the socket, the server validates it, the Redux reducer produces new Immutable state, the store subscriber serializes the change (with tallies guarded), broadcasts it to the room, and fire and forget writes lifecycle changes to MongoDB. Clients never dispatch anything the server did not already authorize.

## 1.4 Frontend Application Structure

### Entry and routing

`voting-client/src/main.jsx` mounts `<Provider store>` around `AppRoutes`. `AppRoutes` (`voting-client/src/routes/AppRoutes.jsx`) holds the whole route table and, on mount, calls `getVoterProfile()` to restore a signed in voter from the `vs_voter` cookie.

| Route | Component | Access |
| ----- | --------- | ------ |
| `/` | `Home` (marketing landing: Hero, Features, HowItWorks, Candidates, Stats, Testimonials) | Public |
| `/join` | `Join` (6 character join code form) | Public |
| `/join/:code` | `Join` (auto resolves the code from the URL) | Public |
| `/history` | `History` (completed tournament archive) | Public |
| `/login` | `Login` (voter OTP mode and admin credential mode) | Public |
| `/register` | `Register` (voter account creation via OTP) | Public |
| `/admin` | `Admin`, wrapped in `AdminGuard` | Admin JWT required; otherwise redirect to `/login` |
| `/dashboard` | Redirect to `/admin` | Same as `/admin` |
| `/sessions` | Redirect to `/join` | Public |
| `/sessions/:id/lobby` | `Lobby` (waiting room, display name join) | Public route; secured sessions are gated server side |
| `/sessions/:id/vote` | `Voting` (the voting arena) | Public route; voting itself is gated server side |
| `/sessions/:id/results` | `Results` (round chart, history, totals, admin controls) | Public route; secured results are gated server side |
| `/elections`, `/elections/:id/vote`, `/elections/:id/results`, `/vote`, `/results` | `LegacyRedirects` components that forward to the session routes | Public |
| `*` | `NotFound` (404 page) | Public |

`AdminGuard` (`voting-client/src/routes/AdminGuard.jsx`) checks `isAdminLoggedIn()` from `services/auth.js`, which decodes the stored JWT and compares its `exp` to the clock. It redirects to `/login` and remembers the intended location in router state.

Two files in the tree are not part of the live app: `src/App.jsx` is an old single page demo (hardcoded elections, local state only) and is never imported by `main.jsx`, and `src/pages/Dashboard.jsx` is not referenced by any route. Do not document them as features.

### Redux state

`voting-client/src/redux/store.js` builds the store with three slices:

```text
state.sessions  -> voteSlice  (normalized, see below)
state.history   -> historySlice (archive list, selected result)
state.voterAuth -> voterAuthSlice ({ isLoggedIn, user, loading, error })
```

The sessions slice (`voting-client/src/redux/voteSlice.js`) is normalized exactly as the project convention requires:

```text
{
  list: [ ...session summaries ],
  activeSessionId: 'sess_...',
  bySessionId: { sess_...: { id, title, status, entries, vote, winner,
                              timerDuration, timer, votingMode, type,
                              whoCanJoin, roundLifecycle, roundId, roundIndex,
                              finalVote, revealTimer, tiePending, tieCount,
                              zeroVoteCount, rounds, voterCount, entryCount,
                              connectedCount, totalVoters,
                              publishResultsPublicly, participantCounts, ... } },
  adminSessionExpired: false
}
```

`normalizeSession()` strips `voterToken`, `token`, `jwt`, `password` and `secret` from anything the server sends, so a token can never reach client state. `adminSessionExpired` is set when the server answers an admin action with `action_error { error: 'UNAUTHORIZED' }`; the socket layer then drops both admin keys, clears the socket handshake, and admin only surfaces render a session gone message instead of empty data.

### Remote action middleware

`createRemoteActionMiddleware` in `voting-client/src/redux/store.js` is the single place actions leave the client:

* `REMOTE_ACTION_TYPES` is the set that may be emitted over the socket: `VOTE`, `NEXT`, `SET_ENTRIES`, `CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `REFRESH_JOIN_CODE`, `RESOLVE_TIE`, `SET_ALLOWLIST`, `APPROVE_PARTICIPANT`, `REJECT_PARTICIPANT`, `REMOVE_PARTICIPANT`, `SET_WHO_CAN_JOIN`, `SET_PUBLISH_RESULTS`.
* `LOCAL_ACTION_TYPES` plus anything starting with `@@` is never emitted (echo prevention). Local slices, socket fed sync actions like `session_state` or `lobby_update`, and internal actions like `SET_TIE_PENDING` stay in the browser.
* `VOTE` actions are enriched with the session voter token (`getVoterToken(sessionId)` or `user:<id>` for a signed in voter). Admin actions are enriched with the stored admin JWT.
* An action may carry `meta.onAck`; the middleware strips it from the payload and passes it as the Socket.io acknowledgement callback so the caller can wait for the server answer (used by the publish results toggle).

### Socket layer

`voting-client/src/services/socket.js` owns a singleton `io(SERVER_URL, ...)` connection. `SERVER_URL` comes from `window.__VOTING_SERVER_URL__`, then `import.meta.env.VITE_SERVER_URL`, then `http://localhost:8090`.

* The stored admin JWT (`localStorage` key `votesphere_admin_jwt`) is attached as handshake `auth.token` at construction, because the server filters secured sessions out of the registry broadcast for any socket it cannot identify as admin.
* `applyAdminTokenToSocket(token)` reattaches a token and forces a reconnect, since Socket.io only transmits `auth` during the handshake. Login and logout both call it.
* `connectSocketToStore()` wires server events into Redux: `sessions` (registry), `session_state` (room state), `lobby_update`, `presence_update`, `timer_state`, `tie_pending`, `session_turnout`, legacy `state`, and `action_error` (with the `UNAUTHORIZED` handling above). On `connect` it re-requests the registry and restores every tracked room subscription with the stored voter token, so a reconnect heals itself.
* Page components subscribe and unsubscribe around mounts: `subscribeSession` / `unsubscribeSession` for the room, `subscribeTurnout` / `unsubscribeTurnout` for the admin turnout room.
* Admin identity lives in `localStorage` (`votesphere_admin_jwt`, `votesphere_admin_user`). Anonymous voter tokens live in `sessionStorage` (falling back to `localStorage`) under `votesphere_voter_token_<sessionId>` and `votesphere_voter_name_<sessionId>`.

### Services

| Service | Responsibility |
| ------- | -------------- |
| `src/services/socket.js` | Socket singleton, subscriptions, token to handshake, socket to Redux wiring |
| `src/services/auth.js` | Admin login/logout and token storage; voter join (`joinVoterSession`), session token helpers, OTP request/verify, voter profile get/update/logout (all REST calls carry `credentials: 'include'` so cookies ride along) |
| `src/services/history.js` | `fetchSessionHistory`, `fetchSessionResult`, `fetchSessionRounds`; attaches the admin Bearer header when present so an admin can read gated secured results |

### Notable components

| Component | Role |
| --------- | ---- |
| `components/CountdownTimer.jsx` | Renders `MM:SS` from the server `expiresAt`. It never decrements a stored value and never dispatches `NEXT`; it only reads the clock. Urgency classes kick in at 10 s (warning) and 5 s (critical) |
| `components/voting/VoteCard.jsx` | One candidate choice card in the arena |
| `components/results/ResultsChart.jsx` | Recharts bar chart of the revealed tally |
| `components/results/ResultCard.jsx` | Frozen round outcome card |
| `components/results/RoundTimeline.jsx` | Per round history list with resolution labels |
| `components/results/TotalsPanel.jsx` | Aggregated per candidate totals across closed rounds (`deriveTotals`) |
| `components/results/resultsUtils.js` | Pure helpers: `getGuardedResultsPresentation` (decides whether the chart and tallies may render), `transformTallyToChartData`, `deriveTotals`, `formatResolution`, `buildTurnoutCsv` (CSV export with spreadsheet formula guard) |

The Results page (`src/pages/Results.jsx`) is the main consumer of the visibility rules. While a round is live (`VOTING_IN_PROGRESS`) the chart, tallies and percentages are removed from the DOM. At `RESULTS_REVEALED` the frozen `finalVote` pair and tally drive the chart. After conclusion the winner banner and full round history render. A gated secured read renders one neutral unavailable state.

## 1.5 Backend Architecture

### Startup (`voting-server/index.js`)

1. `validateVoterJwtSecret()` throws in production when `VOTER_JWT_SECRET` is missing; in development it warns and uses a fallback.
2. `connectMongo(MONGODB_URI)` runs and a failed connection aborts startup (exit code 1).
3. The Redux store is created (`createStore(reducer)`).
4. `recoverSessionsFromDb()` loads persisted sessions back into the store. Open sessions are reset to `pending` because a mid round state cannot be rebuilt.
5. `backfillResultTypes()` fills `Result.type` on legacy result rows; a failure logs the count of still untyped rows (those rows are then gated as secured, never public).
6. Two seed sessions are bootstrapped if absent: `sess_default` ("Danny Boyle Film Tournament", 11 film titles loaded from `voting-server/entries.json`, so tournament mode) and `sess_horror` ("Horror Classics": The Shining, Psycho, Alien, so single ballot mode). Both are dispatched through `CREATE_SESSION` then `START_SESSION`.
7. `persistSeedSessions()` writes them to MongoDB idempotently.
8. `startServer(store, PORT)` opens the HTTP server and Socket.io. SIGINT and SIGTERM trigger a graceful shutdown (close sockets, disconnect Mongo).

### HTTP server and Socket.io (`voting-server/src/server.js`, 4182 lines)

One native `http.createServer` handler matches routes by pathname, and a Socket.io server shares the same port. There is no Express and no separate REST framework.

**Ingress guard.** Every client intent arrives on the socket `action` event. `ALLOWED_ACTION_TYPES` is the complete set accepted: the 13 admin actions in `ADMIN_ACTION_TYPES` (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`, `REFRESH_JOIN_CODE`, `RESOLVE_TIE`, `SET_ALLOWLIST`, `APPROVE_PARTICIPANT`, `REJECT_PARTICIPANT`, `REMOVE_PARTICIPANT`, `SET_WHO_CAN_JOIN`, `SET_PUBLISH_RESULTS`) plus `VOTE`. Anything else, including internal reducer actions like `SET_ROUND_LIFECYCLE`, is rejected with `FORBIDDEN_ACTION` before it can reach the store. Admin actions additionally require a verifiable admin JWT (from the action, the socket handshake, or socket data). `VOTE` requires a valid session voter token, rejects forged `user:` tokens, re checks eligibility for secured sessions at vote time, rejects votes in a closed or tie pending round, blocks duplicates per round, and records `VoteParticipation` for signed in voters.

**Store subscription.** On every state change the subscriber: serializes each changed session with `serializeSessionState` (explicit allowlist of fields; presence, snapshots and any token or secret are removed), applies `applyTallyVisibilityGuard`, emits `session_state` to the room when the serialized JSON actually changed, emits a fresh turnout snapshot to the admin room when a round was appended, broadcasts the sessions registry when it changed (filtered per socket: voter sockets never see secured sessions), calls `persistStateChanges` (fire and forget), and performs memory hygiene (terminal sessions release voter tokens, socket mappings and presence records). Finally it hands both snapshots to `timerManager.onStateChange()` so timers start, stop or transition.

### Reducer (`voting-server/src/reducer.js`)

The root reducer keeps `sessions: Map<sessionId, SessionMap>`. Every session scoped action carries `sessionId`; reducers return new state and never mutate. Handled action types:

`CREATE_SESSION` (validates shape, defaults timer to 30 s, assigns `votingMode` from entry count, `type`, `whoCanJoin`, `publishResultsPublicly`, `joinCode`, `pendingExpiresAt`), `START_SESSION` (pending to open, builds the first pair or ballot), `SET_ENTRIES`, `NEXT` (advances the bracket via `core.next`, detects ties on the pre NEXT pair, resets tie counters on a decisive win, appends the closed round to `rounds`), `VOTE` (rejects when not open, when the round is `ROUND_CLOSED` / `RESULTS_REVEALED` / `TIE_PENDING`, or when the entry is not in the active candidate list; tallies through `vote` or `voteBallot`), `REPLAY_ZERO_VOTE`, `START_RUNOFF`, `SET_TIE_LADDER_COUNT` (server internal), `SET_TIE_PENDING`, `RESOLVE_TIE` (single ballot completes the session; tournament keeps the chosen winner first in the pair and eliminates the tied loser), `TERMINATE_NO_RESULT`, `RESTORE_SESSION_OUTCOME` (startup recovery only, restricted to `pending` and `completed`), `ARCHIVE_SESSION`, `REFRESH_JOIN_CODE`, `SET_WHO_CAN_JOIN` (secured, pending only), `SET_PUBLISH_RESULTS`, `APPEND_ROUND_RESULT` (idempotent by `roundIndex`), `CORRECT_ROUND_RESULT` (server internal), `RECORD_PRESENCE_CONNECT`, `RECORD_PRESENCE_DISCONNECT`, `SNAPSHOT_ROUND_ELIGIBILITY` (idempotent per round), `PURGE_SESSION_PRESENCE`, and `SET_ROUND_LIFECYCLE` (server internal).

### Protected core (`voting-server/src/core.js`)

Exactly 39 lines, immutable and pure, protected by a pinned SHA-256 (`b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`). It exports `INITIAL_STATE`, `setEntries`, `next` (pairwise tournament step: winners re queue, last entry wins) and `vote` (tally increment). Do not edit it and do not wrap new behavior inside it.

### Ballot module (`voting-server/src/ballot.js`)

Pure single ballot functions kept separate from `core.js` so its hash stays intact: `initBallot` (candidates plus a `pair` alias of the first two), `voteBallot`, `getTotalVotes`, `getPluralityWinners` (all candidates tied for first), `deriveRunoff` (a fresh ballot containing only the tied candidates).

### Round manager (`voting-server/src/roundManager.js`, 1897 lines)

Owns the round lifecycle and the tie ladder. Key facts:

* Lifecycle constants: `VOTING`, `ROUND_CLOSED`, `RESULTS_REVEALED`, `TIE_PENDING`.
* Round identity is `${sessionId}:::r${roundIndex}`, monotonic per session.
* `closeRoundOnce()` is idempotent: a round closes at most once, and a stale timer callback can never close a newer round. It freezes the outcome into `finalVote` (`{ pair, tally, closedAt }`), appends a round snapshot (`APPEND_ROUND_RESULT` and `pushRoundToResult`), and starts the reveal timer.
* Early completion (`canCompleteEarly`) closes the round when every eligible voter has voted. Eligibility is snapshotted at round start (`SNAPSHOT_ROUND_ELIGIBILITY`) and a voter disconnected for more than `GRACE_PERIOD_MS` (10000 ms) drops out of the count. Zero eligible voters can never satisfy the condition.
* Tie ladder: a first tie replays the matchup (tournament rematch or single ballot runoff of the tied candidates); a second consecutive tie opens `TIE_PENDING` with a 30 second admin window (`RESOLVE_TIE` with `choice: 'pick'` or `'coin_flip'`); if the window expires the server resolves it with a coin flip by itself. Zero vote rounds replay once, and a second consecutive empty round terminates the session as `no_result`.
* `resolveTieAuthoritative()` is the single resolution path used by both the admin action and the timer expiry.

### Timer manager (`voting-server/src/timer.js`, 810 lines)

Three independent clock families per session, all running only on the server:

| Timer | Default | Bounds | On expiry |
| ----- | ------- | ------ | --------- |
| Round timer | `VOTE_TIMER_DURATION` env or 30 s | 5 to 300 s (enforced at `CREATE_SESSION`) | Closes the round through `closeRoundOnce` |
| Reveal timer | `ROUND_REVEAL_DURATION` env, else 1 s (the example `.env` sets 10) | 1 to 60 s | `expireReveal` advances via `NEXT` or concludes |
| Tie pending timer | 30 s | fixed | Coin flip resolution |

Clients receive `timer_state` with `{ duration, expiresAt, status }` and only draw the countdown.

### Auth modules (`voting-server/src/auth/`)

| File | Responsibility |
| ---- | -------------- |
| `admin.js` | Exactly one in memory admin account, seeded from `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` and bcrypt hashed. `verifyAdminCredentials` also runs a login throttle: after 5 failures in a bucket, retries are refused with exponential backoff (1 s doubling, capped at 60 s). Failures count against the client address and, when the identifier is unknown, against one shared bucket, so rotating identifiers or addresses cannot evade it. `generateAdminToken` / `verifyAdminToken` sign and check the admin JWT (`JWT_SECRET`, `JWT_EXPIRES_IN`, default 24 h) |
| `config.js` | Reads the auth environment with development fallbacks |
| `otp.js` | Challenge lifecycle: 6 digit code from `crypto.randomInt`, per challenge salt, SHA 256 hash stored (never the code), 60 s resend cooldown, maximum 5 verify attempts then `CHALLENGE_LOCKED`, username validation (3 to 20 alphanumeric or underscore) and safe regex escaping, pending name/username carried on the challenge and applied only when the email has no account yet |
| `voter.js` | In memory voter registry. Anonymous tokens are `crypto.randomUUID()`; signed in voters use the synthetic `user:<userId>` token. `validateVoterToken` scopes a token to its session, `canCastVote` builds the duplicate key `${sessionId}:::${roundId}:::${sortedPair}:::${voterToken}`, `revokeSessionVoter` / `revokeSessionVoters` / `releaseSessionVoters` implement removal and terminal cleanup |
| `voterCookie.js` | Signs and verifies the `vs_voter` HttpOnly cookie (payload: `userId`, `email`, `role: 'voter'`; lifetime `VOTER_SESSION_DAYS`, default 7). `Secure` is added on HTTPS or when `COOKIE_SECURE=true`. `validateVoterJwtSecret` enforces the production requirement |

### Email (`voting-server/src/email/transport.js`)

Nodemailer transport built from `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. When `SMTP_HOST` is empty, `sendOtpEmail` logs `[OTP-DEV] Code <code> for <email>, expires in <ttl> min` to the server console and reports success, which is the intended local development path.

### Database layer (`voting-server/src/db/`)

| File | Responsibility |
| ---- | -------------- |
| `connection.js` | `connectMongo`, `disconnectMongo`, `isConnected` |
| `repository.js` | All model access. Two in process promise queues (`enqueueSessionWrite`, `enqueueResultWrite`) serialize writes per session so concurrent lifecycle transitions cannot land out of order. `pushRoundToResult` appends round snapshots idempotently (guarded by `roundIndex`, with content comparison and ordered `$position` insert). `updateSessionStatus` refuses regressive transitions (`open` never overwrites `completed` or `archived`). `backfillResultTypes` and `setPublishResultsPublicly` support the visibility matrix |
| `persistence.js` | The only Redux to MongoDB boundary. `persistStateChanges` diffs two Immutable snapshots and persists new sessions, status transitions, completions (with the full original entry list read back from the Session document), join code refreshes, and `SET_ENTRIES` changes (it deliberately ignores entry changes caused by tournament progression, which must not overwrite the stored roster) |

### Utilities (`voting-server/src/utils/`)

| File | Responsibility |
| ---- | -------------- |
| `joinCode.js` | 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0`, `O`, `1`, `I`, `L`), generated with `crypto.randomInt`. Uniqueness is checked against pending and open sessions only, with 10 attempts before `COLLISION_EXHAUSTION` |
| `rateLimit.js` | Fixed window counters (one `Map` per key space, always charge the attempt, honest `Retry-After`) |
| `timing.js` | Response time floor. `padToMinimumDuration` holds OTP request and join code resolver replies open until `API_MIN_RESPONSE_MS` (default 100 ms, 0 disables) so response timing cannot reveal whether an address or a code exists |

## 1.6 Database Architecture

MongoDB through Mongoose 9. The server refuses to start without a reachable database. Mongoose pluralizes the model names into these collections:

| Collection | Model | Purpose | Important fields and indexes |
| ---------- | ----- | ------- | ---------------------------- |
| `users` | `User` | Voter accounts | `email` (unique, indexed, lowercased), `username` (unique, indexed, 3 to 20 chars, alphanumeric or underscore), `name` (1 to 80 chars), timestamps |
| `sessions` | `Session` | Session metadata and lifecycle | `sessionId` (unique), `title`, `entries` (original roster), `status` (`pending` / `open` / `completed` / `archived`, indexed), `winner`, `timerDuration` (5 to 300), `type` (`public` / `secured`), `votingMode` (`single_ballot` / `tournament`), `joinCode`, `whoCanJoin` (`public` / `allowlist` / `approval`), `candidateInfo[]` (`name`, `description`, each max 80 chars), `publishResultsPublicly`, `pendingExpiresAt`, `completedAt`, `archivedAt`. Partial unique index on `joinCode` for pending and open sessions only. TTL index on `pendingExpiresAt` for pending sessions (7 day expiry set at creation); seed sessions deliberately carry no `pendingExpiresAt` so they are never TTL deleted |
| `results` | `Result` | Completed outcomes and round history | `sessionId` (indexed), `title`, `entries`, `winner` (nullable), `completedAt` (indexed descending), `type` (`public` / `secured`, indexed; mirrors `Session.type` at completion, backfilled on startup for legacy rows), `publishResultsPublicly` (indexed, default false), `rounds[]` embedded snapshots (`roundIndex`, `kind`, `candidates`, `tally`, `totalVotes`, `closedAt`, `resolution`, `advanced`). Compound index on `type`, `publishResultsPublicly`, `completedAt` for the archive query |
| `otpchallenges` | `OtpChallenge` | Login and registration codes | `email` (indexed, lowercased), `codeHash`, `salt`, `expiresAt` (TTL index, so expired rows self delete), `attempts`, `lastSentAt`, `consumedAt`, `pendingName`, `pendingUsername` |
| `sessionallowlistentries` | `SessionAllowlistEntry` | Secured session allowlists | `sessionId`, `email`, `addedAt`; unique compound index on (`sessionId`, `email`) |
| `sessionjoinrequests` | `SessionJoinRequest` | Approval queue for secured sessions | `sessionId`, `userId` (ref `User`), `email`, `displayName`, `status` (`pending` / `approved` / `rejected`), `requestedAt`, `decidedAt`; unique compound index on (`sessionId`, `userId`) |
| `voteparticipations` | `VoteParticipation` | Audit trail of who voted per round (never the choice) | `sessionId`, `roundId`, `userId` (ref `User`), `createdAt`; unique compound index on (`sessionId`, `roundId`, `userId`) |

### Data lifecycle

```text
CREATE_SESSION  -> Session row (status pending, joinCode, pendingExpiresAt +7d)
START_SESSION   -> status open
each round close-> Result.rounds[] grows by one snapshot (idempotent)
NEXT / champion -> status completed, winner set, Result row completed (idempotent,
                   original entries read back from the Session row)
ARCHIVE_SESSION -> status archived, archivedAt set, in memory voter data released
server restart  -> open sessions reset to pending; completed sessions restored with
                   their recorded winner; archived sessions stay out of the store
pending expiry  -> MongoDB TTL deletes a pending session row after 7 days
```

## 1.7 Feature Architecture

Each feature below is traced end to end: user action, frontend, backend, database, real time.

### Session creation

```text
Admin panel "Create Session"
├── Frontend: Admin.jsx create modal (title, optional id, timer, entries,
│   session type, whoCanJoin, initial allowlist)
├── State: voteSlice createSession() -> normalizeSessionType ("open" becomes "public")
├── Socket: action CREATE_SESSION enriched with the admin JWT
├── Backend: server.js ingress (admin JWT, field validation: non blank title,
│   at least 2 distinct string entries, timer 5..300 integer, type public|secured,
│   whoCanJoin enum, secured cannot be public, publish boolean, candidateInfo caps)
├── Reducer: CREATE_SESSION builds the Immutable session Map as pending
├── Database: persistence.js persistNewSession -> Session upsert (write queue)
└── Real time: store subscriber broadcasts sessions registry; admin sees the row
```

The server also assigns the unique join code (`getUniqueJoinCode`, up to 10 attempts against pending and open rows) and `pendingExpiresAt`.

### Join code discovery and QR share

```text
Admin clicks Share / Refresh code
├── Frontend: QR modal builds <origin>/join/<joinCode> (or the lobby URL when no
│   code exists) and renders it with the qrcode library
├── REST: GET /api/join/:code  (30 requests per minute per address, timing floor,
│   normalized to upper case alphanumerics)
├── Backend: Session lookup by joinCode; only pending or open and unexpired rows
│   answer; anything else is the same 404 body
└── Client: Join.jsx navigates to /sessions/<id>/lobby on success
```

### Public voter join (anonymous)

```text
Lobby /join/:code -> display name submit
├── Frontend: Lobby.jsx joinVoterSession() -> POST /api/sessions/:id/join
├── Backend: registerVoter() mints a crypto.randomUUID() session token, stores it
│   in memory (votersByToken, tokensBySession) and answers with the token
├── Cookie: per session HttpOnly cookie voter_token_<sessionId> (anonymous only)
├── Client storage: sessionStorage votesphere_voter_token_<id> + name key
├── Real time: lobby_update and presence_update to the room, registry rebroadcast
└── Database: none for anonymous voters (in memory only, freed at terminal state)
```

### Voter accounts and OTP

```text
/register or /login (voter mode)
├── Frontend: Register.jsx or Login.jsx -> POST /api/auth/otp/request
├── Backend: rate limit (5 per hour per email, 20 per hour per address), 60 s
│   cooldown, username taken check, OtpChallenge row (salted SHA 256, TTL),
│   email sent or console logged; response is always the same generic body
├── Verify: POST /api/auth/otp/verify (6 digits, 5 attempts then locked)
├── Success: vs_voter HttpOnly cookie (JWT signed with VOTER_JWT_SECRET),
│   Redux voterAuth set, User row created on first verification
├── Profile: POST /api/auth/profile updates name/username; GET /api/auth/voter/me
│   restores the session; POST /api/auth/logout clears the cookie
└── Database: users, otpchallenges
```

### Secured sessions (allowlist and approval)

```text
Admin creates type=secured (whoCanJoin allowlist or approval), pastes emails
├── SET_ALLOWLIST: csv-parse per line, lowercased, validated; diff against the
│   collection (adds and removes); a dropped joined email is revoked and its
│   socket disconnected immediately
├── Voter path: must hold a valid vs_voter cookie, then
│   evaluateSecuredEligibility() runs the same gate for REST join and the
│   join_session socket event: allowlist row or approved request required
├── Approval path: a request row is created (status pending) and answered with
│   202 pending_approval; the admin roster updates live over
│   session_participants; APPROVE_PARTICIPANT mints the voter token and emits
│   participant_status approved; REJECT_PARTICIPANT answers rejected
├── Start locks the roster: new joins return 409 SESSION_STARTED, and pending
│   requests are auto rejected with a participant_status message
├── subscribe_session refuses a non eligible socket with NOT_ELIGIBLE
├── VOTE re checks eligibility at vote time (fail closed)
└── Database: sessionallowlistentries, sessionjoinrequests, voteparticipations
```

### Voting (both modes)

```text
Voter clicks a candidate in /sessions/:id/vote
├── Frontend: VoteCard -> dispatch vote(sessionId, entry); the pair lock key
│   (session + pair + roundId) disables the card locally after a choice
├── Socket: action VOTE enriched with the voter token
├── Backend ingress: token valid, session open, entry in the active list, round
│   still VOTING, no duplicate for (session, round, sorted pair, token), secured
│   eligibility rechecked; VoteParticipation row for signed in voters
├── Reducer: VOTE -> vote() (pairwise) or voteBallot() (single ballot)
├── Early completion: canCompleteEarly -> closeRoundOnce when everyone voted
├── Round close: finalVote frozen, round snapshot appended, reveal timer starts,
│   tally guard keeps totals hidden until reveal
├── Reveal expiry: NEXT advances the bracket (tournament) or the ladder resolves
│   (single ballot); a champion completes the session
└── Real time: session_state, timer_state, and the results reveal to every room
    member at once; database rows grow per round and at completion
```

### Tie ladder

```text
Round closes tied
├── tieCount 1: rematch (tournament) or runoff of tied candidates (single ballot)
├── tieCount 2: TIE_PENDING, tie_pending event, 30 s admin window
├── Admin: RESOLVE_TIE with choice pick (winner required) or coin_flip
├   Window expiry: server resolves with a coin flip by itself
├── Tournament resolution keeps the winner first in the pair and eliminates the
│   loser; single ballot resolution completes the session with that winner
└── Result rounds record resolution: majority_win, tie_advance, runoff,
    admin_pick, coin_flip, no_result or zero_vote_replay
```

### Results, visibility and history

```text
Round closes / session completes
├── Client: Results.jsx reads session_state plus REST
│   GET /api/sessions/:id/result and /rounds; guarded presentation hides all
│   tallies while VOTING_IN_PROGRESS and shows the frozen finalVote at reveal
├── Admin: subscribe_turnout -> session_turnout per round (who voted, never the
│   choice); CSV export built in the browser from that payload
├── Secured publish: SET_PUBLISH_RESULTS only after completed or archived; the
│   server writes Session and Result in one step and acknowledges; the toggle
│   moves only on that acknowledgement
├── Visibility: resolveResultVisibility decides every read (public always, secured
│   until published only for approved participants and the admin). A denied or
│   unresolvable read answers the same 404 a missing result gets, on every path
├── Archive: GET /api/sessions/history lists public rows and published secured
│   rows with their type; the History page links to each result
└── Database: results (rounds embedded), voteparticipations (turnout source)
```

### Crash recovery

```text
Server boot
├── recoverSessionsFromDb: pending and completed rows reload; open rows reset to
│   pending (mid round state is not reconstructable)
├── RESTORE_SESSION_OUTCOME restores a recorded winner for pending/completed only
├── backfillResultTypes repairs legacy Result.type rows
└── Rounds history for a recovered session is released by the tally guard because
    each stored round was already broadcast when its round closed
```

## 1.8 Application Flows

### Admin login

```text
Open /login -> switch to Administrator Portal -> username + password
  -> POST /api/admin/login (throttled per address and per unknown identifier)
  -> 200: JWT stored in localStorage, socket reconnects with the token
  -> /admin (AdminGuard passes)
Failure: 401 invalid credentials, or 429 with retryAfterMs once throttled
Logout: navbar Logout clears both keys and reconnects the socket without admin identity
```

### Run a public tournament (happy path)

```text
Admin logs in -> Create Session (title, timer, 7+ entries, Public)
  -> Share modal shows join code and QR (/join/<code>)
Voters open the link -> Lobby -> display name -> joined, live headcount grows
Admin clicks Start -> status open, first pair appears, round timer runs
Voters vote -> early completion or timer expiry closes the round
  -> reveal window shows the frozen tally -> NEXT advances
... repeats until one champion remains -> status completed
Results page shows the winner and full round history -> History archive lists it
Admin may Archive (two step confirm) -> status archived, memory released
```

### Single ballot session (2 to 6 entries)

```text
Admin creates a session with 3 to 6 entries -> votingMode single_ballot automatically
Start -> one ballot with every candidate
Close -> plurality winner completes the session; a tie triggers a runoff ballot
  of only the tied candidates; a second tie opens the 30 s admin window
```

### Secured approval session

```text
Admin creates Secured + Approval -> shares the link
Voter signs in (OTP) -> requests to join in the lobby -> 202 pending_approval
Admin sees the request live -> Approve (voter is registered and notified over the
  socket) or Reject (voter sees the rejection message)
Admin clicks Start -> pending requests are auto rejected; roster is locked
```

### Voter account creation

```text
/register -> email + display name + username -> OTP requested
  -> console (dev) or email carries the 6 digit code
Enter code -> verified -> User created, vs_voter cookie set, redirected home
Navbar shows "Hi, <name>" and a Log out button
```

## 1.9 Security

| Area | Implementation |
| ---- | -------------- |
| Admin authentication | Single seeded admin, bcrypt hashed password, JWT with configurable expiry (`JWT_EXPIRES_IN`, default 24 h) sent as `Authorization: Bearer` on REST and as socket handshake `auth.token` |
| Admin login throttle | 5 failures per address bucket plus one shared bucket for unknown identifiers, exponential backoff 1 s to 60 s, `429` with `retryAfterMs`; only correct credentials clear the shared bucket |
| Voter identity | Anonymous: random session scoped UUID tokens, in memory only. Signed in: `user:<id>` tokens derived server side from the verified `vs_voter` cookie; a client claiming a `user:` token it does not own is refused with `FORBIDDEN_VOTER_TOKEN` |
| Voter session cookie | `vs_voter`, HttpOnly, SameSite=Lax, `Secure` on HTTPS or `COOKIE_SECURE=true`, lifetime `VOTER_SESSION_DAYS` (default 7). `VOTER_JWT_SECRET` is required in production |
| OTP handling | 6 digit code, per challenge salt, SHA 256 stored, TTL expiry (`OTP_TTL_MINUTES`, default 10), 60 s resend cooldown, 5 attempts then `CHALLENGE_LOCKED` (HTTP 423), never returned in any response body |
| OTP rate limits | 5 requests per hour per email address and 20 per hour per client address, both buckets always charged, `429` with `Retry-After`; ceilings configurable through `OTP_RATE_LIMIT_MAX_PER_EMAIL` and `OTP_RATE_LIMIT_MAX_PER_IP` |
| Timing parity | OTP request and join code resolver hold every reply open until `API_MIN_RESPONSE_MS` (default 100 ms) so response time cannot reveal whether an email has an account or a code exists |
| Join code resolver | 30 requests per minute per address, identical 404 body for unknown, expired, completed and gated codes |
| Ingress allowlist | Only the 14 client action types reach the store; internal actions are rejected; every admin action re verifies the JWT server side regardless of what the client claims |
| Duplicate votes | Composite key `${sessionId}:::${roundId}:::${sortedPair}:::${voterToken}`; a signed in voter who already voted is also refused from the persisted `VoteParticipation` row, which survives restarts |
| Secured eligibility | Re checked at join (REST and socket share one helper), at room subscription, and again at every vote; failures close (an unreadable database means ineligible) |
| Participant removal | `REMOVE_PARTICIPANT` revokes the token itself (not just the roster row) and disconnects the socket in the lobby; during an open round the cut off is deferred to the end of that round through `pendingRemovalsBySession` |
| Result visibility matrix | `resolveResultVisibility` is the single decision for lobby metadata, result, rounds and history reads. Public always visible; secured visible to approved participants and the admin until published. An unresolved type is gated as secured (fail closed). Denied callers get the byte identical 404 a missing row gets, and the client renders one neutral not available state |
| Tally hiding | `applyTallyVisibilityGuard` runs on every outbound session payload and the REST rounds read: `rounds[]` releases at round close, `finalVote` and the live `vote.tally` release only at reveal or conclusion, and `TIE_PENDING` withholds everything |
| CORS | Origin allowlist from `CORS_ALLOWED_ORIGINS` (plus `CLIENT_ORIGIN`), credentials only for allowed origins, `*` only for development. Socket.io uses the same origin function |
| Client address trust | `TRUST_PROXY=false` by default so a client controlled `x-forwarded-for` cannot rotate addresses past the throttles; set true only behind a proxy you control |
| Request limits | JSON bodies above 1 MB are refused (socket destroyed) |
| Admin credential hygiene | On any `action_error` with `UNAUTHORIZED` the client deletes both admin keys, reconnects the socket without the token, and sets `adminSessionExpired` so admin surfaces never render a refusal as empty data |
| CSV export safety | Turnout CSV cells starting with `=`, `+`, `-` or `@` are prefixed so a voter display name cannot become a spreadsheet formula |

## 1.10 Testing Architecture

| Suite | Tooling | Command | Verified result |
| ----- | ------- | ------- | --------------- |
| Backend unit and integration | Mocha 10 + Chai 4 (`chai-immutable`), `mongodb-memory-server` for isolated databases, `socket.io-client` against a real server instance; custom runner `voting-server/test/runner.cjs` (Mocha + Babel register) | `cd voting-server && npm test` (watch: `npm run test:watch`) | 799 passing, 0 failing (measured on 2026 10 06) |
| Frontend logic | Node built in test runner over `test/*_spec.js` (reducers, selectors, services, pure utils, server authority rules) | `cd voting-client && npm run test:unit` | 468 passing, 139 suites, 0 failing |
| Frontend components | Vitest 5 + jsdom + Testing Library over `test/**/*.test.jsx`, including axe core accessibility scans of the voting and lobby screens with a self check so an empty scan cannot pass | `cd voting-client && npm run test:component` | 127 passing, 6 files, 0 failing |
| Both frontend suites | `npm test` chains unit then component | `cd voting-client && npm test` | All green |
| Lint | ESLint 10 config `eslint.config.js` | `cd voting-client && npm run lint` | Configured for the client package |
| Production build | Vite 8 | `cd voting-client && npm run build` | Emits `voting-client/dist` |
| Manual testing | This repository's manual guide | See `Manual Test.md` | Not automated |

There is no end to end browser automation (no Playwright or Cypress) in the repository. Real time behavior is covered by socket level integration specs on the server and by rendered component specs on the client, plus the manual multi browser procedures in `Manual Test.md`.

Backend specs are organized per feature: `core_spec`, `reducer_spec`, `timer_spec`, `single_ballot_and_tie_ladder_spec`, `early_completion_spec`, `presence_spec`, `secured_sessions_spec`, `accounts_and_otp_spec`, `hardening_rate_limits_and_timing_spec`, `tally_visibility_guard_spec`, `visibility_and_privacy_spec`, `history_api_spec`, `persistence_spec`, and regression suites named `review_majors_*` and `review_minors_*`. Client specs mirror the same areas (`voting_spec`, `stage_c/d/e_spec`, `results_*`, `secured_session_client_spec`, `a11y_voting_and_lobby.test.jsx`, and others).

## 1.11 How to Run

Every command below runs from the repository root of a fresh clone. Nothing beyond the two existing `package.json` files is needed.

### Install (once)

```bash
# 1. Create the environment file, the backend reads it at the repository root
cp .env.example .env

# 2. Backend dependencies
cd voting-server && npm install

# 3. Frontend dependencies
cd voting-client && npm install
```

MongoDB must be reachable before the backend starts. The default connection string is `mongodb://localhost:27017/votesphere_dev`, changeable with `MONGODB_URI` in `.env`. Leaving `SMTP_HOST` empty means OTP codes print to the backend console, which is the intended local setup.

### Start the project

```bash
# Terminal 1: backend on port 8090 (reads .env from the repository root)
cd voting-server && npm start

# Terminal 2: frontend on port 5173
cd voting-client && npm run dev
```

Then open `http://localhost:5173`. On a fresh database the backend seeds two sessions, `sess_default` ("Danny Boyle Film Tournament") and `sess_horror` ("Horror Classics"), and prints the admin credentials it created.

### Build, lint and automated tests

```bash
cd voting-client && npm run build   # production build, output in voting-client/dist
cd voting-client && npm run lint    # ESLint over the client package
cd voting-server && npm test        # backend Mocha suite
cd voting-client && npm test        # frontend unit suites, then component suites
```

Section 1.10 records the measured results and the test tools.

### One feature suite at a time

Each suite file also runs on its own, so a single feature can be checked without the full run:

```bash
# one backend spec, from voting-server
npx mocha --require @babel/register --require ./test/test_helper.js test/<FILE>.js

# one frontend logic spec, from voting-client
node --test test/<FILE>.js

# one frontend component test, from voting-client
npx vitest run test/<FILE>
```

### Commands for each feature

Backend suite files live in `voting-server/test/`, frontend suite files in `voting-client/test/`, and each runs with the patterns above. The manual column is what a tester does by hand next to those suites.

| Feature | Manual command or action | Backend suites | Frontend suites |
| ------- | ------------------------ | -------------- | --------------- |
| Startup and seed data | `cd voting-server && npm start`, then `curl -s http://localhost:8090/api/sessions` | `test/db_connection_spec.js`, `test/bootstrap_spec.js` | |
| Frontend startup | `cd voting-client && npm run dev`, open `http://localhost:5173` | | `test/stage_c_spec.js` |
| Admin sign in and throttle | `curl -s -X POST http://localhost:8090/api/admin/login -H "Content-Type: application/json" -d '{"username":"admin","password":"adminPassword123!"}'`, open `http://localhost:5173/admin` | `test/auth_spec.js`, `test/ip_throttle_regression_spec.js` | `test/auth_spec.js`, `test/admin_socket_auth_spec.js` |
| Admin logout and expired credential | Press Log out in the nav bar, then reload `/admin` | | `test/auth_spec.js`, `test/admin_session_expired_spec.js` |
| Create a session (modes, validation, id cleaning) | Create form at `http://localhost:5173/admin`, then `curl -s http://localhost:8090/api/sessions` | `test/timer_contract_spec.js`, `test/create_session_spec.js`, `test/sessions_reducer_spec.js` | `test/admin_workflow_spec.js`, `test/stage_d_spec.js`, `test/admin_mode_note_spec.js` |
| Join code and QR share | `curl -s http://localhost:8090/api/join/<CODE>` | `test/join_code_and_discovery_spec.js` | `test/join_code_spec.js`, `test/stage_d_spec.js` |
| Rate limits and response timing | Repeat the join resolver or OTP request inside one minute or one hour | `test/hardening_rate_limits_and_timing_spec.js` | |
| Anonymous voter join | `curl -s -X POST http://localhost:8090/api/sessions/<ID>/join -H "Content-Type: application/json" -d '{"displayName":"Ada"}'`, or the `/join` screen | `test/lobby_headcount_spec.js` | `test/stage_e_spec.js` |
| Lobby and live headcount | Two browser windows on `http://localhost:5173/sessions/<ID>/lobby` | `test/lobby_headcount_spec.js` | `test/presence_client_spec.js`, `test/stage_c_spec.js` |
| Voting and duplicate votes | Vote at `http://localhost:5173/sessions/<ID>/vote` from two windows | `test/core_spec.js`, `test/review_majors_regression_spec.js` | `test/voting_spec.js` |
| Round timer and early completion | Set `VOTE_TIMER_DURATION` in `.env`, restart the backend | `test/timer_spec.js`, `test/timer_integration_spec.js`, `test/early_completion_spec.js` | `test/timer_expiry_spec.js`, `test/early_completion_frontend_spec.js` |
| Reveal window and advancement | Press Next in the admin panel during the reveal | `test/reveal_next_regression_spec.js`, `test/round_lifecycle_spec.js` | `test/round_results_lifecycle_spec.js` |
| Single ballot and tie ladder | Play a session with 2 to 6 entries to a tie, then pick a winner or flip a coin | `test/single_ballot_and_tie_ladder_spec.js`, `test/grace_window_tie_ladder_spec.js` | `test/single_ballot_tie_ladder_client_spec.js` |
| Secured sessions (allowlist and approval) | Create a secured session, join from an allowlisted browser | `test/secured_sessions_spec.js`, `test/secured_sessions_regression_spec.js`, `test/eligibility_integration_spec.js` | `test/secured_session_client_spec.js`, `test/lobby_secured.test.jsx` |
| Participant removal | Press Remove in the admin manage dialog | `test/removal_token_revocation_spec.js`, `test/voter_revocation_unit_spec.js` | |
| Voter accounts and OTP | `curl -s -X POST http://localhost:8090/api/auth/otp/request -H "Content-Type: application/json" -d '{"email":"voter1@example.com"}'`, read the code from the backend console | `test/accounts_and_otp_spec.js`, `test/review_majors_accounts_otp_spec.js` | `test/voter_auth_slice_spec.js`, `test/review_majors_client_spec.js` |
| Results visibility and publish | `curl -s http://localhost:8090/api/sessions/<ID>/result`, publish toggle on the admin results page | `test/visibility_and_privacy_spec.js`, `test/tally_visibility_guard_spec.js`, `test/visibility_matrix_unit_spec.js` | `test/visibility_privacy_client_spec.js`, `test/results_visibility.test.jsx` |
| Round history and archive | `curl -s http://localhost:8090/api/sessions/<ID>/rounds`, open `http://localhost:5173/history` | `test/history_api_spec.js`, `test/round_history_spec.js` | `test/history_spec.js`, `test/round_history_spec.js` |
| Turnout report and CSV | `curl -s -H "Authorization: Bearer <TOKEN>" http://localhost:8090/api/sessions/<ID>/turnout` | `test/visibility_and_privacy_spec.js`, `test/secured_sessions_regression_spec.js` | `test/turnout_csv_spec.js` |
| Real time sync and reconnect | Two browser windows, reload one mid round | `test/reveal_timer_socket_hardening_spec.js`, `test/timer_integration_spec.js` | `test/admin_roster_resubscribe.test.jsx`, `test/presence_client_spec.js` |
| Persistence and crash recovery | Finish a session, restart with `cd voting-server && npm start` | `test/persistence_spec.js`, `test/bootstrap_spec.js`, `test/history_api_spec.js` | |
| Ingress allowlist and forged identity | Socket probes from the browser console (see `Manual Test.md`, MT-065) | `test/ingress_allowlist_spec.js`, `test/accounts_and_otp_spec.js` | |
| Navigation, refresh and accessibility | Browse `/admin` signed out, legacy `/elections` links, reload mid session | | `test/stage_c_spec.js`, `test/a11y_voting_and_lobby.test.jsx` |

Each feature also has a manual case in `Manual Test.md`, and every case there carries its own `Commands` line with the literal command to run.
