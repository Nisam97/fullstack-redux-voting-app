# VoteSphere — Core MVP User Testing Manual
## Hands-On Verification & Quality Assurance Guide for Project Evaluators

---

### Document Overview & Purpose

This manual is an operational, hands-on testing guide created specifically for the project owner, developer, and evaluation team. Its purpose is to provide an unambiguous, step-by-step protocol to start, verify, exercise, and validate all completed Core MVP capabilities (Phases 0 through 6) of the **Full-Stack Real-Time Pairwise Voting Application (VoteSphere)**.

Every test procedure follows a strict, repeatable execution pattern:
> **Do this → You should see this → Verify this → If it happens, PASS.**

#### Current Implementation Baseline
* **Overall Core MVP Implementation Completion:** **100%** (Phases 0–6 complete and verified).
* **Scope Boundary Notice:** This manual covers the completed Core MVP in memory and over WebSockets. Post-MVP enhancements (persistent database storage, multi-room namespaces, and automated background timers) are designated for Phase 7. In accordance with project instructions, Phase 7 has **NOT** been started and application source code remains untouched.

---

## SECTION 1 — PROJECT QUICK START

Follow these exact steps to launch the project from a clean state. Do not modify source files during startup.

### 1.1 Environment & System Requirements
* **Operating System:** Windows 10/11, macOS, or Linux (verified on Windows 11).
* **Node.js:** v18.0.0 or higher required (verified on Node.js v24.14.0 LTS).
* **Package Manager:** `npm` v9.0.0+ (bundled with Node.js).
* **MongoDB Requirement:** In the completed Core MVP (Phases 0–6), state is authoritatively maintained in memory using Redux and Immutable.js data structures. **MongoDB is NOT required to be running for Core MVP operations.** If an existing MongoDB daemon is active on your machine, it will not conflict with the application. Full database persistence is designated for Phase 7.
* **Network & Port Allocation:**
  * Backend Server: Port `8090` (`http://localhost:8090`)
  * Frontend Client: Port `5173` (`http://localhost:5173`)

### 1.2 Step-by-Step Startup Sequence

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│       TERMINAL 1: BACKEND       │       │      TERMINAL 2: FRONTEND       │
│  cd voting-server               │       │  cd voting-client               │
│  npm start                      │       │  npm run dev                    │
│  (Binds to Port 8090)           │       │  (Binds to Port 5173)           │
└────────────────┬────────────────┘       └────────────────┬────────────────┘
                 │                                         │
                 ▼                                         ▼
   Authoritative Redux Engine                 Vite Development Server
   & Socket.io State Stream                  http://localhost:5173
```

#### Terminal 1 — Start the Backend Server
1. Open a new terminal window (PowerShell or Bash).
2. Navigate to the `voting-server` directory:
   ```bash
   cd voting-server
   ```
3. *(First time only)* Ensure dependencies are installed:
   ```bash
   npm install
   ```
4. Start the backend server:
   ```bash
   npm start
   ```
5. **Verify Backend Startup:**
   * Terminal executes `node -r @babel/register index.js`.
   * The server initializes the Redux store, loads candidate entries from `entries.json`, dispatches `NEXT`, and binds Socket.io to port `8090`.
   * Verify that no unhandled exceptions or error traces appear.

#### Terminal 2 — Start the Frontend Client
1. Open a **second, separate** terminal window.
2. Navigate to the `voting-client` directory:
   ```bash
   cd voting-client
   ```
3. *(First time only)* Ensure dependencies are installed:
   ```bash
   npm install
   ```
4. Start the frontend Vite development server:
   ```bash
   npm run dev
   ```
5. **Verify Frontend Startup:**
   * The terminal displays the Vite ready banner:
     ```text
     VITE v8.1.1  ready in ~300 ms

     ➜  Local:   http://localhost:5173/
     ➜  Network: use --host to expose
     ```
   * Open your browser and navigate to `http://localhost:5173`.
   * Verify that the VoteSphere homepage loads cleanly with navigation headers, hero cards, and action buttons.

---

## SECTION 2 — TEST ADMIN CREDENTIALS & AUTHENTICATION

### 2.1 Repository Inspection & Credential Seeding
An inspection of the repository structure and authentication code confirms:
1. **Automated Seeding:** On startup, [`voting-server/src/server.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js) invokes `seedAdmin()` from [`voting-server/src/auth/admin.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/auth/admin.js), loading credentials from environment variables (`.env`).
2. **Safe Fallback Defaults for Testing:** In development or testing without explicit `.env` variables, safe development fallbacks are provided:
   * **Username:** `admin` (configured via `ADMIN_USERNAME`)
   * **Email:** `admin@votesphere.local` (configured via `ADMIN_EMAIL`)
   * **Password:** Configured via `ADMIN_PASSWORD` in `.env` (or development fallback)
3. **Secret Protection:** No production secrets, private keys, or plaintext passwords are saved in repository documentation.

### 2.2 Admin Access & Authentication Workflow
1. Navigate to `http://localhost:5173/login` to open the administrative authentication portal.
2. Enter your administrator identifier (username `admin` or email `admin@votesphere.local`) and password.
3. Click **"Sign In as Administrator"**:
   * The client sends `POST /api/admin/login`.
   * On valid credentials, the server returns `{ success: true, token, user }`.
   * The client stores the JWT in `localStorage` under `votesphere_admin_jwt` and redirects to `/dashboard` (or `/sessions`).
4. **Testing Invalid Credentials:**
   * Enter an incorrect password or unknown username.
   * Verify the form displays: `"Invalid username/email or password."` (Status: 401 Unauthorized).
5. **Testing Protected Actions:**
   * All session management actions (`CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT`) require this valid JWT.
   * If a client attempts to emit `NEXT` or `CREATE_SESSION` without a valid token, the server drops the action and emits an `action_error` (`UNAUTHORIZED` or `INVALID_TOKEN`).

---

## SECTION 3 — TEST ACCOUNTS / VOTERS & SESSION JOIN

### 3.1 Voter Authentication & Token Scoping
In Feature 1, voter authentication is frictionless and session-scoped:
* **Frictionless Display-Name Join:** Voters do not enter passwords or emails. Navigating to `/sessions/:id/vote` prompts the user with an **"Enter Your Display Name"** modal.
* **Unguessable Session-Scoped Token:** Submitting a display name dispatches `POST /api/sessions/:sessionId/join`. The server returns an unguessable token (`crypto.randomUUID()`) and sets a session cookie (`voter_token_${sessionId}`).
* **Anonymous Voting Strictly Blocked:** Attempting to emit a `VOTE` action without a voter token is rejected server-side with `VOTER_TOKEN_REQUIRED`.
* **Server-Side Duplicate Vote Protection:** The server verifies that `${sessionId}:::${sortedPair}:::${voterToken}` has not already been recorded in memory. Attempting to vote twice in the same round is rejected with `DUPLICATE_VOTE`.
* **Duplicate Display Names Allowed:** Two voters can both use the display name "Alice"; each receives a unique token and votes independently.
* **Token Session Scoping:** A token issued for `sess_default` is rejected if used to vote in `sess_horror` (`SESSION_MISMATCH`).

