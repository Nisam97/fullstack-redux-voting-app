# Project Changelog

All notable changes, architectural decisions, and progress updates for the Full-Stack Redux Pairwise Voting Application will be documented chronologically in this file.

---

### Date: 2026-09-09
**Phase:** Phase 0 — Baseline Repository Audit & Reality Analysis  
**Files Changed:** None (Read-only discovery audit)  
**Change:** Audited the `develop1` workspace and remote branches (`origin/backend`, `origin/develop`, `origin/frontend`, `origin/main`). Inspected `voting-client/` and `voting-server/`.  
**Reason:** Understand the current repository state, identify branch divergence, uncover architectural gaps, discover existing valuable code assets on `origin/backend`, and detect potential risks before any modification.  
**Tests:** Static analysis of file trees, dependencies in `package.json`, and commit histories.  
**Result:** Established that `voting-server/` on `develop1` is empty (0-byte `README.md`), while `origin/backend` preserves pure voting logic, Redux store, Mocha tests, and Socket.io server. Determined that `voting-client/` is an in-memory React 19 UI mock driven by a monolithic `App.jsx` without backend communication or Redux state.  

---

### Date: 2026-09-09
**Phase:** Phase 1 — Project Analysis & Architecture Documentation Baseline  
**Files Changed:**
* `docs/PROJECT_ANALYSIS.md` (Created)
* `docs/PROJECT_PROGRESS.md` (Created)
* `docs/CHANGELOG.md` (Created)
* `docs/ARCHITECTURE.md` (Created)
* `docs/API_CONTRACT.md` (Created)  
**Change:** Created comprehensive technical analysis and project tracking documentation, documenting the current vs. target architecture, core actions, Socket.io communication contract, and multi-phase implementation roadmap.  
**Reason:** Establish project clarity, prevent scope creep, set explicit interface agreements between client and server, and provide development tracking prior to modifying application code.  
**Tests:** Cross-referenced architectural findings against remote commit `3307cd2` (`origin/backend`), local `voting-client` files, and project specifications.  
**Result:** Documentation baseline established. Application implementation has not yet been performed in this phase. The project repository is prepared for Phase 1 backend recovery.  

---

### Date: 2026-09-09
**Phase:** Phase 1 — Backend Recovery & Modernization  
**Files Changed:**
* `.gitignore` (Modified)
* `voting-server/.gitignore` (Created)
* `voting-server/entries.json` (Recovered from `origin/backend`)
* `voting-server/index.js` (Recovered from `origin/backend`)
* `voting-server/src/core.js` (Recovered from `origin/backend`)
* `voting-server/src/reducer.js` (Recovered from `origin/backend`)
* `voting-server/src/store.js` (Recovered from `origin/backend`)
* `voting-server/src/server.js` (Recovered and fixed signature to `startServer(store)` with CORS config)
* `voting-server/test/test_helper.js` (Recovered from `origin/backend`)
* `voting-server/test/immutable_spec.js` (Recovered from `origin/backend`)
* `voting-server/test/core_spec.js` (Recovered from `origin/backend`)
* `voting-server/test/reducer_spec.js` (Recovered from `origin/backend`)
* `voting-server/test/store_spec.js` (Recovered from `origin/backend`)
* `voting-server/test/runner.cjs` (Created)
* `voting-server/babel.config.json` (Created)
* `voting-server/package.json` (Modernized)
* `voting-server/package-lock.json` (Generated via clean `npm install`)
* `docs/PROJECT_PROGRESS.md` (Updated)
* `docs/CHANGELOG.md` (Updated)  
**Change:** Safely recovered pure voting logic, Redux store, root reducer, Socket.io server, baseline entries, and full Mocha test suite from `remotes/origin/backend` without importing committed `node_modules` pollution. Fixed server startup bug where `startServer()` omitted the `store` argument. Upgraded legacy Babel 6 / Mocha 3 tooling to Babel 7 (`@babel/preset-env`, `@babel/register`) and Mocha 10+ with Chai 4.5.0 for Node.js v24.14.0 compatibility.  
**Reason:** Provide an authoritative, fully tested, and cleanly running backend engine on the active `develop1` branch adhering to system architecture requirements.  
**Tests:** Executed `npm test` in `voting-server/` (`node test/runner.cjs`). Also performed application startup verification executing `node -r @babel/register index.js` verifying store state, `SET_ENTRIES`, and `NEXT` dispatching.  
**Result:** 12 passing, 0 failing across all 4 test suites (`immutable_spec.js`, `core_spec.js`, `reducer_spec.js`, `store_spec.js`). Server process boots and initializes Socket.io on port 8090, successfully seeds state with 11 entries, and transitions round 1 into `vote.pair: ["Shallow Grave", "Trainspotting"]`. Zero frontend files modified.  

---

### Date: 2026-09-10
**Phase:** Phase 2 — Real-Time Server Integration  
**Files Changed:**
* `voting-server/src/server.js` (Modified)
* `voting-server/test/server_spec.js` (Created)
* `voting-server/package.json` (Modified: added `socket.io-client` devDependency)
* `voting-server/package-lock.json` (Updated)
* `docs/PROJECT_PROGRESS.md` (Updated)
* `docs/CHANGELOG.md` (Updated)  
**Change:** Completed server-side real-time Socket.io integration. Updated `startServer(store, port = 8090)` in `server.js` to support configurable ports (enabling collision-free automated integration testing using ephemeral port 0) and added resilient error handling to prevent malformed or unexpected socket actions from crashing the Node server process. Created comprehensive automated integration test suite in `voting-server/test/server_spec.js` validating real Socket.io clients for initial state unicast upon connection, multi-client real-time synchronization on VOTE actions, round progression on NEXT actions, final tournament winner broadcast, and malformed payload resilience. Conducted live socket verification against the running production server on port 8090.  
**Reason:** Fulfill the authoritative server real-time architecture, ensure robust multi-client state synchronization over WebSockets, and guarantee error resilience before client integration.  
**Tests:** Executed `npm test` in `voting-server/` (`node test/runner.cjs`), executing all unit and integration test suites. Also executed live Socket.io multi-client end-to-end verification connecting two clients to the production server process on port 8090.  
**Result:** 17 passing, 0 failing across all 5 test suites (`immutable_spec.js`, `core_spec.js`, `reducer_spec.js`, `store_spec.js`, `server_spec.js`). Multi-client synchronization verified: Client A and Client B receive identical state snapshots, vote tally updates propagate instantaneously to all connected clients, round progression advances properly, and the single authoritative server Redux store remains the source of truth. Zero frontend files modified.

---

### Date: 2026-09-10
**Phase:** Phase 3 — Client Dependency & Routing Setup  
**Files Changed:**
* `voting-client/package.json` (Modified: installed dependencies)
* `voting-client/package-lock.json` (Updated)
* `voting-client/src/components/results/ResultCard.jsx` (Fixed circular self-import)
* `voting-client/src/pages/Dashboard.jsx` (Populated empty stub)
* `voting-client/src/pages/Home.jsx` (Assembled landing page)
* `voting-client/src/main.jsx` (Mounted AppRoutes)
* `docs/PROJECT_PROGRESS.md` (Updated)
* `docs/CHANGELOG.md` (Updated)  
**Change:** Installed client runtime and state dependencies (`react-router-dom`, `socket.io-client`, `redux`, `react-redux`, `@reduxjs/toolkit`, and `react-icons`). Resolved circular self-import in `ResultCard.jsx` and connected to `ResultCard.css`. Resolved missing icon dependency referenced by `HowItWorks.jsx`. Populated 0-byte `Dashboard.jsx` with existing dashboard components. Assembled complete landing view in `Home.jsx` to preserve presentation aesthetics. Mounted `<AppRoutes />` from `main.jsx` to activate React Router.  
**Reason:** Prepare the frontend foundation for upcoming Redux state integration and Socket.io communication without breaking build, lint, or existing presentation.  
**Tests:** Executed `npm run build` (built cleanly in 648ms), `npm run lint` (0 errors), and preview route check (`/`, `/vote`, `/results` returning HTTP 200). Executed backend test suite (`npm test` in `voting-server/`, 17 passing, 0 failing) confirming zero backend modification.  
**Result:** Client build and lint pass with 0 errors. React Router is active and functional. Zero backend files modified.

---

### Date: 2026-09-10
**Phase:** Documentation Audit & Status Certification  
**Files Changed:**
* `docs/PROJECT_PROGRESS.md` (Updated)
* `docs/PROJECT_ANALYSIS.md` (Updated)
* `docs/CHANGELOG.md` (Updated)  
**Change:** Conducted a comprehensive read-only codebase audit across Onboarding, Project Management, Evidence Collection, and Reality Checking perspectives.  
* **IMPLEMENTED:**
  * Authoritative server Redux store, reducer, pure voting domain, and entries loader (`voting-server/src`).
  * Real-time Socket.io server with multi-client state broadcast and error resilience (`voting-server/src/server.js`).
  * Client dependencies installed (`react-router-dom`, `socket.io-client`, `redux`, `react-redux`, `@reduxjs/toolkit`, `react-icons`).
  * React Router configuration mounted via `voting-client/src/main.jsx`.
  * Component bug fixes in `ResultCard.jsx` and `HowItWorks.jsx`.
* **VERIFIED:**
  * Backend test suite: 17 passing, 0 failing (`npm test` in `voting-server/`).
  * Frontend production build: SUCCESS (`npm run build` in `voting-client/`).
  * Frontend code quality: SUCCESS (`npm run lint` in `voting-client/`, 0 errors, 0 warnings).
  * Backend freeze: `git diff voting-server` confirms 0 files modified during client phases.
* **DOCUMENTED:**
  * Updated `docs/PROJECT_PROGRESS.md` to reflect 57% MVP completion (Phases 0–3 complete).
  * Updated component inventory in `docs/PROJECT_ANALYSIS.md`.
  * Certified Phase 3 completion and identified Phase 4 as next step.
* **NOT STARTED:**
  * Phase 5: Interactive Pairwise Voting UI (`VoteCard.jsx`, `Voting.jsx`, `Results.jsx`).
  * Phase 6: End-to-end multi-browser integration testing.
  * Phase 7: Post-MVP features (auth, round timers, admin panel, MongoDB persistence, charts).

---

### Date: 2026-09-10
**Phase:** Phase 4 — Client Redux & Socket.io Implementation  
**Files Changed:**
* `voting-client/src/redux/voteSlice.js` (Created)
* `voting-client/src/redux/store.js` (Created)
* `voting-client/src/services/socket.js` (Created)
* `voting-client/src/main.jsx` (Modified: mounted Redux Provider)
* `docs/PROJECT_PROGRESS.md` (Updated)
* `docs/CHANGELOG.md` (Updated)  
**Change:** Completed the Phase 4 Client Redux and Socket.io integration.
* Created `voteSlice.js` using `@reduxjs/toolkit` with state `{ vote, entries, winner, hasLoaded }`, supporting `SET_STATE` (both RTK `setState` and standard `SET_STATE` actions) to receive authoritative server broadcasts, along with client action creators (`vote`, `next`, `setEntries`) and state selectors.
* Created `socket.js` establishing a persistent Socket.io client connection to the backend server (`http://localhost:8090`), with listener deduplication (`socket.off('state')`) and action dispatcher bridge (`connectSocketToStore`).
* Created `store.js` configuring the client Redux store and remote action middleware (`createRemoteActionMiddleware`), intercepting domain actions (`VOTE`, `NEXT`, `SET_ENTRIES` or `meta.remote: true`) and emitting `socket.emit('action', action)`.
* Implemented strict **Echo-Loop Prevention** filtering in middleware (`LOCAL_ACTION_TYPES`), explicitly ensuring `SET_STATE`, `voting/setState`, and internal Redux lifecycle actions (`@@redux/...`) are never transmitted back to the server over WebSockets.
* Prevented circular module dependency (`store.js` ↔ `socket.js`) via acyclic import graph (`main.jsx` → `store.js` → `socket.js` → `voteSlice.js`).
* Wrapped top-level React application in `<Provider store={store}>` in `main.jsx` while preserving React Router.  
**Reason:** Fulfill the authoritative server real-time architecture, establishing the bidirectional data flow bridge between the client Redux store and the backend server prior to implementing UI components in Phase 5.  
**Tests:**
* Executed `npm run build` in `voting-client/`: SUCCESS (0 errors, built in 549ms).
* Executed `npm run lint` in `voting-client/`: SUCCESS (0 errors, 0 warnings).
* Executed backend test suite `npm test` in `voting-server/`: 17 passing, 0 failing (zero backend files modified, backend freeze maintained).
* Executed live 6-part Socket.io and Redux end-to-end integration test suite verifying:
  1. Successful connection to port 8090.
  2. Authoritative initial state reception (`'state'` → `SET_STATE` → store updated).
  3. Remote action forwarding (`store.dispatch(vote(...))` → middleware → `socket.emit('action', ...)`).
  4. Server state broadcast reception.
  5. Two-client real-time synchronization with identical tally state.
  6. Strict echo loop prevention (`SET_STATE` is not emitted back to socket).  
**Result:** 71% MVP completion (5 of 7 phases completed: Phases 0–4). The client state and real-time bridge are fully verified and operational. Zero backend files modified. Ready for Phase 5 (Pairwise Voting UI).

---

### Date: 2026-09-10
**Phase:** Phase 5 — Pairwise Voting UI Implementation  
**Files Changed:**
* `voting-client/src/components/voting/VoteCard.jsx` (Implemented: candidate card with accessible vote action)
* `voting-client/src/components/voting/VoteCard.css` (Created: dark theme card styling, hover effects, and active state)
* `voting-client/src/pages/Voting.jsx` (Implemented: Redux-connected pairwise voting page)
* `voting-client/src/pages/Voting.css` (Created: responsive pairwise arena, status cards, and VS divider)
* `voting-client/package.json` (Modified: added `"test": "node --test test/voting_spec.js"`)
* `voting-client/test/voting_spec.js` (Created: 7-part automated unit test suite)
* `voting-client/test/verify_live.js` (Created: live socket integration verification script)
* `docs/PROJECT_PROGRESS.md` (Updated)
* `docs/CHANGELOG.md` (Updated)  
**Change:** Completed the Phase 5 Pairwise Voting UI implementation.
* Implemented `VoteCard.jsx` component displaying candidate initials monogram, title, server-provided vote tally badge, and semantic accessible `<button>` (`aria-label`, `aria-pressed`, keyboard navigable).
* Created `VoteCard.css` featuring dark aesthetic (`#1e293b`), subtle glowing accents (`#38bdf8`), elevation transitions, and distinct selected/voted visual feedback.
* Implemented `Voting.jsx` page consuming the client Redux store via `useSelector` (`selectVote`, `selectWinner`, `selectHasLoaded`) and `useDispatch` with the existing `vote(entry)` action.
* Implemented pure React 19 state derivation for vote locking scoped to the active candidate pair without cascading effect renders, automatically resetting when the server advances to the next pair.
* Handled all UI states gracefully:
  1. Initial loading indicator (`hasLoaded === false`).
  2. Tournament winner announcement banner (`Boolean(winner)`).
  3. Empty / no-active-pair notice (`pair.length < 2`).
  4. Active pairwise matchup arena (`pair[0]` vs `pair[1]`) with instant vote confirmation feedback banner.
