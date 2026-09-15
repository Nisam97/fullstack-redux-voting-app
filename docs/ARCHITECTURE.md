# System Architecture Documentation

**Project:** Full-Stack Real-Time Pairwise Voting Application  
**Author:** Technical Writer (`agency-technical-writer`)  
**Last Updated:** September 14, 2026  
**Current Branch:** `develop1`  
**Reference:** [PROJECT_ANALYSIS.md](file:///d:/Mine_project/fullstack-redux-voting-app/docs/PROJECT_ANALYSIS.md), [API_CONTRACT.md](file:///d:/Mine_project/fullstack-redux-voting-app/docs/API_CONTRACT.md), [PROJECT_PROGRESS.md](file:///d:/Mine_project/fullstack-redux-voting-app/docs/PROJECT_PROGRESS.md), [CHANGELOG.md](file:///d:/Mine_project/fullstack-redux-voting-app/docs/CHANGELOG.md)

---

## 1. Architectural Overview & System Principles

The application is an authoritative, full-stack real-time pairwise voting platform. In each active tournament round, voters evaluate candidate entries head-to-head (`pair[0]` vs `pair[1]`). Round winners return to the candidate pool until an undisputed tournament champion is crowned.

### Core Architectural Principles

1. **Server Authoritativeness**: All voting rules, candidate tallies, tournament progression, and identity authorizations are strictly governed by the backend server. Clients never compute tallies, issue tokens, or declare winners independently; they operate as reactive presentation layers that dispatch actions and render broadcast state.
2. **Protected Pure Engine**: The tournament math in [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) is an immutable, pure domain module consisting of exactly 40 lines. It remains untouched across all architectural stages. Authentication, identity verification, and networking wrap around this engine as external protective boundaries.
3. **Two-Tier Identity Separation**: The platform enforces an explicit separation between administrative lifecycle control (password-authenticated, JWT-authorized) and voter participation (display-name join, cryptographically random session-scoped tokens).
4. **Multi-Session Isolation**: The system hosts multiple independent voting tournaments concurrently. State mutations, room broadcasts, and voter tokens for one session never leak into or mutate another session.
5. **Reactive Unidirectional Data Flow**: State flows unidirectionally from the server Redux store, across Socket.io rooms, into normalized client Redux slices, and down into React presentation components.

---

## 2. Architectural Evolution: MVP to Admin Session Management

The system architecture has evolved systematically through distinct development eras:

```text
Original Single-Election MVP (Phases 0–6)
              ↓
Multi-Election Registry & Rooms (Stages A–J)
              ↓
Rename Pass: Election → Session Refactor
              ↓
Feature 1: Two-Tier Authentication System
              ↓
Feature 4: MongoDB Persistence & Results History
              ↓
Feature 3: Admin Panel & Waiting Room Lobby
              ↓
Feature 2: Voting Timer
              ↓
Feature 5: Real-Time Results Chart
              ↓
Feature 6: Admin Session Creation & Session Management
              ↓
Feature 7: Early Round Completion
              ↓
Feature 8: Round Results Lifecycle (Current State)
```

### Phase 0–6 Baseline (Historical Single-Election Architecture)
In the initial MVP (Phases 0–6), the backend maintained a single global Immutable.js `Map` in its Redux store:
```text
Map({
  vote: Map({ round, pair, tally }),
  entries: List([...]),
  winner: string
})
```
State updates were broadcast globally to all connected clients across a single `'state'` Socket.io event with no authentication or identity controls.

### Multi-Session Architecture (Post-Rename Pass)
To support multiple concurrent tournaments, the application standardized its terminology to **Sessions**:
* The root server Redux store manages an in-memory collection of sessions keyed by unique IDs (`sessionId`).
* Socket.io distributes state via **lightweight global registry summaries** (`'sessions'`) and **room-isolated session states** (`'session_state'`).
* The client Redux store normalizes sessions by ID (`bySessionId`), synchronizing subscriptions dynamically via React Router.

### Feature 1 Architecture: Two-Tier Authentication & Access Control
Feature 1 incorporates security and identity boundaries around the multi-session architecture:
* **Admin Tier**: Single global administrator seeded from environment configuration with bcrypt-hashed credentials, issuing signed JSON Web Tokens (JWT) to authorize session lifecycle actions (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`).
* **Voter Tier**: Frictionless, password-free session joining requiring only a display name. The server issues an unguessable session-scoped token that authoritatively blocks duplicate votes in pairwise rounds while permitting duplicate display names.
* **Ingress Guard**: Socket.io action handlers and REST HTTP endpoints intercept actions and strictly reject unauthorized operations before they can reach the server Redux store or pure tournament engine.

### Feature 4 Architecture: MongoDB Persistence & Results History
Feature 4 introduces a robust persistence and results history tier wrapping around the real-time engine:
* **Asynchronous Persistence Layer**: Compares Redux store state snapshots via a store subscriber hook and asynchronously persists session metadata, status transitions, and completed tournament outcomes to MongoDB without blocking real-time WebSocket broadcasts.
* **Startup Recovery**: On server restart, interrupted `open` sessions are safely reset to `pending`, and non-archived sessions are reconstructed into the in-memory Redux store.
* **Results History REST API**: Native endpoints (`GET /api/sessions/history` and `GET /api/sessions/:sessionId/result`) serve completed tournament results directly from MongoDB.
* **Isolated Client History Slice**: The client Redux store isolates historical data (`state.history`) from live WebSocket session states (`state.sessions`), powering a dedicated `/history` archive and historical results viewing.

### Feature 3 Architecture: Admin Panel & Waiting Room Lobby
Feature 3 delivers a complete administrative and participant entry experience:
* **Administrative Management (`/admin`)**: Guarded by `AdminGuard`, allowing the authenticated administrator to inspect live voter counts, create new sessions with validated candidate rosters, and authoritatively control tournament progression (`START_SESSION`, `NEXT`, `ARCHIVE_SESSION`).
* **Zero Competing REST Lifecycle APIs**: Conforming to architectural specifications, all lifecycle state mutations remain strictly within the authorized Socket.io action pipeline. REST endpoints remain dedicated to reading metadata, public discovery, participant join, and history.
* **Share Links & Frontend QR Codes**: The Admin Panel dynamically renders shareable URLs (`/sessions/:id/lobby`) and client-side QR codes via `qrcode`. QR codes contain zero credentials or tokens.
* **Participant Waiting Room (`/sessions/:id/lobby`)**: Direct landing interface designed for mobile and desktop access. Performs instant hydration via `GET /api/sessions/:id/lobby` to populate session metadata before socket handshakes.
* **Frictionless Display-Name Join**: Participants join with a display name, receiving a session-scoped token persisted in client storage (`sessionStorage`).
* **Live Participant Headcount**: Real-time participant counts update reactively across room subscribers via `lobby_update` broadcasts without client recalculation.
* **Authoritative Lifecycle Handling**: Seamlessly updates UI for `pending` (waiting screen), `open` (automatic or button-driven transition to `/sessions/:id/vote`), `completed` (winner presentation & `/sessions/:id/results` link), `archived` (read-only notice), and missing sessions (safe 404 card).

### Feature 2 Architecture: Authoritative Voting Timer
Feature 2 integrates server-side round duration control:
* **Server-Authoritative Timer Domain**: `TimerManager` executes round timeouts (`setTimeout`), dispatching `NEXT` on expiry. Clients never dispatch `NEXT` on countdown zero.
* **Room-Scoped Synchronization**: Emits `timer_state` strictly to `session:${sessionId}` rooms with reconnect hydration.
* **Voter Vote Guarding**: Disables voting controls upon timer expiry without page reload.

### Feature 5 Architecture: Real-Time Results Chart & Guarded Visibility
Feature 5 introduces graphical pairwise results visualization and visibility gating:
* **Dedicated ResultsChart Presentation Component**: Recharts-based bar chart with custom tooltips, responsive SVG container, and accessible screen-reader data table.
* **Strict Results Visibility Guarding**: Pairwise tallies, percentages, and charts are completely hidden from the DOM during active voting (`VOTING_IN_PROGRESS`), replaced by locked contender cards and live countdown timer; results are revealed (`RESULTS_REVEALED`) only after round conclusion.
* **Real-Time Round Transition Invalidation**: Seamlessly invalidates old tallies and unmounts previous charts on Round N -> Round N+1 transition via round-scoped React keys (`getSessionPairLockKey`).
* **Pure Presentation Layer**: Zero socket subscriptions, zero Redux mutations, and zero backend modifications. Pure core engine `core.js` remains 100% untouched.

### Feature 6 Architecture: Admin Session Creation & Session Management
Feature 6 elevates administrative operations to production-grade usability and architectural resilience:
* **Prominent Creation UX**: Dedicated `+ Create New Session` modal dialog (`AdminSessionModal.jsx` / `AdminSessionModal.css`) replacing clunky inline forms.
* **Session Configuration & Pre-Validation**: Supports session title, optional custom ID, configurable round timer duration (5–300 seconds, default 30s), and dynamic candidate entry roster with minimum 2 distinct entries validation before dispatch.
* **Focused Management Dialog**: Dedicated `[Manage]` dialog (`AdminManageModal.jsx` / `AdminManageModal.css`) delivering focused, state-tailored lifecycle controls across `pending`, `open`, `completed`, and `archived` states.
* **Protected Archival**: Two-step modal confirmation dialog (`Confirm Session Archival`) guarding `ARCHIVE_SESSION` dispatches against accidental triggers.
* **Backend Persistence & Schema Hardening**: Mongoose `Session` schema persists `timerDuration`, which cleanly survives server shutdown and is restored during startup recovery.
* **Authoritative Server Validation**: Authoritative validation in `server.js` protects the `CREATE_SESSION` ingress pipeline, providing structured `action_error` feedback.
* **Accepted Monotonic Status Guard**: Atomic query filters in `repository.js` permanently prevent asynchronous fire-and-forget MongoDB writes from regressing terminal states.
* **Pure Engine Preservation**: The pure domain core [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remains completely untouched.


```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       CLIENT BROWSER                                             │
│                                                                                                  │
│  ┌──────────────────────────────┐                ┌────────────────────────────────────────────┐  │
│  │     React Router Routes      │                │           Client Redux Store               │  │
│  │  /admin (AdminGuard)         │                │  state.sessions: (Live Socket.io state)    │  │
│  │  /sessions (Discovery)       │                │  - list, activeSessionId, bySessionId      │  │
│  │  /sessions/:id/lobby (Wait)  │───────────────▶│    (title, status, voterCount, etc.)       │  │
│  │  /sessions/:id/vote (Arena)  │                │  state.history:  (Archived REST state)     │  │
│  │  /sessions/:id/results       │                │  - items, selectedResult, loading, error   │  │
│  │  /history                    │                └─────────────────────┬──────────────────────┘  │
│  │  /login                      │                                      │                         │
│  └──────────────┬───────────────┘                                      │ Middleware intercepts   │
│                 │                                                      │ Enriches with tokens    │
│                 │ Route-driven                                         ▼                         │
│                 ▼ subscription                   ┌────────────────────────────────────────────┐  │
│  ┌──────────────────────────────┐                │         Remote Action Middleware           │  │
│  │    Socket Client Service     │◀───────────────│  - Attaches voterToken to VOTE             │  │
│  │ (voting-client/.../socket.js)│                │  - Attaches admin JWT to admin actions     │  │
│  │                              │                │    (CREATE, START, NEXT, ARCHIVE)          │  │
│  └──────────────┬───────────────┘                │  - Echo-loop prevention                    │  │
│                 │                                └────────────────────────────────────────────┘  │
│                 │ HTTP REST Client                                     ▲                         │
│                 │ - auth.js / history.js                               │ Reads stored tokens     │
│                 │                                ┌─────────────────────┴──────────────────────┐  │
│                 │                                │       Auth Service (auth.js)               │  │
│                 │                                │  - getAdminToken() (localStorage)          │  │
│                 │                                │  - getVoterToken(sessionId) (sessionStorage│  │
│                 │                                └────────────────────────────────────────────┘  │
└─────────────────┼──────────────────────────────────────────────────────┬─────────────────────────┘
                  │                                                      │
                  │ WebSocket Events (Port 8090)                         │ 'action' { sessionId, ... }
                  │ - 'subscribe_session' { sessionId }                  │ Enriched with tokens
                  │ - 'unsubscribe_session' { sessionId }                │
                  │                                                      │
                  │ HTTP API Endpoints (Port 8090)                       │
                  │ - POST /api/admin/login                              │
                  │ - POST /api/sessions/:sessionId/join                 │
                  │ - GET  /api/auth/me                                  │
                  │ - GET  /api/sessions (Discovery)                     │
                  │ - GET  /api/sessions/:id/lobby (Lobby Hydration)     │
                  │ - GET  /api/sessions/history                         │
                  │ - GET  /api/sessions/:sessionId/result               │
══════════════════╪══════════════════════════════════════════════════════╪═════════════════════════════
                  │                                                      │
┌─────────────────┼──────────────────────────────────────────────────────┼─────────────────────────┐
│                 ▼                                                      ▼                         │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                  Authoritative Gateway (voting-server/src/server.js)                       │  │
│  │                                                                                            │  │
│  │  HTTP Endpoints:                                                                           │  │
│  │   - POST /api/admin/login ───────────▶ verifyAdminCredentials() ──▶ generateAdminToken()   │  │
│  │   - POST /api/sessions/:id/join ────▶ registerVoter() ────────────▶ voterToken + Cookie    │  │
│  │   - GET  /api/auth/me ───────────────▶ verifyAdminToken()                                  │  │
│  │   - GET  /api/sessions ──────────────▶ getSessionsSummary(store.getState())                │  │
│  │   - GET  /api/sessions/:id/lobby ────▶ session metadata + voterCount (instant hydration)   │  │
│  │   - GET  /api/sessions/history ──────▶ repository.getCompletedResults()                    │  │
│  │   - GET  /api/sessions/:id/result ───▶ repository.getResultBySessionId()                   │  │
│  │                                                                                            │  │
│  │  Socket Ingress Verification:                                                              │  │
│  │   - Admin Actions (NEXT, CREATE, ...) ──▶ verifyAdminToken() (Rejects unauthorized)        │  │
│  │   - Vote Actions (VOTE) ───────────────▶ canCastVote() & recordVote() (Rejects duplicates) │  │
│  │                                                                                            │  │
│  │  Broadcasting:                                                                             │  │
│  │   - Global 'sessions' registry summaries                                                   │  │
│  │   - Room 'session_state' scoped to room "session:${sessionId}"                             │  │
│  │   - Room 'lobby_update' (live headcount & status) scoped to "session:${sessionId}"         │  │
│  │  └──────────────────────────────────────────────┬──────────────────────────────────────────┘  │
│                                                 │ Validated, authorized actions only             │
│                                                 ▼                                                │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                         Authoritative Server Redux Store                                   │  │
│  │                           (voting-server/src/store.js)                                     │  │
│  │                                                                                            │  │
│  │   Root State: Map({ sessions: Map({ [id]: sessionState }) })                               │  │
│  │   Runtime: In-memory store dispatch, headcount tracking, and broadcasting                   │  │
│  └──────────────────────────┬───────────────────┬─────────────────────────────────────────────┘  │
│                             │                   │ Dispatches                                     │
│      Store Subscriber Hook  │                   ▼                                                │
│      (Fire-and-forget async)│  ┌──────────────────────────────────────────────────────────────┐  │
│                             │  │            Session Registry Reducer (src/reducer.js)         │  │
│                             │  │ Routes: CREATE_SESSION, START_SESSION, ARCHIVE_SESSION, etc. │  │
│                             │  └────────────────┬─────────────────────────────────────────────┘  │
│                             │                   │ Delegates pure pairwise operations             │
│                             │                   ▼                                                │
│                             │  ┌──────────────────────────────────────────────────────────────┐  │
│                             │  │   Protected Pure Tournament Engine (voting-server/src/core.js)│  │
│                             │  │    setEntries(session, entries) | next(session) | vote(...)  │  │
│                             │  └──────────────────────────────────────────────────────────────┘  │
│                             ▼                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                  Persistence Orchestration (voting-server/src/db/persistence.js)           │  │
│  │  - Lifecycle transition detection (prev vs current snapshot)                               │  │
│  │  - Tournament progression guard (prevents overwriting original entries)                    │  │
│  │  - Idempotent completed result persistence                                                 │  │
│  └──────────────────────────┬─────────────────────────────────────────────────────────────────┘  │
│                             │ Repository calls                                                   │
│                             ▼                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                  Repository Layer (voting-server/src/db/repository.js)                     │  │
│  │  - saveSession, updateSessionStatus, getActiveSessions, resetOpenSessionsToPending         │  │
│  │  - saveResult, getCompletedResults, getResultBySessionId                                   │  │
│  └──────────────────────────┬─────────────────────────────────────────────────────────────────┘  │
│                             │ Mongoose ODM                                                       │
│                             ▼                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                  MongoDB Models (Session.js, Result.js) & Database (Port 27017)            │  │
│  │  └─────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                  │
│                                        BACKEND ENGINE                                            │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---�────────────────────────┐  │
│                             │  │            Session Registry Reducer (src/reducer.js)         │  │
│                             │  │ Routes: CREATE_SESSION, START_SESSION, ARCHIVE_SESSION, etc. │  │
│                             │  └────────────────┬─────────────────────────────────────────────┘  │
│                             │                   │ Delegates pure pairwise operations             │
│                             │                   ▼                                                │
│                             │  ┌──────────────────────────────────────────────────────────────┐  │
│                             │  │   Protected Pure Tournament Engine (voting-server/src/core.js)│  │
│                             │  │    setEntries(session, entries) | next(session) | vote(...)  │  │
│                             │  └──────────────────────────────────────────────────────────────┘  │
│                             ▼                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                  Persistence Orchestration (voting-server/src/db/persistence.js)           │  │
│  │  - Lifecycle transition detection (prev vs current snapshot)                               │  │
│  │  - Tournament progression guard (prevents overwriting original entries)                    │  │
│  │  - Idempotent completed result persistence                                                 │  │
│  └──────────────────────────┬─────────────────────────────────────────────────────────────────┘  │
│                             │ Repository calls                                                   │
│                             ▼                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                  Repository Layer (voting-server/src/db/repository.js)                     │  │
│  │  - saveSession, updateSessionStatus, getActiveSessions, resetOpenSessionsToPending         │  │
│  │  - saveResult, getCompletedResults, getResultBySessionId                                   │  │
│  └──────────────────────────┬─────────────────────────────────────────────────────────────────┘  │
│                             │ Mongoose ODM                                                       │
│                             ▼                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                  MongoDB Models (Session.js, Result.js) & Database (Port 27017)            │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                  │
│                                        BACKEND ENGINE                                            │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Two-Tier Authentication Architecture

The application adopts a two-tier identity and access control model designed to reconcile rigorous administrative authority with frictionless voter participation.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   TWO-TIER IDENTITY MODEL                                        │
│                                                                                                  │
│   ┌──────────────────────────────────────────────┐  ┌─────────────────────────────────────────┐  │
│   │        TIER 1: SINGLE GLOBAL ADMIN           │  │      TIER 2: SESSION-SCOPED VOTER       │  │
│   ├──────────────────────────────────────────────┤  ├─────────────────────────────────────────┤  │
│   │ • Exactly ONE admin account                  │  │ • Frictionless join via Display Name    │  │
│   │ • Seeded from environment (no registration)  │  │ • No password, email, or OTP required   │  │
│   │ • Credentials: username/email + bcrypt hash  │  │ • Duplicate display names allowed       │  │
│   │ • Authoritative signed JWT (role: 'admin')   │  │ • Server issues random session token    │  │
│   │ • Controls tournament lifecycle actions      │  │ • Token strictly scoped to sessionId    │  │
│   │   (CREATE_SESSION, START, NEXT, ARCHIVE)     │  │ • Token blocks duplicate votes in round │  │
│   └──────────────────────────────────────────────┘  └─────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Tier 1: Single Global Administrator

1. **Environment-Based Seeding**:
   - The application supports exactly one global administrator account. There is no public registration, promotion, or multi-admin hierarchy.
   - Admin credentials are initialized at startup via `seedAdmin()` in [`voting-server/src/auth/admin.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/admin.js), configured by environment variables:
     - `ADMIN_USERNAME`
     - `ADMIN_EMAIL`
     - `ADMIN_PASSWORD`
2. **Bcrypt Password Hashing**:
   - Plaintext passwords are never stored in memory or persisted.
   - The password is salted and hashed using `bcrypt` (10 salt rounds).
   - In-memory admin store retains: `{ username, email, passwordHash, seededAt }`.
3. **Authentication & JWT Issuance**:
   - The admin authenticates by submitting username or email and password to `POST /api/admin/login` or via the Socket.io `admin_login` event.
   - Verification uses `bcrypt.compareSync()`.
   - On valid credentials, the server signs a JSON Web Token (JWT) with the configured `JWT_SECRET` and expiration (`JWT_EXPIRES_IN`, default `'24h'`).
   - The JWT payload contains only non-sensitive identity attributes:
     ```json
     {
       "role": "admin",
       "username": "admin",
       "email": "admin@votesphere.local",
       "iat": 1726135200,
       "exp": 1726221600
     }
     ```
     Passwords, password hashes, and secrets are strictly excluded from the token payload.
4. **JWT Verification & Protected Lifecycle Actions**:
   - Server middleware and Socket ingress handlers verify admin tokens using `verifyAdminToken(token)`.
   - Rejects missing, expired (`TokenExpiredError`), tampered, or non-admin tokens.
   - Verifies that `decoded.username` matches the currently active seeded admin.
   - Authorizes administrative lifecycle actions:
     - `CREATE_SESSION`
     - `START_SESSION`
     - `ARCHIVE_SESSION`
     - `SET_ENTRIES`
     - `NEXT`
   - Unauthorized attempts receive an `action_error` event (`UNAUTHORIZED`, `INVALID_TOKEN`, or `FORBIDDEN`).

### 3.2 Tier 2: Session-Scoped Voter Identity

1. **Frictionless Display-Name Join**:
   - Voters participate in tournaments without creating accounts, remembering passwords, submitting emails, or undergoing OTP verification.
   - A voter joins a specific session by submitting only a `displayName` via `POST /api/sessions/:sessionId/join` or Socket.io `join_session`.
   - The session must exist in the Redux store and must not be archived.
2. **Cryptographically Secure, Unguessable Token Issuance**:
   - Upon join, the server generates a cryptographically secure random token (`crypto.randomUUID()` or 24-byte hex string) via [`voting-server/src/auth/voter.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js).
   - The server stores the voter record in its in-memory repository:
     ```javascript
     {
       sessionId: "sess_default",
       displayName: "Alice",
       sessionToken: "c4b3a1e2-9f8d-4e5a-8b1c-7d6e5f4a3b2c",
       joinedAt: "2026-09-12T06:00:00.000Z"
     }
     ```
   - The token is returned in the response payload and set as a session cookie (`voter_token_${sessionId}`).
3. **Session Scoping Guarantees**:
   - A voter token is strictly bound to the `sessionId` for which it was issued.
   - Attempting to use a token from `sess_default` to vote in `sess_horror` is rejected with `SESSION_MISMATCH`.
4. **Duplicate Display Names Allowed**:
   - Display names are cosmetic labels only and are explicitly allowed to be duplicated.
   - Two distinct voters named "Alex" joining the same session receive independent random session tokens and vote completely independently without interference.
5. **Anonymous Voting Blocked**:
   - Fully anonymous voting (submitting a ballot with no identity token) is strictly rejected by the server with `VOTER_TOKEN_REQUIRED`.

### 3.3 Server-Authoritative Vote Security & Duplicate-Vote Protection

Vote security and duplicate-vote prevention are strictly server-authoritative:

1. **Vote Ingress Validation (`canCastVote`)**:
   When an incoming `VOTE` action is received:
   - The server extracts the `voterToken` from the action, action metadata, socket state, socket handshake auth, or request cookies.
   - Validates that the token exists and matches `action.sessionId` (`validateVoterToken`).
   - Validates that the target session is currently in `'open'` status.
   - Validates that the session has an active pairwise round (`vote.pair` with at least 2 entries).
2. **Unique Composite Duplicate Key**:
   - The server constructs an authoritative duplicate key:
     $$\text{VoteKey} = \text{sessionId} + \text{":::"} + \text{sorted(pair).join(":::")} + \text{":::"} + \text{sessionToken}$$
   - Example: `sess_default:::Shallow Grave:::Trainspotting:::c4b3a1e2-9f8d-4e5a-8b1c-7d6e5f4a3b2c`.
3. **Double-Vote Enforcement**:
   - The server checks its in-memory `recordedVotes` Set for the generated `VoteKey`.
   - If the key exists, the vote is authoritatively rejected with `action_error`: `{ error: "DUPLICATE_VOTE", message: "Voter has already cast a vote in this pairwise round." }`. The Redux store state remains completely unchanged.
   - If the key does not exist, the vote is accepted:
     - `recordVote(voteKey)` adds the key to `recordedVotes`.
     - The action is forwarded to the authoritative Redux store: `actualStore.dispatch(action)`.
     - The store increments the candidate's tally via pure `core.vote(voteState, entry)` and broadcasts updated `session_state` to room subscribers.
4. **Automatic Round Reset**:
   - Because the candidate pair is sorted and embedded into the `VoteKey`, advancing to the next round via `NEXT` (which generates a new candidate pair) automatically allows the voter to cast their ballot in the new pairwise matchup.
   - Voters do not need to re-join or acquire a new token between rounds of the same session.

### 3.4 Socket.io Authentication & Authorization Pipeline

Socket.io communication on port `8090` implements an authoritative ingress pipeline:

* **Connection Handshake**: Sockets connect and can provide tokens via `socket.handshake.auth` or cookies (`socket.handshake.headers.cookie`).
* **Socket Events for Auth**:
  * `admin_login`: Emits credentials with an acknowledgment callback. Stores `socket.data.adminToken` and sets `socket.data.isAdmin = true`.
  * `join_session`: Emits `{ sessionId, displayName }` with an acknowledgment callback. Stores token in `socket.data.voterTokens[sessionId]`.
* **Action Ingress Filter (`socket.on('action', ...)`):**
  * Evaluates `action.type`.
  * If the action is in `ADMIN_ACTION_TYPES` (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`), the server searches for the admin token across:
    1. `action.token`
    2. `action.meta.token`
    3. `socket.data.adminToken`
    4. `socket.handshake.auth.token`
    5. `socket.handshake.headers.authorization`
    If invalid or absent, the server emits an `action_error` event and aborts dispatch.
  * If the action is `VOTE`, the server verifies `sessionId`, resolves `voterToken`, verifies session scoping, checks session status, and verifies that the voter has not already voted on this pairwise round. If rejected, it emits `action_error` and aborts dispatch.

### 3.5 HTTP Authentication Endpoints

In addition to WebSocket channels, native HTTP REST endpoints provide standardized auth interfaces:
* `POST /api/admin/login`: Verifies admin credentials and returns a signed JWT.
* `POST /api/sessions/:sessionId/join`: Accepts display name, validates session existence, issues a random voter token, and sets a session cookie.
* `GET /api/auth/me`: Verifies the incoming `Bearer <token>` in the `Authorization` header and returns public admin profile details.

### 3.6 Relationship Between Authentication and Multi-Session Architecture

* **Session-Scoped Voter Bounding**: Voters exist only within the context of a specific session. A voter joining `sess_default` receives a token scoped exclusively to `sess_default`. Attempting to vote in `sess_horror` with that token is rejected (`SESSION_MISMATCH`).
* **Global Administrative Authority**: The administrator's authority is global across the entire server. A valid admin JWT authorizes management actions on any session in the registry (`sess_default`, `sess_horror`, or dynamically created sessions).
* **Isolated Duplicate Vote Tracking**: The `recordedVotes` set tracks duplicate votes using composite keys prefixed with `sessionId`. Casting a vote on a pair in Session A has zero impact on the ability to vote in Session B.

### 3.7 Protection of the Pure Tournament Engine

> [!IMPORTANT]
> **[`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remains completely pure and unmodified.**

Authentication, token validation, duplicate vote tracking, and access control are strictly peripheral concerns. They reside in:
- HTTP API route handlers.
- Socket.io action ingress middleware.
- Dedicated authentication domain modules ([`voting-server/src/auth/admin.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/admin.js), [`auth/voter.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js), [`auth/config.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/config.js)).

The core tournament engine remains 40 lines of pure, functional Immutable.js logic, completely agnostic of HTTP, WebSockets, passwords, JWTs, or voter tokens.

---

## 4. Backend State Architecture

### Root Redux State: The Session Registry

The backend Redux store maintains an Immutable.js `Map` containing the `sessions` registry:

```javascript
Map({
  sessions: Map({
    sess_default: Map({
      id: 'sess_default',
      title: 'Danny Boyle Film Tournament',
      status: 'open',
      createdAt: '2026-09-12T06:00:00.000Z',
      entries: List(['Sunshine', 'Slumdog Millionaire', '127 Hours', ...]),
      vote: Map({
        pair: List(['Shallow Grave', 'Trainspotting']),
        tally: Map({
          'Shallow Grave': 3,
          'Trainspotting': 5
        })
      }),
      winner: null
    }),
    sess_horror: Map({
      id: 'sess_horror',
      title: 'Horror Classics',
      status: 'open',
      createdAt: '2026-09-12T06:00:00.000Z',
      entries: List(['Alien']),
      vote: Map({
        pair: List(['The Shining', 'Psycho']),
        tally: Map({})
      }),
      winner: null
    })
  })
})
```

### Session Entity Structure

Each session in the registry is an independent Immutable.js `Map` with these core fields:
* **`id`** (`string`): Unique identifier (e.g., `'sess_default'`, `'sess_horror'`).
* **`title`** (`string`): Human-readable name for display in registry listings and page headers.
* **`status`** (`string`): Current lifecycle state (`'pending'`, `'open'`, `'completed'`, `'archived'`).
* **`createdAt`** (`string`): ISO 8601 creation timestamp.
* **`entries`** (`List<string>`): Candidate entries waiting in the elimination queue.
* **`vote`** (`Map` or `null`): Active pairwise round state containing `pair: List<string>` and `tally: Map<string, number>`.
* **`winner`** (`string` or `null`): Declared tournament champion once pairwise elimination finishes.

### 4.3 MongoDB Persistence Layer Architecture

Feature 4 bridges the in-memory Redux runtime with persistent storage in MongoDB using Mongoose. The database layer wraps around the existing Redux engine via a non-blocking store subscriber hook, maintaining server authoritativeness while guaranteeing durability across restarts.

```text
Store Dispatch ──▶ Redux Reducer ──▶ State Change
                                          │
                                          ├─▶ Socket.io Broadcast (Instant, Synchronous)
                                          │
                                          └─▶ Store Subscriber (server.js)
                                                    │
                                                    ▼
                                          persistStateChanges() (persistence.js)
                                          [Fire-and-forget async comparison]
                                                    │
                                                    ▼
                                          Repository Layer (repository.js)
                                                    │
                                                    ▼
                                          Mongoose Models (Session / Result)
                                                    │
                                                    ▼
                                          MongoDB Database (Port 27017)
```

#### 1. Connection Lifecycle (`src/db/connection.js`)
* **Connection Manager**: Exposes `connectMongo(uri)`, `disconnectMongo()`, and `isConnected()`.
* **Configuration**: Reads connection string from environment variable `MONGODB_URI` with fallback to `mongodb://localhost:27017/votesphere_dev`.
* **Fail-Fast Startup**: If MongoDB is unavailable during startup, `index.js` logs a fatal error and terminates (`process.exit(1)`), preventing headless or unpersisted execution.
* **Graceful Shutdown**: Intercepts `SIGINT` and `SIGTERM` signals to close Socket.io listeners and disconnect cleanly from MongoDB (`disconnectMongo()`).

#### 2. Mongoose Data Models
The persistence layer manages two distinct collections:

* **`Session` Model (`src/db/models/Session.js`)**:
  Stores session metadata and current lifecycle status:
  ```javascript
  {
    sessionId:   { type: String, required: true, unique: true, index: true },
    title:       { type: String, default: '' },
    entries:     { type: [String], required: true },
    status:      { type: String, required: true, enum: ['pending', 'open', 'completed', 'archived'], default: 'pending', index: true },
    winner:      { type: String, default: null },
    createdAt:   { type: Date, default: Date.now },
    updatedAt:   { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    archivedAt:  { type: Date, default: null }
  }
  ```
  Timestamps (`createdAt`, `updatedAt`) are automatically managed via Mongoose schema options.

* **`Result` Model (`src/db/models/Result.js`)**:
  Stores immutable historical tournament outcomes:
  ```javascript
  {
    sessionId:   { type: String, required: true, index: true },
    title:       { type: String, default: '' },
    entries:     { type: [String], required: true },
    winner:      { type: String, required: true },
    completedAt: { type: Date, default: Date.now }
  }
  ```
  Indexes:
  - `{ completedAt: -1 }`: Optimizes descending chronological queries on `GET /api/sessions/history`.
  - `{ sessionId: 1, completedAt: -1 }`: Optimizes session-specific result lookups on `GET /api/sessions/:sessionId/result`.

#### 3. Repository Layer (`src/db/repository.js`)
Decouples database query mechanics from business logic:
* `saveSession(sessionData)`: Upserts session metadata by `sessionId`.
* `updateSessionStatus(sessionId, status, winner)`: Updates session lifecycle state, populating `completedAt` or `archivedAt`.
* `getActiveSessions()`: Retrieves all non-archived sessions sorted by `createdAt` ascending.
* `getAllSessions()`: Retrieves all sessions including archived ones.
* `getSessionBySessionId(sessionId)`: Retrieves a specific session document.
* `resetOpenSessionsToPending()`: Mass updates `{ status: 'open' }` sessions to `{ status: 'pending' }` during server startup recovery.
* `saveResult(resultData)`: Idempotently upserts a completed result using atomic `$setOnInsert` and `findOneAndUpdate` to prevent duplicate race conditions.
* `getCompletedResults(limit)`: Retrieves completed results sorted by `completedAt` descending, enforcing a default of 50 and maximum cap of 100 via `.lean()`.
* `getResultBySessionId(sessionId)`: Retrieves the completed result for a specific session ID via `.lean()`.

#### 4. Persistence Orchestration (`src/db/persistence.js`)
Acts as the sole boundary between the Redux store and MongoDB:
* **Lifecycle Change Detection (`persistStateChanges`)**: Compares `prevState` and `currentState` Immutable.js trees after store dispatch:
  - Detects new sessions: Calls `persistNewSession()`.
  - Detects status transitions (`pending` → `open`, `open` → `completed`, etc.): Calls `persistStatusChange()`.
  - Detects completion: When `currStatus === 'completed'` and a winner is crowned, triggers `persistCompletedResult()`.
* **Tournament Progression Guard**:
  In pairwise elimination, `core.next()` consumes entries from the queue into the active pair or crowns the winner, shrinking `entries`. The persistence layer implements an explicit `isTournamentProgression` guard:
  ```javascript
  const isTournamentProgression = (prevStatus !== currStatus)
    || (prevVote !== currVote)
    || !!currSession.get('winner')
    || currStatus === 'completed';
  ```
  Entries updates in MongoDB are only triggered on explicit administrative `SET_ENTRIES` actions, preventing active tournament rounds from wiping the original candidate list.
* **Preserving Original Candidate Lists in Results**:
  When a tournament finishes, `core.next()` crowns a winner and strips `entries` from the Redux state. To ensure the permanent `Result` record retains the complete roster of contestants, `persistCompletedResult()` queries the MongoDB `Session` document to retrieve the original full `entries` array before writing the result.
* **Idempotency & Race-Free Upserts**:
  `saveResult` checks whether a result already exists and executes an atomic `findOneAndUpdate({ sessionId }, { $setOnInsert: resultData }, { upsert: true })`. Duplicate completion events or duplicate calls never create duplicate result documents.

#### 5. Runtime Resilience & Durability Window
* **Asynchronous Fire-and-Forget**: Persistence operations run asynchronously in background promises without awaiting completion before responding to WebSocket clients. Socket.io broadcasts are never delayed by database latency.
* **Fault Tolerance**: If MongoDB is temporarily unresponsive, errors are caught and logged (`console.error('[Persistence] ...')`). Database failures do NOT crash the Node.js server process or corrupt the live in-memory Redux store.
* **Known Durability Window**:
  Because state changes are broadcast over Socket.io before the asynchronous MongoDB write completes, an immediate ungraceful process crash (e.g. `SIGKILL` or power loss within milliseconds of a vote or transition) could theoretically result in a state change being broadcast to clients before reaching persistent storage. Under normal graceful shutdowns (`SIGINT`, `SIGTERM`), all pending operations finish cleanly.

#### 6. Server Restart & Recovery Semantics
When [`voting-server/index.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/index.js) boots:
1. **MongoDB Connection**: Connects to MongoDB via `connectMongo()`.
2. **Redux Store Creation**: Instantiates a fresh in-memory Redux store (`makeStore()`).
3. **Open Session Reset**: Executes `repository.resetOpenSessionsToPending()`. Any sessions that were `'open'` when the server stopped cannot resume in-flight pairwise rounds because mid-round ephemeral vote tallies are discarded. They are safely set back to `'pending'` so administrators can cleanly restart them.
4. **Active Session Recovery**: Calls `recoverSessionsFromDb(store)`. All non-archived sessions (`getActiveSessions()`) are loaded from MongoDB and registered into the Redux store via `CREATE_SESSION`.
5. **Archived Session Isolation**: Archived sessions (`status === 'archived'`) are intentionally NOT restored into the active Redux registry. They remain safely preserved in MongoDB and queryable via the History API.
6. **Seed Session Idempotency**: `bootstrapDefaultSession` and `bootstrapHorrorSession` register default seeds only if they are not already present in the recovered store. `persistSeedSessions()` checks MongoDB first and skips writing if the seed already exists in the database.
7. **Ephemeral Security State**:
   - Voter tokens (`socket.data.voterTokens` and in-memory registry) are strictly ephemeral and reset on restart. Voters refresh and acquire a new token upon rejoining.
   - Duplicate vote keys in `recordedVotes` are ephemeral and reset on restart.

---

## 5. Session Lifecycle & Action Handling

### Lifecycle State Machine

A session progresses through four distinct lifecycle states:

```
                  ┌──────────────────────┐
                  │       pending        │
                  │ (Created, unstarted) │
                  └──────────┬───────────┘
                             │ START_SESSION (Admin JWT required)
                             ▼
                  ┌──────────────────────┐
                  │         open         │◀────────┐
                  │ (Active voting live) │         │ NEXT (Admin JWT required)
                  └──────────┬───────────┴─────────┘
                             │
            ┌────────────────┴────────────────┐
            │ NEXT (1 entry remains)          │ ARCHIVE_SESSION (Admin JWT required)
            ▼                                 ▼
┌──────────────────────┐          ┌──────────────────────┐
│      completed       │          │       archived       │
│  (Winner declared)   │          │ (Frozen from voting) │
└──────────┬───────────┘          └──────────────────────┘
           │ ARCHIVE_SESSION (Admin JWT required)
           ▼
┌──────────────────────┐
│       archived       │
└──────────────────────┘
```

1. **`pending`**: Session registered via `CREATE_SESSION`. Pairwise rounds have not commenced (`vote: null`).
2. **`open`**: Pairwise voting is active. Authorized votes can be cast via `VOTE` and rounds advanced via `NEXT`.
3. **`completed`**: Tournament concluded. `winner` declared and `vote` is null. Votes are rejected.
4. **`archived`**: Session frozen. Prevents further votes or round progression while preserving state.

---

## 6. Socket.io Multi-Session Real-Time Architecture

Communication between clients and backend occurs over Socket.io connections (Port 8090).

```text
Server Socket Gateway (Port 8090)
 ├── Global Broadcast: 'sessions' ──▶ All connected sockets (lightweight summaries)
 └── Room Broadcasts:  'session_state'
      ├── Room "session:sess_default" ──▶ Subscribed sockets only
      └── Room "session:sess_horror"  ──▶ Subscribed sockets only
```

### Event Contracts

| Event Name | Direction | Scope | Auth Required | Purpose |
|---|---|---|---|---|
| **`sessions`** | Server → Client | Global Broadcast / Unicast | None | Distributes lightweight registry summaries (id, title, status, createdAt, winner). Excludes internal tallies. |
| **`sessions`** | Client → Server | Unicast Request | None | Requests an on-demand registry summary from the server. |
| **`session_state`** | Server → Client | Room-Scoped (`session:${id}`) | None | Delivers complete, authoritative voting state (pair, tallies, entries, winner) to room subscribers. |
| **`subscribe_session`** | Client → Server | Room Join | None | Requests membership in room `session:${sessionId}`. Triggers immediate unicast of `session_state`. |
| **`unsubscribe_session`**| Client → Server | Room Leave | None | Leaves room `session:${sessionId}`. Stops future broadcasts for that session. |
| **`admin_login`** | Client → Server | Unicast Request | None (Credentials) | Authenticates admin over WebSocket and associates token with socket context. |
| **`join_session`** | Client → Server | Unicast Request | None (Display Name) | Joins voter to session over WebSocket, issues token, and binds to socket context. |
| **`action`** | Client → Server | Ingress | **Yes (Role-dependent)** | Dispatches Redux actions (`VOTE`, `NEXT`, etc.) carrying identity tokens into backend. |
| **`action_error`** | Server → Client | Unicast Error | None | Emits authorization and validation errors (`UNAUTHORIZED`, `DUPLICATE_VOTE`, etc.) back to caller. |

---

## 7. Backend Bootstrap & Seed Sessions

When [`voting-server/index.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/index.js) boots, [`voting-server/src/bootstrap.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/bootstrap.js) seeds two live production sessions:

1. **`sess_default`**:
   * **Title**: "Danny Boyle Film Tournament"
   * **Entries**: Loaded dynamically from [`voting-server/entries.json`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/entries.json) (11 films).
   * **Status**: Automatically started into `'open'`, with initial pair `['Shallow Grave', 'Trainspotting']`.
2. **`sess_horror`**:
   * **Title**: "Horror Classics"
   * **Entries**: Classic entries `['The Shining', 'Psycho', 'Alien']`.
   * **Status**: Automatically started into `'open'`, with initial pair `['The Shining', 'Psycho']`.

Both seed sessions run concurrently in memory on port 8090 upon startup. Simultaneously, `seedAdmin()` initializes the global admin account from environment configuration, and `persistSeedSessions()` idempotently persists both seed sessions to MongoDB so their metadata survives future restarts.

---

## 8. Frontend Multi-Session, History & Authentication Architecture

### 8.1 Normalized Redux State Isolation

The client Redux store strictly isolates live real-time state from historical archival state:

```text
Client Redux Store
 ├── state.sessions (voteSlice.js)  ──▶ Live volatile Socket.io session registry and active rooms
 └── state.history  (historySlice.js) ──▶ Concluded tournament results fetched from REST API
```

#### Live Session Slice (`voteSlice.js`)
Maintains normalized live session state synchronized via Socket.io rooms:

```javascript
{
  list: [
    { id: 'sess_default', title: 'Danny Boyle Film Tournament', status: 'open' },
    { id: 'sess_horror', title: 'Horror Classics', status: 'open' }
  ],
  activeSessionId: 'sess_default',
  bySessionId: {
    sess_default: {
      id: 'sess_default',
      title: 'Danny Boyle Film Tournament',
      status: 'open',
      entries: ['Sunshine', ...],
      vote: { pair: ['Shallow Grave', 'Trainspotting'], tally: { 'Shallow Grave': 1 } },
      winner: null,
      hasLoaded: true
    },
    sess_horror: { ... }
  }
}
```

#### History Archive Slice (`historySlice.js`)
Manages public concluded tournament outcomes retrieved from the REST history endpoints:

```javascript
{
  items: [
    {
      sessionId: 'sess_default',
      title: 'Danny Boyle Film Tournament',
      winner: 'Trainspotting',
      entries: ['Shallow Grave', 'Trainspotting', 'Sunshine', ...],
      completedAt: '2026-09-12T14:00:00.000Z'
    }
  ],
  loading: false,
  error: null,
  selectedResult: null,
  resultLoading: false,
  resultError: null
}
```

**Rationale for Isolation**:
* Live sessions require high-frequency, bidirectional WebSocket communication with frequent room switching and optimistic voting locks.
* Results history represents an immutable, append-only record of completed tournaments that is read via standard HTTP GET queries with pagination and sorting.
* Decoupling the two domains prevents WebSocket noise from invalidating cached historical records and ensures historical browsing does not trigger accidental room subscriptions.

### 8.2 Client History Service (`services/history.js`) & UI Integration
* **API Service (`services/history.js`)**:
  - `fetchSessionHistory(limit = 50)`: Calls `GET /api/sessions/history?limit=${limit}`.
  - `fetchSessionResult(sessionId)`: Calls `GET /api/sessions/:sessionId/result`.
* **History Page (`pages/History.jsx` & `pages/History.css`)**:
  Route: `/history`.
  Implements all 4 primary UI lifecycle states:
  1. **Loading**: Renders accessible status spinner while fetching records.
  2. **Error**: Displays descriptive error banner with an interactive **"Try Again"** retry button.
  3. **Empty**: Displays polite notification when no tournaments have finished yet, with a link to active sessions.
  4. **Populated**: Displays responsive grid of completed tournament cards showing tournament title, champion winner badge with trophy icon, completed timestamp, candidate headcount, and direct link to view full details.
* **Historical Result Presentation (`pages/Results.jsx`)**:
  When a user navigates to `/sessions/:id/results`, the component first checks live Socket.io state. If the session has concluded or is absent from active memory, it asynchronously calls `fetchSessionResult(routeSessionId)` to retrieve the persisted champion outcome and full candidate list directly from MongoDB.

### 8.3 Remote Action Middleware with Token Enrichment (`store.js`)

[`voting-client/src/redux/store.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/store.js) implements `createRemoteActionMiddleware`:
1. **Echo-Loop Prevention**: Filters out `LOCAL_ACTION_TYPES` (`SET_STATE`, `SET_SESSIONS`, etc.) so incoming server updates are never reflected back.
2. **Voter Token Enrichment**: When a `VOTE` action is dispatched, the middleware retrieves the stored voter token for `action.sessionId` via `getVoterToken(sessionId)` and enriches the outgoing action payload:
   ```javascript
   enrichedAction = {
     ...action,
     voterToken,
     meta: { ...(action.meta || {}), voterToken }
   };
   ```
3. **Admin Token Enrichment**: When an admin lifecycle action (`NEXT`, `SET_ENTRIES`, `CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`) is dispatched, the middleware retrieves the stored admin JWT via `getAdminToken()` and attaches it:
   ```javascript
   enrichedAction = {
     ...action,
     token: adminToken,
     meta: { ...(action.meta || {}), token: adminToken }
   };
   ```

### 8.4 Client Authentication Service (`services/auth.js`)

Provides complete token lifecycle management on the frontend:
* `loginAdmin({ username, email, password })`: Authenticates against `POST /api/admin/login` and stores token in `localStorage`.
* `getAdminToken()` / `isAdminLoggedIn()`: Checks token existence and validates payload expiry.
* `logoutAdmin()`: Removes admin credentials and detaches token from Socket auth.
* `joinVoterSession({ sessionId, displayName })`: Calls `POST /api/sessions/:sessionId/join`, receives random token, and persists it in `sessionStorage` or `localStorage`.
* `getVoterToken(sessionId)`: Retrieves the session-scoped token.
* `hasJoinedSession(sessionId)`: Evaluates whether voter has joined the given session.

---

## 9. Feature 3 Architecture: Admin Panel & Waiting Room Lobby

Feature 3 completes the administrative and participant lifecycle workflows for the platform. It builds seamlessly upon the multi-session Redux registry, two-tier authentication tier, and MongoDB persistence foundation without modifying the protected tournament core engine.

### 9.1 End-to-End Architectural Workflow

The complete Feature 3 lifecycle spans from administrative tournament setup to permanent archival:

```text
Admin Panel (/admin)
        ↓
Session Creation & Entry Validation
        ↓
Share / QR Lobby URL Generation
        ↓
Participant Waiting Room (/sessions/:id/lobby)
        ↓
Instant REST Hydration (GET /api/sessions/:id/lobby)
        ↓
Display-Name Voter Join (No Password/OTP)
        ↓
Server Issues Session-Scoped Token & Increments Headcount
        ↓
Live Headcount Broadcast (lobby_update over Socket.io)
        ↓
Admin Starts Session (START_SESSION via Socket.io)
        ↓
Automated Client Transition to Voting Arena (/sessions/:id/vote)
        ↓
Pairwise Tournament Rounds (VOTE / NEXT)
        ↓
Tournament Completion & Winner Podium (/sessions/:id/results)
        ↓
Session Archival (ARCHIVE_SESSION) & Results History (/history)
```

```text
                    ┌────────────────────────────────────────────────────────┐
                    │                   Administrative Tier                  │
                    │                    Admin Panel /admin                  │
                    │               (Guarded by JWT & AdminGuard)            │
                    └───────────────────────────┬────────────────────────────┘
                                                │
                                        Socket.io actions:
                                        - CREATE_SESSION
                                        - START_SESSION
                                        - NEXT
                                        - ARCHIVE_SESSION
                                        - SET_ENTRIES
                                        (Enriched with Admin JWT)
                                                │
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │                Authoritative Backend                   │
                    │                Redux Store & Registry                  │
                    │             (Root State: Map({sessions}))              │
                    └───────────────────────────┬────────────────────────────┘
                                                │
                  ┌─────────────────────────────┴────────────────────────────┐
                  │                                                          │
                  ▼                                                          ▼
        Room: "session:ABC"                                        Room: "session:XYZ"
                  │                                                          │
                  ├── 'lobby_update'                                         ├── 'lobby_update'
                  │   (voterCount, status)                                   │   (voterCount, status)
                  ├── 'session_state'                                        ├── 'session_state'
                  │   (pair, tallies, winner)                                │   (pair, tallies, winner)
                  ▼                                                          ▼
        Waiting Room ABC                                           Waiting Room XYZ
      /sessions/ABC/lobby                                        /sessions/XYZ/lobby
                  │                                                          │
          Direct QR/URL Access                                       Direct QR/URL Access
          GET /api/sessions/ABC/lobby                                GET /api/sessions/XYZ/lobby
                  │                                                          │
            Voter Joins                                                Voter Joins
        (Display Name Only)                                        (Display Name Only)
        Token: sessionToken                                        Token: sessionToken
                  │                                                          │
          Auto-Redirect on                                           Auto-Redirect on
          status: 'open'                                             status: 'open'
                  │                                                          │
                  ▼                                                          ▼
             Voting Room                                                Voting Room
         /sessions/ABC/vote                                         /sessions/XYZ/vote
                  │                                                          │
            Pairwise Vote                                              Pairwise Vote
         Token-Guarded Ballot                                       Token-Guarded Ballot
                  │                                                          │
                  ▼                                                          ▼
          Tournament Podium                                          Tournament Podium
        /sessions/ABC/results                                      /sessions/XYZ/results
                  │                                                          │
                  └─────────────────────────────┬────────────────────────────┘
                                                │
                                       Store Subscriber Hook
                                       (Fire-and-forget async)
                                                │
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │                    MongoDB Database                    │
                    │              Session Model & Result Model              │
                    └────────────────────────────────────────────────────────┘
```

---

### 9.2 Administrative Management Panel (`/admin`)

The `/admin` route serves as the centralized command center for tournament administrators.

1. **Authentication & Route Guarding**:
   - Protected by `AdminGuard` ([`voting-client/src/routes/AdminGuard.jsx`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AdminGuard.jsx)).
   - Evaluates `isAdminLoggedIn()` from [`services/auth.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/auth.js).
   - If an unauthenticated user attempts to access `/admin`, they are immediately redirected to `/login`, preserving security across client refreshes.
2. **Session Oversight & Real-Time Monitoring**:
   - Displays all sessions registered in `state.sessions.list` and `state.sessions.bySessionId`.
   - Real-time badges indicate session status (`pending`, `open`, `completed`, `archived`).
   - Displays live participant headcount (`voterCount`) and candidate entry count (`entryCount`).
   - Summary metric cards display aggregate counts: Total Sessions, Active/Open, Waiting/Pending, Concluded, Archived, and Total Joined Voters.
3. **Session Creation Suite**:
   - Form supports configuring a human-readable `title` and optional custom `sessionId`/slug.
   - Candidate entries can be entered as comma-separated or newline-separated values.
   - Validates that the title is non-empty.
   - Automatically sanitizes and deduplicates candidate entries, enforcing that at least 2 distinct entries are provided before submission.
   - Checks for ID collisions against existing sessions.
   - Dispatches `createSession({ sessionId, title, entries })` via Redux, enriched with the admin JWT.
4. **Authoritative Lifecycle Controls**:
   - **Start Session**: Dispatches `START_SESSION` to move a `pending` session into `open`, generating the initial pairwise round via `core.next()`.
   - **Advance Round (NEXT)**: Dispatches `NEXT` to progress to the next pairwise matchup or declare the final tournament champion.
   - **Archive Session**: Dispatches `ARCHIVE_SESSION` (with a confirmation modal) to freeze voting and render the session read-only.

---

### 9.3 Admin Lifecycle Authority (Zero Competing REST Mutation Endpoints)

> [!IMPORTANT]
> **Definitive Architectural Decision (Stage 0/A/D): ZERO Competing REST Mutation Endpoints.**
> The system strictly avoids dual lifecycle pipelines. All lifecycle mutations—including session creation, starting, round advancement (`NEXT`), and archiving—occur **exclusively via the authorized Socket.io `action` pipeline**:
> - `CREATE_SESSION`
> - `START_SESSION`
> - `NEXT`
> - `ARCHIVE_SESSION`
> - `SET_ENTRIES`
> 
> Outgoing actions are automatically enriched with the admin JWT by the client remote action middleware in `store.js`. The backend server validates the JWT in `server.js` before dispatching to the store.
> 
> REST endpoints remain strictly read-only or dedicated to voter joining and history retrieval (`GET /api/sessions`, `GET /api/sessions/:id/lobby`, `POST /api/sessions/:id/join`, `GET /api/sessions/history`, `GET /api/sessions/:id/result`). There are no competing REST mutation endpoints (e.g. no `POST /api/sessions/:id/start` or `POST /api/sessions/:id/next`).

---

### 9.4 Share URLs & Frontend QR Code Generation

1. **Lobby URL Structure**:
   - The Admin Panel generates direct participant URLs pointing to:
     ```text
     /sessions/:id/lobby
     ```
   - The complete share URL is resolved dynamically using the browser origin:
     `${window.location.origin}/sessions/${encodeURIComponent(session.id)}/lobby`
2. **Client-Side QR Code Generation**:
   - QR codes are generated purely on the frontend using the `qrcode` package via `QRCode.toDataURL()`.
   - Renders a clean 260px data URL canvas inside an accessible modal with a one-click clipboard copy button.
3. **Zero Credential Exposure**:
   - Share URLs and QR codes contain **ONLY** the public navigation URL.
   - Admin JWTs, voter tokens, passwords, and server secrets are **NEVER** embedded in share URLs or QR payloads.
   - Scanning the QR code simply opens the browser to `/sessions/:id/lobby` as an unauthenticated participant.

---

### 9.5 Participant Waiting Room Lobby (`/sessions/:id/lobby`)

The Waiting Room Lobby provides a polished, frictionless entry experience for participants joining from shared links or QR code scans.

1. **Direct Access Support & Instant Hydration**:
   - When a voter arrives directly at `/sessions/:id/lobby` (e.g. from a mobile QR scan), the socket handshake may still be in progress.
   - To avoid blank cards or layout shifts, the component immediately calls `GET /api/sessions/:id/lobby` on mount.
   - Hydrates session metadata (`title`, `status`, `voterCount`, `entryCount`, `isArchived`, `votingStarted`) directly into the Redux store via `lobbyUpdate()`.
2. **Socket Room Subscription**:
   - Mount triggers `subscribeSession(routeSessionId)`, placing the client's socket into room `session:${routeSessionId}`.
   - Cleanly executes `unsubscribeSession(routeSessionId)` upon component unmount.
3. **Frictionless Display-Name Join**:
   - Voters enter a cosmetic display name (no passwords, emails, or accounts).
   - Client calls `joinVoterSession({ sessionId, displayName })` via `POST /api/sessions/:sessionId/join`.
   - Server issues a random, unguessable voter token (`crypto.randomUUID()`), saved client-side in `sessionStorage` (`votesphere_voter_token_${sessionId}`).
   - The voter token is strictly scoped to that session ID and is never exposed in the UI.
4. **Already-Joined State**:
   - If the voter has already joined the session, the join form is replaced with a greeting ("You're in, Alex!") and a green status badge ("Ready to vote").
5. **Live Participant Headcount**:
   - Displays a prominent participant counter badge with an animated pulse indicator ("X Participants Waiting").
   - Updates reactively whenever a `lobby_update` event is received across the room.
6. **Reactive Lifecycle State Transitions**:
   - **`pending`**: Participants see the waiting room, session title, contender count, and live participant count.
   - **`open`**: If the participant has joined and the admin starts the session, `Lobby.jsx` **automatically transitions** the voter to `/sessions/:id/vote` via React Router `navigate()`. An interactive "Enter Voting Arena" button is also provided.
   - **`completed`**: Displays a winner announcement card with a trophy icon and a direct link to `/sessions/:id/results`.
   - **`archived`**: Displays a clear, amber archive notification ("Session Archived") stating that the tournament has concluded and participation is closed.
   - **Unknown Session (`does-not-exist`)**: Renders a graceful "Session Not Found" card with a link back to `/sessions`, preventing application crashes.

---

### 9.6 Server-Authoritative Live Headcount Architecture

The live headcount system is strictly server-authoritative and completely isolated per session:

```text
Voter joins via POST /api/sessions/:id/join or join_session
                        │
                        ▼
      voting-server/src/auth/voter.js:
      tokensBySession.get(sessionId).add(sessionToken)
                        │
                        ▼
           voterCount = tokensBySession.get(sessionId).size
                        │
                        ▼
        io.to(`session:${sessionId}`).emit('lobby_update', {
          sessionId,
          voterCount
        });
        io.emit('sessions', getSessionsSummary(store.getState()));
                        │
                        ▼
       Client voteSlice.js handles 'lobby_update':
       state.bySessionId[sessionId].voterCount = voterCount
```

* **In-Memory Registry Index**: [`voting-server/src/auth/voter.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js) maintains `tokensBySession = new Map<string, Set<string>>()`.
* **Zero Client Calculation**: Clients never increment or calculate headcount locally; they strictly render the server-broadcast `voterCount`.
* **Multi-Session Headcount Isolation**: Because headcounts are stored in discrete sets keyed by `sessionId`, participant joins in `sess_default` never increment or affect `sess_horror`.

---

### 9.7 Socket.io Room Architecture & Multi-Session Isolation

Real-time isolation across concurrent tournaments is maintained through Socket.io rooms:

* **Room Key Format**: `session:${sessionId}` (e.g. `session:sess_default`, `session:sess_horror`).
* **Subscription Model**:
  - `subscribe_session`: Joins socket to `session:${sessionId}` and triggers an immediate unicast of `session_state`.
  - `unsubscribe_session`: Removes socket from `session:${sessionId}`.
* **Room-Scoped Events**:
  - `session_state`: Broadcast only to sockets in `session:${sessionId}` whenever the tournament state (pairs, tallies, entries, winner) mutates.
  - `lobby_update`: Broadcast only to sockets in `session:${sessionId}` whenever a participant joins or session metadata changes.
* **Global Registry Event**:
  - `sessions`: Emitted globally to all connected sockets on session creation or status change, containing lightweight summaries (`id`, `title`, `status`, `entryCount`, `voterCount`) without exposing internal tallies or tokens.

---

### 9.8 Session Lifecycle States & UI Behavior Matrix

| Lifecycle State | Admin Panel (`/admin`) | Waiting Room (`/sessions/:id/lobby`) | Voting Arena (`/sessions/:id/vote`) | Results View (`/sessions/:id/results`) |
|---|---|---|---|---|
| **`pending`** | Shows "Start Session" button; can add entries or archive | Waiting screen; shows live headcount; allows display-name join | Displays notice: "Tournament has not started yet" | Displays notice: "Tournament in preparation" |
| **`open`** | Shows "Next Round" button; shows live tallies and voter counts | **Auto-redirects joined voters to `/vote`**; join redirects directly | Active pairwise voting; voters click contender; locks upon vote | Real-time percentage bars update dynamically as votes arrive |
| **`completed`** | Displays tournament winner; shows "Archive Session" button | Displays winner celebration card with link to results | Shows tournament complete card; links to results | Authoritative winner podium crowned; links to `/history` |
| **`archived`** | Shows read-only "Archived" badge; further actions blocked | Displays amber "Session Archived" banner; rejects join attempts | Displays read-only archive notice; rejects vote actions | Concluded results viewable; permanently queryable in `/history` |

---

### 9.9 Frontend Routing & Compatibility Layer

[`voting-client/src/routes/AppRoutes.jsx`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AppRoutes.jsx) declares the complete route hierarchy:

```text
Canonical Modern Routes:
├── /admin                   ──▶ Administrative Management Dashboard (Guarded by AdminGuard)
├── /sessions                ──▶ Public Session Discovery Catalog
├── /sessions/:id/lobby      ──▶ Participant Waiting Room & Live Headcount
├── /sessions/:id/vote       ──▶ Pairwise Head-to-Head Voting Arena
├── /sessions/:id/results    ──▶ Real-Time / Concluded Results Podium
├── /history                 ──▶ Completed Tournament Results Archive (MongoDB)
├── /login                   ──▶ Administrator Login Portal (JWT authentication)
├── /register                ──▶ Informational registration notice
└── /                        ──▶ Homepage with feature hero and navigation

Compatibility & Legacy Redirect Routes:
├── /dashboard               ──▶ Redirects to /admin (Replace navigation)
├── /elections               ──▶ Redirects to /sessions (LegacyElectionRedirect)
├── /elections/:id/vote      ──▶ Redirects to /sessions/:id/vote (LegacyElectionVoteRedirect)
├── /elections/:id/results   ──▶ Redirects to /sessions/:id/results (LegacyElectionResultsRedirect)
├── /vote                    ──▶ Redirects to active session vote or /sessions/sess_default/vote
└── /results                 ──▶ Redirects to active session results or /sessions/sess_default/results
```

---

### 9.10 Normalized Redux State Architecture

The client Redux store normalizes session data to guarantee multi-session isolation:

```javascript
// state.sessions in voteSlice.js
{
  list: [
    {
      id: "sess_default",
      sessionId: "sess_default",
      title: "Danny Boyle Film Tournament",
      status: "open",
      entryCount: 11,
      voterCount: 4
    },
    {
      id: "sess_horror",
      sessionId: "sess_horror",
      title: "Horror Classics",
      status: "pending",
      entryCount: 8,
      voterCount: 1
    }
  ],
  activeSessionId: "sess_default",
  bySessionId: {
    sess_default: {
      id: "sess_default",
      title: "Danny Boyle Film Tournament",
      status: "open",
      entries: ["Sunshine", "Slumdog Millionaire"],
      vote: {
        pair: ["Shallow Grave", "Trainspotting"],
        tally: { "Shallow Grave": 1, "Trainspotting": 3 }
      },
      voterCount: 4,
      entryCount: 11,
      winner: null,
      hasLoaded: true
    },
    sess_horror: {
      id: "sess_horror",
      title: "Horror Classics",
      status: "pending",
      entries: ["The Shining", "Psycho", "Alien"],
      vote: null,
      voterCount: 1,
      entryCount: 8,
      winner: null,
      hasLoaded: true
    }
  }
}
```

* **Targeted Mutation**: `lobbyUpdate` and `sessionState` actions modify only `bySessionId[action.payload.sessionId]`.
* **Zero Cross-Talk**: Actions and headcounts in `sess_default` cannot overwrite or modify `sess_horror`.
* **No Global Lobby Singleton**: The Waiting Room leverages this normalized structure directly; there is no competing global lobby state.

---

### 9.11 MongoDB & Feature 4 Compatibility

Feature 3 is fully compatible with the MongoDB persistence tier introduced in Feature 4:
* **Zero Schema Modifications**: Feature 3 did NOT introduce or require any new MongoDB schemas or migrations. It uses the existing `Session` and `Result` Mongoose models.
* **Continuous Persistence**: As admins trigger `START_SESSION`, `NEXT`, and `ARCHIVE_SESSION` over Socket.io, the Redux store subscriber in `server.js` triggers `persistStateChanges()` to update MongoDB asynchronously.
* **Safe Restart Recovery**: Interrupted `open` sessions are safely reset to `pending` on restart, and active sessions are re-hydrated into Redux, allowing the Admin Panel and Waiting Room to resume cleanly.

---

### 9.12 Known Persistence Ordering Race (Low-Severity Deferred Technical Debt)

> [!WARNING]
> **Known Low-Severity Deferred Technical Debt: Asynchronous MongoDB Status-Write Race**
> Discovered during Stage B and reproduced during Stage F integration verification:
> When rapid sequential lifecycle actions are dispatched in sub-millisecond intervals (e.g. `START_SESSION` followed immediately by `NEXT` and `NEXT`), the asynchronous, non-blocking fire-and-forget MongoDB update promises (`repository.updateSessionStatus()`) can occasionally resolve out of order in the database.
>
> **Consequence**:
> In this edge-case scenario, the MongoDB `Session` document status may record `'open'` while the in-memory Redux store and the immutable `Result` document correctly reflect `'completed'`.
>
> **Impact & Disposition**:
> - **In-Memory Server State Is Authoritative**: The live Socket.io state and in-memory Redux engine remain 100% accurate and unaffected.
> - **Result Document Is Correct**: The completed tournament result is saved idempotently with the correct champion winner.
> - **User Flow Unaffected**: Verified live end-to-end admin and participant journeys functioned with 100% success during Stage F.
> - **Status**: Documented as low-severity technical debt; intentionally deferred to a future persistence-hardening pass. `persistence.js` remains untouched during this stage.

---

---

## 10. Feature 2: Voting Timer Architecture

Feature 2 integrates an authoritative round countdown timer into the pairwise voting lifecycle, ensuring that active voting rounds expire predictably and advance tournaments automatically without manual administrator intervention.

### 10.1 Architectural Principles of the Voting Timer
1. **Server Authoritativeness**: The server owns timer progression, timeout execution (`setTimeout`), and tournament advancement. The frontend acts exclusively as a display-oriented countdown renderer and interaction guard.
2. **Zero Client-Side Progression**: The client never advances a tournament round or dispatches `NEXT` merely because its local countdown display reached `00:00`.
3. **Session-Scoped Timer Isolation**: Each session owns an independent `timerDuration` configuration and an isolated timer handle in `TimerManager`. Timer start, tick, and expiry in Session A have zero impact on Session B.
4. **Clean Decoupling from Tournament Math**: The pure domain engine in [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remains 100% pure and untouched. Timers wrap around the Redux store via an external `TimerManager` subscriber.
5. **No Timer Persistence in MongoDB**: Timer state (`endsAt`, remaining milliseconds, active timeouts) is entirely ephemeral and in-memory. No timer state or ticks are persisted to MongoDB.

### 10.2 System Architecture Flow

```text
Admin Form (/admin)
  │
  │ timerDuration: 5–300 seconds (integer)
  ▼
CREATE_SESSION action (Socket.io)
  │
  ▼
Backend Session State
  │
  │ session.set('timerDuration', duration)
  ▼
START_SESSION action (Socket.io)
  │
  ▼
TimerManager (voting-server/src/timer.js)
  │
  ├── server-side Node.js timeout (endsAt = Date.now() + duration * 1000)
  ├── session-specific timer handle (Map<sessionId, TimerEntry>)
  └── on expiry ──▶ store.dispatch({ type: 'NEXT', sessionId })
  │
  ▼
timer_state broadcast: { sessionId, duration, expiresAt, status: 'running' }
  │
  ▼
Socket.io Room: session:${sessionId}
  │
  ▼
Frontend Redux (state.sessions.bySessionId[sessionId].timer)
  │
  ▼
CountdownTimer & Voting Page (Disabled vote buttons on expiry)
```

### 10.3 Configuration Contract & Validation
* **Allowed Range**: `5` to `300` seconds inclusive.
* **Default Value**: `30` seconds.
* **Integer-Only Constraint**: Decimals are strictly rejected.
* **Invalid Input Guarding**: Inputs that are `<5`, `>300`, `0`, negative, decimal, non-numeric, or empty are rejected both client-side in `/admin` (disabling submission with validation feedback) and server-side in `reducer.js` (falling back safely to `30` seconds).
* **Multi-Round Persistence**: The configured duration is saved on the session Immutable Map (`session.get('timerDuration')`) and reused for every pairwise round in that session's lifecycle.
* **Admin Controls Scope**: Administrators do NOT receive pause, resume, extend, reset, or manual timer restart capabilities; timers run automatically according to configured duration.

### 10.4 Voter Experience & Expiry UX
* **Live Display**: `CountdownTimer.jsx` renders display time using `formatCountdown()` with subtle micro-animations and accessibility tags (`role="timer"`, `aria-live="polite"`).
* **Vote Guarding**: `Voting.jsx` tracks `isTimerExpired(timer, now)`. When the local timestamp crosses `expiresAt`:
  - Voting candidate buttons receive `disabled` attributes and `.voting-btn-disabled` visual styling.
  - An inline feedback banner appears: *"⏰ Round timer expired. Waiting for next round..."*.
* **Client Non-Interference**: The frontend NEVER dispatches `NEXT` when countdown reaches zero.
* **Reactive Recovery**: When the server dispatches `NEXT` and broadcasts new `session_state` and `timer_state`, Redux updates `state.sessions.bySessionId[sessionId]`, immediately unlocking voting buttons for the new round without requiring a page refresh.

### 10.5 Multi-Session Isolation
* **Backend Isolation**: `TimerManager` maintains independent timers in `this.timers = new Map()` keyed strictly by `sessionId`.
* **Room Isolation**: Timer updates are transmitted strictly via `io.to('session:' + sessionId).emit('timer_state', payload)`.
* **Client Redux**: Client state isolates timers under `state.sessions.bySessionId[sessionId].timer`.
* **Concurrent Autonomy**: Session A configured for 10s and Session B configured for 60s tick down, advance rounds, and terminate independently without cross-session event leakage.

### 10.6 Socket Contract & Hydration
* **`timer_state` Event**:
  - Emitted to room `session:${sessionId}` on round start, round change, and timer stop.
  - Unicast immediately to connecting sockets upon `subscribe_session` for initial hydration and reconnect recovery.
* **Zero Competing Protocols**: No REST endpoints were created for timers, and no pause/resume/extend/reset Socket actions exist. Timer authority is entirely event-driven.

---

## 11. Feature 5: Real-Time Results Chart Architecture

Feature 5 integrates graphical pairwise voting visualization and authoritative results visibility gating into the presentation layer. It ensures that voters cannot observe live vote counts during active voting, while delivering an accessible, animated comparative chart once a round concludes.

### 11.1 Architectural Principles of Results Visualization
1. **Pure Presentation Layer**: The chart component (`ResultsChart.jsx`) and transformation utility (`resultsUtils.js`) contain zero networking, socket subscriptions, MongoDB calls, or Redux store mutations. They consume authoritative data passed down as props from `Results.jsx`.
2. **Server-Authoritative Data Source**: All chart data, percentages, and candidate rankings derive strictly from authoritative server state (`pair` and `tally` from `session_state`, or immutable `Result` documents from `/api/sessions/:sessionId/result`).
3. **Strict Results Visibility Guarding**: Tally numbers, vote percentages, and visual bars are protected during active rounds. The DOM does not contain hidden or obscured vote counts that could be inspected via DevTools; tallies and chart data are set to `null` in the presentation model.
4. **Stale Data Invalidation on Progression**: When the server advances to a new round, previous round tallies and chart components are invalidated and unmounted immediately.
5. **Universal Accessibility**: Every chart provides an accessible HTML `<table>` representation with semantic captions and headers, ensuring full screen-reader accessibility alongside visual SVG rendering.

### 11.2 System Architecture Flow

```text
Server Redux Store (Authoritative)
  │
  │ session_state { pair, tally, status }
  ▼
Socket.io Room: session:${sessionId}
  │
  ▼
Frontend Redux (state.sessions.bySessionId[sessionId])
  │
  ▼
Results Page (/sessions/:id/results)
  │
  ├── getGuardedResultsPresentation({ hasLoaded, winner, pair, tally, timer, now })
  │     │
  │     ├── [Active Round] ──▶ VOTING_IN_PROGRESS
  │     │                       - showChart: false
  │     │                       - chartData: null
  │     │                       - Renders Contender cards (hideStats=true) + CountdownTimer
  │     │
  │     ├── [Round Closed] ──▶ RESULTS_REVEALED
  │     │                       - showChart: true
  │     │                       - transformTallyToChartData(pair, tally)
  │     │                       - Renders ResultsChart + ResultCard (stats shown)
  │     │
  │     └── [Winner Declared] ──▶ CONCLUDED
  │                               - Winner celebration podium + trophy + history links
  │
  ▼
Round-Scoped Remounting: key={roundKey} (getSessionPairLockKey)
```

### 11.3 Results Visibility State Machine

The results presentation layer evaluates an explicit state machine through `getResultsVisibilityState`:

| Visibility State | Trigger Condition | Chart Display | Tally / Percentage Visibility | UI Components Rendered |
|---|---|---|---|---|
| **`LOADING`** | `!hasLoaded && !winner` | Hidden (`showChart: false`) | Hidden (`null`) | Loading spinner card with connection status |
| **`EMPTY`** | `hasLoaded && pair.length < 2 && !winner` | Hidden (`showChart: false`) | Hidden (`null`) | Empty round alert notice with link to vote/sessions |
| **`VOTING_IN_PROGRESS`** | Active round with running timer (`!isExpired`) | Hidden (`showChart: false`) | **Strictly Hidden** (`chartData: null`, `totalVotes: null`) | Contender cards (`hideStats={true}`), Locked notice banner, active `CountdownTimer` |
| **`RESULTS_REVEALED`** | Round closed (timer expired/stopped or server confirmed) | **Visible** (`showChart: true`) | **Authoritative Reveal** (Exact tallies, clamped percentages) | `ResultsChart` (SVG + Table), `ResultCard` (with stats), Total round votes badge |
| **`CONCLUDED`** | `winner` present (live or historical) | Hidden (`showChart: false`) | Winner only (100% share) | Tournament winner podium, celebration card, links to `/sessions` and `/history` |

### 11.4 Real-Time Round Transition & Stale Data Invalidation
When the server advances the tournament from Round N (`["Candidate A", "Candidate B"]`) to Round N+1 (`["Candidate A", "Candidate C"]`):
1. **Server Broadcast**: Server emits updated `session_state` with new `pair` and reset `tally: {}`, along with new `timer_state`.
2. **Normalized Redux Ingestion**: Client RTK `voteSlice` updates `bySessionId[sessionId]` targeted strictly to the session.
3. **Presentation Model Recalculation**: `getGuardedResultsPresentation` re-evaluates the new pair. Because the new round is actively running, visibility automatically transitions from `RESULTS_REVEALED` to `VOTING_IN_PROGRESS`.
4. **React Component Remounting**: The `Results.jsx` view anchors the arena container with a round-scoped key:
   ```javascript
   const roundKey = getSessionPairLockKey(routeSessionId, pair) || presentation.roundKey || 'round-initial';
   ```
   This forces React to unmount the previous round's `ResultsChart` and `ResultCard` components and mount fresh components for Round N+1, preventing any lingering animation artifacts, cached tooltips, or stale percentages from surviving across rounds.
5. **No Page Refresh**: The entire transition occurs smoothly in-place via WebSocket event delivery without requiring browser reloads.

### 11.5 Pure Transformation & Calculation Architecture (`resultsUtils.js`)
* **`transformTallyToChartData(pair, tally)`**:
  - Preserves exact server candidate ordering (`pair[0]` -> contender 1, `pair[1]` -> contender 2).
  - Handles missing tally keys safely by defaulting candidate votes to `0`.
  - Maps to standard UI theme colors (`CONTENDER_COLORS`: `#6366f1` Indigo, `#ec4899` Rose).
* **`calculatePercentage(votes, totalVotes)`**:
  - Safe zero-division arithmetic: Returns `0` when `totalVotes <= 0` or votes are invalid.
  - Clamps output cleanly between `0` and `100` rounded to 1 decimal place (`Number(pct.toFixed(1))`).
  - Never returns `NaN` or `Infinity`.
* **`getPairwiseSummary(pair, tally)`**:
  - Calculates aggregate total votes, leader identification, vote margin, and tie detection.

### 11.6 Dual Representation Accessibility
`ResultsChart.jsx` satisfies accessibility standards by coupling visual rendering with assistive markup:
* **Visual Layer**: An interactive SVG bar chart rendered via Recharts wrapped in `<div className="results-chart-canvas-wrapper" aria-hidden="false">` with custom dark-themed tooltips.
* **Assistive Table Layer**: A dedicated `<table className="results-chart-accessible-table" aria-label="Pairwise Vote Distribution Summary Data">` containing semantic captions (`<caption className="sr-only">`), column headers (`<th scope="col">`), and data rows. Screen readers can navigate candidate vote distributions sequentially without needing to parse SVG canvas elements.
* **Numerical Legend**: An auxiliary legend displaying exact vote counts and share percentages.

### 11.7 Multi-Session Isolation
* Results charts strictly consume session-scoped state from `state.sessions.bySessionId[sessionId]`.
* Sockets subscribe strictly to `session:${sessionId}` rooms.
* Voting activity, round progressions, or tallies in `sess_horror` have zero impact on the chart data or visibility state rendered for `sess_default`.

### 11.8 Deferred Architectural Risk: Backend Timer Expiry Progression
* **Limitation**: The current backend timer implementation automatically dispatches `NEXT` immediately upon timer expiry (`timer expiry` -> `handleExpiry` -> `NEXT` -> next round).
* **Consequence**: There is currently no intermediate server-authoritative lifecycle state representing `Round N closed + results revealed` while retaining Round N as the active pair.
* **Disposition**: The current Feature 5 client implementation cannot provide an extended server-confirmed results pause without changing the backend lifecycle, reducer, and socket contracts. This is documented as an architectural boundary and explicitly deferred to future lifecycle iterations.

---

## 12. Feature 6: Admin Session Creation & Session Management Architecture

Feature 6 establishes a robust administrative workflow for session creation, lifecycle controls, and MongoDB persistence. It formalizes a dedicated modal creation UX, an isolated session management dialog, an authoritative two-step archival confirmation flow, and backend hardening that protects tournament state integrity.

### 12.1 Administrative Session Creation Workflow
* **Creation Trigger**: The Admin Panel (`/admin`) presents a clear `+ Create New Session` primary action button at the top right of the dashboard.
* **Dedicated Modal Architecture (`AdminSessionModal.jsx` / `AdminSessionModal.css`)**:
  - Encapsulates creation fields within a focused, accessible modal overlay (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`).
  - Supports Session Title (required, trimmed non-empty string).
  - Supports optional custom Session ID/slug. If omitted, the system generates a URL-friendly slug from the title or timestamps.
  - Supports Round Timer Duration (number, 5–300 seconds, default 30s).
  - Dynamic Candidate Entry Roster: Interactive list allowing administrators to add, inspect, and remove candidates with duplicate entry pruning.
* **Pre-Submission Client Validation**:
  - Title: Must not be empty or solely whitespace.
  - Entries: Must contain at least 2 distinct non-empty candidate entries.
  - Timer Duration: Must be an integer between 5 and 300 seconds.
* **Authoritative Action Dispatch**:
  - Emits the authenticated Socket.io action `CREATE_SESSION` enriched with the administrator JWT via client middleware.
  - Upon server processing, newly created sessions initialize in the `pending` lifecycle state.

### 12.2 Focused Session Management Workflow (`AdminManageModal.jsx`)
To eliminate visual clutter and avoid accidental state transitions, session cards display summary metadata (title, status badge, timer duration, voter headcount, candidate count) and provide a single `[Manage]` action.
Clicking `[Manage]` opens `AdminManageModal`, which renders dedicated lifecycle controls strictly tailored to the current session status:

| Lifecycle State | Available Controls | Hidden Controls | Architectural Rationale |
|---|---|---|---|
| **`pending`** | • Start Tournament (`START_SESSION`)<br>• Open Lobby (`/sessions/:id/lobby`)<br>• Share Link / QR Code | • Next Pair<br>• Archive Session | Tournament is unseeded; cannot advance or archive before launch. |
| **`open`** | • Next Pair (`NEXT`)<br>• Archive Session (Triggers confirmation)<br>• Vote View (`/sessions/:id/vote`)<br>• Results View (`/sessions/:id/results`)<br>• Open Lobby<br>• Share Link / QR Code | • Start Tournament | Tournament is actively running; cannot re-trigger start. |
| **`completed`** | • Archive Session (Triggers confirmation)<br>• View Results (`/sessions/:id/results`)<br>• Open Lobby<br>• Share Link / QR Code | • Start Tournament<br>• Next Pair | Tournament winner crowned; no remaining candidate pairs to advance. |
| **`archived`** | • View Results (`/sessions/:id/results`)<br>• Share Link / QR Code | • Start Tournament<br>• Next Pair<br>• Archive Session | Session is read-only; all mutation controls are strictly removed. |

### 12.3 Two-Step Archival Confirmation Flow
Archiving a session terminates participation and permanently freezes mutations. To safeguard against accidental clicks:
1. Administrator clicks `Archive Session` within `AdminManageModal`.
2. The UI intercepts the action and displays a dedicated `Confirm Session Archival` modal dialog.
3. The confirmation dialog explicitly states: *"Archiving this session will permanently end active voting and move the session to a read-only state."*
4. Administrator must click `Yes, Archive Session` to proceed.
5. If confirmed, `ARCHIVE_SESSION` is dispatched over Socket.io.
6. If cancelled (`Cancel` or closing modal), the session remains untouched in its current state.
7. Once archived, the Admin Panel permanently conceals all live tournament mutation triggers for that session.

### 12.4 Backend Persistence & Schema Hardening (`Session.js` & `persistence.js`)
* **Mongoose Schema Hardening**:
  - `voting-server/src/db/models/Session.js` incorporates `timerDuration`:
    ```javascript
    timerDuration: {
      type: Number,
      default: 30,
      min: [5, 'Timer duration must be at least 5 seconds'],
      max: [300, 'Timer duration cannot exceed 300 seconds']
    }
    ```
* **Persistence & Recovery Lifecycle**:
  - When `CREATE_SESSION` is dispatched, `persistStateChanges()` saves `timerDuration` into the MongoDB `Session` document.
  - On backend restart, `recoverSessionsFromDb()` in `persistence.js` reads `sessionDoc.timerDuration` and dispatches `CREATE_SESSION` to rebuild the in-memory Redux store.
  - Legacy records without stored duration safely fall back to `30` seconds.

### 12.5 Server-Side Authoritative Validation (`server.js`)
Authoritative validation runs on the Socket.io action ingress filter before dispatching `CREATE_SESSION` into the Redux store:
* **Session ID Validation**: Checks presence and format; verifies `state.getIn(['sessions', sessionId])` is undefined. If already taken, emits `action_error` (`DUPLICATE_SESSION_ID`).
* **Title Validation**: Trims title; rejects empty or non-string titles with `action_error` (`MISSING_TITLE`).
* **Entries Validation**: Validates array structure, strips whitespace, filters duplicates; requires at least 2 distinct entries. If fewer than 2, emits `action_error` (`INSUFFICIENT_ENTRIES`).
* **Timer Duration Validation**: Verifies integer type and bounds (5 <= duration <= 300). If invalid, emits `action_error` (`INVALID_TIMER_DURATION`).
* **Authorization**: Rejects missing or non-admin JWTs with `action_error` (`UNAUTHORIZED` or `FORBIDDEN`).

### 12.6 Formally Accepted Monotonic Status Guard (`repository.js`)
During Feature 6 Stage A, an atomic status guard was added to `updateSessionStatus()` in `voting-server/src/db/repository.js`:
```javascript
const filter = { sessionId };
if (status === 'open') {
  filter.status = { $nin: ['completed', 'archived'] };
} else if (status === 'completed') {
  filter.status = { $ne: 'archived' };
}
```
* **Discovered Value**: Resolves the pre-existing asynchronous fire-and-forget write race where a fast `START_SESSION` followed immediately by `NEXT` could cause out-of-order writes in MongoDB.
* **Formal Classification**: Reviewed and formally accepted as beneficial backend hardening discovered during implementation.

### 12.7 Multi-Session Isolation & Room Architecture
* **Room-Scoped Delivery**: Sessions communicate strictly within Socket.io rooms (`session:${sessionId}`). Actions on Session A do not trigger broadcasts or mutations in Session B.
* **Registry Broadcasting**: The server broadcasts lightweight summary lists (`sessions`) to inform clients of all sessions and their status without leaking active round pair tallies.
* **Concurrent Autonomy**: Verified live in Stage C with `e2e_feature6_session` (15s timer, 4 entries) and `e2e_session_b` (10s timer, 2 entries) executing independently without cross-talk.

### 12.8 Pure Core Engine Preservation
> [!IMPORTANT]
> **[`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remained 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`).**
> All validation, modal logic, management workflows, and persistence updates wrap strictly around the pure 40-line tournament domain core without altering domain mathematics.

---

## 13. Security Boundaries & Implementation Decisions

### Display Name Boundary
> [!IMPORTANT]
> **The display name is NOT an authentication credential.**
> The display name is purely cosmetic metadata used to personalize the voter's screen. The secret, server-issued `sessionToken` (and its presence in the server's in-memory registry) is the sole authorization factor protecting votes. Duplicate display names within the same session are explicitly allowed and cause no interference.

### History & Lobby API Read-Only Security Boundary
> [!NOTE]
> **Public discovery, lobby, and history endpoints are strictly read-only and unprivileged.**
> - `GET /api/sessions`, `GET /api/sessions/:id/lobby`, `GET /api/sessions/history`, and `GET /api/sessions/:sessionId/result` do not accept mutative payloads or require admin tokens.
> - Responses are explicitly sanitized to expose only domain fields (`sessionId`, `title`, `status`, `entryCount`, `voterCount`, `winner`, `entries`, `completedAt`). Internal database identifiers (`_id`, `__v`) and sensitive tokens (admin JWTs, voter tokens, passwords) are strictly excluded from response payloads.

### Share URL & QR Code Security
* Share URLs and QR codes contain **zero credentials or secrets**.
* No administrative tokens, voter session tokens, or authentication secrets are ever encoded into share links.

### Client-Side Token Storage Decision (v1)
* **Current Implementation**: In v1, the admin JWT is stored in browser `localStorage` (`votesphere_admin_jwt`). Voter tokens are stored in `sessionStorage` (`votesphere_voter_token_${sessionId}`) and mirrored in session cookies.
* **Rationale**: Simple to implement, inspect, and verify during evaluation across multi-browser testing workflows without complex third-party cookie or domain restrictions.
* **Known Limitation**: Browser storage is accessible to scripts executing in the document origin.
* **Deferred Hardening**: Migration to `httpOnly`, `SameSite=Strict`, `Secure` cookies for JWT management is deferred to a future security hardening pass.

---

## 14. Architectural Roles of Core Components

| Component / File | Location | Primary Architectural Role |
|---|---|---|
| **`core.js`** | `voting-server/src/core.js` | **Protected Pure Engine.** Immutable tournament logic (`setEntries`, `next`, `vote`). Unmodified 40-line pure domain module (SHA-256: `B479F3F0...`). |
| **`reducer.js`** | `voting-server/src/reducer.js` | **Session Registry Reducer.** Manages `Map({ sessions })` root state, handles lifecycle transitions (`timerDuration` contract validation), and delegates to `core.js`. |
| **`timer.js`** | `voting-server/src/timer.js` | **Server-Authoritative Timer Manager.** Manages in-memory round countdown timeouts per session, expiry dispatching (`NEXT`), and `timer_state` generation. |
| **`server.js`** | `voting-server/src/server.js` | **Authoritative Server & Gateway.** Manages HTTP endpoints, Socket.io rooms, action ingress authentication, duplicate vote tracking, live headcount broadcasts, history endpoints, `timer_state` broadcasts, and `CREATE_SESSION` validation. |
| **`connection.js`**| `voting-server/src/db/connection.js`| **MongoDB Connection Lifecycle.** Manages connection, disconnect, and status checking for MongoDB. |
| **`Session.js`** | `voting-server/src/db/models/Session.js`| **Session Data Model.** Mongoose schema defining session metadata, status, entries, timer duration, and lifecycle timestamps. |
| **`Result.js`** | `voting-server/src/db/models/Result.js`| **Result Data Model.** Mongoose schema defining immutable completed tournament outcomes and candidate rosters. |
| **`repository.js`**| `voting-server/src/db/repository.js`| **Data Access Repository.** Query abstractions for sessions, results, recovery queries, idempotent upserts, and monotonic status update guards. |
| **`persistence.js`**| `voting-server/src/db/persistence.js`| **Persistence Orchestration.** Redux state diffing, tournament progression guarding, completed result extraction, and DB recovery with timer duration. |
| **`auth/admin.js`** | `voting-server/src/auth/admin.js` | **Admin Authentication Module.** Seeding single admin, bcrypt password hashing/comparison, JWT issuance and verification. |
| **`auth/voter.js`** | `voting-server/src/auth/voter.js` | **Voter Identity & Headcount Registry.** Registration with display name, cryptographically secure token issuance, server-authoritative active voter tracking for live headcount (`tokensBySession`), and duplicate vote prevention. |
| **`auth/config.js`** | `voting-server/src/auth/config.js` | **Auth Configuration Module.** Environment configuration loader with safe fallbacks and runtime override capabilities for testing. |
| **`bootstrap.js`** | `voting-server/src/bootstrap.js` | **Data Seed Orchestrator.** Loads `entries.json` and bootstraps `sess_default` and `sess_horror`. |
| **`voteSlice.js`** | `voting-client/src/redux/voteSlice.js` | **Normalized Live Client State.** Stores `list` and `bySessionId` (including `voterCount`, `timer`, `timerDuration`), defines selectors, and handles real-time `lobby_update` and `timer_state` socket actions. |
| **`historySlice.js`**| `voting-client/src/redux/historySlice.js`| **Archived History State.** Redux slice managing fetched tournament results history, loading states, and error handling. |
| **`store.js`** | `voting-client/src/redux/store.js` | **Client Store & Middleware.** Configures RTK store with echo-loop prevention and automatic token enrichment middleware (attaches admin JWT to admin actions). |
| **`timerUtils.js`** | `voting-client/src/utils/timerUtils.js` | **Timer Formatting & Expiry Utils.** Pure mathematical utility functions for countdown calculation, string formatting (`00:30`), and client expiry detection. |
| **`resultsUtils.js`**| `voting-client/src/components/results/resultsUtils.js` | **Results Transformation & Guarding Utils.** Pure functions for tally-to-chart normalization, safe percentage calculation, zero-division clamping, and presentation visibility state derivation. |
| **`ResultsChart.jsx`**| `voting-client/src/components/results/ResultsChart.jsx` | **Pairwise Results Bar Chart.** Dedicated Recharts presentation component rendering graphical vote distributions with custom tooltips and an accessible screen-reader table. |
| **`ResultCard.jsx`** | `voting-client/src/components/results/ResultCard.jsx` | **Candidate Result Card.** Renders candidate details, ranking, and votes; supports `hideStats` prop to guard statistics during active voting rounds. |
| **`CountdownTimer.jsx`** | `voting-client/src/components/CountdownTimer.jsx` | **Visual Countdown Presentation.** Reusable UI component displaying active countdown timer with warning/critical urgency styling. |
| **`AdminSessionModal.jsx`**| `voting-client/src/components/AdminSessionModal.jsx` | **Admin Session Creation Modal.** Dedicated modal dialog with title, custom ID, timer duration (5–300s), and dynamic candidate entries roster validation. |
| **`AdminManageModal.jsx`** | `voting-client/src/components/AdminManageModal.jsx` | **Admin Session Management Modal.** Focused modal dialog providing state-tailored lifecycle controls across `pending`, `open`, `completed`, and `archived` states. |
| **`AdminSessionCard.jsx`** | `voting-client/src/components/AdminSessionCard.jsx` | **Admin Session Card Component.** Displays session status, configured duration badge, voter headcount, entry count, and focused `[Manage]` trigger. |
| **`services/auth.js`**| `voting-client/src/services/auth.js`| **Client Auth Service.** Admin login/logout, voter session join, token persistence, and session check helpers. |
| **`services/history.js`**| `voting-client/src/services/history.js`| **Client History Service.** Fetches paginated tournament history and individual session results from REST API. |
| **`services/socket.js`**| `voting-client/src/services/socket.js`| **Client Socket Bridge.** Manages connection, subscriptions registry, and auto-resubscription on reconnect. |
| **`AppRoutes.jsx`** | `voting-client/src/routes/AppRoutes.jsx` | **Multi-Session Router.** Declares route hierarchy (`/admin`, `/sessions`, `/sessions/:id/lobby`, `/sessions/:id/vote`, `/sessions/:id/results`, `/history`, `/login`, legacy redirects). |
| **`AdminGuard.jsx`**| `voting-client/src/routes/AdminGuard.jsx` | **Admin Route Guard.** Higher-order route wrapper protecting `/admin`, verifying admin token existence and redirecting unauthenticated users to `/login`. |
| **`Admin.jsx`** | `voting-client/src/pages/Admin.jsx` | **Admin Management Panel.** Protected administrative dashboard providing modal-based session creation, manage dialog orchestration, two-step archive confirmation, and live session cards. |
| **`Lobby.jsx`** | `voting-client/src/pages/Lobby.jsx` | **Participant Waiting Room Lobby.** Public lobby view with display-name voter joining, instant REST hydration, live headcount via `lobby_update`, automated transition to `/sessions/:id/vote` when session opens, and handling for completed/archived sessions. |
| **`qrcode`** | `package.json` (client dependency) | **QR Code Generation.** Pure client-side SVG/canvas generation of shareable lobby URLs without embedding credentials or secrets. |
| **`Voting.jsx`** | `voting-client/src/pages/Voting.jsx` | **Pairwise Voting Arena.** Enforces display-name voter join before voting, renders candidate cards, manages local lock, displays countdown timer, and disables vote buttons on expiry. |
| **`Login.jsx`** | `voting-client/src/pages/Login.jsx` | **Admin Login Portal.** Authenticates admin via identifier/password, acquires JWT, and redirects to management views. |
| **`Results.jsx`** | `voting-client/src/pages/Results.jsx` | **Live Tallies & Presentation.** Renders guarded active-round notices, real-time `ResultsChart` upon round conclusion, authoritative winner podium, and falls back to MongoDB history if session concluded. |
| **`History.jsx`** | `voting-client/src/pages/History.jsx` | **Results History Archive.** Renders past completed tournament outcomes with loading, error, empty, and populated states. |

---

## 15. Feature Scope, Test Verification History & Future Roadmap

To ensure development integrity, completed functionality is strictly distinguished from deferred scope:

### Completed & Verified: Feature 1 (Two-Tier Authentication)
* Single global administrator with bcrypt password hashing and JWT issuance/verification.
* Protected administrative lifecycle actions (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`).
* Frictionless voter session joining with display-name-only input and cryptographically secure session-scoped token issuance.
* Server-authoritative vote security and duplicate vote rejection (`${sessionId}:::${pair}:::${token}`).
* Multi-session isolation with session-scoped voter tokens.
* HTTP REST endpoints (`POST /api/admin/login`, `POST /api/sessions/:sessionId/join`, `GET /api/auth/me`).
* Socket.io ingress authorization with `action_error` feedback.
* Client token enrichment middleware and authentication service.
* Protected pure tournament engine [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remaining completely untouched.

### Completed & Verified: Feature 4 (MongoDB Persistence & Results History)
* MongoDB connection lifecycle management with fail-fast startup and graceful shutdown (`connection.js`).
* Mongoose data models for sessions (`Session.js`) and historical outcomes (`Result.js`).
* Repository abstraction decoupling database queries from domain logic (`repository.js`).
* Non-blocking Redux store subscriber for asynchronous persistence (`persistence.js`).
* Protection of original candidate entries lists during tournament progression via `isTournamentProgression` guard.
* Safe server startup recovery resetting interrupted `open` sessions to `pending` and restoring active sessions into Redux.
* Idempotent seed session persistence and result creation.
* REST API endpoints (`GET /api/sessions/history`, `GET /api/sessions/:sessionId/result`, alias `/history`).
* Frontend history state isolation (`state.history` vs `state.sessions`) in Redux RTK.
* Dedicated `/history` archive page with loading, error/retry, empty, and populated card grid states.
* Historical result fallback in `/sessions/:id/results` for concluded sessions not in active memory.

### Completed & Verified: Feature 3 (Admin Panel & Waiting Room Lobby)
* Dedicated Admin Dashboard (`/admin`) protected by `AdminGuard` and JWT authentication.
* Admin session creation with title validation, optional custom slug/ID, candidate entry sanitization, duplicate pruning, and collision protection.
* Strict Socket.io admin lifecycle authority (`CREATE_SESSION`, `START_SESSION`, `NEXT`, `ARCHIVE_SESSION`) with zero competing REST mutation endpoints.
* Participant Waiting Room Lobby (`/sessions/:id/lobby`) supporting direct URL/QR access, public session metadata hydration (`GET /api/sessions/:id/lobby`), and display-name joining.
* Server-authoritative in-memory voter registry tracking active session voters and broadcasting live headcount updates (`lobby_update`) to `session:${sessionId}` rooms.
* Client-side QR code generation using `qrcode` rendering shareable lobby URLs without embedding tokens, secrets, or administrative credentials.
* Normalized Redux store state isolation: `voterCount` stored per session in `state.sessions.bySessionId[sessionId]` without cross-session pollution.
* Automated participant progression from Waiting Room (`/sessions/:id/lobby`) to Voting Arena (`/sessions/:id/vote`) upon session activation (`open`).
* Graceful waiting room states for completed and archived sessions with redirection to results and read-only status alerts.
* Compatibility routes preserving historical URLs (`/dashboard`, `/elections`, `/vote`, `/results`).

### Completed & Verified: Feature 2 (Voting Timer)
* Server-authoritative `TimerManager` (`timer.js`) driving round timeouts and store progression (`NEXT`).
* End-to-end duration configuration: `5–300` seconds integer-only, default `30` seconds, persisted in session state.
* Room-scoped `timer_state` events emitted strictly to `session:${sessionId}` rooms.
* Initial timer hydration and reconnect recovery via `subscribe_session`.
* Voter vote guarding via `isTimerExpired()` disabling voting controls upon timer expiry without page reload.
* Admin active session countdown display and static duration badges for inactive sessions.
* Zero pause/resume/extend/reset/manual restart scope creep.
* Complete multi-session timer isolation.
* Protected pure core engine [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) preserved 100% byte-for-byte.

### Completed & Verified: Feature 5 (Real-Time Results Chart)
* Dedicated `ResultsChart` presentation component using Recharts rendering pairwise vote distributions (`BarChart`, `Bar`, `XAxis`, `YAxis`, `Tooltip`, `Cell`).
* Pure data transformation utilities (`resultsUtils.js`) providing safe percentage arithmetic, zero-division clamping, candidate order preservation, and presentation model derivation.
* Dual accessible presentation: interactive SVG bar chart coupled with a semantic HTML `<table>` for screen-reader navigation.
* Strict Results Visibility guarding: tallies, vote totals, percentages, and `ResultsChart` are strictly hidden from the DOM during active voting rounds (`VOTING_IN_PROGRESS`), replaced by locked contender cards, a notice banner, and an active `CountdownTimer`.
* Authoritative Results Reveal (`RESULTS_REVEALED`): displayed upon round conclusion with exact vote shares and total ballot count.
* Real-Time Round Transition Invalidation: automatic invalidation of old candidate data, tallies, and chart components on Round N -> Round N+1 transition; round-scoped React keys (`getSessionPairLockKey`) ensure clean unmounting and prevent stale DOM state from surviving across rounds without page refresh.
* Server Authoritativeness: client never independently calculates tallies, advances rounds, or dispatches `NEXT` upon countdown zero.
* Complete multi-session isolation across charts, tallies, and visibility states.
* Protected pure core engine [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) preserved 100% byte-for-byte.

### Completed & Verified: Feature 6 (Admin Session Creation & Session Management)
* Prominent, visible `+ Create New Session` modal dialog (`AdminSessionModal.jsx` / `AdminSessionModal.css`) replacing inline creation form.
* Session setup configuration supporting title, optional custom ID/slug, round timer duration (5–300s, default 30s), and dynamic candidate entries roster.
* Pre-submission client validation enforcing non-empty title, valid ID syntax, 5–300s timer bounds, and minimum 2 distinct entries before submission.
* Dedicated session management modal dialog (`AdminManageModal.jsx` / `AdminManageModal.css`) providing state-tailored lifecycle operations across `pending`, `open`, `completed`, and `archived` states.
* Explicit two-step archival confirmation dialog (`Confirm Session Archival`) guarding `ARCHIVE_SESSION` dispatches against accidental clicks; cancellation leaves session untouched.
* Backend persistence hardening: `Session` Mongoose schema explicitly persists `timerDuration` (default 30, min 5, max 300), which survives backend shutdown and is restored during `recoverSessionsFromDb()`.
* Authoritative server-side validation in `server.js` guarding `CREATE_SESSION` with machine-readable `action_error` feedback (`DUPLICATE_SESSION_ID`, `MISSING_TITLE`, `INSUFFICIENT_ENTRIES`, `INVALID_TIMER_DURATION`).
* Formally accepted monotonic lifecycle status update guard in `repository.js` permanently resolving the pre-existing persistence timing race.
* Complete multi-session room isolation (`session:${sessionId}`) verified concurrently (`e2e_feature6_session` vs `e2e_session_b`).
* Protected pure core engine [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) preserved 100% byte-for-byte (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`).

### Feature 6 Verification History & Stage Sign-Offs
The implementation and certification of Feature 6 proceeded systematically:
* **Stage 0 — Architecture & Codebase Audit**: PASS (Identified existing `CREATE_SESSION` architecture, timer persistence gap, UI layout shift gap, and verified `core.js` byte integrity).
* **Stage A — Backend Persistence & Validation Hardening**: PASS (Implemented `timerDuration` persistence in `Session.js`, DB recovery in `persistence.js`, server validation in `server.js`, and monotonic status guard in `repository.js`; 254/254 backend tests passing).
* **Stage A Reconciliation**: PASS (Monotonic repository guard formally reviewed and accepted as beneficial backend hardening).
* **Stage B — Admin Panel UI & Manage Workflow**: PASS (Implemented `AdminSessionModal`, `AdminManageModal`, streamlined cards, archive confirmation; 17 tests in `admin_workflow_spec.js`; 252 frontend tests passing).
* **Stage C — E2E Verification & Integration Testing**: **APPROVE FEATURE 6** (Full real-browser runtime verification with Antigravity subagent: modal creation, custom timer, entry validation, duplicate ID rejection, multi-session isolation, manage workflow, archive confirmation, restart recovery; 0 errors, 0 regressions).
* **Stage D — Technical Documentation & Final Sign-Off**: **APPROVED — FEATURE 6 COMPLETE** (Exhaustive documentation synchronization across all technical documents; 506 tests verified).

### Completed & Verified: Feature 7 (Early Round Completion)

#### Conceptual Round Termination Architecture
```text
                 ┌─────────────────────┐
                 │   Protected Core    │
                 │      core.js        │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │   Round Manager     │
                 │   (roundManager.js) │
                 │ • Round identity    │
                 │ • Participation     │
                 │ • Dynamic quorum    │
                 │ • Idempotent close  │
                 └──────────┬──────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
       Final Valid Vote              Timer Expiry
       (canCompleteEarly)                 │
              │                           │
              └─────────────┬─────────────┘
                            ▼
                     closeRoundOnce
                     (Disarm Timer)
                            │
                            ▼
                     store.dispatch(NEXT)
                            │
                            ▼
                       core.next()
                            │
                            ▼
                 authoritative session_state
```

#### Key Architecture Components & Responsibilities:
1. **Domain Module: `voting-server/src/roundManager.js`**:
   - Manages round identity, participation tracking, dynamic eligibility, and idempotent closure in pure memory.
   - Decoupled from MongoDB and pure core engine.
2. **Monotonic Round Identity**:
   - Round identifier format: `${sessionId}:::r${roundIndex}`.
   - The round index increments monotonically for each session on every pair change.
   - *Why this is essential*: A tournament bracket may re-evaluate the same candidate pair later (e.g. tie-breaker or second-chance bracket). Identifying a round solely by candidate names causes collision hazards; application-level round identity guarantees strict temporal isolation.
3. **Per-Round Voter Participation Accounting**:
   - Submissions are tracked in a round-scoped Set: `submissionsByRound` (`Map<string, Set<string>>` keyed by `${sessionId}:::${roundId}`).
   - Only unique voter session tokens are recorded (`one voter = one participation record per round`).
   - Duplicate submissions by the same voter return `isNew: false` without incrementing participation.
4. **Strict Pre-Participation Validation Pipeline**:
   - In `voting-server/src/server.js`, incoming votes must strictly pass all authorization and domain checks before participation is recorded:
     1. Authenticated voter token existence (`voterToken`).
     2. Valid token scoped to target session (`validateVoterToken`).
     3. Session status is `'open'`.
     4. Valid active pair present (`pairArray.length >= 2`).
     5. Selected candidate is part of active pair (`pairArray.includes(entry)`).
     6. Duplicate vote check (`canCastVote`).
   - Only upon passing all 6 gates is `roundManager.recordRoundSubmission()` executed and the vote forwarded to `store.dispatch(action)`.
5. **Dynamic Voter Eligibility Policy**:
   - Voter eligibility is derived dynamically from `getVoterCount(sessionId)`:
     - **0 eligible voters**: Early completion does NOT occur (zero-voter protection).
     - **1 eligible voter**: Early completion does NOT occur (minimum 2 eligible voters required to prevent single-voter premature advancement).
     - **2+ eligible voters**: Early completion occurs when `submittedCount >= eligibleCount`.
     - **Dynamic Denominator**: If a new voter joins the session while a round is running, the required submission threshold automatically increases to match the new headcount.
6. **Idempotent Round Closure Gate (`closeRoundOnce`)**:
   - Both early completion (final valid vote) and timer expiration converge on `closeRoundOnce({ sessionId, roundId, store, timerManager, io })`.
   - Idempotency guard: checks `closedRounds.has("${sessionId}:::${roundId}")`. If already closed, immediately returns `{ success: false, reason: 'ALREADY_CLOSED' }`.
   - Stale round guard: verifies `activeRound.roundId === roundId`. If mismatched, returns `{ success: false, reason: 'STALE_ROUND' }`.
   - Disarms the active timer via `timerManager.clearTimer(sessionId, io)`.
   - Authoritatively dispatches `{ type: 'NEXT', sessionId }` to the Redux store, delegating tournament progression to `core.next()`.
7. **Timer Integration & Stale Callback Protection**:
   - Active timers bind the current `roundId` into the `setTimeout` closure.
   - If a timer callback executes after early completion has already advanced the round, `handleExpiry` detects that `activeTimer.roundId !== targetRoundId` and passes the stale round ID to `closeRoundOnce` (which returns `STALE_ROUND` or `ALREADY_CLOSED`). The callback is safely disarmed without canceling or advancing the newer round.
8. **Frontend Strict Server Authority**:
   - The React/Redux client (`voting-client`) acts purely as a reactive presentation layer.
   - The frontend never calculates quorum, never counts voters for completion, and never dispatches `NEXT` on timer zero or vote submission.
   - Candidate choice locks (`votesByLockKey`) and temporary error states are keyed to `${sessionId}:::${pair}` and reset automatically upon server pair advancement.
9. **Race-Condition Invariant Guarantees**:
   - **Scenario 1 (Final Vote + Timer Expiry Race)**: Exactly one advancement; the first event closes the round, the second is dropped by the `closedRounds` set guard.
   - **Scenario 2 (Two Final Voters Race)**: Single-threaded event loop processes sequentially; first voter to reach quorum advances, second is dropped by the guard.
   - **Scenario 3 (Stale Timer Callback)**: Round-bound callback detects stale round ID and performs no-op on the active round.
   - **Scenario 4 (Duplicate Vote)**: Blocked at ingress by `canCastVote`; zero participation recorded, zero premature advancement.
10. **Protected Pure Core Engine**:
    - [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) verified 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`, 40 lines).
11. **Feature 8 Boundary Preservation**:
    - Feature 7 strictly answers: **WHEN does voting stop?** (on timer expiry or 100% voter turnout).
    - Feature 8 will answer: **WHAT happens after voting stops?** (dedicated results delay, `ROUND_CLOSED` session state, results reveal screen, transition countdown).
    - Feature 8 is strictly unstarted and excluded from Feature 7.

### Feature 7 Verification History & Stage Sign-Offs
* **Stage 0 — Architecture & Readiness Audit**: PASS (Analyzed round lifecycle, participation tracking, and race condition requirements; verified pure core integrity).
* **Stage A — Backend Implementation**: PASS (Implemented `roundManager.js`, round identity, participation tracking, and `closeRoundOnce`; 25 tests in `early_completion_spec.js`; 279 backend tests passing).
* **Stage B — Socket.io, Vote & Timer Integration**: PASS (Integrated vote validation pipeline in `server.js`, round-bound timer callbacks in `timer.js`, and stale callback disarming; 19 tests in `early_completion_integration_spec.js`; 298 backend tests passing).
* **Stage C — Frontend Synchronization & E2E Behavior**: PASS (Implemented render-time error clearing and action error lock release in `Voting.jsx`, stale timer clearing in `voteSlice.js`; 10 tests in `early_completion_frontend_spec.js`; 262 frontend tests passing).
* **Stage D — Final Reality Verification & Sign-Off**: **FEATURE 7 — PASS** (Independent read-only reality audit across 32 checkpoints; 560 tests passing, 0 defects, 0 regressions, Vite build PASS, ESLint 0 errors / 0 warnings).
* **Stage E — Technical Documentation & Final Sign-Off**: **APPROVED — FEATURE 7 COMPLETE** (Exhaustive documentation synchronization across all technical documents; 560 tests verified).

### Test Baseline Summary
* **Backend Test Suite**: **298 / 298 passing** (clean run across 29 spec files).
* **Frontend Test Suite**: **262 / 262 passing** across 19 spec files.
* **Total Automated Tests**: **560 / 560 passing** across the repository.
* **Code Quality**: `eslint .` returned **0 errors, 0 warnings**.
* **Production Build**: `vite build` completed with **SUCCESS** (built cleanly in 1.36s, 0 errors).
* **Protected Pure Core Engine**: [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) verified 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`, 40 lines).

### Explicitly Deferred Scope & Future Roadmap
* **Resolved: Early Round Termination on 100% Turnout**: Fully implemented and verified in Feature 7 via dynamic voter participation tracking and idempotent `closeRoundOnce` execution.
* **Resolved: Round Results Lifecycle**: Fully implemented and verified in Feature 8 via `ROUND_CLOSED` and `RESULTS_REVEALED` lifecycle phases, frozen `finalVote` snapshots, and authoritative reveal timers.
* **Future Security Hardening** (`NOT STARTED`):
  - Migration of admin JWT and voter tokens from client-side storage to `httpOnly`, `SameSite=Strict`, `Secure` HTTP cookies.

---

## 13. Feature 8 Architecture: Round Results Lifecycle

Feature 8 establishes the complete round conclusion, frozen results reveal, and authoritative advancement lifecycle for VoteSphere pairwise tournaments.

### Core Architectural Purpose & Boundary

The platform draws an explicit architectural boundary between Feature 7 and Feature 8:

| Feature | Core Question | Architectural Responsibility |
|---|---|---|
| **Feature 7** | *When does voting stop?* | Dual-convergence termination: voting stops when either (A) authoritative timer expires OR (B) all currently eligible registered voters submit valid ballots. |
| **Feature 8** | *What happens after voting stops?* | Post-voting lifecycle: decouples voting closure from tournament advancement by inserting intermediate `ROUND_CLOSED` and `RESULTS_REVEALED` phases with frozen `finalVote` display and an authoritative reveal countdown before advancing to `NEXT`. |

### Complete Lifecycle State Machine

```text
               VOTING
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
 Timer Expiry          Final Vote
      │                     │
      └──────────┬──────────┘
                 ▼
            ROUND_CLOSED
                 │
                 │ Freeze finalVote { pair, tally, closedAt }
                 ▼
          RESULTS_REVEALED
                 │
                 │ startRevealTimer()
                 │ (Server-authoritative countdown)
                 ▼
          Reveal Expiration
                 │
                 │ expireReveal() ──▶ store.dispatch(NEXT)
                 ▼
      ┌─────────────────────┐
      ▼                     ▼
    VOTING              COMPLETED
 (Next Round)       (Final Champion)
```

For intermediate tournament rounds:
```text
VOTING → ROUND_CLOSED → RESULTS_REVEALED → NEXT → VOTING
```

For the championship round (final pair):
```text
VOTING → ROUND_CLOSED → RESULTS_REVEALED → NEXT → COMPLETED
```

---

### Key Architectural Modules & Responsibilities

#### 1. Domain Module: `voting-server/src/roundManager.js`
* **`ROUND_LIFECYCLE` Enum**: Object defining `VOTING: 'VOTING'`, `ROUND_CLOSED: 'ROUND_CLOSED'`, `RESULTS_REVEALED: 'RESULTS_REVEALED'`.
* **Monotonic Round Identity**: Formatted as `${sessionId}:::r${roundIndex}`, guaranteeing strict temporal isolation across tournament rounds.
* **Closure Idempotency (`closeRoundOnce`)**:
  - Guards against duplicate round closure via `closedRounds` set.
  - Disarms running voting timers via `timerManager.clearTimer(sessionId)`.
  - Freezes `finalVote` snapshot `{ pair, tally, closedAt }` from the current store state.
  - If `revealDuration > 0` and timerManager is present, transitions round lifecycle to `RESULTS_REVEALED` and calls `timerManager.startRevealTimer()`.
  - Dispatches `SET_ROUND_LIFECYCLE` to the Redux store with lifecycle, round ID, round index, `finalVote`, and `revealTimer`.
  - If `revealDuration === 0`, dispatches `NEXT` immediately (direct advancement fallback).
* **Reveal Duration Resolution (`resolveRevealDuration`)**:
  - Evaluates duration based on strict precedence:
    1. Explicit override duration (clamped to 1–60 seconds).
    2. Environment variable `ROUND_REVEAL_DURATION` (clamped to 1–60 seconds).
    3. `DEFAULT_REVEAL_DURATION` = 1 second (verified baseline; configurable up to 60s).
* **Authoritative Reveal Expiration (`expireReveal`)**:
  - Validates active round match (`active.roundId === cleanRoundId`), rejecting stale callbacks as `STALE_ROUND`.
  - Guarded against duplicate expiration via `active.revealExpired` flag (`ALREADY_EXPIRED`).
  - Disarms reveal timer via `timerManager.clearRevealTimer(sessionId, io)`.
  - Authoritatively dispatches `{ type: 'NEXT', sessionId }` to the Redux store.
* **Vote Ingress Guard (`canAcceptVotes`)**:
  - Returns `false` if active round is marked `closed` or lifecycle is not `VOTING`, rejecting late votes at the server ingress boundary.

#### 2. Timer Domain Module: `voting-server/src/timer.js`
* **Voting Timer vs. Reveal Timer**:
  - **Voting Timer**: Runs during `VOTING` phase (`timer_state.status === 'running'`), timing out when voting duration elapses.
  - **Reveal Timer**: Runs during `RESULTS_REVEALED` phase (`timer_state.status === 'revealing'`), timing out when reveal duration elapses.
* **Timer Exclusivity**:
  - A session can NEVER hold both a voting timer and a reveal timer simultaneously.
  - Closing a round cancels the voting timer before starting the reveal timer.
  - Expiring a reveal timer clears the reveal timer before dispatching `NEXT` (which starts the next round's voting timer).
* **Dedicated Methods**:
  - `startRevealTimer(sessionId, roundId, duration, store, io)`: Computes absolute `expiresAt = startedAt + duration * 1000`, starts `setTimeout`, and broadcasts `timer_state` to room `session:${sessionId}`.
  - `clearRevealTimer(sessionId, io)`: Cancels reveal timeout, removes timer entry, and broadcasts `timer_state: { sessionId, status: 'stopped' }`.
* **Expiry Handler**:
  - Invokes `roundManager.expireReveal({ sessionId, roundId, store, timerManager, io })` upon timeout completion.

#### 3. Redux Store & Reducer: `voting-server/src/reducer.js`
* **`SET_ROUND_LIFECYCLE`**: Updates session map with:
  ```javascript
  session
    .set('roundLifecycle', action.lifecycle)
    .set('roundId', action.roundId)
    .set('roundIndex', action.roundIndex)
    .set('finalVote', fromJS(action.finalVote))
    .set('revealTimer', fromJS(action.revealTimer));
  ```
* **`NEXT` Action Integration**:
  - On tournament progression to the next round, resets `roundLifecycle` to `'VOTING'`, clears `finalVote` to `null`, and clears `revealTimer` to `null`.
  - When tournament concludes (`winner` determined), marks session `status: 'completed'`.

#### 4. Protected Pure Tournament Core: `voting-server/src/core.js`
* Remained **100% untouched and unmodified**.
* Verified SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310` (40 lines).
* Pure voting mathematics and tournament brackets remain isolated from lifecycle orchestration.

---

### Frontend Architecture: Reactive Projection of Server State

The frontend (`voting-client`) acts purely as a reactive projection of authoritative server state:

```text
Redux Store: state.sessions.bySessionId[sessionId]
  ├── roundLifecycle: 'VOTING' | 'ROUND_CLOSED' | 'RESULTS_REVEALED'
  ├── roundId: string
  ├── roundIndex: number
  ├── finalVote: { pair, tally, closedAt } | null
  ├── revealTimer: { duration, startedAt, expiresAt, status } | null
  └── timer: { duration, startedAt, expiresAt, status } | null
```

#### Component Presentation Across Lifecycle Phases

| Phase | `Voting.jsx` / `VoteCard.jsx` | `CountdownTimer.jsx` | `ResultsChart.jsx` |
|---|---|---|---|
| **`VOTING`** | Active pair buttons enabled. Contender cards interactive. | Voting countdown visible (`status: 'running'`). | Tallies hidden. Guarded placeholder rendered. |
| **`ROUND_CLOSED`** | Buttons disabled. "Round Closed" badge displayed. | Voting countdown halted. | Transition placeholder rendered. |
| **`RESULTS_REVEALED`** | Buttons disabled. "Results Revealed" banner rendered. Contenders show frozen votes. | Reveal countdown visible (`status: 'revealing'`, accent styling). | Authoritative frozen tally rendered from `finalVote`. |
| **`NEXT` (New Round)** | Buttons re-enabled for new pair. Previous result cleared. | New voting timer countdown running. | Tallies hidden for new matchup. |
| **`COMPLETED`** | Tournament complete screen. Decisive champion crowned. | Timer disarmed and hidden. | Final podium and historical stats displayed. |

#### Absolute Server Authority Guarantee
* The frontend `CountdownTimer` is purely cosmetic.
* When the local reveal countdown reaches `00:00`, the UI displays `00:00` and waits.
* The frontend **never dispatches `NEXT`** and **never advances the tournament locally**. Round advancement is driven solely by the server via `expireReveal()`.

---

### Frozen Results Contract (`finalVote`)

During `RESULTS_REVEALED`, the UI must display stable, uncorrupted outcomes. Because the live `vote` object in the Redux store may be mutated or zeroed during state transitions, the server captures an immutable snapshot upon round closure:

```json
{
  "pair": ["Trainspotting", "Shallow Grave"],
  "tally": {
    "Trainspotting": 4,
    "Shallow Grave": 2
  },
  "closedAt": 1789454396000
}
```

* Rendered by `ResultsChart` and `VoteCard` whenever `roundLifecycle === 'RESULTS_REVEALED'`.
* Preserved consistently until the server authoritatively advances to the next round.

---

### Closed-Round Vote Rejection Contract

When a voter attempts to submit a ballot after voting has concluded (during `ROUND_CLOSED` or `RESULTS_REVEALED`):
1. The server checks `roundManager.canAcceptVotes(sessionId)`.
2. The action is rejected before dispatching to the store, and an `action_error` is returned:
   ```json
   {
     "action": "VOTE",
     "error": "ROUND_CLOSED",
     "message": "Round is closed for voting"
   }
   ```
3. The frontend catches `action_error`, renders a graceful non-blocking alert, and leaves the frozen tally and lifecycle completely unmodified.

---

### Reconnect & Hydration Resilience

* **Reconnect During Reveal**:
  - Reconnecting client sends `subscribe_session`.
  - Server immediately unicasts `session_state` (with `roundLifecycle: 'RESULTS_REVEALED'`, `finalVote`, `roundId`) and `timer_state` (`status: 'revealing'`, original `expiresAt`).
  - Client hydrates into the active reveal window and computes remaining time as `Math.max(0, expiresAt - Date.now())`.
  - The reveal timer is **never restarted** on reconnect.
* **Reconnect After Reveal**:
  - Reconnecting client hydrates directly into `VOTING` for the new round (or `COMPLETED` if tournament finished).
* **State Monotonicity**:
  - Client state updates check `roundIndex(newer) > roundIndex(older)`, ignoring stale socket events from older rounds.

---

### Race-Condition Safeguards

1. **Final Vote + Timer Expiration Convergence**:
   - Both triggers pass through `closeRoundOnce`.
   - The first trigger to execute adds the composite key `${sessionId}:::${roundId}` to `closedRounds` and disarms the timer.
   - The second trigger detects `ALREADY_CLOSED` and terminates cleanly without duplicate advancement.
2. **Multiple Simultaneous Final Voters**:
   - Sequential processing on the single-threaded Node.js event loop ensures exactly one voter satisfies the completion check.
   - Subsequent votes are rejected by `canAcceptVotes()` with `ROUND_CLOSED`.
3. **Duplicate Reveal Expiration**:
   - `expireReveal` verifies `active.revealExpired`. Once set to `true`, repeated calls return `{ success: false, reason: 'ALREADY_EXPIRED' }`.
4. **Stale Timer Callbacks**:
   - Reveal timer callbacks bind `expectedRoundId`.
   - If the callback fires after the round has advanced, `active.roundId !== cleanRoundId` returns `{ success: false, reason: 'STALE_ROUND' }`.
5. **Multi-Session Isolation**:
   - State maps, timers, and Socket.io rooms are partitioned strictly by `sessionId`. Session A's reveal timer has zero effect on Session B.

---

### Persistence & Restart Semantics

* **Transient In-Memory Lifecycle**:
  - The reveal lifecycle (`ROUND_CLOSED`, `RESULTS_REVEALED`, reveal timer) is intentionally ephemeral and transient.
  - It is not stored in MongoDB.
* **Server Restart Behavior**:
  - In accordance with the Feature 4 persistence recovery contract, open sessions interrupted by server shutdown are recovered into `pending` status.
  - Completed sessions remain `completed` with their persisted winner.
  - The application never resurrects stale, expired reveal timers after reboot.

---

### Feature 8 Verification History & Stage Sign-Offs

* **Stage 0 — Architecture & Codebase Audit**: PASS (Decoupled Feature 7 from Feature 8; verified pure engine byte integrity).
* **Stage A — Backend Implementation**: PASS (Implemented `roundManager.js` lifecycle enum, frozen `finalVote`, `SET_ROUND_LIFECYCLE` reducer, and `expireReveal`; 24 tests in `round_lifecycle_spec.js`; 322 backend tests passing).
* **Stage B — Reveal Timer & Socket Hardening**: PASS (Implemented `startRevealTimer()`, `timer_state` broadcast with `status: 'revealing'`, timer exclusivity, and reconnect hydration; 16 tests in `reveal_timer_socket_hardening_spec.js`; 338 backend tests passing).
* **Stage C — Frontend Round Results Lifecycle**: PASS (Implemented Redux state model, `Voting.jsx` and `Results.jsx` reveal presentation, `VoteCard` frozen tallies, and zero client `NEXT` dispatching; 18 tests in `round_results_lifecycle_spec.js`; 280 frontend tests passing).
* **Stage D — Integration, E2E & Race-Condition Verification**: **FEATURE 8 — PASS** (10/10 live checks passed covering end-to-end flow, frozen result stability, client non-advancement, races, reconnect hydration, multi-session isolation, and final round completion; 618 total automated tests passing, 0 defects, exact `core.js` SHA-256 match).
* **Stage E — Technical Documentation & Final Sign-Off**: **APPROVED — FEATURE 8 COMPLETE** (Synchronized technical documentation across `ARCHITECTURE.md`, `API_CONTRACT.md`, `PROJECT_PROGRESS.md`, `CHANGELOG.md`, and `README.md`).

### Test Baseline Summary
* **Backend Test Suite**: **338 / 338 passing** (clean run across 31 spec files).
* **Frontend Test Suite**: **280 / 280 passing** across 98 suites (20 spec files).
* **Total Automated Tests**: **618 / 618 passing** across full-stack repository.
* **Code Quality**: `eslint .` returned **0 errors, 0 warnings**.
* **Production Build**: `vite build` completed with **SUCCESS** (built cleanly in 1.31s, 0 errors).
* **Protected Pure Core Engine**: [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) verified 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`, 40 lines).