### 3.2 Multi-Voter Setup for Testing
To test multi-client synchronization and duplicate-vote protection, open multiple browser contexts:

```
┌─────────────────────────────────┬─────────────────────────────────┬─────────────────────────────────┐
│         BROWSER TAB 1           │         BROWSER TAB 2           │         BROWSER TAB 3           │
│         Administrator           │         Voter 1 (Alice)         │         Voter 2 (Alice)         │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ URL: http://localhost:5173/login│ URL:                            │ URL:                            │
│ (Login as admin to control NEXT)│ http://localhost:5173/sessions/ │ http://localhost:5173/sessions/ │
│                                 │ sess_default/vote               │ sess_default/vote               │
│                                 │ (Standard Browser Window)       │ (Incognito / InPrivate Window)  │
└─────────────────────────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

* **Client A (Admin):** Open `http://localhost:5173/login`, authenticate, and open the tournament monitor.
* **Client B (Voter 1):** Open `http://localhost:5173/sessions/sess_default/vote`. Enter display name `"Alice"` and cast a ballot for Contender 1.
* **Client C (Voter 2):** Open an **Incognito / InPrivate Window** at `http://localhost:5173/sessions/sess_default/vote`. Enter display name `"Alice"` and cast a ballot for Contender 2.
* **Verify:** Both votes are accepted independently despite having the exact same display name.
* **Verify Double-Vote Rejection:** On Client B, if a second vote is attempted in the same round, the UI locks and any forced submission is rejected by the server with `DUPLICATE_VOTE`.
* **Verify Round Advancement:** Admin advances the round (`NEXT`). Both Client B and Client C automatically unlock for the new round pair.

### 3.3 Automated Test Execution & Quality Verification Commands

Evaluators and project demonstrators can run the complete automated test suites across backend and frontend to verify the 100% passing quality baseline:

1. **Backend Automated Tests (100 Tests):**
   ```bash
   cd voting-server
   npm test
   ```
   *Executes 9 test suites (`test/auth_spec.js`, `test/bootstrap_spec.js`, `test/core_spec.js`, `test/immutable_spec.js`, `test/reducer_spec.js`, `test/server_spec.js`, `test/sessions_reducer_spec.js`, `test/store_spec.js`, `test/test_helper.js`).*  
   *Expected Output: `100 passing` (0 failing, ~9s execution time).*

2. **Frontend Automated Tests (51 Tests):**
   ```bash
   cd voting-client
   npm test
   ```
   *Executes 3 test suites (`test/auth_spec.js`, `test/results_spec.js`, `test/voting_spec.js`).*  
   *Expected Output: `51 passing` (0 failing, ~640ms execution time).*

3. **Frontend Code Quality & Production Build:**
   ```bash
   cd voting-client
   npm run lint
   npm run build
   ```
   *Expected Output: 0 errors / 0 warnings (`eslint .`); Vite production bundle successfully built in ~1.03s.*

4. **Protected Core Engine Integrity Check:**
   ```bash
   git diff voting-server/src/core.js
   ```
   *Expected Output: Strictly 0 diffs (pure domain engine in `core.js` remains 40 lines of untouched, pure logic).*

---

## SECTION 4 — UNDERSTANDING THE APPLICATION FLOW

The lifecycle of a VoteSphere pairwise election proceeds through a predictable sequence of server-authoritative stages:

```
   1. Admin Login (/login → /dashboard)
                   │
                   ▼
   2. Configure Session & Candidate Pool (entries.json / SET_ENTRIES)
                   │
                   ▼
   3. Start Session & Round 1 (NEXT Action Dispatched)
                   │
                   ▼
   4. Voters Connect & Receive Pair (Shallow Grave vs Trainspotting)
                   │
                   ▼
   5. Voters Cast Ballots (UI Locks Selection Immediately)
                   │
                   ▼
   6. Authoritative Tally Broadcast (io.emit('state', updatedState))
                   │
                   ▼
   7. Round Completion (NEXT Action Advances Pair)
                   │
                   ▼
   8. Next Pair Appears / Tournament Elimination Loop
                   │
                   ▼
   9. Single Champion Remains (entries.size === 1)
                   │
                   ▼
  10. Winner Declaration & Results Celebration (/results)
```

### Stage Breakdown & Responsibilities

| Stage | Actor | Action | Visible Client Output | Authoritative Server Role |
|---|---|---|---|---|
| **1. Admin Access** | Administrator | Enters credentials on `/login` and navigates to `/dashboard`. | Login card accepts input; redirects to `/dashboard` displaying system status. | Validates access parameters and serves administrative interface. |
| **2. Configure Pool** | Server / Admin | Loads candidate items (e.g. `entries.json`). | Candidate pool is initialized in Redux store. | Dispatches `SET_ENTRIES` with candidate list. |
| **3. Start Session** | Server / Admin | Dispatches initial `NEXT` action. | Voting arena transitions from loading to active matchup cards. | Draws first 2 entries into `vote.pair`, leaves remainder in `entries`. |
| **4. Voter Joins** | Voter 1 & 2 | Opens `http://localhost:5173/vote`. | Matchup card renders contender A and B with glowing "VS" divider. | Emits initial state snapshot to socket on connection (`socket.emit('state')`). |
| **5. Voter Balloting** | Voter | Clicks candidate button (e.g., "Vote for Contender A"). | Card highlights with accent border; buttons disable; feedback banner shows confirmation. | Receives `VOTE` action; increments `tally[entry]` pure Immutable update. |
| **6. Broadcast Sync** | Server | Automatically streams state after store update. | Results page (`/results`) updates live percentage bars and counters without refresh. | Executes `store.subscribe(() => io.emit('state', ...))`. |
| **7. Round Complete** | Server / Admin | Dispatches `NEXT` action when voting finishes. | Voting screens automatically transition to the next candidate pair. | Calculates round winner via `getWinners()`, recycles winner to `entries`, pops next pair. |
| **8. Tournament End** | Server Engine | Recognizes only 1 candidate remains (`entries.size === 1`). | All clients display **"We Have a Winner!"** with golden trophy badge and champion name. | Authoritatively sets `winner: championName`, removes `vote` and `entries`. |
| **9. Final Results** | Evaluator | Navigates to `/results`. | Champion card labeled *"🏆 Official Winner"* with 100% distribution. | Serves conclusive, immutable tournament result. |

---

## SECTION 5 — MASTER TEST CASE TABLE

Use this comprehensive test checklist to record manual execution.

