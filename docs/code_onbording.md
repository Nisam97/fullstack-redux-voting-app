# Codebase Orientation Map

## 1-Line Summary
VoteSphere is a full-stack real-time pairwise tournament voting platform comprising an authoritative Node.js Redux/Socket.io backend server ([voting-server/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server)) backed by MongoDB persistence and server-authoritative timer/lifecycle managers, paired with a reactive React 19 single-page application ([voting-client/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client)) built with Redux Toolkit, Socket.io client, and React Router 7.

---

## 5-Minute Explanation
- **Primary tasks in code**:
  - **Authoritative Tournament & Session Management**: Manages multi-session pairwise tournament trees immutably in memory via Redux and pure functions in [core.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) and [reducer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/reducer.js).
  - **Hybrid Dual-Protocol Networking**: Runs a native Node HTTP REST API for admin login, session discovery, waiting room/lobby queries, and historical results alongside a Socket.io WebSocket server on port `8090` for real-time room-scoped event dispatching ([server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js)).
  - **Server-Authoritative Round Lifecycle & Timers**: Tracks monotonic round IDs (`${sessionId}:::r${roundIndex}`), executes non-blocking countdown timers ([timer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/timer.js)), enables early round completion when 100% of registered voters participate ([roundManager.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/roundManager.js)), and enforces reveal windows before auto-advancing rounds.
  - **Authentication & Role Separation**: Protects administrative actions (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`) using bcrypt-hashed admin credentials and JWT tokens ([admin.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/admin.js)); protects voting actions via anonymous session-scoped voter tokens, seat tracking, and duplicate vote rejection ([voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js)).
  - **MongoDB Persistence Layer**: Automatically snapshots session states, updates lifecycle status, and writes immutable tournament results to MongoDB asynchronously without blocking the in-memory Redux dispatch cycle ([persistence.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/persistence.js)).
  - **Client-Side Reactive UI**: Connects to the backend via WebSocket, manages state in Redux Toolkit slices ([voteSlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/voteSlice.js), [historySlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/historySlice.js)), prevents echo loops via middleware, and renders landing, lobby, voting arena, three-phase results, admin dashboard, and history archive pages.
- **Primary inputs**:
  - **HTTP REST Requests**: `POST /api/admin/login`, `GET /api/auth/me`, `POST /api/sessions/:sessionId/join`, `GET /api/sessions`, `GET /api/sessions/:sessionId/lobby`, `GET /api/sessions/history`, `GET /api/sessions/:sessionId/result`.
  - **WebSocket Events**: Client-to-server events `action` (carrying `{ type, sessionId, voterToken, ... }`), `subscribe_session`, `unsubscribe_session`, `admin_login`, `join_session`, `sessions`.
  - **Filesystem Seed Data**: [voting-server/entries.json](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/entries.json) (11 Danny Boyle movie titles loaded during initial bootstrap).
  - **User Interactions**: Form submissions, voter display name inputs, candidate button clicks in the arena, navigation link clicks, and admin control buttons.
- **Primary outputs**:
  - **HTTP Responses**: JSON authentication tokens, session summaries, lobby headcounts, and completed tournament records.
  - **WebSocket Broadcasts**: `'sessions'` (global registry summary), `'session_state'` (room-scoped full state to `session:${sessionId}`), `'timer_state'` (countdown duration and expiry timestamps), `'lobby_update'` (live voter headcount), and `'action_error'` (validation and authorization rejections).
  - **Database Records**: Mongoose documents in MongoDB collections `sessions` and `results`.
  - **Rendered DOM Elements**: Marketing landing page ([Home.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Home.jsx)), session directory ([SessionList.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/SessionList.jsx)), waiting room ([Lobby.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Lobby.jsx)), voting arena ([Voting.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Voting.jsx)), live results with animated bars and reveal timers ([Results.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Results.jsx)), administrative cockpit ([Admin.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Admin.jsx)), and historical results ([History.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/History.jsx)).
- **Key files**:
  - [voting-server/index.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/index.js): Backend startup script; establishes MongoDB connection, initializes Redux store, recovers persisted sessions, seeds defaults, and starts server on port 8090.
  - [voting-server/src/server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js): Dual HTTP + Socket.io server; handles REST routes, socket authentication, room isolation, action validation, and store subscription broadcasts.
  - [voting-server/src/core.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js): Pure pairwise tournament engine (`setEntries`, `next`, `vote`, `getWinners`) operating strictly on immutable data structures.
  - [voting-server/src/reducer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/reducer.js): Root reducer managing `Map({ sessions: Map() })` state tree and delegating pairwise logic to `core.js`.
  - [voting-server/src/timer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/timer.js): In-memory server-authoritative countdown timer manager dispatching `NEXT` on expiry and coordinating with `roundManager`.
  - [voting-server/src/roundManager.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/roundManager.js): Domain module tracking round identities, voter participation accounting, reveal window delays, and idempotent early completion.
  - [voting-server/src/auth/admin.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/admin.js): Global admin credentials management, bcrypt verification, and JWT generation/verification.
  - [voting-server/src/auth/voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js): Session-scoped voter registration, token validation, duplicate vote protection, and session headcount tracking.
  - [voting-server/src/db/persistence.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/persistence.js): Asynchronous store subscriber bridge synchronizing Redux state changes to MongoDB repositories.
  - [voting-client/src/main.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/main.jsx): Frontend React DOM entry point mounting `<AppRoutes />` within Redux `<Provider>`.
  - [voting-client/src/routes/AppRoutes.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AppRoutes.jsx): Client route map containing public, session, administrative, and legacy redirect routes.
  - [voting-client/src/routes/AdminGuard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AdminGuard.jsx): Route guard checking admin authentication status before allowing access to `/admin`.
  - [voting-client/src/redux/store.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/store.js): Client Redux store setup with echo-prevention remote action middleware.
  - [voting-client/src/redux/voteSlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/voteSlice.js): Normalized multi-session slice managing session lists, details, timer states, and lock keys.
  - [voting-client/src/services/socket.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/socket.js): Socket.io client singleton with connection handling, subscription registry, and store dispatch bridge.
  - [voting-client/src/components/CountdownTimer.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/CountdownTimer.jsx): Reusable timer component consuming authoritative `expiresAt` timestamps.
- **Main code paths**:
  - **Server Startup & Recovery Path**: [index.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/index.js) connects Mongoose -> `makeStore()` -> `recoverSessionsFromDb(store)` -> `bootstrapDefaultSession(store)` and `bootstrapHorrorSession(store)` -> `persistSeedSessions(store)` -> `startServer(store, PORT)`.
  - **Voter Join & Lobby Path**: Voter visits `/sessions/:id/lobby` -> submits name -> [auth.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/auth.js) posts to `POST /api/sessions/:id/join` -> [server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js) calls `registerVoter()` in [voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js) -> stores session-scoped token in cookie and storage -> emits `'lobby_update'` to room `session:${id}` -> updates headcount across all lobby clients.
  - **Voting Action & Early Completion Path**: Voter clicks candidate on [Voting.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Voting.jsx) -> dispatches `vote(sessionId, entry, voterToken)` -> sent via WebSocket `action` -> [server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js) verifies token and checks duplicate via `canCastVote()` -> records vote in [voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js) -> records round participation in [roundManager.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/roundManager.js) -> dispatches to Redux store -> [reducer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/reducer.js) delegates to `core.vote()` -> if all eligible voters have voted, `canCompleteEarly()` triggers `closeRoundOnce()` -> starts reveal countdown -> advances round on reveal expiry.
  - **Admin Workflow Path**: Admin logs in at `/login` -> [auth.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/auth.js) posts to `POST /api/admin/login` -> receives JWT -> navigates to `/admin` ([AdminGuard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AdminGuard.jsx)) -> dispatches `START_SESSION` or `NEXT` -> intercepted by middleware -> emits `action` with JWT -> [server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js) validates token via `verifyAdminToken()` -> dispatches to server Redux store -> updates state -> [persistence.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/persistence.js) syncs status to MongoDB.

---

## Deep Dive
- **Type**: Full-stack multi-session tournament application (monorepo directory structure housing backend server, frontend client, automated test suites, and documentation).
- **Primary runtime(s)**:
  - **Backend**: Node.js (v20+ / v24) executing ES modules via Babel 7 (`@babel/register`), connecting to MongoDB via Mongoose.
  - **Frontend**: Node.js build runtime (Vite 8), Modern Browser execution runtime (React 19, Redux Toolkit, React Router 7, Socket.io client).
- **Entry points**:
  - [voting-server/index.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/index.js): Backend startup script; coordinates MongoDB connection, session recovery, seed initialization, and HTTP/WebSocket listener on port 8090.
  - [voting-server/src/server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js): Server factory exporting `startServer(store, port)`.
  - [voting-client/src/main.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/main.jsx): Frontend browser entry point; mounts React root with `<Provider>` and `<AppRoutes />`.
  - [voting-client/src/routes/AppRoutes.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AppRoutes.jsx): Primary router declaring route mapping and redirects.
  - [voting-client/index.html](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/index.html): HTML page shell loaded by Vite.

---

## Top-Level Structure

| Path | Purpose | Notes |
|---|---|---|
| [voting-server/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server) | Backend server application | Authoritative Redux store, pure tournament core, multi-session reducer, timer manager, round lifecycle manager, auth, MongoDB persistence, and Mocha test suites |
| [voting-server/src/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src) | Server source code | Modules: `core.js`, `reducer.js`, `store.js`, `server.js`, `timer.js`, `roundManager.js`, `bootstrap.js` |
| [voting-server/src/auth/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth) | Server authentication modules | `admin.js` (bcrypt, JWT admin authentication), `voter.js` (session tokens, duplicate vote prevention), `config.js` |
| [voting-server/src/db/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db) | Database persistence layer | `connection.js` (Mongoose setup), `repository.js` (queries & mutations), `persistence.js` (Redux subscriber sync), `models/` |
| [voting-server/src/db/models/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/models) | Mongoose data models | `Session.js` (session definition & lifecycle), `Result.js` (immutable tournament completion record) |
| [voting-server/test/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test) | Server automated test suites | 25 test files executed via Mocha/Chai using `runner.cjs` |
| [voting-client/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client) | Frontend client application | React 19 single-page application built with Vite, Redux Toolkit, React Router 7, and Lucide icons |
| [voting-client/src/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src) | Client source code | Contains components, pages, routes, Redux slices, network services, styles, and utilities |
| [voting-client/src/pages/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages) | Route page components | `Home.jsx`, `SessionList.jsx`, `Lobby.jsx`, `Voting.jsx`, `Results.jsx`, `Admin.jsx`, `History.jsx`, `Login.jsx`, `Register.jsx`, `NotFound.jsx`, `ElectionList.jsx`, `Dashboard.jsx` |
| [voting-client/src/components/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components) | UI components | Subdivided into `dashboard/`, `home/`, `layout/` (`Navbar.jsx`, `Footer.jsx`), `results/` (`ResultCard.jsx`, `ResultsChart.jsx`, `resultsUtils.js`), `voting/` (`VoteCard.jsx`), and `CountdownTimer.jsx` |
| [voting-client/src/redux/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux) | Client Redux state store | `store.js` (RTK configureStore + echo prevention middleware), `voteSlice.js` (normalized session state), `historySlice.js` |
| [voting-client/src/routes/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes) | Client routing hierarchy | `AppRoutes.jsx`, `AdminGuard.jsx` (route protection), `LegacyRedirects.jsx` (legacy backwards compatibility) |
| [voting-client/src/services/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services) | Client network services | `socket.js` (Socket.io client singleton), `auth.js` (REST auth helper & storage), `history.js` (REST client for history) |
| [voting-client/src/utils/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/utils) | Pure utility helpers | `timerUtils.js` (drift-free remaining time calculation, formatting, urgency states) |
| [voting-client/test/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/test) | Client automated test suites | 20 test files covering components, Redux slices, socket integration, lifecycle transitions, and end-to-end flows |
| [docs/](file:///d:/Mine_project/fullstack-redux-voting-app/docs) | Project documentation & specifications | `code_onbording.md`, `ARCHITECTURE.md`, `API_CONTRACT.md`, `CHANGELOG.md`, `PROJECT_PROGRESS.md`, `PROJECT_ANALYSIS.md` |
| [.agents/](file:///d:/Mine_project/fullstack-redux-voting-app/.agents) | Agent skills configuration | Operational specifications and skill definitions for paired AI pair programmers |

---

## Key Boundaries

- **Presentation**:
  - React Mounting Root: [voting-client/src/main.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/main.jsx) mounting `<Provider store={store}><AppRoutes /></Provider>`.
  - Route Hierarchy: [voting-client/src/routes/AppRoutes.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AppRoutes.jsx):
    - Public: `/` ([Home.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Home.jsx)), `/sessions` ([SessionList.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/SessionList.jsx)), `/history` ([History.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/History.jsx)), `/login` ([Login.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Login.jsx)), `/register` ([Register.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Register.jsx)).
    - Session Participation: `/sessions/:id/lobby` ([Lobby.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Lobby.jsx)), `/sessions/:id/vote` ([Voting.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Voting.jsx)), `/sessions/:id/results` ([Results.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Results.jsx)).
    - Protected: `/admin` ([Admin.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Admin.jsx) wrapped with [AdminGuard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AdminGuard.jsx)).
    - Redirects: `/dashboard` redirects to `/admin`; legacy routes (`/vote`, `/results`, `/elections`, `/elections/:id/*`) map through [LegacyRedirects.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/LegacyRedirects.jsx).
  - Presentation Components: [CountdownTimer.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/CountdownTimer.jsx), [ResultCard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/results/ResultCard.jsx), [ResultsChart.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/results/ResultsChart.jsx), [VoteCard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/voting/VoteCard.jsx).
- **Application/Domain Logic**:
  - Pure Pairwise Tournament Engine: [voting-server/src/core.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) contains immutable pairwise mathematics (`setEntries`, `next`, `vote`, `getWinners`).
  - Authoritative Root Reducer: [voting-server/src/reducer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/reducer.js) maintains `sessions` map and processes actions (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`, `VOTE`).
  - Round Lifecycle & Participation Engine: [voting-server/src/roundManager.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/roundManager.js) governs round identities (`${sessionId}:::r${roundIndex}`), tracks participation submissions, enforces zero-voter protection, and triggers idempotent round completion (`closeRoundOnce`).
  - Timer Engine: [voting-server/src/timer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/timer.js) maintains server countdown timers per session, emits `timer_state` events, and dispatches `NEXT` on expiry.
  - Client Normalized Redux State: [voting-client/src/redux/voteSlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/voteSlice.js) maintains normalized registry `list`, `byElectionId`, active session tracking, timer state, and pair locking; [voting-client/src/redux/historySlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/historySlice.js) manages completed tournament records.
- **Persistence/External I/O**:
  - MongoDB Mongoose Connection: [voting-server/src/db/connection.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/connection.js) connects to `mongodb://localhost:27017/votesphere_dev` (or `MONGODB_URI`).
  - Database Repositories: [voting-server/src/db/repository.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/repository.js) queries and mutates `Session` and `Result` models.
  - Asynchronous Persistence Synchronization: [voting-server/src/db/persistence.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/persistence.js) subscribes to store state diffs in `server.js` and persists session lifecycle changes and final results fire-and-forget.
  - Startup Recovery: [voting-server/src/db/persistence.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/persistence.js) implements `recoverSessionsFromDb()` to reload non-archived sessions into the Redux store upon server restart.
- **Cross-Cutting Concerns**:
  - **Authentication & Authorization**:
    - Admin: [voting-server/src/auth/admin.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/admin.js) seeds a single admin from environment variables, verifies passwords via bcrypt, and issues JWT tokens. `ADMIN_ACTION_TYPES` (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`) are rejected in `server.js` without a valid token.
    - Voter: [voting-server/src/auth/voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js) issues cryptographically secure session-scoped tokens via `POST /api/sessions/:sessionId/join` or WebSocket `join_session`. Tracks active session seat counts (`getVoterCount`) and enforces duplicate vote prevention (`canCastVote`).
  - **Room Isolation**: Broadcasts in [voting-server/src/server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js) target `io.to('session:' + sessionId)`. Sockets subscribed to one session do not receive packets from other sessions.
  - **Echo-Loop Prevention**: Client middleware [voting-client/src/redux/store.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/store.js) filters `LOCAL_ACTION_TYPES`, ensuring inbound server state events (`sessions`, `session_state`, `timer_state`, `lobby_update`) are never echoed back over the WebSocket.
  - **Three-Phase Results Visibility**: [voting-client/src/pages/Results.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Results.jsx) and [resultsUtils.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/results/resultsUtils.js) hide live tallies during active voting, revealing them only during the authoritative reveal delay (`ROUND_CLOSED` / `RESULTS_REVEALED`) and displaying the champion upon conclusion.

---

## Responsibilities by File/Module

| File / Path | Primary Responsibility in Current Codebase |
|---|---|
| [voting-server/index.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/index.js) | Server boot coordinator: connects MongoDB, creates Redux store, recovers sessions, seeds tournaments, and starts server |
| [voting-server/src/core.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) | Protected pure tournament math engine (`setEntries`, `next`, `vote`, `getWinners`) |
| [voting-server/src/reducer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/reducer.js) | Multi-session root reducer managing `Map({ sessions: Map() })` state transitions |
| [voting-server/src/store.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/store.js) | Redux store factory creating the authoritative server store |
| [voting-server/src/server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js) | HTTP REST API endpoints, Socket.io gateway, room routing, action ingress validation, and state subscriber |
| [voting-server/src/timer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/timer.js) | Server-authoritative countdown timer manager handling timer lifecycles, broadcasts, and next-round dispatches |
| [voting-server/src/roundManager.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/roundManager.js) | Domain module managing round IDs, voter participation tracking, reveal windows, and idempotent early completion |
| [voting-server/src/auth/admin.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/admin.js) | Admin authentication service: bcrypt password hashing, credential verification, and JWT generation/validation |
| [voting-server/src/auth/voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js) | Voter authentication service: session-scoped token registration, duplicate vote prevention, and headcount tracking |
| [voting-server/src/auth/config.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/config.js) | Environment configuration loader for admin credentials and JWT secrets |
| [voting-server/src/db/connection.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/connection.js) | MongoDB Mongoose connection manager |
| [voting-server/src/db/models/Session.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/models/Session.js) | Mongoose schema and model for tournament sessions |
| [voting-server/src/db/models/Result.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/models/Result.js) | Mongoose schema and model for completed tournament outcomes |
| [voting-server/src/db/repository.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/repository.js) | Data access layer for session and result database queries |
| [voting-server/src/db/persistence.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/persistence.js) | Synchronization bridge persisting Redux state diffs to MongoDB and recovering sessions at boot |
| [voting-server/src/bootstrap.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/bootstrap.js) | Initial dataset loader seeding `elec_default` and `elec_horror` sessions |
| [voting-server/entries.json](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/entries.json) | Static dataset of 11 Danny Boyle films |
| [voting-client/src/main.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/main.jsx) | Client React DOM mounting root |
| [voting-client/src/routes/AppRoutes.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AppRoutes.jsx) | Client React Router 7 route declaration mapping paths to components |
| [voting-client/src/routes/AdminGuard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AdminGuard.jsx) | Route protection component ensuring only authenticated admins access `/admin` |
| [voting-client/src/routes/LegacyRedirects.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/LegacyRedirects.jsx) | Redirect components preserving compatibility for legacy routes (`/vote`, `/results`, etc.) |
| [voting-client/src/redux/store.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/store.js) | Client Redux store setup with echo-loop prevention middleware |
| [voting-client/src/redux/voteSlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/voteSlice.js) | Client Redux slice for session registry, session state, timers, and lock keys |
| [voting-client/src/redux/historySlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/historySlice.js) | Client Redux slice for completed historical tournament records |
| [voting-client/src/services/socket.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/socket.js) | Socket.io client singleton, room subscription manager, and store dispatcher |
| [voting-client/src/services/auth.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/auth.js) | Client authentication service handling admin login/logout, voter join, and token storage |
| [voting-client/src/services/history.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/history.js) | HTTP REST client fetching tournament history and completed session results |
| [voting-client/src/utils/timerUtils.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/utils/timerUtils.js) | Pure utility functions calculating drift-free countdowns, formatting, and urgency thresholds |
| [voting-client/src/components/CountdownTimer.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/CountdownTimer.jsx) | Visual countdown timer component calculating remaining time from server `expiresAt` |
| [voting-client/src/components/results/ResultCard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/results/ResultCard.jsx) | Candidate result card rendering vote counts, percentages, and progress bars |
| [voting-client/src/components/results/ResultsChart.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/results/ResultsChart.jsx) | Visual bar chart comparing candidate vote distributions |
| [voting-client/src/components/results/resultsUtils.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/results/resultsUtils.js) | Guarding helper enforcing three-state results visibility rules |
| [voting-client/src/components/voting/VoteCard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/voting/VoteCard.jsx) | Pairwise voting candidate card with vote button and locked state styling |
| [voting-client/src/pages/Home.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Home.jsx) | Modern marketing landing page |
| [voting-client/src/pages/SessionList.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/SessionList.jsx) | Directory page displaying active sessions, status badges, and join links |
| [voting-client/src/pages/Lobby.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Lobby.jsx) | Waiting room page with voter name registration and real-time voter headcount |
| [voting-client/src/pages/Voting.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Voting.jsx) | Pairwise voting arena managing voter token verification, pair locking, and voting actions |
| [voting-client/src/pages/Results.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Results.jsx) | Results page implementing three-state visibility guarding, reveal countdown, and historical fallback |
| [voting-client/src/pages/Admin.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Admin.jsx) | Administrative control room for tournament creation, start, advancement, and archiving |
| [voting-client/src/pages/History.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/History.jsx) | Historical archive displaying past completed tournaments |
| [voting-client/src/pages/Login.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Login.jsx) | Admin login portal form |
| [voting-client/src/pages/Register.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Register.jsx) | Admin registration guidance page |
| [voting-client/src/pages/NotFound.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/NotFound.jsx) | 404 error fallback view |

---

## Detailed Code Flows

### 1. Server Boot & Database Recovery Sequence
1. Runtime executes `node -r @babel/register index.js` in [voting-server/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server).
2. [index.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/index.js) executes `connectMongo(MONGODB_URI)` in [connection.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/connection.js).
3. Calls `makeStore()` in [store.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/store.js), creating the server Redux store with `INITIAL_STATE = fromJS({ sessions: {} })`.
4. Calls `recoverSessionsFromDb(store)` in [persistence.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/persistence.js):
   - Resets any previously `'open'` sessions in MongoDB to `'pending'` via `resetOpenSessionsToPending()`.
   - Retrieves active sessions via `getActiveSessions()` and dispatches `CREATE_SESSION` actions to repopulate the Redux state tree.
5. Invokes `bootstrapDefaultSession(store)` and `bootstrapHorrorSession(store)` in [bootstrap.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/bootstrap.js) (skips seeding if already recovered from the database).
6. Calls `persistSeedSessions(store, ...)` to ensure default sessions are stored in MongoDB.
7. Calls `startServer(store, PORT)` in [server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js):
   - Calls `seedAdmin()` in [admin.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/admin.js) to initialize administrator credentials from environment variables.
   - Binds native HTTP server and Socket.io server to port 8090.
   - Attaches `actualStore.subscribe()` listener to trigger room-scoped broadcasts, MongoDB updates via `persistStateChanges()`, and timer state synchronizations via `timerManager.onStateChange()`.

### 2. Voter Registration & Lobby Headcount Flow
1. User navigates to `/sessions/:id/lobby` in the browser.
2. [Lobby.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Lobby.jsx) checks for an existing session voter token via `getVoterToken(sessionId)` in [auth.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/auth.js).
3. If no token exists, the user enters their display name and clicks "Join Session":
   - Calls `joinVoterSession({ sessionId, displayName })` in [auth.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/auth.js).
   - Posts to `POST /api/sessions/:sessionId/join`.
4. Server [server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js) receives the request and calls `registerVoter()` in [voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js):
   - Generates a cryptographically random token via `crypto.randomBytes(24).toString('hex')`.
   - Records the token and increments the session headcount in `tokensBySession`.
   - Unicasts response with `voterToken`, `displayName`, and `voterCount`, and sets `Set-Cookie`.
   - Broadcasts `'lobby_update'` with new headcount to room `session:${sessionId}` and emits updated `'sessions'` summary to all sockets.
5. Client stores the voter token in `sessionStorage` / `localStorage` and transitions into the ready-to-vote state.

### 3. Pairwise Voting, Lock Enforcement & Early Completion Flow
1. User enters `/sessions/:id/vote` ([Voting.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Voting.jsx)).
2. If no voter token is found, user is redirected to `/sessions/:id/lobby`.
3. Component calls `subscribeSession(sessionId)` in [socket.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/socket.js):
   - Emits `'subscribe_session'` to the server.
   - Server joins the socket to room `session:${sessionId}` and returns initial `'session_state'` and `'timer_state'`.
4. The client selects the active pair (e.g. `['Trainspotting', '28 Days Later']`) and active timer from Redux.
5. User clicks "Vote" for candidate `"Trainspotting"`:
   - Client checks local pair-lock key `${sessionId}:::${pair[0]}:::${pair[1]}` in [voteSlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/voteSlice.js) and sets local vote lock.
   - Dispatches `vote(sessionId, 'Trainspotting')`.
   - Remote action middleware in [store.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/store.js) attaches `voterToken` from [auth.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/auth.js) and emits WebSocket event `action: { type: 'VOTE', sessionId, entry: 'Trainspotting', voterToken }`.
6. Server receives `action` in [server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js):
   - Validates `voterToken` against [voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js).
   - Verifies session is `'open'` and candidate is in the active pair.
   - Verifies round is not closed or in reveal mode via [roundManager.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/roundManager.js).
   - Checks `canCastVote()` in [voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js) to prevent duplicate votes per pair.
   - Calls `recordVote()` and records participation in [roundManager.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/roundManager.js) via `recordRoundSubmission()`.
   - Dispatches `{ type: 'VOTE', ... }` to the server Redux store -> [reducer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/reducer.js) -> `core.vote()`.
   - Checks `canCompleteEarly()`: if all registered voters in the session have cast their vote, triggers `closeRoundOnce()` immediately:
     - Cancels active round countdown timer.
     - Sets round lifecycle to `'RESULTS_REVEALED'`.
     - Starts the reveal timer (default 1s, configurable up to 60s).
     - Broadcasts `'timer_state'` with status `'revealing'` to room `session:${sessionId}`.
     - When the reveal timer expires, automatically advances the round via `actualStore.dispatch({ type: 'NEXT', sessionId })`.

### 4. Admin Tournament Orchestration Flow
1. Administrator accesses `/login` and provides credentials.
2. [Login.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Login.jsx) calls `loginAdmin()` in [auth.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/auth.js) -> `POST /api/admin/login`.
3. Server validates credentials with bcrypt via `verifyAdminCredentials()` and returns a signed JWT.
4. Client stores the JWT in `localStorage` and redirects to `/admin`.
5. [AdminGuard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AdminGuard.jsx) verifies token presence; [Admin.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Admin.jsx) renders the tournament management console.
6. Admin clicks "Start Tournament":
   - Dispatches `{ type: 'START_SESSION', sessionId }`.
   - Middleware attaches `adminToken` and transmits the action over WebSocket.
   - Server validates token via `verifyAdminToken()`; if valid, forwards action to the server Redux store.
   - Redux reducer updates session status to `'open'` and invokes `core.next()` to establish the initial pair.
   - Server store subscriber triggers:
     - Emits updated `'session_state'` to `session:${sessionId}`.
     - Calls `timerManager.onStateChange()`, which starts a new server countdown timer and emits `'timer_state'`.
     - Calls `persistStateChanges()`, which updates session status to `'open'` in MongoDB via `repository.markSessionOpen()`.

---

## How the Pieces Map Together

```text
               ┌────────────────────────────────────────────────────────┐
               │                     Browser URL                        │
               │   /sessions/:id/lobby | /vote | /results | /admin      │
               └───────────────────────────┬────────────────────────────┘
                                           │
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │             React Application Pages & Guards           │
               │   - AdminGuard.jsx: validates admin JWT                │
               │   - Lobby.jsx: voter registration & headcount sync     │
               │   - Voting.jsx: candidate cards & pair-scoped locking   │
               │   - Results.jsx: 3-phase visibility & reveal countdown │
               │   - Admin.jsx: tournament creation & control cockpit   │
               └──────────────┬───────────────────────────▲─────────────┘
                              │ Dispatches                │ Selects
                              │ actions                   │ state
                              ▼                           │
               ┌───────────────────────────┐ ┌────────────┴─────────────┐
               │ Remote Action Middleware  │ │    Normalized Redux Store│
               │ - Filters local echoes    │ │   - voteSlice (sessions) │
               │ - Attaches auth tokens    │ │   - historySlice         │
               └──────────────┬────────────┘ └────────────▲─────────────┘
                              │ socket.emit               │ Dispatches
                              │ ('action')                │ incoming events
                              ▼                           │
               ┌──────────────────────────────────────────┴─────────────┐
               │           Client Socket & Network Services             │
               │   - socket.js: room subscriptions & reconnection       │
               │   - auth.js: REST login / voter session tokens         │
               │   - history.js: REST fetcher for archived results      │
               └──────────────┬───────────────────────────▲─────────────┘
                              │                           │
══════════════════════════════╪═══════════════════════════╪═══════════════════════════
                   Port 8090: │ REST API (HTTP)           │ WebSocket (Socket.io)
                              ▼                           │
               ┌──────────────────────────────────────────┴─────────────┐
               │            Authoritative Node.js Server                │
               │               (voting-server/src/server.js)            │
               │   - REST Endpoints: /api/admin/*, /api/sessions/*      │
               │   - Socket.io: rooms "session:${sessionId}"            │
               │   - Action Gatekeeper: verifies Admin JWT & Voter Token│
               └──────┬───────────────────────▲───────────────────┬─────┘
                      │                       │                   │
         Dispatches   │                       │ Subscribes        │ Syncs
         inbound      │                       │ to changes        │ state
                      ▼                       │                   ▼
       ┌──────────────────────────────┐       │      ┌──────────────────────────┐
       │   Authoritative Redux Store  │───────┘      │     MongoDB Database     │
       │   Root: Map({ sessions })    │              │   (via persistence.js)   │
       └──────────────┬───────────────┘              │  - Session documents     │
                      │                              │  - Result documents      │
                      ▼                              │  - Boot recovery         │
       ┌──────────────────────────────┐              └──────────────────────────┘
       │   Multi-Session Reducer      │
       │   Handles lifecycle & bounds │
       └──────────────┬───────────────┘
                      │ Delegates
                      ▼
       ┌──────────────────────────────┐              ┌──────────────────────────┐
       │    Pure Tournament Engine    │              │  Server Timer & Rounds   │
       │   (voting-server/src/core.js)│              │  - timer.js              │
       │   setEntries, next, vote     │              │  - roundManager.js       │
       └──────────────────────────────┘              │  - 100% early completion │
                                                     └──────────────────────────┘
```

---

## Files Inspected
- [voting-server/package.json](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/package.json)
- [voting-server/index.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/index.js)
- [voting-server/entries.json](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/entries.json)
- [voting-server/src/core.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js)
- [voting-server/src/reducer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/reducer.js)
- [voting-server/src/store.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/store.js)
- [voting-server/src/server.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js)
- [voting-server/src/timer.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/timer.js)
- [voting-server/src/roundManager.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/roundManager.js)
- [voting-server/src/bootstrap.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/bootstrap.js)
- [voting-server/src/auth/admin.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/admin.js)
- [voting-server/src/auth/voter.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/voter.js)
- [voting-server/src/auth/config.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/config.js)
- [voting-server/src/db/connection.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/connection.js)
- [voting-server/src/db/repository.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/repository.js)
- [voting-server/src/db/persistence.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/persistence.js)
- [voting-server/src/db/models/Session.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/models/Session.js)
- [voting-server/src/db/models/Result.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/db/models/Result.js)
- [voting-server/test/runner.cjs](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/runner.cjs)
- [voting-server/test/core_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/core_spec.js)
- [voting-server/test/reducer_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/reducer_spec.js)
- [voting-server/test/store_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/store_spec.js)
- [voting-server/test/server_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/server_spec.js)
- [voting-server/test/round_lifecycle_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/round_lifecycle_spec.js)
- [voting-server/test/early_completion_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/early_completion_spec.js)
- [voting-server/test/timer_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/timer_spec.js)
- [voting-server/test/auth_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/auth_spec.js)
- [voting-server/test/persistence_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test/persistence_spec.js)
- [voting-client/package.json](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/package.json)
- [voting-client/vite.config.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/vite.config.js)
- [voting-client/index.html](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/index.html)
- [voting-client/src/main.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/main.jsx)
- [voting-client/src/routes/AppRoutes.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AppRoutes.jsx)
- [voting-client/src/routes/AdminGuard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/AdminGuard.jsx)
- [voting-client/src/routes/LegacyRedirects.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/routes/LegacyRedirects.jsx)
- [voting-client/src/redux/store.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/store.js)
- [voting-client/src/redux/voteSlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/voteSlice.js)
- [voting-client/src/redux/historySlice.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/redux/historySlice.js)
- [voting-client/src/services/socket.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/socket.js)
- [voting-client/src/services/auth.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/auth.js)
- [voting-client/src/services/history.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/services/history.js)
- [voting-client/src/utils/timerUtils.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/utils/timerUtils.js)
- [voting-client/src/components/CountdownTimer.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/CountdownTimer.jsx)
- [voting-client/src/components/results/ResultCard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/results/ResultCard.jsx)
- [voting-client/src/components/results/ResultsChart.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/results/ResultsChart.jsx)
- [voting-client/src/components/results/resultsUtils.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/results/resultsUtils.js)
- [voting-client/src/components/voting/VoteCard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/voting/VoteCard.jsx)
- [voting-client/src/pages/Home.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Home.jsx)
- [voting-client/src/pages/SessionList.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/SessionList.jsx)
- [voting-client/src/pages/Lobby.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Lobby.jsx)
- [voting-client/src/pages/Voting.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Voting.jsx)
- [voting-client/src/pages/Results.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Results.jsx)
- [voting-client/src/pages/Admin.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Admin.jsx)
- [voting-client/src/pages/History.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/History.jsx)
- [voting-client/src/pages/Login.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Login.jsx)
- [voting-client/src/pages/Register.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/Register.jsx)
- [voting-client/src/pages/NotFound.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/pages/NotFound.jsx)
- [voting-client/test/round_results_lifecycle_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/test/round_results_lifecycle_spec.js)
- [voting-client/test/voting_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/test/voting_spec.js)
- [voting-client/test/results_spec.js](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/test/results_spec.js)
- [docs/ARCHITECTURE.md](file:///d:/Mine_project/fullstack-redux-voting-app/docs/ARCHITECTURE.md)
- [docs/API_CONTRACT.md](file:///d:/Mine_project/fullstack-redux-voting-app/docs/API_CONTRACT.md)
- [.agents/skills/engineering-codebase-onboarding-engineer/SKILL.md](file:///d:/Mine_project/fullstack-redux-voting-app/.agents/skills/engineering-codebase-onboarding-engineer/SKILL.md)

---

## Files Not Inspected
- [voting-client/src/components/home/Hero.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/home/Hero.jsx)
- [voting-client/src/components/home/Features.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/home/Features.jsx)
- [voting-client/src/components/home/HowItWorks.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/home/HowItWorks.jsx)
- [voting-client/src/components/home/Candidates.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/home/Candidates.jsx)
- [voting-client/src/components/home/Stats.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/home/Stats.jsx)
- [voting-client/src/components/home/Testimonials.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/home/Testimonials.jsx)
- [voting-client/src/components/home/CTA.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/home/CTA.jsx)
- [voting-client/src/components/dashboard/StatsCards.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/dashboard/StatsCards.jsx)
- [voting-client/src/components/dashboard/WelcomeCard.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/dashboard/WelcomeCard.jsx)
- [voting-client/src/components/layout/Navbar.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/layout/Navbar.jsx)
- [voting-client/src/components/layout/Footer.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/components/layout/Footer.jsx)
- [voting-client/src/App.jsx](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src/App.jsx) (legacy monolith retained as historical reference)
- CSS stylesheets under [voting-client/src/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/src) (`CountdownTimer.css`, `ResultsChart.css`, `ResultCard.css`, `VoteCard.css`, `Voting.css`, `Results.css`, `index.css`, `App.css`)
- Server test files in [voting-server/test/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/test) (`sessions_reducer_spec.js`, `create_session_spec.js`, `db_connection_spec.js`, `db_models_spec.js`, `db_repository_spec.js`, `db_test_helper.js`, `early_completion_integration_spec.js`, `history_api_spec.js`, `immutable_spec.js`, `lobby_headcount_spec.js`, `reveal_timer_socket_hardening_spec.js`, `timer_contract_spec.js`, `timer_integration_spec.js`)
- Client test files in [voting-client/test/](file:///d:/Mine_project/fullstack-redux-voting-app/voting-client/test) (`admin_timer_spec.js`, `admin_workflow_spec.js`, `auth_spec.js`, `countdown_timer_spec.js`, `early_completion_frontend_spec.js`, `history_spec.js`, `results_chart_spec.js`, `results_hardening_spec.js`, `results_transition_spec.js`, `results_visibility_spec.js`, `stage_c_spec.js`, `stage_d_spec.js`, `stage_e_spec.js`, `timer_expiry_spec.js`, `timer_redux_spec.js`, `verify_live.js`, `verify_phase6_live.js`)
- Binary PDF documents inside [docs/](file:///d:/Mine_project/fullstack-redux-voting-app/docs) (`Full-Stack Real-Time Voting Application Using Redux.pdf`, `Team18_Task_Division.pdf`)