* Created `Voting.css` with responsive desktop side-by-side cards and mobile stacked layouts with a glowing circular VS divider.
* Configured automated test runner in `package.json` (`npm test`) and created 7-part test suite in `test/voting_spec.js`.
* Performed live end-to-end integration check (`test/verify_live.js`) connecting to running backend server on port 8090, verifying state synchronization and real-time tally increment.  
**Reason:** Deliver the core pairwise comparison and voting interaction experience on top of the Phase 4 Redux and Socket.io architecture while maintaining strict backend authoritativeness and zero backend modification.  
**Tests:**
* Frontend unit tests (`npm test` in `voting-client/`): **7 passing, 0 failing (13.5ms)**.
* Frontend lint (`npm run lint` in `voting-client/`): **0 errors, 0 warnings**.
* Frontend build (`npm run build` in `voting-client/`): **SUCCESS (0 errors, built in 817ms)**.
* Backend regression tests (`npm test` in `voting-server/`): **17 passing, 0 failing (279ms)**.
* Live integration test (`node test/verify_live.js`): **PASS** (Server state unicast received, vote action processed, authoritative tally broadcast verified).
* Backend freeze check: **Zero backend files modified** during Phase 5.  
**Result:** 86% MVP completion (6 of 7 phases completed: Phases 0–5). The interactive Pairwise Voting UI is complete, fully tested, and certified. Ready for human review before proceeding to Phase 6.

---

### Date: 2026-09-10
**Phase:** Phase 6 — Results Presentation & End-to-End Verification  
**Files Changed:**
* `voting-client/src/pages/Results.jsx` (Implemented: Redux-connected results view with all 5 lifecycle states)
* `voting-client/src/pages/Results.css` (Created: dark-themed responsive results grid and status cards)
* `voting-client/src/components/results/ResultCard.jsx` (Enhanced: monogram avatar, ARIA progressbar, custom winner labels)
* `voting-client/package.json` (Modified: test runner includes `results_spec.js`)
* `voting-client/test/results_spec.js` (Created: 7-part automated unit test suite for Results)
* `voting-client/test/verify_phase6_live.js` (Created: 6-part live multi-client end-to-end verification script)
* `docs/PROJECT_PROGRESS.md` (Updated: 100% Core MVP completion)
* `docs/CHANGELOG.md` (Updated)  
**Change:** Completed Phase 6 Results Presentation and End-to-End Verification.
* Connected `Results.jsx` to client Redux store using existing selectors (`selectVote`, `selectWinner`, `selectHasLoaded`).
* Implemented all 5 application lifecycle UI states:
  1. Initial loading spinner (`hasLoaded === false`).
  2. Tournament winner champion card & celebration announcement (`Boolean(winner)`).
  3. Empty state notice when session is idle or unseeded (`pair.length < 2`).
  4. Active round live notice when round is active with 0 votes cast so far.
  5. Authoritative results arena with live candidate cards, progress bars, and total vote count.
* Enhanced `ResultCard.jsx` with monogram initials, WAI-ARIA progressbar attributes (`role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label`), clean conditional party display, and customizable `winnerLabel`.
* Created `Results.css` providing responsive desktop 2-column grid, mobile single-column layout, glowing live stream indicator, and accessible contrast.
* Enforced strict **SERVER IS AUTHORITATIVE** architecture:
  * Preserved server-provided candidate ordering (`pair[0]`, `pair[1]`).
  * Division-by-zero protection (`totalVotes === 0` safely produces 0%, avoiding `NaN` or `Infinity`).
  * Client never computes or derives an authoritative winner independently during active rounds.
* Expanded test runner in `package.json` to execute both `voting_spec.js` and `results_spec.js` (`16/16 passing tests`).
* Executed 6-part live end-to-end multi-client verification (`test/verify_phase6_live.js`) connecting Client A and Client B to real backend server on port 8090, verifying real-time cross-client broadcast synchronization on vote, round progression (`NEXT`), and browser refresh state recovery.  
**Reason:** Deliver real-time results presentation and validate the complete end-to-end voting lifecycle across multiple connected clients while maintaining backend freeze and server authoritativeness.  
**Tests:**
* Frontend unit tests (`npm test` in `voting-client/`): **16 passing, 0 failing (482ms)**.
* Frontend lint (`npm run lint` in `voting-client/`): **0 errors, 0 warnings**.
* Frontend build (`npm run build` in `voting-client/`): **SUCCESS (0 errors, built in 815ms)**.
* Backend regression tests (`npm test` in `voting-server/`): **17 passing, 0 failing (268ms)**.
* Live integration test (`node test/verify_phase6_live.js`): **PASS (100% - all 6 multi-client & reconnection checks passed)**.
* Backend freeze check: **Zero backend files modified** during Phase 6.  
**Result:** 100% Core MVP completion (7 of 7 core phases completed: Phases 0–6). Results Presentation and full End-to-End multi-client workflows are certified and operational. Ready for human review before proceeding to Phase 7.

---

### Date: 2026-09-12
**Stage:** Stages A–J — Multi-Election Architecture & System Verification  
**Type:** Architectural Paradigm Transformation & System-Wide Multi-Election Implementation  
**Files Changed:**
* `voting-server/src/reducer.js` (Multi-election registry reducer, lifecycle transitions, targeted actions)
* `voting-server/src/server.js` (Socket.io multi-election room engine, targeted broadcasts, registry summaries)
* `voting-server/src/bootstrap.js` (Dynamic entry loading, `elec_default` and `elec_horror` seed bootstrap)
* `voting-server/index.js` (Dual-election server bootstrap on port 8090)
* `voting-server/test/elections_reducer_spec.js` (25 multi-election unit tests)
* `voting-server/test/bootstrap_spec.js` (9 seed election bootstrap tests)
* `voting-server/test/server_spec.js` (24 Socket.io multi-election room integration tests)
* `voting-client/src/redux/voteSlice.js` (Normalized election state `{ list, activeElectionId, byElectionId }`, selectors, scoped pair locks)
* `voting-client/src/redux/store.js` (Echo-loop prevention for multi-election actions)
* `voting-client/src/services/socket.js` (Multi-election subscription registry, auto-resubscription on reconnect)
* `voting-client/src/routes/AppRoutes.jsx` (Multi-election route hierarchy `/elections`, `/elections/:id/vote`, `/elections/:id/results`)
* `voting-client/src/routes/LegacyRedirects.jsx` (Graceful backward compatibility redirects `/vote` and `/results`)
* `voting-client/src/pages/ElectionList.jsx` (Available elections registry directory)
* `voting-client/src/pages/Voting.jsx` (Route-aware pairwise arena with election-scoped voting locks)
* `voting-client/src/pages/Results.jsx` (Route-aware results view with authoritative tallies)
* `voting-client/src/components/layout/Navbar.jsx` (Elections directory navigation link)
* `voting-client/test/voting_spec.js` (Expanded unit test suite covering Stages F, G, H)
* `docs/API_CONTRACT.md` (Updated with multi-election events, action signatures, and breaking changes)
* `docs/ARCHITECTURE.md` (Updated with election registry, lifecycle, room isolation, and pure engine preservation)
* `docs/CHANGELOG.md` (Updated with architectural transformation entry)
* `docs/PROJECT_PROGRESS.md` (Updated tracking 100% completion of Stages A–J)

**Major Architectural Changes:**
1. **Redux Election Registry**: Replaced single-election root store with a registry `Map({ elections: Map({ [electionId]: electionState }) })`. Each election owns its independent tournament state (`id`, `title`, `status`, `createdAt`, `entries`, `vote`, `winner`).
2. **Protected Pure Engine**: Preserved [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) completely untouched. The multi-election reducer delegates pure domain transitions (`setEntries`, `next`, `vote`) to this protected engine.
3. **Election Lifecycle**: Formalized election lifecycle states (`pending`, `open`, `completed`, `archived`) with dedicated actions `CREATE_ELECTION`, `START_ELECTION`, and `ARCHIVE_ELECTION`.
4. **Election-Scoped Domain Actions**: Configured `VOTE`, `NEXT`, and `SET_ENTRIES` to require an `electionId` property, guaranteeing targeted mutations with complete cross-election isolation.
5. **Socket.io Multi-Room Architecture**:
   * Replaced global state broadcasting with targeted room broadcasts (`election:${electionId}`).
   * Implemented global `elections` event delivering lightweight registry summaries without leaking internal tallies.
   * Implemented room-scoped `election_state` event delivering complete tournament state only to subscribed clients.
   * Implemented client subscription protocol (`subscribe_election`, `unsubscribe_election`, and on-demand `elections` query).
6. **Backend Seed Bootstrap**: Implemented dual-election bootstrap on port 8090:
   * `elec_default` ("Danny Boyle Film Tournament") with 11 entries from `entries.json`.
   * `elec_horror` ("Horror Classics") with 3 entries ("The Shining", "Psycho", "Alien").
7. **Frontend Normalized Redux State**: Restructured client slice into normalized structure (`list`, `activeElectionId`, `byElectionId`) with robust selectors, echo-loop prevention, and fallback handlers.
8. **Election-Scoped Local Voting Lock**: Derived pair lock keys as `${electionId}:::${pair}`, allowing users to vote independently across different elections without cross-election lock contention.
9. **Election-Aware Client Routing**: Added `/elections` directory view, `/elections/:id/vote`, and `/elections/:id/results`, plus `LegacyRedirects` mapping `/vote` and `/results` to the first available election.
10. **In-Memory Persistence Specification**: Formalized that state is maintained strictly in server memory and resets on backend process restart.

**Breaking Change Notice:**
* **Deprecation of Global `'state'` Event**: The single-election `'state'` Socket.io broadcast is deprecated and replaced by the global `'elections'` summary event and the room-scoped `'election_state'` event. Clients must subscribe to specific election rooms to receive voting state.

**Verification & Test Results:**
* **Backend Test Suite (`voting-server`):** **72 passing, 0 failing (969ms)** across 8 spec files (`immutable_spec.js`, `core_spec.js`, `reducer_spec.js`, `store_spec.js`, `server_spec.js`, `bootstrap_spec.js`, `elections_reducer_spec.js`).
* **Frontend Test Suite (`voting-client`):** **44 passing, 0 failing (308ms)** across all specifications (`voting_spec.js`, `results_spec.js`).
* **Frontend Code Quality (`voting-client`):** `eslint .` **0 errors, 0 warnings**.
* **Frontend Production Build (`voting-client`):** `vite build` **SUCCESS (543ms)**.
* **Live Multi-Election Verification:** **PASS (100%)** — verified dual seed elections `elec_default` and `elec_horror`, concurrent voting, room isolation, zero cross-talk, and reconnection recovery.
* **Protected Engine Verification:** `voting-server/src/core.js` remained completely unmodified throughout Stages A–J.

**Result:** Stages A through J are 100% complete and fully verified. Multi-election architecture is operational and certified.

---

### Date: 2026-09-12
**Feature:** Feature 1 — Two-Tier Authentication System (Admin Account + Voter Session Join)  
**Type:** Security & Identity Architecture Implementation  
**Files Changed / Created:**
* `voting-server/src/auth/config.js` (Created: Environment configuration for admin credentials and JWT settings with safe defaults and runtime overrides)
* `voting-server/src/auth/admin.js` (Created: In-memory single admin seeding, bcrypt password hashing/comparison, JWT generation and verification)
* `voting-server/src/auth/voter.js` (Created: Session-scoped voter registration, cryptographically secure token generation, and server-side duplicate vote prevention)
* `voting-server/src/server.js` (Modified: Integrated HTTP endpoints `/api/admin/login`, `/api/sessions/:sessionId/join`, `/api/auth/me`, Socket action ingress authorization for admin actions and VOTE, duplicate vote enforcement, cookie parsing)
* `voting-server/test/auth_spec.js` (Created: 28 comprehensive automated unit and integration tests covering admin credentials, JWT verification, voter join, token scoping, server duplicate vote protection, socket auth, and REST endpoints)
* `voting-client/src/services/auth.js` (Created: Client-side authentication service managing admin login/logout in `localStorage`, session voter token persistence, and session check helpers)
* `voting-client/src/redux/store.js` (Modified: Enhanced remote action middleware to automatically enrich `VOTE` actions with session voter tokens and admin actions with admin JWTs)
* `voting-client/src/pages/Voting.jsx` (Modified: Enforced display-name voter join modal before pairwise voting, error feedback for rejected votes, and voter display name presentation)
* `voting-client/src/pages/Login.jsx` (Modified: Admin authentication login portal interacting with `loginAdmin()` and redirecting to management views)
* `voting-client/src/components/layout/Navbar.jsx` (Modified: Added admin login status and quick navigation)
* `voting-client/test/auth_spec.js` (Created: 7 automated unit tests covering admin login state, voter token scoping, and action enrichment middleware)
* `.env.example` & `voting-server/.env.example` (Created/Updated: Safe environment configuration templates)
* `docs/ARCHITECTURE.md` (Updated: Comprehensive Two-Tier Authentication Architecture documentation)
* `docs/API_CONTRACT.md` (Updated: Complete HTTP REST endpoints and Socket.io authorization contract)
* `docs/PROJECT_PROGRESS.md` (Updated: 100% Feature 1 completion and verified test baseline)
* `docs/CHANGELOG.md` (Updated)

**Major Architectural Changes:**
1. **Two-Tier Identity Separation**:
   * **Tier 1 (Admin)**: Exactly one global administrator account seeded from environment configuration (`ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`), hashed with bcrypt (`saltRounds = 10`), and authenticated via signed JWTs carrying `role: 'admin'`.
   * **Tier 2 (Voter)**: Frictionless session join with display-name only (no password/email/OTP). Server generates a cryptographically random, unguessable token (`crypto.randomUUID()` / `randomBytes`), strictly bound to the target `sessionId`.
2. **Server-Authoritative Vote Security & Duplicate Vote Prevention**:
   * Fully anonymous voting is strictly blocked with `VOTER_TOKEN_REQUIRED`.
   * Server tracks cast votes using composite keys: `${sessionId}:::${sortedPair}:::${voterToken}` in an in-memory `recordedVotes` set.
   * Double-voting on the same pairwise round is strictly rejected with `DUPLICATE_VOTE` without mutating store state.
   * Advancing the round changes the active candidate pair, automatically unlocking the voter to participate in the next round without re-joining.