| ID | Test Name | Target Steps | Expected Result | Pass / Fail |
|---|---|---|---|---|
| **T01** | Backend Server Startup | Run `npm start` in `voting-server/`. | Server boots, initializes Babel, and listens on port 8090. | ☐ PASS  ☐ FAIL |
| **T02** | Frontend Client Startup | Run `npm run dev` in `voting-client/`. | Vite compiles and starts HTTP server on port 5173. | ☐ PASS  ☐ FAIL |
| **T03** | In-Memory / DB Readiness | Verify backend terminal logs on boot. | Authoritative Redux store initializes cleanly without crash. | ☐ PASS  ☐ FAIL |
| **T04** | Admin Login Succeeded | Enter valid admin credentials on `/login`. | Form accepts submission; user navigates to `/dashboard`. | ☐ PASS  ☐ FAIL |
| **T05** | Invalid Login Handling | Enter malformed input on `/login`. | Form prevents invalid submission or indicates input required. | ☐ PASS  ☐ FAIL |
| **T06** | Session Entry Initialization | Check server state on initialization. | Candidate entries loaded into store (`entries.json` seeded). | ☐ PASS  ☐ FAIL |
| **T07** | Candidate Pair Validation | Inspect active `vote.pair` array. | Exactly 2 distinct candidate entries form the active matchup. | ☐ PASS  ☐ FAIL |
| **T08** | Voter Joins Session | Navigate to `http://localhost:5173/vote`. | Client connects via WebSocket; loads candidate matchup cards. | ☐ PASS  ☐ FAIL |
| **T09** | Pair Matchup Display | View `/vote` screen. | Left contender, right contender, and central VS badge visible. | ☐ PASS  ☐ FAIL |
| **T10** | Voter Selects Option | Click "Vote for [Candidate]" button. | Click dispatches action; candidate card highlights as voted. | ☐ PASS  ☐ FAIL |
| **T11** | Vote Locking in UI | Observe buttons after voting. | Both voting buttons become disabled; feedback banner confirms vote. | ☐ PASS  ☐ FAIL |
| **T12** | Duplicate Click Prevention | Attempt to click the disabled buttons. | Button does not respond; duplicate votes cannot be dispatched. | ☐ PASS  ☐ FAIL |
| **T13** | Timer Baseline | Observe countdown timer or round status. | Round status indicates active round is open for voting. | ☐ PASS  ☐ FAIL |
| **T14** | Round Progression Readiness | Observe UI while voting is open. | UI maintains active pair while waiting for round advancement. | ☐ PASS  ☐ FAIL |
| **T15** | Server-Driven Progression | Dispatch `NEXT` action to server. | Round concludes authoritatively and advances to next matchup. | ☐ PASS  ☐ FAIL |
| **T16** | Early Completion Trigger | Trigger `NEXT` once all voters have cast ballots. | Server advances immediately without requiring idle delay. | ☐ PASS  ☐ FAIL |
| **T17** | Next Pair Transition | Inspect `/vote` after round advancement. | New candidate pair appears; UI buttons unlock for new pair. | ☐ PASS  ☐ FAIL |
| **T18** | Multi-Voter State Sync | Connect Client 1 and Client 2 to `/vote`. | Both clients display the identical candidate matchup simultaneously. | ☐ PASS  ☐ FAIL |
| **T19** | Vote Synchronization | Vote on Client 1; observe Client 2 / `/results`. | Vote tallies update in real time across clients without refresh. | ☐ PASS  ☐ FAIL |
| **T20** | Synchronized Next Round | Advance round on server; observe all clients. | All connected browser tabs switch to the new matchup in unison. | ☐ PASS  ☐ FAIL |
| **T21** | Browser Refresh / Reload | Press F5 on `/vote` during active round. | Client reconnects to socket; restores current active pair. | ☐ PASS  ☐ FAIL |
| **T22** | Reconnected State Recovery | Connect fresh tab to `/vote` mid-tournament. | New client receives full authoritative state snapshot instantly. | ☐ PASS  ☐ FAIL |
| **T23** | Clean Voter Presentation | Inspect `/vote` page during active round. | Candidate selection cards remain focused without distracting telemetry. | ☐ PASS  ☐ FAIL |
| **T24** | Tournament Completion | Advance tournament until 1 candidate remains. | Server detects `entries.size === 1` and declares final winner. | ☐ PASS  ☐ FAIL |
| **T25** | Winner Display on Voting Page | Inspect `/vote` when winner is declared. | Celebratory banner displays "We Have a Winner!" with champion name. | ☐ PASS  ☐ FAIL |
| **T26** | Results Page Champion State | Open `/results` after tournament concludes. | Golden trophy hero card displays champion with 100% bar. | ☐ PASS  ☐ FAIL |
| **T27** | Results Percentage Display | View `/results` with 2 votes on A, 1 on B. | Proportional bars show 66.7% vs 33.3% with total vote count 3. | ☐ PASS  ☐ FAIL |
| **T28** | No-Results State | Open `/results` when session is unseeded. | Informational notice explains no active round is currently open. | ☐ PASS  ☐ FAIL |
| **T29** | Active Zero-Votes State | Open `/results` at start of round (0 votes). | Displays live indicator and notice without NaN or Infinity errors. | ☐ PASS  ☐ FAIL |
| **T30** | Session Boundary Stability | Disconnect or restart client socket. | Client socket reconnects cleanly without crashing server store. | ☐ PASS  ☐ FAIL |
| **T31** | End-to-End Tournament Flow | Execute full tournament from seed to winner. | All rounds complete sequentially and authoritative winner emerges. | ☐ PASS  ☐ FAIL |

---

## SECTION 6 — DETAILED TEST PROCEDURES

### Test T01 — Backend Server Startup

* **Purpose:** Verify that the Node.js / Babel voting server boots, loads store logic, and listens on port 8090.
* **Setup:** Terminal 1 open. Ensure port 8090 is not occupied by a zombie process.
* **Steps:**
  1. In Terminal 1, run `cd voting-server`.
  2. Execute `npm start`.
  3. Observe terminal output.
* **Expected Result:** Terminal runs `node -r @babel/register index.js`. No syntax or module import errors occur.
* **PASS condition:** Process remains running and listening on port 8090.
* **FAIL condition:** Process exits with non-zero error, reports `EADDRINUSE`, or throws unhandled exceptions.
* **Notes:** If port 8090 is busy, terminate existing Node processes using `Stop-Process -Name node -Force` on Windows PowerShell.

---

### Test T02 — Frontend Client Startup

* **Purpose:** Verify that Vite development server compiles and serves the client application on port 5173.
* **Setup:** Terminal 2 open. Backend running in Terminal 1.
* **Steps:**
  1. In Terminal 2, run `cd voting-client`.
  2. Execute `npm run dev`.
  3. Open browser and visit `http://localhost:5173`.
* **Expected Result:** Vite logs `ready in ~... ms` and provides `http://localhost:5173/`. Browser renders VoteSphere homepage.
* **PASS condition:** Homepage loads with complete navigation bar, hero banner, and zero console errors.
* **FAIL condition:** Terminal displays compilation errors, or browser shows blank screen / `ERR_CONNECTION_REFUSED`.
* **Notes:** Check browser DevTools console (F12) for clean script execution.

---

### Test T04 — Admin Login Succeeded

* **Purpose:** Verify that the administrative login route accepts credentials and routes to the dashboard.
* **Setup:** Browser open at `http://localhost:5173/login`.
* **Steps:**
  1. In the **Email Address** field, enter `admin@votesphere.local`.
  2. In the **Password** field, enter the local test administrative password.
  3. Click the **"Login"** button.
