# VoteSphere — Full-Stack Real-Time Pairwise Voting Application

[![CI Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![Backend Tests](https://img.shields.io/badge/backend%20tests-338%2F338%20passing-brightgreen.svg)](#running-the-automated-test-suites)
[![Frontend Tests](https://img.shields.io/badge/frontend%20tests-280%2F280%20passing-brightgreen.svg)](#running-the-automated-test-suites)
[![Total Tests](https://img.shields.io/badge/total%20tests-618%20tests-brightgreen.svg)](#running-the-automated-test-suites)
[![ESLint](https://img.shields.io/badge/eslint-0%20errors-brightgreen.svg)](#running-the-automated-test-suites)
[![Vite Build](https://img.shields.io/badge/vite%20build-passing-brightgreen.svg)](#running-the-automated-test-suites)
[![Core Engine](https://img.shields.io/badge/core.js-protected%20pure-blue.svg)](#pure-tournament-engine)

---

## Why VoteSphere?

In traditional voting systems, voters are overwhelmed by long candidate ballots, leading to tactical voting, cognitive fatigue, and split-vote anomalies. **VoteSphere** solves this by evaluating candidates through head-to-head pairwise matchups (`pair[0]` vs `pair[1]`). Round winners return to the candidate pool until an undisputed tournament champion emerges.

All voting logic, tallies, round advancements, duplicate-vote protections, and participant headcounts are strictly governed by an **authoritative backend Redux engine**, keeping all connected clients reactively synchronized in real time via Socket.io rooms, with tournament metadata and completed outcomes durably archived in **MongoDB**.

---

## Feature Implementation Status

| Feature Domain | Implementation Status | Notes |
|---|---|---|
| **Multi-Session Tournament Engine** | `[x]` **IMPLEMENTED** | Isolated session registry, room routing, pure core math |
| **Two-Tier Authentication (Feature 1)** | `[x]` **IMPLEMENTED** | Single admin JWT, frictionless session-scoped voter tokens, duplicate-vote blocking |
| **MongoDB Persistence (Feature 4)** | `[x]` **IMPLEMENTED** | Async store subscriber persistence, models, startup recovery |
| **Results History Archive (Feature 4)** | `[x]` **IMPLEMENTED** | REST history API, `/history` route, historical result presentation |
| **Admin Panel & Waiting Room Lobby (Feature 3)** | `[x]` **IMPLEMENTED** | Dedicated `/admin` controls, pre-round `/lobby`, live headcount, QR code generation |
| **Timer-Based Auto-Advancement (Feature 2)** | `[x]` **IMPLEMENTED** | Server-authoritative timer domain, duration 5–300s, auto `NEXT` dispatch |
| **Real-Time Results Chart (Feature 5)** | `[x]` **IMPLEMENTED** | Recharts bar charts, guarded active round visibility, round invalidation |
| **Admin Session Creation & Management (Feature 6)** | `[x]` **IMPLEMENTED** | Prominent creation modal, focused `[Manage]` dialog, two-step archive confirm, timer persistence |
| **Early Round Completion (Feature 7)** | `[x]` **IMPLEMENTED** | Dual-path convergence (timer expiry or 100% voter turnout), idempotent `closeRoundOnce`, monotonic round identity |
| **Round Results Lifecycle (Feature 8)** | `[x]` **IMPLEMENTED** | Monotonic lifecycle (`VOTING` → `ROUND_CLOSED` → `RESULTS_REVEALED` → `NEXT`), frozen `finalVote`, reveal timer |

---

## Key Architectural Highlights

* **Round Results Lifecycle & Frozen Results (Feature 8)**:
  * **Dedicated Results Reveal Window**: Decouples round closure from immediate tournament progression, inserting intermediate `ROUND_CLOSED` and `RESULTS_REVEALED` phases with an authoritative reveal countdown.
  * **Frozen Results Snapshot (`finalVote`)**: Server freezes an immutable `{ pair, tally, closedAt }` snapshot upon round closure, ensuring the UI displays stable, uncorrupted outcomes during the reveal window.
  * **Authoritative Reveal Timer**: `TimerManager` manages reveal countdowns (`status: 'revealing'`), enforcing timer exclusivity (voting and reveal timers never run concurrently).
  * **Absolute Server Authority**: The frontend countdown is purely visual; zero client `NEXT` dispatching occurs when the countdown reaches `00:00`.
  * **Closed-Round Vote Rejection**: Votes submitted during `ROUND_CLOSED` or `RESULTS_REVEALED` are safely rejected with `action_error: { action: 'VOTE', error: 'ROUND_CLOSED' }`.
* **Early Round Completion & Dual Convergence (Feature 7)**:
  * **Dual Convergence Architecture**: A voting round ends authoritatively either when the server timer expires OR when all currently eligible registered voters submit valid ballots.
  * **Monotonic Round Identity**: Identifies rounds as `${sessionId}:::r${roundIndex}`, incrementing per session on every pair change to isolate brackets even if candidate pairs recur.
  * **Pre-Participation Validation**: Authentication, session status, active pair, and candidate selection are verified *before* participation is recorded.
  * **Dynamic Voter Eligibility**: Derived from `getVoterCount(sessionId)`; requires minimum 2 voters, protects zero-voter sessions from premature advancement, and adapts if voters join mid-round.
  * **Idempotent Closure Gate (`closeRoundOnce`)**: Funnels both final vote and timer expiry through a single idempotent closure function, disarming active timers, preventing duplicate `NEXT` dispatches, and rejecting stale callbacks.
  * **Strict Frontend Server Authority**: Frontend operates purely reactively, never calculating quorum or dispatching `NEXT`.
* **Admin Management Panel & Lifecycle Authority (Feature 3)**:
  * **Dedicated Admin Dashboard**: Authenticated control center at `/admin` protected by `AdminGuard` and JWT validation.
  * **Session Creation**: Full session setup supporting custom or auto-generated session IDs/slugs, title validation, candidate entry sanitization, duplicate pruning, and collision prevention.
  * **Strict Socket.io Authority**: Authoritative tournament lifecycle operations (`CREATE_SESSION`, `START_SESSION`, `NEXT`, `ARCHIVE_SESSION`) run strictly through the authenticated WebSocket action pipeline. There are zero competing REST lifecycle mutation endpoints.
  * **Share & QR Generation**: Generates shareable participant lobby URLs (`/sessions/:id/lobby`) with instant client-side QR code rendering via `qrcode`. QR codes and URLs contain clean, safe routing links without embedding voter tokens, admin JWTs, or secrets.
* **Participant Waiting Room Lobby & Live Headcount (Feature 3)**:
  * **Direct Access & Hydration**: Direct landing at `/sessions/:id/lobby` immediately hydrates session metadata and participant counts via `GET /api/sessions/:id/lobby`.
  * **Frictionless Join**: Participants enter a cosmetic display name and receive a cryptographically secure, session-scoped voter token.
  * **Authoritative Live Headcount**: Active voters are tracked in the backend in-memory voter registry and broadcast in real time across the room via `lobby_update` Socket.io events.
  * **Automated Tournament Entry**: When the administrator starts the session (`pending` → `open`), the Waiting Room automatically transitions joined participants into the pairwise voting arena (`/sessions/:id/vote`).
  * **Completed & Archived Handling**: Concluded or archived lobbies gracefully inform participants and redirect to historical results.
* **Two-Tier Authentication Model (Feature 1)**:
  * **Tier 1 (Admin)**: Exactly one global administrator seeded from environment configuration (`ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`), bcrypt-hashed passwords (`saltRounds = 10`), and signed JSON Web Tokens (JWT) authorizing tournament lifecycle actions.
  * **Tier 2 (Voter)**: Frictionless session joining requiring only a cosmetic display name (no password, email, or OTP). The server issues an unguessable session-scoped token (`crypto.randomUUID()`) delivered via JSON and cookie (`voter_token_${sessionId}`).
* **Server-Authoritative Vote Security & Duplicate-Vote Prevention**:
  * Anonymous voting is strictly rejected (`VOTER_TOKEN_REQUIRED`).
  * The server constructs a unique composite key for each ballot: `${sessionId}:::${sortedPair}:::${voterToken}`.
  * Duplicate votes within the same active pairwise round are blocked authoritatively (`DUPLICATE_VOTE`).
  * When a round advances, the active pair changes, automatically unlocking the voter for the new matchup without re-joining.
  * Duplicate display names are fully supported; each voter receives an independent token and votes independently.
* **MongoDB Persistence & Startup Recovery (Feature 4)**:
  * Non-blocking Redux store subscriber hooks into state transitions to persist session metadata, status changes, and completed tournament outcomes asynchronously.
  * Protection of initial candidate entries lists ensures that pairwise queue reductions during rounds do NOT overwrite the full contestant roster.
  * Safe startup recovery resets interrupted `open` sessions back to `pending` and restores active sessions into Redux.
  * Idempotent atomic upserts prevent duplicate `Result` records.
* **Results History & Historical Viewing (Feature 4)**:
  * Public REST history API (`GET /api/sessions/history` and `GET /api/sessions/:sessionId/result`) delivers completed tournament outcomes with original contestant rosters.
  * Frontend isolates archival records in `state.history` from volatile real-time state in `state.sessions`.
  * Dedicated `/history` archive page features loading, error/retry, empty, and populated tournament card grid views.
  * `/sessions/:id/results` gracefully falls back to MongoDB history if a concluded session is no longer in active server memory.
* **Protected Pure Tournament Engine**:
  * [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) is a 40-line pure, immutable domain module. It remains 100% unmodified (SHA-256: `B479F3F0B90C5BD81E1A813B3C5753179EFEECD08A531AA833000B65188FB310`). Authentication, persistence, lobby headcount, and networking wrap around this engine as external protective layers.
* **Multi-Session Room Isolation**:
  * Hosts concurrent independent tournament sessions (e.g., `sess_default`, `sess_horror`).
  * Socket.io distributes state via lightweight global registry summaries (`'sessions'`) and room-scoped state streams (`'session_state'`, `'lobby_update'`).
  * Actions and voter headcounts in Session A never leak into or mutate Session B.

---

## Application Route Structure

### Modern Frontend Routes (Port 5173)
* `/admin`: Administrative Management Panel (protected by `AdminGuard`; session creation, lifecycle controls, QR share).
* `/sessions`: Public Session Discovery Catalog (active and completed session listing).
* `/sessions/:id/lobby`: Participant Waiting Room Lobby (pre-round join, live headcount, automated start redirect).
* `/sessions/:id/vote`: Pairwise Voting Arena (head-to-head matchup voting).
* `/sessions/:id/results`: Live Tournament Results & Podium (real-time percentage bars and winner presentation).
* `/history`: Completed Tournament Results Archive (paginated historical tournament records).
* `/login`: Administrator Login Portal (JWT authentication).

### Compatibility & Legacy Routes
* `/dashboard` → Redirects to `/admin` (Administrator Dashboard)
* `/elections` → Redirects to `/sessions` (Session Catalog)
* `/vote` → Redirects to active session or fallback `/sessions/sess_default/vote`
* `/results` → Redirects to active session or fallback `/sessions/sess_default/results`

---

## Verified Baseline Quality Metrics

All test suites and code quality checks have been verified on branch `develop1`:

```text
================================================================================
VERIFIED BASELINE SUMMARY: FEATURE 6 (ADMIN SESSION CREATION & MANAGEMENT)
================================================================================
* Backend Unit & Integration Tests: 254 / 254 PASSING (0 failing across 27 spec files)
  - test/auth_spec.js:              28 passing (Admin auth, voter tokens, duplicate vote, socket, REST)
  - test/bootstrap_spec.js:          9 passing (Entries loading, seed sessions)
  - test/core_spec.js:               5 passing (Pure core voting mathematics)
  - test/db_connection_spec.js:      3 passing (MongoDB connect, disconnect, isConnected)
  - test/db_models_spec.js:         10 passing (Mongoose schemas, validation, timerDuration, indexes)
  - test/db_repository_spec.js:     10 passing (CRUD operations, session recovery, monotonic status guard)
  - test/history_api_spec.js:       18 passing (REST history endpoints, pagination, limits, errors)
  - test/immutable_spec.js:          1 passing (Immutable.js tree structures)
  - test/lobby_headcount_spec.js:   21 passing (Headcount tracking, GET /lobby, GET /sessions, room isolation)
  - test/persistence_spec.js:       18 passing (State diffing, recovery, timerDuration persistence, seeds)
  - test/reducer_spec.js:            6 passing (Legacy reducer compatibility)
  - test/server_spec.js:            24 passing (Socket.io multi-session room isolation)
  - test/sessions_reducer_spec.js:  36 passing (Session registry lifecycle, timerDuration contract)
  - test/store_spec.js:              1 passing (Redux store configuration)
  - test/test_helper.js:             1 passing (Test environment baseline)
  - test/timer_spec.js:             15 passing (TimerManager unit tests, boundaries, callbacks)
  - test/timer_integration_spec.js: 17 passing (Socket.io room isolation, hydration, auto-advance)
  - Additional regression suites:   32 passing (Multi-client helper and regression suites)

* Frontend Unit & Integration Tests: 252 / 252 PASSING (0 failing across 18 spec files)
  - test/admin_workflow_spec.js:    17 passing (Feature 6 modal creation, manage lifecycle controls, archive confirm)
  - test/admin_timer_spec.js:       22 passing (Admin timer input validation, payload, live countdown display)
  - test/auth_spec.js:               7 passing (Admin state, voter token scoping, token middleware)
  - test/countdown_timer_spec.js:   13 passing (Countdown rendering, urgency states, accessibility)
  - test/history_spec.js:           11 passing (History service, async thunks, Redux selectors)
  - test/results_chart_spec.js:     15 passing (ResultsChart Recharts rendering, tooltip, accessible table)
  - test/results_hardening_spec.js: 29 passing (Hardened active/closed states, multi-session isolation)
  - test/results_spec.js:            7 passing (Phase 6 results presentation & authoritativeness)
  - test/results_transition_spec.js: 16 passing (Round N -> Round N+1 stale data invalidation, React round keys)
  - test/results_visibility_spec.js: 18 passing (Active round guarding, closed round reveal, presentation models)
  - test/stage_c_spec.js:           14 passing (Redux voterCount, lobby_update, admin guard, unknown session)
  - test/stage_d_spec.js:           17 passing (Admin panel actions, lifecycle controls, QR code generation)
  - test/stage_e_spec.js:           15 passing (Lobby UI, display-name join, live headcount, session isolation)
  - test/timer_expiry_spec.js:      16 passing (Vote guarding on expiry, inline feedback alert)
  - test/timer_redux_spec.js:       15 passing (Redux timer slice, session normalization, selectors)
  - test/timer_utils_spec.js:       18 passing (Time formatting, countdown calculations, expiry logic)
  - test/voting_spec.js:            37 passing (Stages F, G, H multi-session state, socket, routing)
  - Additional regression suites:     5 passing (Multi-client verification and router regression)

* Total Automated Tests:             506 / 506 PASSING (0 failing across full-stack suite)
* Frontend Code Quality:             0 ERRORS, 0 WARNINGS (eslint .)
* Frontend Production Bundle:        SUCCESS (vite build, built cleanly, 0 errors)
* Protected Engine Verification:     core.js UNTOUCHED (SHA-256 b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310)
* Multi-Session & Auth Regression:   100% PASSING (complete cross-session, room, and security isolation)
================================================================================
```

---

## Quick Start

### Prerequisites
* **Node.js**: v18.0.0 or higher (verified on Node.js v24 LTS).
* **Package Manager**: `npm` v9 or higher.
* **MongoDB**: v6.0+ (running locally on port 27017 or remote MongoDB URI).
* **Ports**: `8090` (Backend API & Socket.io), `5173` (Frontend Vite Client).

### 1. Configure Environment Variables
Copy the environment template in the project root:
```bash
cp .env.example .env
```
Safe placeholder configuration:
```bash
PORT=8090
MONGODB_URI=mongodb://localhost:27017/votesphere_dev
JWT_SECRET=change_this_to_a_secure_random_secret_in_production
JWT_EXPIRES_IN=24h
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@votesphere.local
ADMIN_PASSWORD=adminPassword123!
```

### 2. Start the Backend Server (Port 8090)
```bash
cd voting-server
npm install
npm start
```
*Connects to MongoDB, initializes Redux store, recovers non-archived sessions from DB, seeds single admin, bootstraps and persists seed sessions (`sess_default` and `sess_horror`), and binds Socket.io to port 8090.*

### 3. Start the Frontend Client (Port 5173)
```bash
cd voting-client
npm install
npm run dev
```
*Open `http://localhost:5173` in any modern evergreen browser.*

---

## Running the Automated Test Suites

### Backend Tests (298 Tests)
```bash
cd voting-server
npm test
```

### Frontend Tests (262 Tests)
```bash
cd voting-client
npm test
```

### Frontend Linting & Production Build
```bash
cd voting-client
npm run lint
npm run build
```

---

## API & Communication Overview

### HTTP REST Endpoints (Port 8090)
* `POST /api/admin/login`: Authenticates administrator with identifier (username or email) and password; returns signed JWT.
* `POST /api/sessions/:sessionId/join`: Accepts `{ displayName }`, validates session, issues random session-scoped voter token, and sets session cookie.
* `GET /api/auth/me`: Validates `Authorization: Bearer <token>` and returns admin profile.
* `GET /api/sessions`: Public session discovery catalog returning summary array (`id`, `title`, `status`, `entriesCount`, `voterCount`).
* `GET /api/sessions/:sessionId/lobby`: Pre-round metadata hydration endpoint returning public session info and live `voterCount`.
* `GET /api/sessions/history`: Retrieves paginated list of completed tournament outcomes (`limit` param, default: 50, max: 100).
* `GET /api/sessions/:sessionId/result`: Retrieves completed tournament outcome and full candidate roster for a specific session ID.
* `GET /api/sessions/:sessionId/history`: Identical route alias for `/api/sessions/:sessionId/result`.

### Socket.io Real-Time Protocol (Port 8090)
* `admin_login`: Authenticates admin over WebSocket.
* `join_session`: Registers voter over WebSocket.
* `subscribe_session` / `unsubscribe_session`: Room membership management (`session:${sessionId}`).
* `sessions`: Registry summary query and broadcast stream.
* `session_state`: Authoritative room-scoped state updates (pairs, tallies, winner).
* `lobby_update`: Room-scoped event broadcasting live session headcount and metadata changes (`{ sessionId, voterCount, status, title }`).
* `action`: Action ingress handler enforcing JWT validation on admin actions (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`) and duplicate-vote validation on `VOTE`.
* `action_error`: Emitted to client on unauthorized or rejected actions (`UNAUTHORIZED`, `INVALID_TOKEN`, `VOTER_TOKEN_REQUIRED`, `DUPLICATE_VOTE`).

---

## Project Documentation Index

Comprehensive technical documentation is maintained in the [`docs/`](file:///d:/Mine_project/fullstack-redux-voting-app/docs) directory:

| Document | Description |
|---|---|
| [**`ARCHITECTURE.md`**](file:///d:/Mine_project/fullstack-redux-voting-app/docs/ARCHITECTURE.md) | In-depth technical architecture, two-tier auth model, Admin Panel, Waiting Room Lobby, live headcount, room isolation, pure engine preservation, and component roles. |
| [**`API_CONTRACT.md`**](file:///d:/Mine_project/fullstack-redux-voting-app/docs/API_CONTRACT.md) | Complete HTTP REST endpoint and Socket.io real-time event specifications, history endpoints, discovery and lobby APIs, payload schemas, error codes, and configuration parameters. |
| [**`PROJECT_PROGRESS.md`**](file:///d:/Mine_project/fullstack-redux-voting-app/docs/PROJECT_PROGRESS.md) | Chronological milestone tracker recording 100% completion of Core MVP, Multi-Session Architecture, Feature 1 (Auth), Feature 4 (MongoDB + Results History), and Feature 3 (Admin Panel + Waiting Room). |
| [**`CHANGELOG.md`**](file:///d:/Mine_project/fullstack-redux-voting-app/docs/CHANGELOG.md) | Historical changelog detailing architectural decisions, file changes, and test results across all releases. |
| [**`USER_MANUAL.md`**](file:///d:/Mine_project/fullstack-redux-voting-app/docs/USER_MANUAL.md) | Comprehensive operational user manual for administrators and voters. |
| [**`USER_TESTING_MANUAL.md`**](file:///d:/Mine_project/fullstack-redux-voting-app/docs/USER_TESTING_MANUAL.md) | Step-by-step testing manual and quality assurance guide for project evaluators. |

---

## Scope Boundaries & Future Roadmap

To ensure development integrity, completed work is strictly distinguished from deferred scope:

### Completed in Feature 1 (Two-Tier Authentication)
* Single global administrator with bcrypt password hashing and JWT issuance/verification.
* Protected administrative lifecycle actions (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`).
* Frictionless voter session joining with display-name-only input and cryptographically secure session-scoped token issuance.
* Server-authoritative vote security and duplicate vote rejection (`${sessionId}:::${pair}:::${token}`).
* Multi-session isolation with session-scoped voter tokens.
* HTTP REST endpoints (`POST /api/admin/login`, `POST /api/sessions/:sessionId/join`, `GET /api/auth/me`).
* Socket.io ingress authorization guards and machine-readable `action_error` events.
* Client token enrichment middleware and authentication service.

### Completed in Feature 4 (MongoDB Persistence & Results History)
* MongoDB connection lifecycle management with fail-fast startup and graceful shutdown.
* Mongoose data models for sessions (`Session.js`) and historical outcomes (`Result.js`).
* Repository abstraction decoupling queries from domain logic (`repository.js`).
* Non-blocking Redux store subscriber for asynchronous fire-and-forget persistence (`persistence.js`).
* Protection of initial candidate entries lists during tournament progression via `isTournamentProgression` guard.
* Safe server startup recovery resetting interrupted `open` sessions to `pending` and restoring active sessions into Redux.
* Idempotent seed session persistence and result creation.
* REST API endpoints (`GET /api/sessions/history`, `GET /api/sessions/:sessionId/result`, alias `/history`).
* Frontend history state isolation (`state.history` vs `state.sessions`) in Redux RTK.
* Dedicated `/history` archive page with loading, error/retry, empty, and populated card grid states.
* Historical result fallback in `/sessions/:id/results` for concluded sessions not in active memory.
* Total preservation of [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js).

### Completed in Feature 3 (Admin Panel & Waiting Room Lobby)
* Dedicated Admin Management Dashboard (`/admin`) protected by `AdminGuard` and admin JWT.
* Full session creation suite with custom/auto slugs, title validation, candidate entries sanitization, and collision handling.
* Strict Socket.io admin lifecycle authority (`CREATE_SESSION`, `START_SESSION`, `NEXT`, `ARCHIVE_SESSION`) with zero competing REST mutation endpoints.
* Participant Waiting Room Lobby (`/sessions/:id/lobby`) with instant direct URL/QR access, metadata hydration (`GET /api/sessions/:id/lobby`), and display-name joining.
* Authoritative in-memory session voter registry tracking live participant headcount and broadcasting `lobby_update` events.
* Client-side QR code generation using `qrcode` rendering shareable lobby URLs without embedding voter tokens, admin JWTs, or secrets.
* Automated participant progression from Waiting Room (`/sessions/:id/lobby`) to Voting Arena (`/sessions/:id/vote`) upon session activation.
* Full multi-session isolation in normalized Redux store (`voterCount` stored per session in `state.sessions.bySessionId[sessionId]`).
* Modern routing hierarchy and backwards-compatible redirect routes (`/dashboard`, `/elections`, `/vote`, `/results`).

### Completed in Feature 2 (Voting Timer)
* Server-authoritative in-memory `TimerManager` (`timer.js`) driving round timeouts and store progression (`NEXT`).
* End-to-end duration configuration: `5–300` seconds integer-only, default `30` seconds, persisted in session state.
* Room-scoped real-time synchronization: `timer_state` events emitted strictly to room `session:${sessionId}`.
* Voter vote guarding: Blocks voting and disables buttons upon local timer expiry without page reload.
* Admin session card countdown: Active sessions display live countdown; pending/completed/archived sessions display static duration badge.

### Completed in Feature 5 (Real-Time Results Chart)
* Dedicated `ResultsChart` presentation component built with Recharts rendering graphical pairwise vote distributions.
* Pure data transformation utilities (`resultsUtils.js`) providing safe percentage calculation and presentation model derivation.
* Strict Results Visibility guarding: tallies, vote totals, percentages, and `ResultsChart` are strictly hidden from the DOM during active voting rounds (`VOTING_IN_PROGRESS`).
* Real-Time Round Transition Invalidation: automatic invalidation of old candidate data, tallies, and chart components on Round N -> Round N+1 transition via round-scoped React keys (`getSessionPairLockKey`).

### Completed in Feature 6 (Admin Session Creation & Session Management)
* Prominent `+ Create New Session` modal dialog (`AdminSessionModal.jsx` / `AdminSessionModal.css`) with title, custom ID, timer duration (5–300s, default 30s), and dynamic candidate entries roster.
* Dedicated session management modal dialog (`AdminManageModal.jsx` / `AdminManageModal.css`) providing state-tailored lifecycle operations across `pending`, `open`, `completed`, and `archived` states.
* Explicit two-step archival confirmation dialog (`Confirm Session Archival`) guarding `ARCHIVE_SESSION` dispatches against accidental triggers.
* Backend persistence hardening: `Session` Mongoose schema explicitly persists `timerDuration` (default 30, min 5, max 300), which survives backend shutdown and is restored during `recoverSessionsFromDb()`.
* Authoritative server-side validation in `server.js` guarding `CREATE_SESSION` with machine-readable `action_error` feedback.
* Formally accepted monotonic lifecycle status update guard in `repository.js` permanently resolving the pre-existing persistence timing race.
* Complete multi-session room isolation (`session:${sessionId}`) and pure core engine preservation (`core.js` byte-identical).

### Completed in Feature 7 (Early Round Completion)
* Dual convergence round termination: stops when either server timer expires OR 100% of eligible voters submit valid ballots.
* Monotonic round identity (`${sessionId}:::r${roundIndex}`) preventing collisions when identical pairs recur.
* In-memory per-round voter participation tracking (`submissionsByRound`), dynamic eligibility derived from `getVoterCount(sessionId)`, and zero-voter protection.
* Idempotent round closure gate (`closeRoundOnce`) disarming active timers, preventing duplicate `NEXT` dispatches, and rejecting stale callbacks.
* Strict frontend server authority: client operates purely reactively without calculating quorum or auto-advancing rounds.

### Completed in Feature 8 (Round Results Lifecycle)
* Monotonic round results lifecycle: `VOTING` → `ROUND_CLOSED` → `RESULTS_REVEALED` → `NEXT` → `VOTING` (or `COMPLETED` for championship round).
* Frozen results snapshot: captures immutable `{ pair, tally, closedAt }` upon round closure, rendering stable, uncorrupted outcomes during reveal.
* Server-authoritative reveal countdown: `TimerManager` broadcasts `timer_state` (`status: 'revealing'`), enforcing timer exclusivity.
* Strict client server authority: frontend countdown is purely visual; zero client `NEXT` dispatching on countdown zero.
* Closed-round vote rejection: late submissions during `ROUND_CLOSED` or `RESULTS_REVEALED` are rejected at ingress with `action_error: { action: 'VOTE', error: 'ROUND_CLOSED' }`.
* Client reconnect resilience: reconnecting during reveal hydrates directly into the active reveal window with original `expiresAt` without timer reset.
* Championship round handling: final pairwise matchup transitions `VOTING` → `ROUND_CLOSED` → `RESULTS_REVEALED` → `COMPLETED` with decisive champion display.
* Pure engine preservation: [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) verified 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`).

### Explicitly Deferred Future Work
* **Resolved: Early Round Termination on 100% Turnout**: Fully implemented and verified in Feature 7 via dynamic participation accounting and idempotent `closeRoundOnce` execution.
* **Resolved: Round Results Lifecycle**: Fully implemented and verified in Feature 8 via `ROUND_CLOSED` and `RESULTS_REVEALED` lifecycle phases, frozen `finalVote` snapshots, and authoritative reveal timers.
* **Future Security Hardening** (`NOT STARTED`): Migration of admin JWT and voter tokens from client-side storage to `httpOnly`, `SameSite=Strict`, `Secure` cookies.