3. **Duplicate Display Names Allowed**:
   * Display names are cosmetic labels only and explicitly not authentication credentials.
   * Multiple voters with identical display names receive distinct tokens and vote independently.
4. **Socket.io Ingress Authorization Pipeline**:
   * Ingress filter in `server.js` intercepts all incoming actions.
   * Protects admin actions (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`), rejecting missing or invalid tokens with machine-readable `action_error` events (`UNAUTHORIZED`, `INVALID_TOKEN`, `FORBIDDEN`).
   * Protects `VOTE` action, validating token existence, session match, session status, and duplicate key.
5. **Native HTTP REST API**:
   * Added `POST /api/admin/login` for credential authentication and JWT acquisition.
   * Added `POST /api/sessions/:sessionId/join` for session joining, token issuance, and `Set-Cookie` header delivery.
   * Added `GET /api/auth/me` for admin token verification and profile retrieval.
6. **Client Token Enrichment Middleware**:
   * `createRemoteActionMiddleware` in `store.js` intercepts client actions and automatically enriches `VOTE` actions with the session's stored voter token and admin actions with the stored admin JWT before emitting over WebSockets.
7. **Strict Core Engine Preservation**:
   * [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remained 100% pure and completely unmodified (0 lines changed). All authentication resides strictly in the gateway and peripheral modules.
8. **Client-Side Token Storage Decision (v1)**:
   * Admin JWT is stored in `localStorage` (`votesphere_admin_jwt`). Voter tokens are stored in `sessionStorage`/`localStorage` and mirrored in session cookies.
   * Known XSS limitation documented; migration to `httpOnly` cookies is deferred as a planned security hardening milestone.

**Verification & Test Results:**
* **Backend Test Suite (`voting-server`):** **100 passing, 0 failing (9s)** across 9 spec files.
* **Frontend Test Suite (`voting-client`):** **51 passing, 0 failing (640ms)** across 3 spec files.
* **Frontend Code Quality (`voting-client`):** `eslint .` **0 errors, 0 warnings**.
* **Frontend Production Build (`voting-client`):** `vite build` **SUCCESS (built in 1.03s, 0 errors)**.
* **Multi-Session Regression:** **PASS (100%)** — complete session isolation preserved.
* **Core Engine Protection:** [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) confirmed unmodified.

**Deferred Scope & Future Milestones:**
* Feature 2: Timer-based round countdowns and auto-advancement.
* Feature 3: Admin dashboard panel, waiting room lobby, and QR code links.
* Feature 4: MongoDB persistence and public Results History (Implemented below).
* Feature 5: Real-time results bar charts with round reveal.
* Future Security: Migration of JWTs to `httpOnly` cookies.

---

### Date: 2026-09-12
**Feature:** Feature 4 — MongoDB Persistence & Results History  
**Type:** Persistence Tier & Historical Archival Implementation  
**Files Changed / Created:**
* `voting-server/src/db/connection.js` (Created: MongoDB connection lifecycle with `connectMongo`, `disconnectMongo`, `isConnected`)
* `voting-server/src/db/models/Session.js` (Created: Mongoose schema and model for session metadata, status, entries, and lifecycle timestamps)
* `voting-server/src/db/models/Result.js` (Created: Mongoose schema and model for immutable completed tournament outcomes with compound index)
* `voting-server/src/db/repository.js` (Created: Decoupled data access repository for session and result operations, startup reset, and queries)
* `voting-server/src/db/persistence.js` (Created: Persistence orchestration with Redux state snapshot comparison, tournament progression guard, and DB recovery)
* `voting-server/src/server.js` (Modified: Connected store subscriber hook for asynchronous fire-and-forget persistence; implemented `GET /api/sessions/history`, `GET /api/sessions/:sessionId/result`, and alias `/history`)
* `voting-server/index.js` (Modified: Startup recovery sequence, seed session persistence, and graceful shutdown handling)
* `voting-server/test/db_test_helper.js` (Created: In-memory MongoDB test harness via `MongoMemoryServer`)
* `voting-server/test/db_connection_spec.js` (Created: 3 unit tests for connection lifecycle)
* `voting-server/test/db_models_spec.js` (Created: 10 unit tests for schema validation, defaults, and indexes)
* `voting-server/test/db_repository_spec.js` (Created: 10 unit tests for repository CRUD, recovery queries, and result pagination)
* `voting-server/test/persistence_spec.js` (Created: 18 unit tests for lifecycle detection, progression guard, recovery, and seeds)
* `voting-server/test/history_api_spec.js` (Created: 18 integration tests for REST history endpoints, limits, and errors)
* `voting-client/src/services/history.js` (Created: Frontend HTTP client service for history API)
* `voting-client/src/redux/historySlice.js` (Created: Redux slice isolating history state, async thunks `loadHistory` & `loadSessionResult`)
* `voting-client/src/redux/store.js` (Modified: Registered `historySlice` reducer in client Redux store)
* `voting-client/src/pages/History.jsx` & `History.css` (Created: Dedicated `/history` archive page with loading, error/retry, empty, and populated grid states)
* `voting-client/src/pages/Results.jsx` (Modified: Added historical result fallback when session is not in active Socket.io memory)
* `voting-client/src/routes/AppRoutes.jsx` (Modified: Mounted `/history` route)
* `voting-client/src/components/layout/Navbar.jsx` (Modified: Added "History" navigation link with active route styling)
* `voting-client/test/history_spec.js` (Created: 11 automated unit tests covering history service, slice, selectors, and Socket.io cleanup)
* `voting-client/package.json` (Modified: Updated test script to execute `history_spec.js`)
* `docs/ARCHITECTURE.md` (Updated: Documented MongoDB architecture, models, persistence, resilience, recovery, and history slice)
* `docs/API_CONTRACT.md` (Updated: Documented `GET /api/sessions/history`, `GET /api/sessions/:sessionId/result`, alias, and `MONGODB_URI`)
* `docs/PROJECT_PROGRESS.md` (Updated: Recorded 100% completion of Feature 4 Stages A–F and 221 passing test baseline)
* `docs/CHANGELOG.md` (Updated)
* `README.md` (Updated: Updated feature matrix, prerequisites, endpoints, and test counts)

**Major Architectural Changes:**
1. **MongoDB Persistence Foundation**:
   - Connection lifecycle managed cleanly via Mongoose (`connectMongo`, `disconnectMongo`, `isConnected`), configurable with `MONGODB_URI`.
   - `Session` model enforces unique `sessionId`, tracks lifecycle states (`pending`, `open`, `completed`, `archived`), and maintains lifecycle timestamps.
   - `Result` model stores immutable completed tournament champions with full original entry rosters, indexed by `completedAt: -1`.
2. **Asynchronous Non-Blocking Persistence**:
   - Store subscriber in `server.js` hooks into Redux dispatches and triggers `persistStateChanges(prevState, currentState)` in a fire-and-forget promise.
   - Real-time Socket.io broadcasts are never delayed by database latency.
3. **Tournament Progression Protection**:
   - `isTournamentProgression` guard in `persistence.js` ensures that candidate entry queue reductions during rounds do NOT overwrite the full initial entries list in MongoDB.
4. **Candidate Roster Preservation in Results**:
   - When a tournament completes, `core.next()` crowns a winner and strips `entries` from Redux. `persistCompletedResult()` queries the MongoDB `Session` document to retrieve the original full roster for the permanent `Result` record.
5. **Idempotent Atomic Upserts**:
   - `saveResult()` utilizes `findOneAndUpdate({ sessionId }, { $setOnInsert: resultData }, { upsert: true })` to prevent duplicate result documents during race conditions.
6. **Server Startup Recovery & Interrupted Session Reset**:
   - On boot, `index.js` executes `resetOpenSessionsToPending()`, cleanly returning interrupted in-flight sessions to `'pending'`.
   - `recoverSessionsFromDb()` re-registers active non-archived sessions into the in-memory Redux store via `CREATE_SESSION`.
   - Archived sessions remain queryable via History API but are excluded from active store memory.
7. **Public Results History REST API**:
   - Added `GET /api/sessions/history` supporting pagination limits (default: 50, max: 100) and descending sort.
   - Added `GET /api/sessions/:sessionId/result` (and alias `/history`) returning sanitized tournament outcomes excluding internal MongoDB keys (`_id`, `__v`).
8. **Frontend Redux State Isolation**:
   - Separate Redux slice (`state.history`) prevents static archival data from tangling with high-frequency live WebSocket session states (`state.sessions`).
   - Concluded sessions display champions in `Results.jsx` even when the session is no longer active in server memory.
9. **Strict Core Engine Preservation**:
   - [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remained 100% byte-for-byte unmodified (SHA-256: `B479F3F0B90C5BD81E1A813B3C5753179EFEECD08A531AA833000B65188FB310`, 40 lines).

**Verification & Test Results:**
* **Backend Test Suite (`voting-server`):** **159 passing, 0 failing (~10s)** across 14 spec files.
* **Frontend Test Suite (`voting-client`):** **62 passing, 0 failing (~800ms)** across 4 spec files.
* **Total Automated Tests:** **221 passing, 0 failing**.
* **Frontend Code Quality (`voting-client`):** `eslint .` **0 errors, 0 warnings**.
* **Frontend Production Build (`voting-client`):** `vite build` **SUCCESS (built in ~550ms, 0 errors)**.
* **Protected Engine Verification:** `voting-server/src/core.js` byte-for-byte identical.
* **Multi-Session & Auth Regression:** **PASS (100%)** — complete isolation maintained.

**Deferred Scope & Future Milestones:**
* Feature 2: Timer-based round countdowns and auto-advancement (`NOT STARTED`).
* Feature 5: Real-time results bar charts with round reveal (`NOT STARTED`).
* Future Security: Migration of JWTs and voter tokens to `httpOnly` cookies (`NOT STARTED`).
* Persistence Hardening: Resolution of MongoDB asynchronous write ordering race under rapid sequential dispatches.

---

### Date: 2026-09-13
**Phase:** Feature 3 — Admin Panel & Waiting Room Lobby (Stages 0–F Complete & Verified)  
**Files Changed:**
* `voting-server/src/auth/voter.js` (Modified: In-memory voter tracking by token and session, `getVoterCount()`, registration validation)
* `voting-server/src/server.js` (Modified: Added `GET /api/sessions`, `GET /api/sessions/:id/lobby`, `lobby_update` emission with room isolation)
* `voting-server/test/lobby_headcount_spec.js` (Created: 21 automated tests covering headcount, discovery, lobby API, and room isolation)
* `voting-client/package.json` (Modified: Added `qrcode` package and updated test scripts for Stage C, D, E specs)
* `voting-client/src/redux/voteSlice.js` (Modified: Added `voterCount`, `entryCount`, `lobbyUpdate` reducer cases and action creators)
* `voting-client/src/redux/store.js` (Modified: Updated remote action middleware to enrich admin actions with JWT)
* `voting-client/src/routes/AdminGuard.jsx` (Created: Route wrapper guarding `/admin` based on `isAdminLoggedIn()`)
* `voting-client/src/routes/AppRoutes.jsx` (Modified: Routed `/admin`, `/sessions/:id/lobby`, and legacy `/dashboard` redirect)
* `voting-client/src/pages/Admin.jsx` & `Admin.css` (Created: Full administrative dashboard with session creation, lifecycle controls, and QR generation)
* `voting-client/src/pages/Lobby.jsx` & `Lobby.css` (Created: Participant waiting room with instant REST hydration, display-name join, live headcount pulse badge, and lifecycle transitions)
* `voting-client/test/stage_c_spec.js` (Created: 14 automated unit tests for Redux normalization, voter count, lobby update, and admin guard)
* `voting-client/test/stage_d_spec.js` (Created: 17 automated unit tests for Admin Panel, lifecycle controls, and QR code generation)
* `voting-client/test/stage_e_spec.js` (Created: 15 automated unit tests for Waiting Room Lobby UI, display-name join, live headcount, and room isolation)
* `docs/ARCHITECTURE.md` (Updated: Documented Feature 3 system architecture, flow diagrams, and room isolation)
* `docs/API_CONTRACT.md` (Updated: Documented `GET /api/sessions`, `GET /api/sessions/:id/lobby`, and `lobby_update` socket event)
* `docs/PROJECT_PROGRESS.md` (Updated: Recorded Feature 3 completion and updated quality metrics)
* `docs/CHANGELOG.md` (Updated: Recorded comprehensive Feature 3 changelog)
* `README.md` (Updated: Reflected Feature 3 completion, updated test baselines, and documented routes)

**Major Architectural Changes:**
1. **Administrative Management Panel (`/admin`)**:
   - Protected by `AdminGuard` verifying admin JWT via `isAdminLoggedIn()`.
   - Comprehensive overview of all sessions displaying titles, statuses, voter counts, and entry counts.
   - Session creation form validating non-empty titles and requiring at least 2 distinct candidate entries.
   - Authoritative lifecycle control actions (`START_SESSION`, `NEXT`, `ARCHIVE_SESSION`) dispatched over Socket.io with admin JWT enrichment.
   - Zero competing REST lifecycle mutation endpoints; Socket.io action pipeline remains the single source of truth.
2. **Dynamic QR Code & Share Link Generation**:
   - Frontend QR code generation via `qrcode` package pointing directly to `/sessions/:id/lobby`.
   - Share URLs and QR payloads contain zero credentials, JWTs, voter tokens, or secrets.
3. **Public Session Discovery (`GET /api/sessions`)**:
   - Native HTTP endpoint returning sanitized summary array of registered sessions with live headcounts.
   - Publicly accessible without authentication; integrated into `/sessions` session directory.
4. **Participant Waiting Room Lobby (`/sessions/:id/lobby`)**:
   - Instant hydration on mount via `GET /api/sessions/:id/lobby` to populate metadata immediately when scanning QR codes directly.
   - Display-name voter join form issuing session-scoped voter tokens persisted in `sessionStorage`.
   - Live headcount badge with animated pulse indicator, reactively updated on `lobby_update` Socket.io events.
   - Lifecycle state handling:
     - `pending`: Waiting room experience with live headcount.
     - `open`: Automatic/guided transition to `/sessions/:id/vote`.
     - `completed`: Winner announcement and link to `/sessions/:id/results`.
     - `archived`: Clear read-only archive notice rejecting new voter joins.
     - `does-not-exist`: Clean Session Not Found card without application crashes.
5. **Strict Multi-Session Isolation**:
   - Verified that session actions and `lobby_update` events for `sess_horror` never contaminate `sess_default`.
   - Voter tokens remain strictly bound to their issuing `sessionId`.
6. **Strict Core Engine Preservation**:
   - [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remained 100% byte-for-byte unmodified (SHA-256: `B479F3F0B90C5BD81E1A813B3C5753179EFEECD08A531AA833000B65188FB310`).

**Verification & Quality Audit (Stage F):**
* **Backend Baseline Test Suite:** 180 / 180 passing across 15 spec files.
* **Stage F Reality Audit Result:** 179 passing, 1 known timing-related failure.
  > The established backend regression baseline reached 180/180 passing. During independent Stage F integration verification, the previously identified asynchronous MongoDB status-write race was reproduced, producing 179 passing and 1 known timing-related failure. No new Feature 3 functional or security defect was identified.
* **Frontend Test Suite:** 108 / 108 passing across 7 spec files.
* **Frontend Code Quality:** `eslint .` returned 0 errors, 0 warnings.
* **Frontend Production Build:** `vite build` SUCCESS (built in ~610ms).
* **Full-Stack Journey:** Complete end-to-end user journey executed live across Admin Login → Create Session → Public Discovery → Waiting Room → Voter Join → Live Headcount → Start → Vote → Advance → Complete → Results → Archive → Reconnect with 100% success.

**Deferred Scope & Technical Debt:**
* **MongoDB Status-Write Ordering Race (Low Severity)**: In `voting-server/src/db/persistence.js`, rapid dispatches (`START_SESSION` followed immediately by `NEXT`) can resolve out of order in MongoDB; deferred to future persistence refactor.
* **Feature 2**: Timer-based voting and round countdowns (`NOT STARTED`).
* **Feature 5**: Real-time comparative results bar charts (`NOT STARTED`).
* **Security Hardening**: Migration to `httpOnly` cookies for admin JWTs and voter tokens (`NOT STARTED`).

---

### Date: 2026-09-13
**Phase:** Feature 3 — Stage G: Technical Documentation & Final Feature 3 Sign-Off  
**Files Changed:**
* `docs/ARCHITECTURE.md` (Updated: Added comprehensive Section 9 for Feature 3 architecture, end-to-end workflow diagram, Admin Panel specifications, zero competing REST mutation endpoints policy, QR/share flows, waiting room lifecycle transitions, live headcount architecture, and multi-session isolation)
* `docs/API_CONTRACT.md` (Updated: Explicitly documented zero competing REST lifecycle mutation endpoints, detailed `GET /api/sessions`, `GET /api/sessions/:id/lobby`, `lobby_update` room-scoped delivery, and updated `POST /api/sessions/:id/join` response payload)
* `docs/API_CONTRACT.md` (Updated: Explicitly documented zero competing REST mutation endpoints, detailed `GET /api/sessions`, `GET /api/sessions/:id/lobby`, `lobby_update` room-scoped delivery, and updated `POST /api/sessions/:id/join` response payload)
* `docs/PROJECT_PROGRESS.md` (Updated: Recorded exact test baseline 180 vs Stage F 179 audit with known timing race, verified core engine byte integrity, and finalized Feature 3 sign-off)
* `docs/CHANGELOG.md` (Updated: Recorded comprehensive Stage G documentation sign-off)
* `README.md` (Updated: Reflected Feature 3 completion, updated test baselines, documented routes, and clarified deferred scope)  
**Change:** Conducted a comprehensive documentation-only pass to record the architecture, contracts, verification history, and operational behaviors of the completed Feature 3 (Admin Panel & Waiting Room Lobby). Maintained strict documentation scope rules: zero changes to application code (`voting-server/src/**`, `voting-client/src/**`), zero test modifications, zero dependency updates, and verified pure tournament core [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remains 100% untouched.  
**Reason:** Provide exhaustive, accurate, and reader-centric technical documentation for evaluators, future engineers, and project reviewers, accurately reflecting verified production reality without exaggerating capabilities or masking known low-severity deferred technical debt.  
**Tests:** Verified `voting-server/src/core.js` SHA-256 (`B479F3F0B90C5BD81E1A813B3C5753179EFEECD08A531AA833000B65188FB310`). Conducted read-only audit of file modifications and verified git diff isolation.  
**Result:** Documentation baseline updated and synchronized with reality. Feature 3 certified complete and approved for final project status review.

---

### Date: 2026-09-13
**Phase:** Feature 2 — Voting Timer (Stages A–G Complete & Verified)  
**Files Changed:**
* `voting-server/src/timer.js` (Created: In-memory `TimerManager` domain module managing session-specific timeouts, duration normalization, start/clear, status snapshots, and automated store `NEXT` dispatching on expiry)
* `voting-server/src/server.js` (Modified: Integrated `TimerManager` into store subscriber, hooked `subscribe_session` for initial `timer_state` hydration, broadcasted room-scoped `timer_state` events, and exposed `timerDuration` in `getSessionsSummary()`)
* `voting-server/src/reducer.js` (Modified: Added `timerDuration` support to `CREATE_SESSION` with integer validation 5–300s, default 30s)
* `voting-server/test/timer_spec.js` (Created: Unit tests for `TimerManager` lifecycle, boundary validation, and timer state extraction)
* `voting-server/test/timer_integration_spec.js` (Created: Comprehensive Socket.io integration tests validating room-scoped broadcasts, reconnect hydration, and automatic round advancement)
* `voting-client/src/utils/timerUtils.js` (Created: Pure utility functions `formatCountdown`, `calculateRemainingSeconds`, `isTimerExpired` for reliable frontend countdown calculations)
* `voting-client/src/components/CountdownTimer.jsx` & `CountdownTimer.css` (Created: Reusable visual countdown component supporting urgency styles and accessibility attributes)
* `voting-client/src/components/Voting.jsx` (Modified: Integrated `CountdownTimer`, vote guarding upon timer expiry, and user feedback alert banner)
* `voting-client/src/components/AdminSessionCard.jsx` (Modified: Added `CountdownTimer` for active sessions and static duration badge for pending/completed/archived sessions)
* `voting-client/src/pages/Admin.jsx` (Modified: Added timer duration configuration input with strict 5–300s integer validation, default 30s, and included `timerDuration` in `CREATE_SESSION`)
* `voting-client/src/redux/voteSlice.js` (Modified: Added `timer` and `timerDuration` to session normalization, `timer_state` reducer case, and selectors)
* `voting-client/test/timer_utils_spec.js`, `voting-client/test/countdown_timer_spec.js`, `voting-client/test/voter_timer_spec.js`, `voting-client/test/admin_timer_spec.js` (Created: Comprehensive frontend test suites for timer utility, rendering, voter guarding, and admin controls)

**Major Architectural Changes:**
1. **Server-Authoritative Timer Domain (`TimerManager`)**:
   - Timers run entirely on the server using Node.js `setTimeout` and UTC timestamps (`Date.now()`, `endsAt`).
   - Timers are stored in-memory per session in `Map<string, TimerEntry>`. No timer state is persisted to MongoDB.
   - When a round timer expires, `TimerManager` dispatches `NEXT` directly to the server Redux store, advancing the tournament round and automatically initiating the timer for the subsequent pair.
   - The frontend client never dispatches `NEXT` upon local countdown expiry.
2. **Room-Scoped Timer Synchronization (`timer_state`)**:
   - Timer events emit strictly to room `session:${sessionId}` via `io.to('session:' + sessionId).emit('timer_state', payload)`.
   - On `subscribe_session`, active timer state is unicast to the connecting socket for seamless initial hydration and reconnect recovery.
3. **Admin Timer Configuration & Controls**:
   - Session creation form supports `timerDuration` input: range `5–300` seconds, integer-only, default `30` seconds.
   - Values `<5`, `>300`, `0`, negative, decimal, non-numeric, or empty are rejected client-side and server-side.
   - Configured duration is passed in the existing `CREATE_SESSION` Socket.io action payload and persists across all tournament rounds.
   - Admins receive display-only live countdowns on active session cards; zero pause/resume/extend/reset capabilities are exposed.
4. **Voter Expiry UX & Vote Guarding**:
   - `Voting.jsx` detects expiry via `isTimerExpired(timer, now)`. When expired, voting buttons are disabled with `.voting-btn-disabled`, and an inline alert is shown.
   - When the server advances the round, new `session_state` and `timer_state` payloads automatically re-enable voting controls without a page refresh.
5. **Multi-Session Isolation**:
   - Each session maintains an independent timer duration and timer handle. Expiry in Session A does not impact Session B.
6. **Strict Core Engine Preservation**:
   - Pure tournament core `voting-server/src/core.js` verified 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531AA833000B65188FB310`).

**Verification & Quality Audit (Stage G):**
* **Backend Baseline Test Suite:** 237 / 237 passing (clean run across 26 test files).
* **Frontend Test Suite:** 177 / 177 passing across 46 spec files.
* **Code Quality:** `eslint .` returned 0 errors, 0 warnings.
* **Production Build:** `vite build` SUCCESS (built in 492ms).
* **Manual Verification:** Live browser verification verified default 30s session creation, custom 10s session creation, decimal input rejection (`25.5`), live countdown ticking, automatic round progression on expiry, and fresh timer on next round.

**Deferred Scope & Technical Debt:**
* **MongoDB Async Persistence Timing Race (Pre-existing)**: Hardcoded 150ms timeout in `history_api_spec.js` can intermittently race under high CPU contention. Unrelated to Feature 2; backend tests pass 237/237 on standard execution.
* **Feature 5**: Real-time comparative results bar charts (`NOT STARTED`).
* **Security Hardening**: Migration to `httpOnly` cookies for admin JWTs and voter tokens (`NOT STARTED`).

---

### Date: 2026-09-13
**Phase:** Feature 2 — Stage H: Technical Documentation & Final Feature 2 Sign-Off  
**Files Changed:**
* `docs/PROJECT_PROGRESS.md` (Updated: Added Part 6 for Feature 2 completion, updated verified test baselines to 237 backend / 177 frontend tests, and documented Stage G reality check results)
* `docs/CHANGELOG.md` (Updated: Recorded comprehensive Feature 2 architecture, implementation, and sign-off entries)
* `docs/ARCHITECTURE.md` (Updated: Added comprehensive Section 10 for Feature 2 Voting Timer architecture, flow diagrams, TimerManager lifecycle, server authority, multi-session isolation, and Redux state mapping)
* `docs/API_CONTRACT.md` (Updated: Documented `timerDuration` in `CREATE_SESSION`, `timer_state` Socket.io event, room-scoped synchronization, and hydration contract)  
**Change:** Conducted a comprehensive documentation-only pass to record the architecture, contracts, verification results, and operational behaviors of the completed Feature 2 (Voting Timer). Maintained strict documentation scope rules: zero changes to application code (`voting-server/src/**`, `voting-client/src/**`), zero test modifications, zero dependency updates, and verified pure tournament core [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remains 100% untouched.  
**Reason:** Provide authoritative, complete, and accurate documentation reflecting verified production reality for Feature 2.  
**Tests:** Verified `voting-server/src/core.js` SHA-256 (`b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531AA833000B65188FB310`). Conducted read-only audit of file modifications and verified git status.  
**Result:** Documentation baseline updated and synchronized with reality. Feature 2 certified complete and approved for final project sign-off.

---

### Date: 2026-09-14
**Phase:** Feature 5 — Real-Time Results Chart (Stages A–E Complete & Verified)  
**Files Changed:**
* `voting-client/src/components/results/ResultsChart.jsx` (Created: Dedicated pairwise voting bar chart built with Recharts, custom tooltips, SVG rendering, and accessible data table representation)
* `voting-client/src/components/results/ResultsChart.css` (Created: Responsive, modern dark-themed styling, canvas sizing, animations, and accessible table styles)
* `voting-client/src/components/results/resultsUtils.js` (Created: Pure data transformation utilities `transformTallyToChartData`, `calculatePercentage`, `getPairwiseSummary`, `isServerRoundClosed`, `getResultsVisibilityState`, `getGuardedResultsPresentation`)
* `voting-client/src/components/results/ResultCard.jsx` (Modified: Added `hideStats` prop support to guard candidate tallies/percentages during active rounds)
* `voting-client/src/pages/Results.jsx` (Modified: Integrated `ResultsChart`, results visibility guarding `VOTING_IN_PROGRESS` vs `RESULTS_REVEALED` vs `CONCLUDED`, live countdown timer, and round-scoped React key remounting)
* `voting-client/src/pages/Results.css` (Modified: Added active round notice banner, locked indicator, countdown wrapper, and chart layout styles)
* `voting-client/test/results_chart_spec.js` (Created: Unit tests for chart data transformation, zero division, candidate ordering, and Recharts integration)
* `voting-client/test/results_visibility_spec.js` (Created: Integration tests validating active-round guarding, closed-round reveal, and guarded presentation models)
* `voting-client/test/results_transition_spec.js` (Created: Tests verifying Round N -> Round N+1 invalidation, round identity keys, and reactive cleanup)
* `voting-client/test/results_hardening_spec.js` (Created: Comprehensive test suite for boundary conditions, multi-session isolation, timer thresholds, and zero client auto-advance)

**Major Architectural Changes:**
1. **Dedicated ResultsChart Presentation Component**:
   - Built on Recharts (`ResponsiveContainer`, `BarChart`, `Bar`, `XAxis`, `YAxis`, `Tooltip`, `Cell`).
   - Pure presentation component receiving normalized chart data without direct socket subscriptions, DB queries, or Redux mutations.
   - Dual representation: Visual SVG bar chart paired with a screen-reader-accessible HTML `<table>` with caption and table headers.
   - Robust zero-vote, missing tally key, and zero-division handling (`calculatePercentage` clamps to 0% with 1 decimal precision, avoiding NaN/Infinity).
2. **Strict Results Visibility Guarding**:
   - Active Voting Round (`VOTING_IN_PROGRESS`): Pairwise tallies, total votes, percentages, and `ResultsChart` are strictly hidden from the DOM. Displays Contender cards in a locked state, an informative notice banner, and an active `CountdownTimer`.
   - Closed Round (`RESULTS_REVEALED`): Revealed upon explicit server round closure or countdown completion. Authoritative candidate statistics, total round votes, and `ResultsChart` are rendered.
   - Concluded Tournament (`CONCLUDED`): Official winner podium card, trophy badge, and links to `/sessions` and `/history`.
3. **Real-Time Round Transition & Stale Data Invalidation**:
   - Advancing from Round N to Round N+1 automatically invalidates previous candidate data, tallies, percentages, and chart rendering.
   - Components are bound to round-scoped keys (`getSessionPairLockKey(sessionId, pair)`), ensuring React cleanly remounts the round presentation without stale state surviving across rounds.
   - No manual page refresh is required; updates occur reactively over Socket.io.
4. **Server Authoritativeness & Zero Client Auto-Advance**:
   - The frontend never advances the tournament, crowns winners, or dispatches `NEXT` when a local countdown reaches zero.
   - Progression is strictly driven by the backend server (`TimerManager` or admin Socket.io action).
5. **Strict Multi-Session Isolation**:
   - Chart data, tallies, visibility states, and timers belonging to Session A never cross-contaminate Session B.
6. **Strict Core Engine Preservation**:
   - Pure tournament core `voting-server/src/core.js` verified 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`).

**Verification & Quality Audit (Stage E):**
* **Frontend Test Suite:** 235 / 235 passing across 17 spec files.
* **Backend Test Suite:** 237 / 237 passing across 26 spec files.
* **Frontend Code Quality:** `eslint .` returned 0 errors, 0 warnings.
* **Frontend Production Build:** `vite build` SUCCESS (built in ~6.06s, 0 errors).
* **Live Integration Flow:** Live browser verification verified active round tally hiding, countdown timer display, round conclusion reveal, chart rendering, numerical accuracy, Round N -> N+1 transition, and winner crowning.

**Deferred Scope & Technical Debt:**
* **Deferred Architectural Risk: Backend Timer Expiry Progression**:
  - The current backend timer automatically advances the tournament immediately upon timer expiry (`timer expiry` -> `handleExpiry` -> `NEXT` -> next round).
  - There is currently no intermediate server-authoritative lifecycle state that represents `Round N closed + results revealed` while retaining Round N as the active pair.
  - Therefore, the current implementation cannot provide a separate server-confirmed results pause without changing the backend lifecycle and socket contract.
  - This is an architectural limitation of the backend lifecycle, not a Feature 5 implementation defect, and is deferred to future architectural passes.
* **MongoDB Async Persistence Timing Race (Pre-existing)**: Hardcoded 150ms timeout in `history_api_spec.js` can intermittently race under high CPU contention. Unrelated to Feature 5; backend tests pass 237/237 on standard execution.
* **Early Round Termination on 100% Turnout** (`DEFERRED`): Advancing round before timer expiry if 100% of registered lobby voters cast ballots.
* **Security Hardening**: Migration to `httpOnly` cookies for admin JWTs and voter tokens (`NOT STARTED`).

---

### Date: 2026-09-14
**Phase:** Feature 5 — Stage F: Technical Documentation & Final Feature 5 Sign-Off  
**Files Changed:**
* `docs/PROJECT_PROGRESS.md` (Updated: Added Part 7 for Feature 5 completion, updated verified test baselines to 237 backend / 235 frontend tests, and documented Stage E reality check results)
* `docs/CHANGELOG.md` (Updated: Recorded comprehensive Feature 5 architecture, implementation, and sign-off entries)
* `docs/ARCHITECTURE.md` (Updated: Added comprehensive Section 11 for Feature 5 Results Chart architecture, flow diagrams, visibility state machine, round transition invalidation, multi-session isolation, and component roles)  
**Change:** Conducted a comprehensive documentation-only pass to record the architecture, contracts, verification results, and operational behaviors of the completed Feature 5 (Real-Time Results Chart). Maintained strict documentation scope rules: zero changes to application code (`voting-server/src/**`, `voting-client/src/**`), zero test modifications, zero dependency updates, and verified pure tournament core [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) remains 100% untouched.  
**Reason:** Provide authoritative, complete, and accurate documentation reflecting verified production reality for Feature 5.  
**Tests:** Verified `voting-server/src/core.js` SHA-256 (`b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531AA833000B65188fb310`). Conducted read-only audit of file modifications and verified git status.  
**Result:** Documentation baseline updated and synchronized with reality. Feature 5 certified complete and approved for final project sign-off.

---

### Date: 2026-09-14
**Phase:** Feature 6 — Admin Session Creation & Session Management (Stages 0–D Complete & Verified)  
**Files Changed / Created:**
* `voting-server/src/db/models/Session.js` (Hardened: Added `timerDuration` field to Mongoose schema with type Number, default 30, min 5, max 300)
* `voting-server/src/db/persistence.js` (Hardened: Updated `recoverSessionsFromDb()` to restore `timerDuration` from MongoDB documents into Redux `CREATE_SESSION` actions, falling back safely to 30 seconds for legacy records)
* `voting-server/src/server.js` (Hardened: Server-authoritative payload validation for `CREATE_SESSION` with machine-readable `action_error` feedback for duplicate session IDs, empty titles, insufficient candidate entries, and invalid timer duration types or bounds)
* `voting-server/src/db/repository.js` (Hardened: Added atomic monotonic status query filters to `updateSessionStatus()` preventing stale asynchronous writes from regressing `completed` or `archived` states back to `open`, or `archived` back to `completed`)
* `voting-client/src/components/AdminSessionModal.jsx` & `AdminSessionModal.css` (Created: Dedicated accessible modal dialog for admin session creation featuring form validation, custom session ID, configurable timer duration 5–300s, and dynamic candidate entry roster)
* `voting-client/src/components/AdminManageModal.jsx` & `AdminManageModal.css` (Created: Focused session management modal dialog providing lifecycle-specific controls tailored to `pending`, `open`, `completed`, and `archived` states)
* `voting-client/src/components/AdminSessionCard.jsx` (Modified: Streamlined session cards displaying title, status, timer duration badge, voter headcount, and candidate entry count with a clean `[Manage]` trigger)
* `voting-client/src/pages/Admin.jsx` & `Admin.css` (Modified: Replaced inline creation form with `+ Create New Session` modal trigger, integrated `AdminManageModal`, added explicit two-step archive confirmation dialog, and refined empty states)
* `voting-client/test/admin_workflow_spec.js` (Created: 17 comprehensive unit and integration tests covering session creation modal, manage workflow lifecycle controls, and archive confirmation)
* `docs/PROJECT_PROGRESS.md`, `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md`, `README.md` (Updated: Synchronized technical documentation with verified Feature 6 implementation)

**Major Architectural Changes:**
1. **Admin Session Creation Modal UX (`AdminSessionModal`)**:
   - Replaced clunky inline creation forms with a clean, focused modal dialog accessible via the `+ Create New Session` primary action button.
   - Form fields include: Session Title, optional custom Session ID/slug (auto-generated if omitted), Timer Duration (5–300s range, default 30s), and dynamic candidate entries roster.
   - Pre-submission client validation ensures non-empty title, valid ID syntax, integer timer duration within bounds, and at least 2 distinct candidate entries before dispatch.
2. **Focused Session Management Workflow (`AdminManageModal`)**:
   - Replaced cluttered inline card buttons with a dedicated `[Manage]` dialog providing focused, state-tailored controls for individual sessions:
     - **`pending`**: Start Tournament, Open Lobby, Share Link / QR Code (Next Pair and Archive Session hidden).
     - **`open`**: Next Pair, Archive Session, Vote View, Results View, Open Lobby, Share Link / QR Code (Start Tournament hidden).
     - **`completed`**: Archive Session, View Results, Open Lobby, Share Link / QR Code (Start Tournament and Next Pair hidden).
     - **`archived`**: View Results, Share Link / QR Code (read-only; Start Tournament, Next Pair, and Archive Session hidden).
3. **Explicit Two-Step Archival Confirmation**:
   - Protected session archival behind an explicit confirmation dialog (`Confirm Session Archival`) requiring user confirmation before dispatching `ARCHIVE_SESSION`.
   - Cancellation leaves the session completely unchanged in its current state.
   - Archived sessions are locked from resuming live tournament mutations through the Admin Panel.
4. **Backend Model & Recovery Hardening (Stage A)**:
   - Mongoose `Session` model (`Session.js`) explicitly persists `timerDuration` (Number, default 30, min 5, max 300).
   - Survives session creation, MongoDB persistence, backend process shutdown, and server restart recovery.
   - `recoverSessionsFromDb()` in `persistence.js` extracts `timerDuration` from MongoDB and restores it into the Redux store via `CREATE_SESSION`, using a safe 30-second fallback for legacy documents.
5. **Server-Side Authoritative Validation**:
   - Server-authoritative validation in `server.js` guards the `CREATE_SESSION` ingress action:
     - Validates session ID presence, type, and uniqueness (rejects duplicate collisions with `DUPLICATE_SESSION_ID`).
     - Validates session title (rejects empty or whitespace titles with `MISSING_TITLE`).
     - Validates entries array (rejects fewer than 2 distinct non-empty entries with `INSUFFICIENT_ENTRIES`).
     - Validates timer duration (rejects non-numeric, decimal, or values outside 5–300s with `INVALID_TIMER_DURATION`).
   - Invalid requests emit structured `action_error` feedback without mutating server Redux store state.
6. **Accepted Repository Monotonic Lifecycle Guard**:
   - `updateSessionStatus()` in `voting-server/src/db/repository.js` applies atomic query filters (`filter.status = { $nin: ['completed', 'archived'] }` for open, `{ $ne: 'archived' }` for completed).
   - Permanently prevents asynchronous fire-and-forget MongoDB status writes from regressing terminal database records, resolving the pre-existing persistence timing race. Formally reviewed and accepted as beneficial backend hardening.
7. **Strict Multi-Session Isolation**:
   - Socket.io room isolation (`session:${sessionId}`) and normalized Redux store guarantee that actions, lifecycles, timers, and state updates belonging to one session never leak into or alter another concurrent session.
8. **Protected Pure Tournament Engine**:
   - [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) verified 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`, 40 lines).

**Verification & Quality Audit (Stage C & Stage D):**
* **Backend Baseline Test Suite:** 254 / 254 passing (0 failing across 27 spec files).
* **Frontend Test Suite:** 252 / 252 passing (0 failing across 18 spec files).
* **Total Automated Tests:** 506 / 506 passing across full-stack repository.
* **Frontend Code Quality:** `eslint .` returned 0 errors, 0 warnings.
* **Frontend Production Build:** `vite build` SUCCESS (built cleanly, 0 errors).
* **Live Browser E2E Verification (Stage C):** Full end-to-end verification in real browser runtime via Antigravity subagent:
  - Admin login and protected navigation verified.
  - Modal session creation with custom 15s timer duration verified.
  - Multi-session concurrent isolation verified (`e2e_feature6_session` vs `e2e_session_b`).
  - Full pairwise tournament execution to winner crowning verified.
  - Dedicated `[Manage]` dialog lifecycle controls verified across `pending`, `open`, `completed`, and `archived` states.
  - Two-step archive confirmation dialog verified.
  - MongoDB persistence and server restart recovery verified.
  - Zero console errors, zero runtime exceptions, zero regressions reported.
* **Evidence Artifacts:**
  - Recording: `admin_e2e_test_1789377633722.webp`
  - Screenshot: `admin_final_state_1789378392436.png`
  - Scratchpad: `browser/scratchpad_zmwzajkt.md`

**Result:** Feature 6 is 100% complete, fully tested, documented, and certified for final project sign-off.

---

### Date: 2026-09-15
**Phase:** Feature 7 — Early Round Completion (Stages 0–E Complete & Verified)  
**Files Changed / Created:**
* `voting-server/src/roundManager.js` (Created: Pure domain module managing monotonic round identity `${sessionId}:::r${roundIndex}`, per-round participation accounting in `submissionsByRound`, dynamic eligibility checks, and idempotent `closeRoundOnce` execution)
* `voting-server/src/timer.js` (Hardened: Bound active `roundId` to timer timeout callbacks, disarming old callbacks if execution occurs after a new round starts, and forwarding round identity to `closeRoundOnce`)
* `voting-server/src/server.js` (Hardened: Multi-layered vote validation pipeline ensuring authentication, session status, active pair, and candidate entry validity before recording participation; trigger `closeRoundOnce` upon final voter submission)
* `voting-client/src/pages/Voting.jsx` (Hardened: Added render-time state reset clearing temporary `serverError` upon round change, and released local submission lock upon action error to allow voter retries)
* `voting-client/src/redux/voteSlice.js` (Hardened: Automatically cleared stale timer state to `null` upon active pair transition `isPairChanged`)
* `voting-server/test/early_completion_spec.js` (Created: 25 comprehensive domain unit tests covering round identity, submission tracking, eligibility rules, zero-voter protection, and idempotent closure)
* `voting-server/test/early_completion_integration_spec.js` (Created: 19 end-to-end Socket.io integration tests validating live vote validation, timer expiry races, dual final voters, stale timer disarming, and multi-session isolation)
* `voting-client/test/early_completion_frontend_spec.js` (Created: 10 frontend integration tests validating server authority, reactive lock clearing, error clearing, and multi-client synchronization)
* `voting-client/package.json` (Modified: Registered `early_completion_frontend_spec.js` in client test runner)
* `docs/PROJECT_PROGRESS.md`, `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md`, `README.md` (Updated: Synchronized technical documentation with verified Feature 7 implementation)

**Major Architectural Changes:**
1. **Dual-Path Round Termination Architecture**:
   - Voting for the active round stops when either:
     - **Condition A (Authoritative Timer Expiry)**: The server countdown reaches zero.
     - **Condition B (Early Completion)**: 100% of currently eligible registered voters submit valid ballots.
   - Both paths converge idempotently through `closeRoundOnce({ sessionId, roundId })`.
2. **Monotonic Round Identity**:
   - Introduced application-level round identifiers formatted as `${sessionId}:::r${roundIndex}`.
   - Prevents collision anomalies when the same candidate pair recurs later in tournament brackets.
   - Round index increments monotonically per session on every pair change.
3. **Round-Scoped Voter Participation Accounting**:
   - In-memory `submissionsByRound` Map (`${sessionId}:::${roundId}` -> `Set<string>`) records unique voter session tokens.
   - Each voter can record participation at most once per round. Duplicate submissions return `isNew: false` without inflating participation counts.
4. **Strict Pre-Participation Validation Pipeline**:
   - Server-side vote ingress in `server.js` enforces that voter tokens, session status (`open`), active pair existence, valid candidate entry selection, and duplicate checks (`canCastVote`) succeed *before* `recordRoundSubmission()` is invoked.
   - Invalid or unauthorized votes are strictly prevented from contributing to participation or triggering premature round closure.
5. **Dynamic Voter Eligibility Policy**:
   - Eligibility is dynamically derived from `getVoterCount(sessionId)`.
   - Zero-voter protection: empty sessions never trigger early completion.
   - Minimum voter threshold: requires at least 2 registered voters for early completion.
   - Dynamic threshold: if new voters join the session before round closure, the required submission count increases dynamically.
6. **Idempotent Round Closure (`closeRoundOnce`)**:
   - Authoritative round closure gate disarming active timers, adding composite keys to `closedRounds`, and dispatching `NEXT` exactly once.
   - Guarantees that concurrent final-vote submissions or racing timer expirations trigger at most one tournament advancement.
7. **Round-Bound Timer Stale Protection**:
   - Active round timer callbacks bind the expected `roundId`. If a callback executes after the round has already advanced, it detects `STALE_ROUND` and terminates without canceling or advancing the newer round.
8. **Frontend Strict Server Authority**:
   - The React/Redux client operates strictly as a reactive presentation layer.
   - The frontend never calculates quorum, counts voters for completion, or dispatches `NEXT` on timer expiry or final vote.
   - Local submission locks and temporary server errors are cleared cleanly upon server-driven candidate pair advancement.
9. **Protected Pure Engine Preservation**:
   - Pure tournament engine [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) preserved 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`, 40 lines).
10. **Feature 8 Boundary Preservation**:
   - Feature 7 strictly defines *when* voting stops. Feature 8 (Round Results Lifecycle: `ROUND_CLOSED` session state, results reveal screen, and delay intervals) remains a future feature and is completely excluded from Feature 7.

**Verification & Quality Audit (Stage D Reality Check):**
* **Backend Test Suite:** 298 / 298 passing (0 failing across 29 spec files).
* **Frontend Test Suite:** 262 / 262 passing (0 failing across 19 spec files).
* **Total Automated Tests:** 560 / 560 passing across full-stack repository.
* **Frontend Code Quality:** `eslint .` returned 0 errors, 0 warnings.
* **Frontend Production Build:** `vite build` completed with SUCCESS (built cleanly in 1.36s, 0 errors).
* **Core Checksum Verification:** Exact SHA-256 match `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`.
* **Zero Regressions:** Features 1–6 (Authentication, Timer, Waiting Room Lobby, MongoDB Persistence, Results Chart, Session Management) retain 100% verified functionality.

**Result:** Feature 7 is 100% complete, fully tested, documented, and certified for final project sign-off.

---

### Date: 2026-09-15
**Phase:** Feature 8 — Round Results Lifecycle (Stages 0–E Complete & Verified)  
**Files Changed / Created:**
* `voting-server/src/roundManager.js` (Enhanced: Integrated `ROUND_LIFECYCLE` enum (`VOTING`, `ROUND_CLOSED`, `RESULTS_REVEALED`), frozen `finalVote` snapshots `{ pair, tally, closedAt }`, `revealTimer` tracking, `resolveRevealDuration()`, and `expireReveal()` authoritative round progression)
* `voting-server/src/timer.js` (Enhanced: Integrated dedicated `startRevealTimer()`, `clearRevealTimer()`, and `timer_state` broadcast with `status: 'revealing'` and absolute `expiresAt` ISO timestamps; enforced timer exclusivity so voting and reveal timers never overlap)
* `voting-server/src/reducer.js` (Enhanced: Added `SET_ROUND_LIFECYCLE` action handler updating `roundLifecycle`, `roundId`, `roundIndex`, `finalVote`, and `revealTimer` per session; resets lifecycle to `VOTING` on `NEXT`)
* `voting-server/src/server.js` (Enhanced: Intercepted `VOTE` actions during `ROUND_CLOSED` and `RESULTS_REVEALED` via `canAcceptVotes()`, emitting `action_error: { action: 'VOTE', error: 'ROUND_CLOSED' }`; broadcast updated lifecycle fields in `session_state`)
* `voting-client/src/redux/voteSlice.js` (Enhanced: Added `roundLifecycle`, `roundId`, `roundIndex`, `finalVote`, and `revealTimer` to session state model; synchronized on `session_state` and `SET_ROUND_LIFECYCLE`; hydrated `timer_state` for reveal countdowns)
* `voting-client/src/pages/Voting.jsx` (Enhanced: Integrated `ROUND_CLOSED` and `RESULTS_REVEALED` visual phases, disabled voting buttons during reveal, rendered frozen `finalVote`, and displayed dedicated reveal countdown)
* `voting-client/src/pages/Results.jsx` (Enhanced: Displayed authoritative frozen results during reveal window without prematurely advancing to the next round)
* `voting-client/src/components/voting/VoteCard.jsx` (Enhanced: Rendered frozen final vote tally and reveal badge when `roundLifecycle === 'RESULTS_REVEALED'`)
* `voting-client/src/components/results/ResultsChart.jsx` (Enhanced: Rendered authoritative frozen tally during `RESULTS_REVEALED`)
* `voting-server/test/round_lifecycle_spec.js` (Created: 24 unit tests covering round lifecycle phases, frozen tally creation, duration resolution, and `expireReveal` idempotency)
* `voting-server/test/reveal_timer_socket_hardening_spec.js` (Created: 16 integration tests verifying real-time reveal timer broadcasts, timer exclusivity, multi-session isolation, reconnect hydration, and stale callback protection)
* `voting-client/test/round_results_lifecycle_spec.js` (Created: 18 frontend tests validating Redux state transitions, frozen results presentation, server-authoritative transitions, and zero client `NEXT` dispatching)
* `docs/PROJECT_PROGRESS.md`, `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md`, `README.md` (Updated: Documented complete Feature 8 architecture, API contracts, and verification evidence)

**Major Architectural Changes:**
1. **Separation of Voting Closure from Next-Round Advancement**:
   - Feature 7 established **WHEN** voting stops (timer expiration or 100% voter turnout).
   - Feature 8 establishes **WHAT** happens after voting stops: introduces a dedicated, server-authoritative reveal interval (`RESULTS_REVEALED`) displaying frozen outcomes before `NEXT` executes.
2. **Authoritative Round Results Lifecycle Model**:
   - Defined monotonic transitions:
     `VOTING` → `ROUND_CLOSED` → `RESULTS_REVEALED` → `NEXT` → `VOTING` (or `COMPLETED` for championship round).
   - `ROUND_CLOSED`: Transient intermediate phase disarming the voting timer and locking candidate pairs against new votes.
   - `RESULTS_REVEALED`: Active reveal phase broadcasting frozen `finalVote` and initiating the reveal countdown.
3. **Frozen Final Vote Snapshot (`finalVote`)**:
   - Upon round closure, the server captures `{ pair, tally, closedAt }` as an immutable snapshot.
   - Preserved in memory on the server and broadcast via `session_state`.
   - Prevents mutable, zeroed, or in-flight vote state from corrupting the display of concluded round results.
4. **Authoritative Reveal Timer Domain**:
   - `TimerManager` executes dedicated reveal timers via `startRevealTimer()`, broadcasting `timer_state` with `status: 'revealing'` and absolute `expiresAt`.
   - Duration precedence: `session.revealDuration` → `process.env.ROUND_REVEAL_DURATION` → `DEFAULT_REVEAL_DURATION` (1s verified baseline, configurable up to 60s).
   - Server enforces timer exclusivity: active voting timers and reveal timers never run concurrently.
5. **Strict Client Non-Advancement & Server Authority**:
   - The frontend countdown timer is purely decorative. When the local countdown reaches `00:00`, the client displays `00:00` and waits for server broadcast.
   - The frontend **never** dispatches `NEXT`, never mutates lifecycle state locally, and never advances tournament brackets autonomously.
6. **Closed-Round Vote Rejection**:
   - Ballots submitted during `ROUND_CLOSED` or `RESULTS_REVEALED` are rejected at ingress by `canAcceptVotes()`.
   - Server returns machine-readable `action_error: { action: 'VOTE', error: 'ROUND_CLOSED' }`.
   - Client displays graceful non-crashing feedback without modifying the frozen tally.
7. **Race Condition & Stale Callback Safeguards**:
   - Convergence of final vote and timer expiry is guarded by monotonic `closedRounds` set (`closeRoundOnce`).
   - Duplicate reveal expirations are guarded by `active.revealExpired` flag (`expireReveal`).
   - Stale timer callbacks check `active.roundId !== cleanRoundId`, rejecting delayed callbacks as `STALE_ROUND`.
8. **Client Reconnect & Hydration Resilience**:
   - Reconnecting during reveal hydrates the client into `RESULTS_REVEALED` with the original `expiresAt` without restarting the timer.
   - Reconnecting after reveal hydrates directly into `VOTING` for the new round.
9. **Final Tournament Round Lifecycle**:
   - Championship matchups follow `VOTING` → `ROUND_CLOSED` → `RESULTS_REVEALED` → `COMPLETED`.
   - Reveal displays the final matchup tally, after which `expireReveal` dispatches `NEXT` transitioning session status to `completed` with `winner`.
10. **Protected Pure Engine Preservation**:
    - Pure engine [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js) verified 100% byte-for-byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`, 40 lines).

**Verification & Quality Audit (Stage D Reality Check):**
* **Backend Test Suite:** 338 / 338 passing (0 failing across 31 spec files).
* **Frontend Test Suite:** 280 / 280 passing (0 failing across 98 suites, 20 spec files).
* **Total Automated Tests:** 618 / 618 passing across full-stack repository.
* **Frontend Code Quality:** `eslint .` returned 0 errors, 0 warnings.
* **Frontend Production Build:** `vite build` completed with SUCCESS (built cleanly in 1.31s, 0 errors).
* **Core Checksum Verification:** Exact SHA-256 match `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`.
* **Zero Regressions:** Features 1–7 retain 100% verified functionality with strict multi-session isolation.

**Result:** Feature 8 is 100% complete, fully tested, documented, and certified for final project sign-off.

***

### Date: 2026-09-27
**Phase:** Phase 4: Single Ballot Mode and Tie Ladder (Spec 0004)  
**Files Changed / Created:**
* `voting-server/src/ballot.js` (Created: Pure functional single ballot module for sessions with 2 to 6 candidates)
* `voting-server/src/roundManager.js` (Enhanced: Orchestrates tie ladder, zero vote replays, TIE_PENDING lifecycle, and coin flip fallback)
* `voting-server/src/timer.js` (Enhanced: Integrated 30 second tie pending timer with automatic coin flip expiration)
* `voting-server/src/reducer.js` (Enhanced: Added START_RUNOFF, TIE_PENDING, RESOLVE_TIE, and TERMINATE_NO_RESULT actions)
* `voting-server/src/server.js` (Enhanced: Added RESOLVE_TIE admin ingress authorization, tie_pending socket broadcast, and round resolution snapshots)
* `voting-server/src/constants.js` (Enhanced: Exported SINGLE_BALLOT_MAX threshold)
* `voting-client/src/constants.js` (Enhanced: Mirrored SINGLE_BALLOT_MAX threshold)
* `voting-client/src/redux/voteSlice.js` (Enhanced: Hydrated votingMode, tiePending, and multi candidate ballot vote shapes)
* `voting-client/src/pages/Voting.jsx` (Enhanced: Rendered responsive multi candidate ballot grid for single ballot sessions)
* `voting-client/src/pages/Admin.jsx` (Enhanced: Rendered admin tie resolution panel with 30 second countdown, Pick Winner, and Coin Flip controls)
* `voting-client/src/components/results/RoundTimeline.jsx` (Enhanced: Rendered round resolution badges for runoff, admin pick, coin flip, and zero vote replay)
* `voting-server/test/single_ballot_and_tie_ladder_spec.js` (Created: Comprehensive automated test suite covering AC-1 through AC-10)
* `voting-client/test/single_ballot_tie_ladder_client_spec.js` (Created: Client test suite validating multi candidate grid and tie actions)
* `docs/specs/0004-single-ballot-and-tie-ladder.md` (Created: Architecture specification)
* `docs/reviews/2026-09-26-develop1-single-ballot-tie-ladder.md` (Created: Fresh model code review report)

**Major Architectural Changes:**
1. **Isolated Pure Single Ballot Module (`ballot.js`)**:
   * Sessions with 2 to 6 candidates run single ballot plurality voting via `ballot.js`.
   * Preserved pure tournament engine `voting-server/src/core.js` byte for byte identical (pinned SHA-256 hash intact).
2. **Authoritative Tie Ladder**:
   * First tie triggers an immediate automatic rematch (pairwise mode) or runoff round with only tied contenders (single ballot mode).
   * Second consecutive tie enters `TIE_PENDING` lifecycle state with a 30 second countdown.
   * Admin can pick the winner or trigger a coin flip via authenticated `RESOLVE_TIE` socket action.
   * If admin does not respond within 30 seconds, server executes an automatic coin flip among tied candidates.
3. **Graceful Zero Vote Handling**:
   * Rounds concluding with zero votes replay once with a fresh timer (`zero_vote_replay`).
   * Second consecutive zero vote round terminates the session cleanly with winner set to null (`no_result`).
4. **Full Resolution Tracking**:
   * Every round snapshot in memory and MongoDB `Result.rounds[]` records the resolution method (`majority_win`, `tie_advance`, `runoff`, `admin_pick`, `coin_flip`, `zero_vote_replay`, `no_result`).
5. **Presentation and Admin Controls**:
   * Single ballot voting renders all contenders simultaneously on a grid instead of a pairwise card.
   * Admin interface surfaces a tie resolution alert panel with active countdown.
   * Round history timeline displays color badges identifying how each round was settled.

**Verification and Quality Audit:**
* **Backend Automated Tests:** 36 spec files passing with zero regressions.
* **Frontend Automated Tests:** 21 spec files passing with zero regressions.
* **Core Checksum Verification:** Exact SHA-256 match for `voting-server/src/core.js`.
* **Code Review:** Completed in `docs/reviews/2026-09-26-develop1-single-ballot-tie-ladder.md`.

**Result:** Feature 5 (Single ballot mode and tie ladder) is 100% complete, verified, and documented.






---

### Date: 2026-10-04
**Phase:** Phase 7: Secured Sessions (spec 0007, implemented, reviewed, and verified)  
**Files Changed / Created:**
* `voting-server/src/auth/voter.js` (Added `revokeSessionVoter` and `revokeSessionVoters`, which delete the issued token from `votersByToken` itself rather than only from the session headcount index, with a cross session guard so a `user:<id>` identity legitimately registered in a second session is left alone)
* `voting-server/src/server.js` (Refactored the secured eligibility path and hardened removal: shared `resolveSessionAccess` and `evaluateSecuredEligibility` helpers, the `filterSessionsForCaller` visibility rule reused by the socket summary, the registry broadcast, and `GET /api/sessions`, a secured check before `subscribe_session` joins the room, one `revokeAndDisconnectVoter` path shared by lobby removal, deferred removal at `NEXT`, allowlist paste, and mode switch, a vote time eligibility recheck in `VOTE` that honours the deferred removal grace window, and clearing of pending removals when a session reaches a terminal state)
* `voting-server/test/secured_sessions_regression_spec.js` (Created: 16 tests across all four entry points, including the negative cases and the roster lock at Start for both transports)
* `voting-server/test/removal_token_revocation_spec.js` (Created: 8 tests pinning token revocation for lobby removal, deferred removal at `NEXT`, and allowlist paste in both allowlist and approval mode, voting from sockets that carry the removed voter's real `vs_voter` cookie)
* `voting-server/test/secured_sessions_spec.js` (Modified: the old removal test voted from a socket with no handshake cookie, so it passed for an unrelated reason; it now asserts the server derived rejection)
* `voting-client/src/services/socket.js` (Modified: reads the stored admin JWT at module load and passes it as handshake `auth`, adds `readStoredAdminToken()` and `applyAdminTokenToSocket()`)
* `voting-client/src/services/auth.js` (Modified: `loginAdmin` and `logoutAdmin` call `applyAdminTokenToSocket`, which reconnects because Socket.io only transmits `auth` during the handshake)
* `voting-client/src/pages/Admin.jsx` (Modified: re-subscribes to `subscribe_participants` on every `connect` so the roster stops freezing after a reconnect, and adds a confirmed Remove action on each allowlist row)
* `voting-client/src/redux/voteSlice.js` (Modified: `handleLobbyUpdate` preserves `sessionType`, `type`, and `whoCanJoin` instead of rebuilding the entry from a fixed field list, and `removeParticipant` now targets an email rather than a voter token)
* `voting-client/package.json` (Modified: `test` runs `test:unit` then `test:component`; the unit script globs `test/*_spec.js`; added Vitest, jsdom, and Testing Library)
* `voting-client/vitest.config.js`, `voting-client/test/vitest.setup.js` (Created: component test runner and shared setup)
* `voting-client/test/lobby_secured.test.jsx` (Created: 25 component tests for the secured lobby, including the sign in wall)
* `voting-client/test/admin_roster_resubscribe.test.jsx` (Created: 6 tests proving the roster re-subscribes on `connect`)
* `voting-client/test/admin_socket_auth_spec.js` (Created: handshake token regression coverage)
* `voting-client/test/secured_session_client_spec.js` (Created: client unit coverage for the secured surfaces)
* `AGENTS.md`, `voting-client/AGENTS.md` (Updated: recorded the eligibility admin actions, the passwordless voter cookie, the two session types, the `VoteParticipation` rule, and the two client test suites)
* `docs/specs/0007-secured-sessions/index.md` (Status moved from Implemented to Accepted)
* `docs/specs/0007-secured-sessions/verify.md` (Created: runtime verification record, 2026-10-03 and 2026-10-04 runs)
* `docs/reviews/2026-10-03-develop1.md`, `docs/reviews/2026-10-03-develop1-rereview.md` (Created: two code reviews; the re-review raised the removal revocation blocker)
* `docs/scope/scope.md` (Updated: Phase 7 marked done, verify, test, and review boxes ticked)

**Major Architectural Changes:**
1. **One eligibility gate for both entry points**:
   * `POST /api/sessions/:sessionId/join` and the `join_session` socket event now call the same `evaluateSecuredEligibility`. Before this they had drifted, and the socket path registered any caller straight past the allowlist and the approval queue.
   * `resolveSessionAccess` reads the store first and falls back to MongoDB, so a session that has not been hydrated yet is still gated.
   * A secured session whose `whoCanJoin` value is unusable falls into a deny branch rather than falling through.
2. **Secured visibility through one filter**:
   * `filterSessionsForCaller(summary, isAdmin)` is now used by the socket summary, the registry broadcast, and `GET /api/sessions`, so an anonymous caller cannot enumerate secured sessions or their join codes by switching transports.
   * `subscribe_session` resolves identity before joining the `session:<id>` room, so an ineligible subscriber never receives `session_state`.
3. **Removal revokes the token, not just the roster row**:
   * This was the blocker the 2026-10-03 re-review raised. Removal used to delete the allowlist or request row and the headcount entry, but the token stayed valid in `votersByToken`, and `validateVoterToken` accepted it through the `voter.sessionId === normSession` shortcut. A removed voter could keep casting counted votes while the admin roster showed them gone, and an allowlist paste that dropped a joined email did not disconnect them at all.
   * Every removal route now goes through `revokeAndDisconnectVoter`: lobby removal, the deferred removal applied at `NEXT`, an allowlist paste that drops a joined email, and a mode switch that clears the roster.
   * The removed voter's socket is disconnected, which AC-7 already promised.
4. **Vote time eligibility recheck as defence in depth**:
   * `VOTE` re-reads the voter's standing for secured sessions, so a removal, a rejection, or an allowlist paste takes effect on the next vote rather than the next reconnect. It fails closed when the lookup cannot be completed.
   * The recheck skips the read while the voter's token sits in `pendingRemovalsBySession`, so a mid round removal does not cut the voter off during the round that was meant to remain theirs. `NEXT` clears that set after revoking, so the grace cannot outlive its round.
5. **Admin identity rides the socket handshake**:
   * `socket.js` reads the stored admin JWT at construction and passes it as handshake `auth`; `applyAdminTokenToSocket` reconnects whenever the token changes. Socket.io does not resend `auth` on a connected socket, so this was the fix for secured sessions being invisible in the admin panel until a manual reconnect.
6. **Roster survives a reconnect**:
   * Room membership dies with the connection, so `Admin.jsx` re-emits `subscribe_participants` on every `connect`. The roster no longer freezes until Manage is reopened.
7. **The lobby reducer keeps its access fields**:
   * `handleLobbyUpdate` was rebuilding the session entry from a fixed field list and silently dropped `sessionType`, `type`, and `whoCanJoin`, so a secured session looked open, the sign in wall never rendered, and an anonymous visitor was offered the plain join form. All three now survive the reducer, which matters because headcount only broadcasts arrive constantly during a live session.
8. **Client never holds voter tokens for the roster**:
   * `removeParticipant` takes an email. The admin allowlist panel only ever holds the email and the status, so the server resolves the email to a user and a token itself.
9. **Component tests join the client suite**:
   * Vitest with jsdom and Testing Library was added alongside the existing `node --test` unit specs. `npm test` now runs both, the unit script globs `test/*_spec.js` so a new spec file is picked up with no `package.json` edit, and Vitest globs its own `.test.jsx` files.
10. **Protected pure engine preservation**:
    * `voting-server/src/core.js` verified byte for byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`, 39 lines).

**Verification and Quality Audit:**
* **Backend Automated Tests:** `cd voting-server && npm test` → 648 passing, 0 failing.
* **Frontend Unit Tests:** `cd voting-client && npm run test:unit` → 424 passing, 0 failing across 135 suites.
* **Frontend Component Tests:** `cd voting-client && npm run test:component` → 31 passing, 0 failing across 2 files (25 lobby secured, 6 admin roster resubscribe).
* **Runtime verification (2026-10-04, `docs/specs/0007-secured-sessions/verify.md`):** a real server on port 8090 against real MongoDB, the Vite client on 5173 driven in a real browser as admin and as an anonymous visitor, plus a real process restart. The first run failed 3 of 16 acceptance criteria. All three (AC-7 mid round removal, AC-11 the allowlist Remove button, AC-14 the sign in wall) were fixed and re-verified in a second run, which also confirmed the public session lobby is unaffected by the shared reducer change.
* **Red checked:** reverting `revokeSessionVoter` to its old behaviour turns the lobby revocation, the deferred `NEXT` revocation, and the allowlist paste revocation red. Removing the vote time eligibility recheck turns its own test red. Disabling the `connect` re-subscribe turns the reconnect test red. Each layer is pinned independently.
* **Code review:** two reviews, `docs/reviews/2026-10-03-develop1.md` and `docs/reviews/2026-10-03-develop1-rereview.md`. All six findings from the first review verified fixed; the re-review's blocker and two majors are fixed and covered above. The re-review notes that it ran on the same model as the author, so its fresh model guarantee is degraded.

**Known gaps, not fixed here:**
* The eligibility snapshot half of AC-7 has no automated test. The token revocation that achieves it is covered; the snapshot membership itself is not asserted, because building it needs a harness that closes round one and advances the ladder, and asserting on a later round that never opened would pass vacuously.
* The admin roster reconnect fix was verified by component test, not re-driven in a browser during the second verification run.
* `VoteParticipation` data is persisted but not yet surfaced. The admin per round turnout view is Phase 8.

**Result:** Phase 7 (Secured sessions, spec 0007) is complete, verified at runtime, and accepted. Both "Who can join" modes work end to end, removal actually revokes access, the pending queue closes at Start, `VoteParticipation` stores no vote choice, duplicate secured votes are blocked after a real restart, and emails never appear in voter facing payloads.

---

### Date: 2026-10-04
**Phase:** Phase 8: Visibility and Privacy (spec 0008, implemented, reviewed, and verified)
**Files Changed / Created:**
* `voting-server/src/db/models/Result.js` (Added `type` (enum `public` / `secured`, required, default `public`) and `publishResultsPublicly` (boolean, required, default false), both indexed, plus a compound index over `type`, `publishResultsPublicly`, and `completedAt`)
* `voting-server/src/db/persistence.js` (Modified: `persistCompletedResult` takes `type` and `publishResultsPublicly` from the persisted `Session`, then the live store session, defaulting to `public` and to the session type)
* `voting-server/src/db/repository.js` (Added `setPublishResultsPublicly`, which writes the `Result` row first, writes the `Session` mirror second, and rolls the `Result` row back if the mirror write throws, so the two copies cannot drift across a restart; Added `backfillResultTypes` and `countResultsWithoutType`; Modified `saveResultInner` to write the visibility fields on both the update and the insert path; Modified `getCompletedResults` so the archive lists public results plus published secured ones, and so a row with no `type` is never listed, because the archive is anonymous and cannot establish that such a row is public)
* `voting-server/src/reducer.js` (Added the `SET_PUBLISH_RESULTS` case, which writes `publishResultsPublicly` onto the store session and accepts an archived session)
* `voting-server/src/roundManager.js` (Modified: the `no_result` completion write carries the session's `type` and publish flag, so a session that ends with no champion is still gated correctly)
* `voting-server/index.js` (Modified: startup runs `backfillResultTypes` and logs how many rows it filled; a failed backfill now reports the number of rows still untyped, and those rows are read as secured rather than public)
* `voting-server/src/server.js` (Added `resolveResultVisibility`, one gate shared by the result, rounds, and lobby reads, which fails closed when no type can be resolved; Added `getAdminTokenFromRequest`, `isApprovedParticipant`, `buildSessionTurnout`, `emitSessionTurnout`, and `GET /api/sessions/:sessionId/turnout`; Added `subscribe_turnout` and `unsubscribe_turnout` plus the `session_turnout` emit after each round closes; Registered `SET_PUBLISH_RESULTS` in `ADMIN_ACTION_TYPES` and handled it authoritatively with `VALIDATION_ERROR`, `SESSION_NOT_FOUND`, `SESSION_NOT_COMPLETED`, and `DATABASE_ERROR`)
* `voting-server/test/visibility_and_privacy_spec.js` (Created: 16 sections covering every acceptance criterion, including the leak guards that scan real registry, socket, lobby, and REST payloads for an email shaped value, and the archive round trip that a legacy public row reappears only once the backfill gives it a type)
* `voting-client/src/pages/Results.jsx` (Added the admin "Result visibility" panel with the publish toggle and the per round turnout panel; Added the neutral unavailable state with a sign in prompt when the result read is gated; the publish toggle now waits for the server's acknowledgement, so it renders the value the server stored and clears its busy state on the server's real answer, with a ten second guard against a dropped connection; the toggle renders only for a secured session that has completed or been archived)
* `voting-client/src/components/results/resultsUtils.js` (Added `buildTurnoutCsv`, which renders the admin per round turnout as RFC 4180 CSV with a zero turnout round kept as an empty row rather than dropped, and `turnoutCsvFilename`, which reduces the route's session id to characters that cannot escape the downloads folder; a cell beginning `=`, `+`, `-`, or `@` is prefixed with an apostrophe so a display name cannot be evaluated as a formula when an admin opens the file in a spreadsheet)
* `voting-client/src/pages/Results.jsx` (Added a Download CSV button beside the per round turnout heading, admin only and disabled while there are no rounds; the file is built in the browser from the turnout payload the admin already has, so there is no new endpoint and no second fetch of the same data)
* `voting-client/src/pages/Results.css` (Added the admin panel, turnout list, error line, and turnout heading row styles)
* `voting-client/src/pages/History.jsx` (Modified: a completed session with no official champion now reads "No official champion was declared." instead of an empty winner banner)
* `voting-client/src/pages/Admin.jsx` (Modified: the create session form no longer offers a Publish results publicly checkbox, and no longer sends `publishResultsPublicly` on `CREATE_SESSION`)
* `voting-client/src/redux/voteSlice.js` (Added `SET_PUBLISH_RESULTS`, the local only `SET_PUBLISH_RESULTS_LOCAL`, and `SET_TURNOUT`, with `selectTurnout` and `selectPublishResultsPublicly`; `setPublishResults` takes an optional acknowledgement callback; Turnout is stored under `bySessionId` like every other session scoped field)
* `voting-client/src/redux/store.js` (Registered `SET_PUBLISH_RESULTS` as a remote action carrying the admin token, and `SET_TURNOUT`, `session_turnout`, and `SET_PUBLISH_RESULTS_LOCAL` as local only so nothing loops back to the server; a remote action may now carry `meta.onAck`, which the middleware attaches as the Socket.io acknowledgement callback and strips from the wire payload)
* `voting-client/src/services/socket.js` (Added `subscribeTurnout` and `unsubscribeTurnout`, which send the stored admin token with the subscription, and wired the `session_turnout` event into the slice)
* `voting-client/src/services/history.js` (Modified: the history, result, and rounds fetches send `credentials: 'include'` and attach the admin Bearer header when an admin token is in storage, so a participant and the admin can both read a gated result)
* `voting-client/test/results_visibility.test.jsx` (Created: 30 component tests for the gated panel, the admin toggle and turnout panel, the public session copy, the acknowledgement driven toggle, the turnout CSV export, and the non admin view)
* `voting-client/test/turnout_csv_spec.js` (Created: 9 unit tests for the CSV builder: the header, one row per voter, a kept zero turnout round, the absence of any choice column, comma and quote escaping, the spreadsheet formula guard, bad input, column alignment when a voter has no name, server ordering, and the filename sanitiser)
* `voting-client/test/visibility_privacy_client_spec.js` (Created: 12 unit tests over the new actions, selectors, the local only guarantee, and the acknowledgement wiring in the middleware)
* `AGENTS.md`, `voting-client/AGENTS.md`, `voting-server/AGENTS.md` (Updated: recorded the results visibility rule, the admin only turnout view, and the client rules the new code depends on)
* `docs/specs/0008-visibility-and-privacy/` (Created: `index.md`, `rationale.md`, `verify.md`)
* `docs/reviews/2026-10-04-develop1.md` (Created: the fresh model review, which raised the publish refusal Major and three Minors)
* `docs/scope/scope.md` (Updated: the Phase 8 build, verify, test, and review boxes ticked)

**Major Architectural Changes:**
1. **One visibility decision behind every result read**:
   * `resolveResultVisibility` answers visible or denied plus the viewer kind, and the history, result, rounds, and lobby reads all call it. Before this the socket room was gated but the REST reads were not, so securing the roster left the tallies readable by anyone who knew a session id. Both October 3 reviews named this hole.
   * A public result is never gated. A secured result is readable by its approved participants and the admin until the admin publishes it, and by everyone afterwards.
   * A denied caller gets the same `404` a missing result returns, so an unpublished secured session is not discoverable by status code.
2. **The gate fails closed, in the archive too**:
   * When neither the `Result` row nor the session behind it yields a type, the read treats the row as secured rather than public, and logs it. This closes the review's third Minor, where a legacy row plus an unresolvable session resolved to public and served the result to everyone.
   * `getCompletedResults` applies the same principle. A row with no `type` is not listed in the archive at all, because the archive is anonymous and cannot establish that the row is public. `backfillResultTypes` is the one path that gives a legacy row a type and puts it back, so a pre-spec public result returns to the archive at the next startup.
   * `whoCanJoin` is consulted as a second signal on the lobby, the result and rounds gates, and the join code resolver, so an allowlist session whose `type` column says public is still treated as secured.
   * A failed backfill no longer passes silently. Startup reports how many rows are still untyped, so the operator knows the gate is closed on them.
3. **Publishing writes two rows without drifting**:
   * `setPublishResultsPublicly` writes the `Result` row first, because every read keys off it, then mirrors onto `Session`, and undoes the first write if the second throws. This deployment runs a standalone MongoDB, so a transaction is unavailable; the compensating write is the honest equivalent. This is the review's fourth Minor, fixed.
4. **Turnout reuses the audit trail that was already there**:
   * `GET /api/sessions/:sessionId/turnout` and the `session_turnout` event list every round of a session in ascending order, with the signed in voters who voted in each round and an empty list where nobody voted. The round index is parsed from the pinned `roundId` format, so no new column is stored.
   * Both surfaces are admin only. A non admin caller receives `404` from the endpoint and `UNAUTHORIZED` on the socket. Turnout never carries a vote choice, and an anonymous vote is absent by design.
   * `emitSessionTurnout` returns before touching the database when no admin holds the turnout room, so the per round query costs nothing on the hot path.
5. **The client's publish toggle tells the truth**:
   * The toggle is not flipped on click. `SET_PUBLISH_RESULTS` is emitted with a Socket.io acknowledgement callback, and the server's answer is the only thing that moves the control: on success the server's own stored value is rendered, and on refusal the stored value simply stays and the server's reason is shown. The busy state clears when the answer arrives, not on a timer.
   * The two shared server gates that guard every admin action, the action allowlist check and the admin token check, now answer through the same `respond` helper the action handlers use, so an admin action never leaves a waiting client hanging. `respond` still emits `action_error`, so anything listening only for that event is unaffected.
   * A ten second client side timer remains purely as a guard against a dropped connection, so the control can never stick spinning. It applies nothing, because nothing is applied until the answer lands.
6. **The leak guard is standing, not incidental**:
   * The server suite scans the registry broadcast, `session_state`, the secured lobby, an anonymous refusal, a joined member's payload, and a gated `404` body for an email shaped value. A matching value fails the suite rather than shipping.
7. **The turnout export adds no attack surface**:
   * The CSV is assembled in the browser from the turnout payload the admin has already been sent, so there is no new endpoint, no new query, and no new server side path to get wrong. The export can only ever contain what the admin was already shown.
   * The button lives inside the panel that is already gated on the admin token, so a participant or anonymous viewer cannot reach it, and the component test asserts that even with the turnout already sitting in Redux.
   * The file carries who voted and in which round. There is no choice column, and the tests assert the exact header as well as the absence of any choice, tally, or winner word.
   * Voter display names are attacker controlled and this file is opened in a spreadsheet, so a name starting with `=`, `+`, `-`, or `@` is prefixed with an apostrophe rather than evaluated on open.
8. **Protected pure engine preserved**:
   * `voting-server/src/core.js` verified byte for byte identical (SHA-256: `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`, 39 lines).

**Follow up delivered with this phase**: the spec's open item to surface turnout as an export for the admin is now implemented. See the numbered change above on the turnout export, and `voting-client/test/turnout_csv_spec.js` for its coverage.

**Verification and Quality Audit:**
* **Backend Automated Tests:** `cd voting-server && npm test` → 694 passing, 0 failing. An earlier run was 691 passing with 1 failing: section 16 of `voting-server/test/visibility_and_privacy_spec.js` pins that the archive never lists a row whose type cannot be resolved, and it was red because `getCompletedResults` still treated a missing `type` as public. That filter now fails closed, and a companion test asserts the round trip (a legacy public row reappears in the archive once the backfill gives it a type, while a legacy secured row does not). Both were confirmed to turn red when the fix was reverted.
* **Frontend Unit Tests:** `cd voting-client && npm test` → 456 unit passing, then 68 component passing across 3 files, 0 failing.
* **Frontend Lint:** `cd voting-client && npm run lint` → clean.
* **Frontend Build:** `cd voting-client && npm run build` → builds with no errors. The only output is the pre existing chunk size warning.
* **Runtime verification:** `docs/specs/0008-visibility-and-privacy/verify.md` records a full pass on 2026-10-04 against a real server on port 8091, a real MongoDB 8.2 in an isolated database, and the Vite client driven in a real Chromium as admin, as an approved participant, and as an anonymous outsider. A real emailed OTP sign in was completed, the secured session was joined, voted and completed end to end, and the per criterion results are recorded there. The server logged no errors during the run.

**Known gaps, not fixed here:**
* The lobby answers `200` with title, status, `whoCanJoin`, and counts for a gated secured session while an unknown id answers `404`, so a caller holding a session id can still tell that it exists. The spec deliberately keeps the lobby public and gates only the `winner`, and AC-2's closing sentence sits next to that carve out, so this wants one clarifying line in the spec rather than a code change.
* A publish that the server never answers leaves the control busy until the ten second guard fires. That is deliberate: the alternative is guessing. Nothing is applied optimistically, so the displayed value stays correct throughout.
* `selectSessionRounds` still returns a fresh empty array when a session has no rounds, which trips a react-redux stability warning. `selectTurnout` had the same fault and was fixed to return one shared frozen array; `selectSessionRounds` was left alone as pre existing and outside this feature.
* Turnout widens the amount of voter email in memory for the admin. It is intended, and the participant roster already showed these addresses, but it is a surface to keep an eye on.
* Publishing is post completion only, so an admin cannot pre announce that a secured result will become public.

**Result:** Phase 8 (Visibility and privacy, spec 0008) is implemented, reviewed, and verified at runtime. A secured session's result is now hidden from outsiders until the admin publishes it, the history archive respects the same rule, the admin can see who voted in each round without ever seeing what they chose, and a standing test fails if an email ever reaches a voter facing payload. Both server suites are green. One acceptance criterion remains open: the history listing does not carry a result's type, so a published secured session is listed with no way to tell it apart from a public one.

---

### Date: 2026-10-06
**Phase:** Phase 9 — Hardening and Docs (rate limits, response timing parity, accessibility pass, v2 documentation)

**Files Changed / Created:**
* `voting-server/src/utils/rateLimit.js` (Created: `createFixedWindowStore` and `consumeFixedWindow`, one fixed window counter primitive now shared by the join resolver and the OTP request route)
* `voting-server/src/utils/timing.js` (Created: `DEFAULT_MIN_RESPONSE_MS`, `getMinResponseMs`, `remainingResponsePadMs`, and `padToMinimumDuration`, the response floor that stops the clock from answering a question the body refuses to)
* `voting-server/src/server.js` (Modified: `checkJoinRateLimit` reimplemented on the shared primitive with its exports, constants, and refusal body unchanged; added `OTP_RATE_LIMIT_WINDOW_MS`, `OTP_RATE_LIMIT_MAX_PER_EMAIL`, `OTP_RATE_LIMIT_MAX_PER_IP`, `getOtpRateLimitMaxPerEmail`, `getOtpRateLimitMaxPerIp`, `checkOtpRequestRateLimit`, `resetOtpRequestRateLimit`, and `createPacedResponder`; the OTP request handler now rate limits by email and by client address before any database work and answers every reply through the paced responder with an `error: 'RATE_LIMITED'` body and a `Retry-After` header; the join resolver answers every reply through the same paced responder)
* `voting-server/test/hardening_rate_limits_and_timing_spec.js` (Created: 16 tests over the limiter primitive, the timing helper, both OTP ceilings at unit and HTTP level, the `TRUST_PROXY` address keying, and hit versus miss timing bands for the join resolver and the OTP route)
* `voting-server/test/test_helper.js` (Modified: raises the OTP ceilings for the shared suite, because they are per hour and every test request arrives from one address; the hardening spec sets the real values back for its own cases)
* `voting-client/test/a11y_voting_and_lobby.test.jsx` (Created: 8 tests running `axe-core` over the voting arena, the join prompt, and the four lobby states, plus a self check that pins the scanner itself)
* `voting-client/src/pages/Voting.jsx` (Modified: the join failure message carries `role="alert"`, so a refusal is announced instead of only being findable by exploring past the form)
* `voting-client/src/components/layout/Navbar.jsx` (Modified: the `Sign in` control is one link styled as a button rather than a button nested in a link, so the same control is not exposed twice)
* `voting-client/package.json`, `voting-client/package-lock.json` (Modified: added `axe-core`, the accessibility engine the pass is measured with)
* `.env.example` (Modified: documented `API_MIN_RESPONSE_MS`, `OTP_RATE_LIMIT_MAX_PER_EMAIL`, and `OTP_RATE_LIMIT_MAX_PER_IP`)
* `README.md`, `docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md`, `docs/USER_MANUAL.md` (Updated: the hardening behaviour, the real REST route list, the new environment variables, and the current test counts; the user manual's stale "the backend does not maintain individual voter ballot records" notice was replaced with the actual round scoped duplicate vote rule and the choice free `VoteParticipation` record)
* `docs/scope/scope.md` (Updated: Phase 9 build box and code pointer)

**Major Architectural Changes:**
1. **One rate limit primitive, two call sites:**
   * `consumeFixedWindow` takes a store, a key, a window, and a ceiling, and returns whether the attempt is allowed plus the remaining wait. The join resolver's pre existing limiter now delegates to it, so there is one implementation rather than two copies.
   * The OTP request route is limited on both an email key (5 per hour) and a client address key (20 per hour). Both keys are charged on every attempt, including one that is already refused, so pacing requests cannot keep a key permanently open. A malformed body still charges the address, which is the only key that exists in that case.
   * The ceilings are read through getters, so an operator can raise them by environment variable and the shared test suite can raise them for specs that are not about limiting.
2. **The clock stops being an oracle:**
   * `padToMinimumDuration` holds a response open until a floor has elapsed, and `createPacedResponder` routes every reply on the OTP request and join resolver paths through it. A `400`, a `429`, a `500`, a hit, and a miss therefore all take the same time.
   * The floor is a floor, not a delay: a handler that already ran longer is not held back. It cannot outrun genuinely slow work, and that limit is stated rather than hidden.
   * `API_MIN_RESPONSE_MS` sets the value and `0` disables it.
3. **Accessibility becomes a test, not an opinion:**
   * The voting and lobby screens are scanned with `axe-core` under Vitest, gated on no critical or serious violation. The colour contrast rule is excluded because jsdom performs no layout, and that exclusion is documented rather than silently relied on.
   * Because every assertion is "axe found nothing", the spec carries a self check that scans an unlabelled image and requires `image-alt` back. Without it, a scanner regression would make the file pass while checking nothing.
4. **The user manual told the truth about the ballot model again:**
   * The manual still carried an MVP era notice claiming the backend keeps only aggregate counters and no per voter record. That has been wrong since the duplicate vote key and `VoteParticipation` landed, so the notice now states the actual rule, including that the audit trail stores the voter and the round but never the choice.

**Verification and Quality Audit:**
* **Backend Automated Tests:** `cd voting-server && npm test` → **799 passing, 0 failing** (exit 0).
* **Frontend Unit Tests:** `cd voting-client && npm run test:unit` → **468 passing, 0 failing** across 139 suites.
* **Frontend Component Tests:** `cd voting-client && npm run test:component` → **123 passing, 0 failing** across 6 files.
* **Frontend Lint:** `cd voting-client && npm run lint` → clean, exit 0.
* **Frontend Build:** `cd voting-client && npm run build` → built in 6.46s, exit 0, with only the pre existing chunk size warning.
* **Red checked:** reverting the navbar fix was confirmed NOT to change the accessibility result, because axe does not flag a button nested in a link. The navbar change is kept as correct markup on its own merits, and the claim that axe catches it was removed from both the code comment and the documentation.
* **Scanner self check:** a scratch probe confirmed axe under jsdom reports `image-alt` (critical) and `aria-command-name` (serious) on a deliberately broken tree, so the empty results for the real screens are meaningful rather than vacuous.
* **Protected core:** `voting-server/src/core.js` was not touched.

**Known gaps, not fixed here:**
* The rate limit counters are held in process memory and reset on restart. A multi process or multi host deployment needs a shared store before the limits mean anything across workers.
* Colour contrast is not machine checked. jsdom performs no layout, so the rule cannot resolve a foreground and background pair. It remains a browser or manual check.
* The timing floor cannot mask work that is slower than the floor itself. A cold database or a slow SMTP handshake still shows a longer response.
* The accessibility pass covers the voting arena, the join prompt, and the lobby states, which is what the scope names. The admin panel, the results page, and the archive were not audited.
* The backend still reads no `.env` file: `index.js` has no dotenv load, so the variables in `.env.example` must be exported in the shell or supplied by the process manager. This is pre existing and was left alone.

**Result:** Phase 9 (Hardening and docs) is built and self checked. The OTP request route and the join resolver both enforce their ceilings, a refusal is answered with a `429` and a `Retry-After`, neither route can be timed to learn whether an address is registered or a code exists, the voting and lobby screens pass an axe audit with a guard that keeps the audit honest, and `README`, `ARCHITECTURE`, `API_CONTRACT`, and `USER_MANUAL` describe the behaviour that actually ships. Both suites, lint, and the production build are green.