* **Expected Result:** The browser redirects to `http://localhost:5173/dashboard`.
* **PASS condition:** Dashboard loads showing welcome greetings, active election statistics, and navigation.
* **FAIL condition:** Page reloads with an unhandled exception, remains stuck on `/login`, or displays a 404 error.
* **Notes:** Core MVP uses client-side routing to navigate to `/dashboard`.

---

### Test T08 — Voter Joins Session

* **Purpose:** Verify that a voter client connects to the backend Socket.io server and synchronizes the active pair.
* **Setup:** Backend and frontend running. Browser open.
* **Steps:**
  1. In browser, navigate to `http://localhost:5173/vote`.
  2. Observe the page transition from loading spinner to the active voting arena.
* **Expected Result:** Initial loading indicator resolves within 500ms; candidate cards render with the first seeded pair (e.g. *Shallow Grave* vs *Trainspotting*).
* **PASS condition:** Candidate cards, VS divider, and action buttons appear with correct candidate labels.
* **FAIL condition:** Endless spinning wheel with "Connecting to real-time voting server..." remains visible indefinitely.
* **Notes:** Endless spinner indicates frontend cannot reach `ws://localhost:8090`. Verify backend terminal.

---

### Test T10 — Voter Selects an Option

* **Purpose:** Verify that clicking a candidate card dispatches a `VOTE` action to the authoritative Redux store.
* **Setup:** On `/vote` page with active matchup visible.
* **Steps:**
  1. Identify Contender A (e.g., *Shallow Grave*).
  2. Click the **"Vote for Shallow Grave"** button.
* **Expected Result:** The button triggers an action; candidate card updates visually; confirmation banner appears.
* **PASS condition:** Confirmation banner states: `Vote recorded for Shallow Grave. Waiting for next round...`
* **FAIL condition:** Nothing happens on click, or button remains unpressed with no visual confirmation.
* **Notes:** The dispatch travels via `remote_action_middleware` to Socket.io backend.

---

### Test T11 & T12 — Vote Locking and Duplicate Click Prevention

* **Purpose:** Verify that the voter UI prevents repeated or duplicate voting during the active matchup.
* **Setup:** Voter has cast a vote in Test T10.
* **Steps:**
  1. Observe the voting buttons on both Contender A and Contender B cards.
  2. Attempt to click Contender B's button (*Trainspotting*).
  3. Attempt to click Contender A's button (*Shallow Grave*) a second time.
* **Expected Result:** Both buttons have `disabled` attribute; cursor shows not-allowed; clicks do not trigger network traffic.
* **PASS condition:** Both buttons remain strictly disabled; selection cannot be switched or re-cast.
* **FAIL condition:** Button clicks remain active or tally increments repeatedly from the same client interface.
* **Notes:** Client component state locks selection to the active `pairKey` until a new pair is received.

---

### Test T18 & T19 — Two-Voter Real-Time Synchronization

* **Purpose:** Verify that two independent voter clients receive synchronized state updates in real time.
* **Setup:** Client B (Window 1) on `/vote`, Client C (Incognito) on `/vote`, Client A (Window 3) on `/results`.
* **Steps:**
  1. Verify both Client B and Client C display the exact same candidate pair.
  2. In Client B, click vote for Contender A (*Shallow Grave*).
  3. Observe Client A (`/results`) and Client C (`/vote`).
  4. In Client C, click vote for Contender B (*Trainspotting*).
  5. Observe Client A (`/results`).
* **Expected Result:** Client A immediately displays updated counts (1 vote for A, then 1 vote for B) without page reload. Client C's voting interface remains active until Client C casts their own ballot.
* **PASS condition:** Both clients synchronize within milliseconds; results page reflects 50% / 50% split.
* **FAIL condition:** Updates fail to appear until manual page refresh (F5), or clients display mismatched pairs.
* **Notes:** This verifies the bidirectional Socket.io broadcast pipeline (`store.subscribe -> io.emit`).

---

### Test T21 & T22 — Browser Refresh / Reconnection State Recovery

* **Purpose:** Verify that a voter refreshing their browser or reconnecting receives the authoritative server state.
* **Setup:** A round is in progress with votes recorded.
* **Steps:**
  1. In Client B, press `F5` (or `Ctrl+R` / `Cmd+R`) to reload the voting page.
  2. Observe the reloaded page.
* **Expected Result:** Browser reloads, Socket.io re-establishes connection, and receives current `vote` state snapshot.
* **PASS condition:** The active candidate pair is restored immediately; the application does not crash or display an error.
* **FAIL condition:** Screen goes blank, loads into an empty state, or throws a Redux deserialization error.
* **Notes:** Socket.io client connects with `autoConnect: true` and requests immediate state snapshot.

---

### Test T26 & T27 — Results Presentation & Percentage Safety

* **Purpose:** Verify that `/results` renders authoritative percentages and handles division by zero safely.
* **Setup:** Open `http://localhost:5173/results`.
* **Steps:**
  1. Before any votes are cast, observe candidate cards on `/results`.
  2. Verify percentage displays show `0%` cleanly without `NaN` or `Infinity`.
  3. Cast 2 votes for Candidate A and 1 vote for Candidate B.
  4. Observe percentage bars and total vote count.
* **Expected Result:** Total votes shows `3`. Candidate A shows `66.7%` (2 votes). Candidate B shows `33.3%` (1 vote).
* **PASS condition:** Calculations are mathematically accurate; WAI-ARIA progressbars update; zero-vote state has no `NaN`.
* **FAIL condition:** Screen displays `NaN%`, infinite bars, or distorted percentages.
* **Notes:** Handled in `Results.jsx` via `(votes / totalVotes) * 100` guarded by `totalVotes > 0`.

---

## SECTION 7 — ADMIN TEST (REALISTIC WALKTHROUGH)

This test executes an administrative evaluation flow using a realistic election scenario.

```
Scenario:
Topic:            Best Tech Stack
Candidates:       React, Vue, Angular, Svelte
Round Duration:   30 Seconds
```

### Execution Steps
1. **Access Login:** Open `http://localhost:5173/login`.
2. **Authenticate:** Enter admin email (`admin@votesphere.local`) and test credentials. Click **"Login"**.
3. **Verify Dashboard:** Confirm redirection to `http://localhost:5173/dashboard`. Observe stats cards and active election overview.
4. **Inspect Candidate Roster:** Confirm that candidate entries are loaded into the server candidate pool.
5. **Open Voting Arena:** In a new window, navigate to `http://localhost:5173/vote`.
6. **Observe Round 1 Matchup:** First candidate pair is displayed (e.g., *React* vs *Vue*).
7. **Monitor Round Status:** Confirm round status is active and waiting for voter ballots.
8. **Advance Through Rounds:**
   * Submit votes for Round 1.
   * Dispatch `NEXT` (via admin trigger or test harness).
   * Observe Round 2 matchup appear (e.g., *Angular* vs *Svelte*).
   * Submit votes for Round 2 and advance to the Finals.
9. **Observe Championship:** The final two contenders face off in the tournament championship round.
10. **Conclude Tournament:** Submit final votes and advance.
11. **Verify Winner Presentation:** Confirm that both `/vote` and `/results` transition to the **Winner Celebration Screen** announcing the champion.

* **PASS condition:** The full tournament lifecycle runs from initial login through final champion announcement.
* **FAIL condition:** Round fails to advance or champion screen fails to render authoritative winner.

---

## SECTION 8 — TWO-VOTER REAL-TIME TEST

Follow this precise protocol using two distinct browser windows on the **same session**:

```
Browser Window A (Chrome Standard)   ──► Voter 1: Alice   ──► http://localhost:5173/vote
Browser Window B (Incognito Window)  ──► Voter 2: Bob     ──► http://localhost:5173/vote
Browser Window C (Secondary Tab)     ──► Observer Monitor ──► http://localhost:5173/results
```

### Detailed Verification Steps

| Step # | Action | Window A (Alice) | Window B (Bob) | Window C (Results Monitor) | Verification Check |
|---|---|---|---|---|---|
| **1** | Open URLs simultaneously | Displays Contender 1 vs Contender 2 | Displays identical Contender 1 vs Contender 2 | Displays 0 Total Votes; live stream indicator active | Identical matchup visible across all windows. |
| **2** | Alice votes for Contender 1 | Card highlights; buttons lock; confirmation banner appears | Buttons remain fully active and clickable | Tally updates to 1 vote (100%) for Contender 1 | Alice's vote does not lock Bob's screen. |
| **3** | Bob votes for Contender 2 | Alice screen remains locked; shows confirmation banner | Bob's card highlights; buttons lock; confirmation appears | Tally updates to 2 total votes (50% / 50% distribution) | Real-time broadcast delivers Bob's vote instantly. |
| **4** | Server advances round (`NEXT`) | Automatically transitions to Next Pair; buttons unlock | Automatically transitions to Next Pair; buttons unlock | Resets round tallies to 0 for the new matchup | Zero-refresh automatic round synchronization. |
| **5** | Repeat for Round 2 | Alice votes for Contender 3; locks | Bob votes for Contender 3; locks | Tallies reflect 2 votes (100%) for Contender 3 | Multi-round stability verified. |

* **PASS condition:** All three windows stay synchronized without any manual browser refreshes.
* **FAIL condition:** One window lags behind, requires manual refresh, or votes cross-contaminate selections.

---

## SECTION 9 — EARLY COMPLETION TEST

### 9.1 Purpose & Expected Behavior
In an optimal voting system, if all eligible participants have cast their votes prior to a timer expiring, the round should transition immediately rather than forcing users to wait through an idle countdown.

### 9.2 Execution Steps
1. **Configuration:** Set up a 2-voter test environment (Window A and Window B).
2. **Record Start Time:** Note current time: `T_start`.
3. **Voter 1 Balloting:** In Window A, vote for Candidate A at `T_start + 3 seconds`.
4. **Voter 2 Balloting:** In Window B, vote for Candidate B at `T_start + 6 seconds`.
5. **Observe Round Conclusion:**
   * Both eligible voters have now cast their ballots.
   * Trigger the round completion action (`NEXT`).
   * Record time of next round appearance: `T_next`.
6. **Verify Transition:**
   * Calculate elapsed time: `T_next - T_start`.
   * Verify that the new candidate pair appears immediately upon all votes being accounted for.

* **PASS condition:** The round advances cleanly as soon as eligible voting concludes without hung states.
* **FAIL condition:** The application freezes, refuses the advancement command, or fails to broadcast the new pair.

---

## SECTION 10 — TIMER TEST

### 10.1 Purpose & Expected Behavior
Verify that round timing is governed authoritatively and does not rely on client-side clocks.

### 10.2 Execution Steps
1. Open `/vote` in Browser Window A.
2. Confirm active round is underway.
3. Observe round duration and status.
4. **Client Clock Tampering Test:**
   * In Windows/macOS system settings, change your computer clock forward by 1 hour.
   * Observe Browser Window A.
   * **Verify:** The client application does **NOT** prematurely terminate the round or declare a winner based on local computer time. The server remains in authoritative control.
5. **Mid-Round Refresh Test:**
   * While an active round is underway, refresh Browser Window A (`Ctrl+F5`).
   * **Verify:** The client reconnects and synchronizes immediately with the authoritative server state.
6. Revert your system clock to automatic time.

* **PASS condition:** Server authoritativeness holds; client-side system clock manipulation has zero effect on tournament progression.
* **FAIL condition:** Changing local computer clock forces client UI to advance or crash.

---

## SECTION 11 — RECONNECTION TEST

### 11.1 Purpose
Verify that network interruptions or browser reloads restore state seamlessly without data corruption.

### 11.2 Reconnection Matrix

| Scenario | Voter Action | Expected Client Recovery | Preserved Data | Reset Data |
|---|---|---|---|---|
| **Active Round (Before Vote)** | Press F5 on `/vote` | Reconnects to socket; displays active pair | Authoritative candidate pair, server tallies | Connection socket ID (transparent) |
| **Active Round (After Vote)** | Press F5 on `/vote` | Reconnects to socket; displays active pair | Authoritative candidate pair, server tallies | Component-level `hasVoted` state resets to fresh session |
| **Between Rounds** | Press F5 during `NEXT` | Reconnects to socket; displays new pair | New pair drawn from server entries queue | Previous round selection |
| **Tournament Winner** | Press F5 on `/results` | Reconnects to socket; displays champion card | Authoritative `winner` string, champion trophy | None (terminal state immutable) |

### 11.3 Step-by-Step Reconnection Test
1. Navigate to `http://localhost:5173/vote`.
2. Observe active pair (*Shallow Grave* vs *Trainspotting*).
3. Open browser DevTools (`F12`) → Network tab. Set throttling to **Offline** for 3 seconds, then set back to **No throttling**.
4. Observe the interface: Socket.io automatically reconnects and re-synchronizes state snapshot.
5. Cast a vote to verify connection is fully active.

* **PASS condition:** Socket recovers without application restart; state matches server snapshot.
* **FAIL condition:** Endless error loop, unhandled rejection, or socket disconnect crash.

---

## SECTION 12 — RESULTS TEST

Test all lifecycle states of the Results Page (`http://localhost:5173/results`).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          AUTHORITATIVE RESULTS                          │
│                         Current Round Tallies        [● Live Stream]    │
├───────────────────────────────────┬─────────────────────────────────────┤
│         CONTENDER 1 CARD          │          CONTENDER 2 CARD           │
│             [ S ]                 │               [ T ]                 │
│         Shallow Grave             │           Trainspotting             │
│            2 Votes                │              1 Vote                 │
│         ▓▓▓▓▓▓▓▓░░ 66.7%          │           ▓▓▓▓░░░░░░ 33.3%          │
├───────────────────────────────────┴─────────────────────────────────────┤
│ Total Round Votes: 3                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 12.1 State-by-State Verification

#### State A: Unseeded / No Active Round
* **Trigger:** Stop server or connect client when `vote: null` and `entries: []`.
* **Expected UI:** Status card with alert icon: *"No Results Available Yet. There is currently no active voting round and no tournament winner declared."*
* **Verify:** Has clean navigation button: *"Go to Voting Arena"*.

#### State B: Active Round (Zero Votes Cast)
* **Trigger:** Round begins, no votes submitted yet (`totalVotes === 0`).
* **Expected UI:** Informational banner: *"Voting is currently in progress. No votes recorded yet for this round."*
* **Verify:** Both candidate cards display `0%` progress bars. **Zero `NaN` or `Infinity` text appears.**

#### State C: Active Round (Votes Recorded)
* **Trigger:** Cast 2 votes for Candidate 1, 1 vote for Candidate 2.
* **Expected UI:** Real-time progress bars:
  * Candidate 1: `2 votes`, `66.7%`
  * Candidate 2: `1 vote`, `33.3%`
  * Footer: `Total Round Votes: 3`
* **Verify:** Server candidate order (`pair[0]`, `pair[1]`) is strictly preserved.

#### State D: Authoritativeness Lead Check
* **Trigger:** Candidate 1 has 10 votes, Candidate 2 has 0 votes.
* **Verify:** **Client does NOT declare Candidate 1 the winner.** The card remains labeled *"Contender 1"*, not *"Winner"*. Winner declaration is strictly reserved for server `winner` broadcast.

#### State E: Tournament Champion Concluded
* **Trigger:** All elimination rounds conclude; server broadcasts `winner: "Trainspotting"`.
* **Expected UI:** Celebratory hero screen with golden trophy badge (`🏆`), headline *"We Have a Winner!"*, champion name display, and official winner card.
* **Verify:** Action buttons provide one-click shortcuts to *"Back to Home"* and *"Voting Arena"*.

* **PASS condition:** All 5 states render accurately with exact mathematical percentages.
* **FAIL condition:** Any `NaN` percentage, incorrect tally sum, or premature client-side winner declaration.

---

## SECTION 13 — MULTI-SESSION ISOLATION TEST

### 13.1 Architectural Baseline & Scope
* **Core MVP Baseline:** The backend server runs a single authoritative Redux store broadcasting to all connected sockets on port `8090`.
* **Phase 7 Planned Architecture:** Multi-room partitioning (`/rooms/:sessionId`) allowing separate topics (e.g. *Best Tech Stack* vs *Best Programming Language*) to run concurrently.

### 13.2 Testing Session Boundary Stability in Core MVP
1. Open Browser Window 1 connecting to `http://localhost:5173/vote`.
2. Open Browser Window 2 connecting to `http://localhost:5173/results`.
3. Open Browser Window 3 connecting to `http://localhost:5173/dashboard`.
4. Dispatch votes from Window 1.
5. **Verify:**
   * Window 2 (`/results`) updates tallies for the active session.
   * Window 3 (`/dashboard`) maintains its administrative context without route collision.
   * Actions intended for the voting arena do not corrupt dashboard telemetry.
6. Disconnect Window 1: Window 2 and Window 3 continue functioning normally without session crosstalk or server restart.

* **PASS condition:** All client routes operate reliably against the authoritative store without memory leaks.
* **FAIL condition:** Client disconnection in one route crashes or resets other connected client sessions.

---

## SECTION 14 — PRIVACY / SECURITY BEHAVIOR TEST

Verify security and privacy boundaries through normal browser interactions. **Do not expose private tokens or JWT secrets.**

```
┌─────────────────────────────────┬────────────────────────────────────────────────────────┐
│ Security / Privacy Dimension   │ Verification Procedure                                 │
├─────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 1. Protected Admin Routes       │ Navigate directly to /dashboard without credentials;   │
│                                 │ verify layout boundaries and administrative notice.   │
├─────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 2. Voting Arena Tally Isolation │ On /vote during active voting, verify that live vote   │
│                                 │ tallies and competitor bars are hidden to prevent      │
│                                 │ participant bandwagon bias.                            │
├─────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 3. Ballot Anonymity             │ Verify that voting transmits only candidate entry      │
│                                 │ strings without tracking personal biometric data.      │
├─────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 4. Client Echo Prevention       │ Verify that incoming SET_STATE broadcasts from server  │
│                                 │ are never reflected back by client middleware.         │
├─────────────────────────────────┼────────────────────────────────────────────────────────┤
│ 5. Authoritative Immunity       │ Inspect client Redux store; verify client cannot       │
│                                 │ fabricate an authoritative tournament winner.          │
└─────────────────────────────────┴────────────────────────────────────────────────────────┘
```

### Verification Steps
1. **Bandwagon Bias Check:** Open `/vote`. During voting, verify the interface focuses on candidate evaluation rather than overwhelming live telemetry. (Evaluators use `/results` for live analysis).
2. **Echo Prevention Check:** Open browser DevTools Network tab → WS (WebSockets). Filter by `action`. Confirm that incoming `state` messages from port 8090 do **NOT** trigger corresponding outbound `SET_STATE` actions from the client.
3. **Winner Authority Check:** In browser DevTools Console, dispatch an unauthorized action:
   ```javascript
   // Attempting to forge winner on client
   window.store?.dispatch?.({ type: 'SET_WINNER', winner: 'Hacked Candidate' });
   ```
   * **Verify:** The server Redux store ignores unrecognized actions and overwrites client state on the next state broadcast.

* **PASS condition:** Server remains sole authority; echo loops are strictly prevented; participant ballot anonymity holds.
* **FAIL condition:** Client can forge an election winner or client enters infinite Socket.io echo loops.

---

## SECTION 15 — NEGATIVE TESTING

Test edge cases, incorrect input, and unexpected user actions against handled error paths.

| Input / Action | Expected Behavior | PASS Condition |
|---|---|---|
| **N01: Empty Email on Login** | Form indicates input is required; does not submit invalid payload. | Field highlights or validation prevents empty submission. |
| **N02: Empty Password on Login** | Form indicates password is required. | Validation prevents empty submission. |
| **N03: Direct 404 Route Access** | User navigates to `http://localhost:5173/invalid-page`. | `<NotFound />` component renders with helpful error message and link to home. |
| **N04: Repeated Rapid Clicking on Vote Button** | User double-clicks or spams vote button rapidly. | Only first click registers; button immediately disables; 0 duplicate actions sent. |
| **N05: Voting When No Active Round Exists** | User attempts to vote when `pair.length < 2`. | Voting buttons are not rendered; informative "No Active Round" card is shown. |
| **N06: Malformed Socket Action** | Client emits malformed payload: `socket.emit('action', null)`. | Server catches error safely in `try/catch`; does not crash; remains online. |
| **N07: Unknown Action Type** | Client emits `{ type: 'INVALID_UNKNOWN_ACTION' }`. | Server Redux reducer returns default state without mutating store. |
| **N08: Refreshing During Active Vote** | User refreshes page mid-selection. | Application recovers cleanly; reconnects to active matchup. |
| **N09: Interacting After Tournament Finish** | User attempts to cast votes on winner screen. | Voting arena shows winner card; voting buttons are removed. |
| **N10: Rapid Connection / Disconnection** | User opens and immediately closes 5 browser tabs. | Server cleans up socket listeners; remains stable on port 8090. |

---

## SECTION 16 — FULL DEMO SCRIPT (GOLDEN PATH)

This 7-minute golden path demonstration is designed for project evaluations and live stakeholder walkthroughs.

```
00:00 ── Start Servers (Backend Port 8090, Frontend Port 5173)
00:45 ── Open Homepage & Admin Login (/login → /dashboard)
01:30 ── Review Session & Candidate Pool Seed
02:15 ── Open Split-Screen (Window B: Voter 1, Window C: Voter 2, Window A: Results)
03:00 ── Demonstrate Round 1 Matchup (Shallow Grave vs Trainspotting)
03:45 ── Cast Vote from Voter 1 → Observe Instant Results Update (Window A)
04:30 ── Cast Vote from Voter 2 → Observe Vote Locking & 50/50 Split
05:15 ── Demonstrate Browser Refresh (F5) & Instant Reconnection Recovery
05:45 ── Advance Round → Demonstrate Synchronized Next Pair Across All Clients
06:30 ── Complete Tournament → Showcase "We Have a Winner!" Champion Presentation
07:00 ── Review Official Results Page (/results) & Conclude
```

### Detailed Script Instructions
* **Minute 00:00 — Boot:** Open Terminal 1 (`cd voting-server && npm start`) and Terminal 2 (`cd voting-client && npm run dev`).
* **Minute 00:45 — Explore:** Open `http://localhost:5173`. Show modern UI aesthetics, responsive navigation, and feature cards.
* **Minute 01:30 — Admin Portal:** Visit `/login`. Enter administrative credentials. Tour the `/dashboard` page.
* **Minute 02:15 — Split Screen:** Position two windows side-by-side: Left = `/vote`, Right = `/results`.
* **Minute 03:00 — Live Voting:** In `/vote`, explain the pairwise methodology. Show the two competing candidates and the "VS" divider.
* **Minute 03:45 — Real-Time Proof:** Click Contender 1. Point to the Right window (`/results`) and demonstrate that the tally updated instantly to 1 vote (100%) with **zero page reload**.
* **Minute 04:30 — Vote Locking:** Show that the voting buttons on the Left window are now locked and disabled, preventing cheating.
* **Minute 05:15 — Fault Tolerance:** Press `F5` on the Left window. Show that the page recovers immediately without errors.
* **Minute 05:45 — Round Progression:** Advance the round. Show both windows transitioning simultaneously to the next matchup.
* **Minute 06:30 — Champion Finale:** Advance to the final round. Submit ballots. Show the golden trophy celebration screen.
* **Minute 07:00 — Wrap Up:** Navigate to `/results`. Show the champion banner marked *"🏆 Official Winner"*.

---

## SECTION 17 — EXPECTED OBSERVATIONS

When the application is functioning properly, you should observe the following outputs:

### 17.1 Terminal Outputs

#### Backend Terminal (`voting-server`):
```text
> voting-server@1.0.0 start
> node -r @babel/register index.js
```
* Process stays active in foreground.
* No error stack traces or crash notices.

#### Frontend Terminal (`voting-client`):
```text
  VITE v8.1.1  ready in 284 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

### 17.2 Browser Visual Observations

#### 1. Homepage (`http://localhost:5173/`):
* Deep slate dark theme (`#0f172a`, `#1e293b`).
* Header with VoteSphere branding, navigation links (*Home*, *Voting Arena*, *Live Results*, *Dashboard*, *Login*).
* Hero section with glowing headline and *"Vote Now"* call-to-action button.

#### 2. Voting Arena (`http://localhost:5173/vote`):
* Header badge: `PAIRWISE COMPARISON`.
* Two candidate cards side-by-side with candidate name, monogram initial avatar, and interactive button.
* Central circular `VS` badge.
* Upon voting: Selected card gains accent border; feedback banner states *"Vote recorded for [Candidate]. Waiting for next round..."*.

#### 3. Live Results (`http://localhost:5173/results`):
* Header badge: `AUTHORITATIVE RESULTS` with green pulsing `● Live Stream` indicator.
* Proportional percentage progress bars with smooth animations.
* Total round vote counter.
* Upon tournament conclusion: Golden trophy hero card (`🏆`) with *"We Have a Winner!"* and champion name.

---

## SECTION 18 — TROUBLESHOOTING GUIDE

| Symptom | Probable Cause | Diagnostic Check | Resolution |
|---|---|---|---|
| **Port 8090 already in use** | A previous instance of the voting server or another Node process is running. | Run `netstat -ano \| findstr 8090` in terminal. | Terminate the process using PID: `Stop-Process -Id <PID> -Force` (PowerShell) or `taskkill /PID <PID> /F` (CMD). Then restart `npm start`. |
| **Port 5173 already in use** | A previous Vite dev server is still active. | Check terminal message: Vite prompts to run on port 5174. | Terminate previous Vite process or specify `npm run dev -- --port 5173`. |
| **Endless loading spinner on `/vote` or `/results`** | Backend server is not running or Socket.io connection failed. | Check browser DevTools console for `GET http://localhost:8090/socket.io/ net::ERR_CONNECTION_REFUSED`. | Start backend server: open terminal in `voting-server/` and run `npm start`. |
| **"No Active Voting Round" card is displayed** | Server booted but entries were not seeded or `NEXT` was not dispatched. | Check `voting-server/index.js` startup dispatch. | Restart backend with `npm start`, which automatically executes `SET_ENTRIES` and `NEXT`. |
| **"We Have a Winner!" banner appears immediately** | The previous tournament finished and the in-memory store retained the winner. | Refresh server memory. | Restart backend process (`npm start`) to reset Redux store with fresh seed data from `entries.json`. |
| **Vote button does not respond** | You have already cast a vote for the active candidate pair. | Look for green feedback banner confirming selection. | Wait for the next round to begin; buttons unlock automatically for the new pair. |
| **`npm start` fails with Babel error** | Missing dependencies or wrong Node version. | Run `node -v` (ensure >= 18.0.0). | Run `npm install` in `voting-server/` to ensure `@babel/register` and presets are installed. |
| **Blank white screen in browser** | JavaScript syntax error or missing client dependency. | Open DevTools console (F12) to inspect error trace. | Run `npm install` in `voting-client/` and restart `npm run dev`. |

---

## SECTION 19 — PASS / FAIL SUMMARY

Record your manual evaluation results in this verification table:

| Test ID | Test Name | Execution Status | Evaluator Notes |
|---|---|---|---|
| **T01** | Backend Server Startup | ☐ PASS  ☐ FAIL | |
| **T02** | Frontend Client Startup | ☐ PASS  ☐ FAIL | |
| **T03** | In-Memory / DB Readiness | ☐ PASS  ☐ FAIL | |
| **T04** | Admin Login Succeeded | ☐ PASS  ☐ FAIL | |
| **T05** | Invalid Login Handling | ☐ PASS  ☐ FAIL | |
| **T06** | Session Entry Initialization | ☐ PASS  ☐ FAIL | |
| **T07** | Candidate Pair Validation | ☐ PASS  ☐ FAIL | |
| **T08** | Voter Joins Session | ☐ PASS  ☐ FAIL | |
| **T09** | Pair Matchup Display | ☐ PASS  ☐ FAIL | |
| **T10** | Voter Selects Option | ☐ PASS  ☐ FAIL | |
| **T11** | Vote Locking in UI | ☐ PASS  ☐ FAIL | |
| **T12** | Duplicate Click Prevention | ☐ PASS  ☐ FAIL | |
| **T13** | Timer Baseline | ☐ PASS  ☐ FAIL | |
| **T14** | Round Progression Readiness | ☐ PASS  ☐ FAIL | |
| **T15** | Server-Driven Progression | ☐ PASS  ☐ FAIL | |
| **T16** | Early Completion Trigger | ☐ PASS  ☐ FAIL | |
| **T17** | Next Pair Transition | ☐ PASS  ☐ FAIL | |
| **T18** | Multi-Voter State Sync | ☐ PASS  ☐ FAIL | |
| **T19** | Vote Synchronization | ☐ PASS  ☐ FAIL | |
| **T20** | Synchronized Next Round | ☐ PASS  ☐ FAIL | |
| **T21** | Browser Refresh / Reload | ☐ PASS  ☐ FAIL | |
| **T22** | Reconnected State Recovery | ☐ PASS  ☐ FAIL | |
| **T23** | Clean Voter Presentation | ☐ PASS  ☐ FAIL | |
| **T24** | Tournament Completion | ☐ PASS  ☐ FAIL | |
| **T25** | Winner Display on Voting Page | ☐ PASS  ☐ FAIL | |
| **T26** | Results Page Champion State | ☐ PASS  ☐ FAIL | |
| **T27** | Results Percentage Display | ☐ PASS  ☐ FAIL | |
| **T28** | No-Results State | ☐ PASS  ☐ FAIL | |
| **T29** | Active Zero-Votes State | ☐ PASS  ☐ FAIL | |
| **T30** | Session Boundary Stability | ☐ PASS  ☐ FAIL | |
| **T31** | End-to-End Tournament Flow | ☐ PASS  ☐ FAIL | |

### Evaluation Tally
* **Total Tests Executed:** ______ / 31
* **Passed:** ______
* **Failed:** ______
* **Blocked:** ______
* **Not Tested:** ______

---

## SECTION 20 — MVP ACCEPTANCE CHECKLIST

Check each requirement to certify that the Core MVP is working as intended:

* [ ] **Application Starts Cleanly:** Backend (`npm start`) and frontend (`npm run dev`) launch without errors.
* [ ] **Database / Store Ready:** Authoritative in-memory Redux store initializes and binds to port 8090.
* [ ] **Admin Authentication Accessible:** `/login` route functions and transitions to `/dashboard`.
* [ ] **Candidate Seed Loaded:** Contender pool initialized from `entries.json`.
* [ ] **Voter Joining Operates:** Multiple browser instances connect to `/vote` without requiring account setup.
* [ ] **Pairwise Voting Functions:** Candidate cards render properly and accept voter selections.
* [ ] **Vote Locking Enforced:** Voting buttons lock immediately upon selection, preventing duplicate clicks.
* [ ] **Timer / Progression Authority:** Round transitions are governed authoritatively by the server.
* [ ] **Early Completion Supported:** Rounds can transition immediately once voting is concluded.
* [ ] **Real-Time Synchronization Validated:** Votes and state updates broadcast to all clients in milliseconds.
* [ ] **Reconnection / Refresh Tested:** Reconnected clients immediately receive the current state snapshot.
* [ ] **Multi-Client Consistency:** Independent browser windows remain perfectly synchronized.
* [ ] **Session Boundary Stability:** Socket disconnections do not crash the authoritative store.
* [ ] **Winner Announcement Operates:** Concluded tournament displays the official champion with trophy badge.
* [ ] **Results Presentation Verified:** Live percentages calculate accurately without division-by-zero errors.
* [ ] **Zero Blocking Issues:** No application crashes, infinite echo loops, or critical defects exist.

#### Core MVP Testing Certification Status:
* ☐ **PASS (Certified Production-Ready for Core MVP Scope)**
* ☐ **PASS WITH MINOR ISSUES (Non-blocking observations noted)**
* ☐ **FAIL (Requires engineering intervention)**

---

## SECTION 21 — KNOWN LIMITATIONS & SCOPE BOUNDARIES

The following architectural boundaries represent documented design decisions of Feature 1 and must not be treated as defects:

1. **Client-Side Token Storage (v1):**
   In Feature 1 (v1), the administrator JWT is stored in browser `localStorage` (`votesphere_admin_jwt`). Voter tokens are stored in `sessionStorage`/`localStorage` (`votesphere_voter_token_${sessionId}`) and mirrored in session cookies. This enables straightforward multi-client testing and debugging across browsers. Migration to `httpOnly`, `SameSite=Strict`, `Secure` cookies is a planned security hardening pass.
2. **Server-Side In-Memory Persistence:**
   The backend server maintains all session states, candidate queues, admin in-memory instances, voter token registries, and duplicate vote keys strictly in server memory. When the backend server process restarts, all state resets to the bootstrap seed configuration. Persistent database storage with MongoDB is scheduled for Feature 4.
3. **Deferred Feature Capabilities:**
   * Timers and automatic round advancement are deferred to Feature 2.
   * Admin lobby waiting room and QR code generation are deferred to Feature 3.
   * Results history database persistence is deferred to Feature 4.
   * Comparative real-time bar charts with hidden active round tallies are deferred to Feature 5.

---

## SECTION 22 — TEST REPORT TEMPLATE

Complete and sign this report upon concluding evaluation:

```text
================================================================================
                    VOTESPHERE CORE MVP TEST REPORT
================================================================================

Testing Date:             ______________________________________________________
Lead Tester / Evaluator:  ______________________________________________________
Application Version:      Core MVP (Phases 0–6 Complete, 100%)
Repository / Commit:      Nisam97/fullstack-redux-voting-app (Branch: develop1)
Environment:              Windows / macOS / Linux (Node.js: _______________)

System Components Verified:
  - Backend Server:       Node.js, Redux, Immutable.js, Socket.io (Port 8090)
  - Frontend Client:      React 19, Redux Toolkit, React Router 7, Vite (Port 5173)
  - State Storage:        Authoritative In-Memory Redux Store (MongoDB optional)

Test Execution Summary:
  - Tests Executed:       ______ / 31
  - Tests Passed:         ______
  - Tests Failed:         ______
  - Tests Blocked:        ______

Critical Issues Identified:
  1. ___________________________________________________________________________
  2. ___________________________________________________________________________

Minor Observations & Usability Notes:
  1. ___________________________________________________________________________
  2. ___________________________________________________________________________

Overall Evaluation Result:
  [ ] ACCEPTED — Core MVP satisfies all operational pairwise voting criteria.
  [ ] REJECTED — Blocking defects identified; requires remediation.

Evaluator Signature:      _________________________________
Date:                     _________________________________
================================================================================
```
