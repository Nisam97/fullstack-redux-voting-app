# VoteSphere Manual Test Guide

A complete hands on testing guide for VoteSphere. It assumes no knowledge of the source code. Every step, command and expected result below was verified against the current implementation.

## 3.1 Testing Prerequisites

| Item | Requirement |
| ---- | ----------- |
| Node.js | Version 18 or newer (verified on Node 22 and 24) |
| npm | Version 9 or newer (bundled with Node) |
| MongoDB | Version 6 or newer, running locally on port 27017, or a reachable connection string. The backend refuses to start without it |
| Mail server | Optional. Leave `SMTP_HOST` empty and OTP codes print to the backend console, which is the intended local setup |
| Browser | Chrome, Edge, Firefox or Safari, current version |

### Install (run once)

```bash
# from the repository root
cp .env.example .env
cd voting-server && npm install
cd ../voting-client && npm install
```

### Start the services

```bash
# Terminal 1: backend on port 8090 (reads .env from the repository root)
cd voting-server && npm start

# Terminal 2: frontend on port 5173
cd voting-client && npm run dev
```

### Automated suites (regression reference, not a substitute for this guide)

```bash
cd voting-server && npm test     # Mocha suite, verified: 799 passing
cd voting-client && npm test     # node --test then Vitest, verified: 468 + 127 passing
cd voting-client && npm run lint
cd voting-client && npm run build
```

The full run guide, with every terminal command needed to install and start the project plus a command list for each feature, is in `Architecture.md` section 1.11 (How to Run).

### Environment variables the tester should know

| Variable | Default | Effect on testing |
| -------- | ------- | ----------------- |
| `PORT` | `8090` | Backend port |
| `MONGODB_URI` | `mongodb://localhost:27017/votesphere_dev` | Database target |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `adminPassword123!` | Admin test credentials |
| `SMTP_HOST` | empty | Empty means OTP codes appear in the backend console |
| `OTP_TTL_MINUTES` | `10` | How long a code stays valid |
| `VOTE_TIMER_DURATION` | `30` | Default round length in seconds |
| `ROUND_REVEAL_DURATION` | `10` in the example file | Reveal window in seconds (code range 1 to 60) |
| `API_MIN_RESPONSE_MS` | `100` | Response time floor on OTP request and join code routes |

## 3.2 Test Environment

| Item | Requirement |
| ---- | ----------- |
| Frontend | React 19 + Vite at `http://localhost:5173` |
| Backend | Node http + Socket.io at `http://localhost:8090` |
| Database | MongoDB, database name `votesphere_dev` |
| Browser | Any modern browser; use two separate windows or a normal and a private window for real time tests |
| Authentication | Admin: username and password giving a JWT. Voter: 6 digit email code giving an HttpOnly `vs_voter` cookie. Anonymous voter: display name only |

## 3.3 Test Data

| Test data | Value and purpose |
| --------- | ----------------- |
| Admin account | `admin` / `adminPassword123!` (from `.env.example`), used for every admin test |
| Seed tournament session | `sess_default`, "Danny Boyle Film Tournament", 11 film titles from `voting-server/entries.json`, tournament mode, starts open on a fresh database |
| Seed single ballot session | `sess_horror`, "Horror Classics": The Shining, Psycho, Alien, single ballot mode, starts open |
| OTP test emails | Any valid address works locally, for example `voter1@example.com`. Read the code from the backend console line `[OTP-DEV] Code <code> for <email>...` |
| Second voter | A second browser window or private window, or a second email address for secured sessions |
| Session with 7+ entries | For tournament tests, for example 7 film titles |
| Session with 3 to 6 entries | For single ballot tests, for example 3 titles |
| Secured session emails | Two addresses, one allowlisted and one not, for example `invited@example.com` and `outsider@example.com` |

## 3.4 Feature Test Cases

Each case states its objective, preconditions, steps and pass criteria. Cases are numbered `MT-nnn` and reused in the coverage matrix at the end.

Every case also starts with a `Commands` line. Unless the line says otherwise, the backend and frontend from section 3.1 are already running. The line lists the terminal commands needed to perform that test by hand, plus the automated suite covering the same feature, written out so it can be copied and run as is.

### MT-001: Backend startup and database connection

**Commands:** `cd voting-server && npm start`, then `curl -s http://localhost:8090/api/sessions`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/db_connection_spec.js`

**Objective:** the backend boots, connects to MongoDB and listens on port 8090.

**Preconditions:** MongoDB running locally, `.env` present at the repository root.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Run `cd voting-server && npm start` | Console prints `[MongoDB] Connected: localhost/votesphere_dev` |
| 2 | Wait for startup to finish | Console prints `[Startup] Recovered ... session(s)`, then `Server listening on port 8090` |
| 3 | Open `http://localhost:8090/api/sessions` in the browser | A JSON body with `success: true` and a sessions array |

**Expected Final Result:** server running, API answering, no fatal error.

**Pass Criteria:** all three steps behave as stated.

### MT-002: Seed sessions exist

**Commands:** `curl -s http://localhost:8090/api/sessions`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/bootstrap_spec.js`

**Objective:** the two seed sessions bootstrap on a fresh database.

**Preconditions:** MT-001 complete, database without prior sessions.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | GET `http://localhost:8090/api/sessions` | Array contains `sess_default` (title "Danny Boyle Film Tournament") and `sess_horror` ("Horror Classics") |
| 2 | Open `http://localhost:5173/sessions/sess_default/lobby` | Lobby shows the title and a voter count |
| 3 | Open `http://localhost:5173/sessions/sess_horror/lobby` | Lobby shows "Horror Classics" |

**Expected Final Result:** both seeds present and joinable.

**Pass Criteria:** both sessions resolve in the lobby.

### MT-003: Frontend startup

**Commands:** `cd voting-client && npm run dev`, then open `http://localhost:5173`. Automated regression: `cd voting-client && node --test test/stage_c_spec.js`

**Objective:** the client serves and renders the home page.

**Preconditions:** backend running (MT-001).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Run `cd voting-client && npm run dev` | Vite reports the app at `http://localhost:5173` |
| 2 | Open `http://localhost:5173` | Home page renders: nav bar with Home, Join, History and Sign in |
| 3 | Press each nav link | Each opens without console errors |

**Expected Final Result:** app reachable and navigable.

**Pass Criteria:** home page and navigation work.

### MT-004: Admin login success

**Commands:** open `http://localhost:5173/admin`, or `curl -s -X POST http://localhost:8090/api/admin/login -H "Content-Type: application/json" -d '{"username":"admin","password":"adminPassword123!"}'`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/auth_spec.js`, `cd voting-client && node --test test/auth_spec.js`

**Objective:** valid admin credentials open the admin panel.

**Preconditions:** app running, admin credentials known.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Open `http://localhost:5173/login` | Voter sign in form visible |
| 2 | Switch to "Administrator Portal" mode | Username and password fields appear |
| 3 | Enter `admin` and `adminPassword123!`, submit | Redirected to `/admin`; nav bar shows `Admin: admin` and a Logout button |
| 4 | Inspect the admin page | Six metric cards and the session list render, including secured sessions |

**Expected Final Result:** admin session established.

**Pass Criteria:** `/admin` is reachable and shows the full registry.

### MT-005: Admin login failure and throttle

**Commands:** the same login `curl` from MT-004 with a wrong password, repeated until the throttle answers. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/auth_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/ip_throttle_regression_spec.js`

**Objective:** wrong credentials fail, and repeated failures throttle the login.

**Preconditions:** a browser not yet throttled (restart the backend to clear the in memory throttle, or use a fresh client address).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | On `/login` admin mode submit a wrong password | Error shown, still on the login page |
| 2 | Repeat until 6 attempts total | The 6th answer is refused with a wait message (HTTP 429 with `retryAfterMs`) |
| 3 | Wait for the announced wait, retry the correct password | Login succeeds and the throttle clears |

**Expected Final Result:** brute force attempts are slowed, correct credentials always work.

**Pass Criteria:** failures return 401 until the limit, then 429, then success after waiting.

### MT-006: Admin route guard

**Commands:** open `http://localhost:5173/admin` while signed out. Automated regression: `cd voting-client && node --test test/stage_d_spec.js`

**Objective:** `/admin` requires a valid admin session.

**Preconditions:** signed out (clear site data or press Logout).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Navigate directly to `http://localhost:5173/admin` | Redirected to `/login` |
| 2 | Sign in as admin | Returned to `/admin` (the guard remembers the target) |

**Expected Final Result:** protected route behavior.

**Pass Criteria:** anonymous visitors cannot reach the panel.

### MT-007: Admin logout

**Commands:** press Log out in the nav bar while at `http://localhost:5173/admin`. Automated regression: `cd voting-client && node --test test/auth_spec.js`

**Objective:** logout clears the stored credential and socket identity.

**Preconditions:** signed in as admin (MT-004).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Press Logout in the nav bar | Redirected to `/login`; Admin link disappears |
| 2 | Navigate to `/admin` | Guard redirects to `/login` again |
| 3 | Reload the home page | Still signed out |

**Expected Final Result:** credential removed from storage and from the socket handshake.

**Pass Criteria:** no admin surface is reachable after logout.

### MT-008: Create a public tournament session

**Commands:** create the session in the form at `http://localhost:5173/admin`, then `curl -s http://localhost:8090/api/sessions`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/sessions_reducer_spec.js`, `cd voting-client && node --test test/admin_workflow_spec.js`

**Objective:** an admin creates a public session with 7 or more entries (tournament mode).

**Preconditions:** signed in as admin.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Press Create Session | Dialog opens with title, id, timer, entries, type fields |
| 2 | Title `Tournament Test`, timer `60`, paste 7 film titles one per line, type Public | Form accepts the input; mode note indicates tournament mode |
| 3 | Submit | Success toast; the new session appears in the list as Pending with a join code |
| 4 | Open the session lobby in a second window | Lobby shows the title, entry count 7, status pending |

**Expected Final Result:** session created, pending, joinable.

**Pass Criteria:** the session exists in the admin list and the lobby.

### MT-009: Create a single ballot session

**Commands:** the same create form in single ballot mode at `http://localhost:5173/admin`. Automated regression: `cd voting-client && node --test test/admin_mode_note_spec.js`, `cd voting-client && node --test test/stage_d_spec.js`

**Objective:** 2 to 6 entries automatically produce single ballot mode.

**Preconditions:** signed in as admin.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Create Session with title `Ballot Test`, timer `30`, 4 entries | Mode note shows single ballot |
| 2 | Submit, then open the lobby | Session pending with entry count 4 |
| 3 | Start the session from Manage Session | The voting arena shows all 4 candidates on one ballot |

**Expected Final Result:** single ballot mode chosen by the server from the entry count.

**Pass Criteria:** the arena presents one ballot, not pairs.

### MT-010: Session creation validation

**Commands:** submit invalid values in the create form at `http://localhost:5173/admin`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/timer_contract_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/create_session_spec.js`

**Objective:** invalid create inputs are refused with clear errors.

**Preconditions:** signed in as admin, create dialog open.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Submit with a blank title | Client error: title is required |
| 2 | Paste the same entry three times | Client error: at least 2 distinct entries |
| 3 | Timer `4`, then `301`, then `25.5` | Client errors: minimum 5 seconds, maximum 300 seconds, must be a valid integer |
| 4 | Timer `5`, then `300` | Both accepted |
| 5 | Reuse an existing session id | Client error naming the collision; the server would answer `DUPLICATE_SESSION_ID` |

**Expected Final Result:** only valid sessions are created.

**Pass Criteria:** every invalid input is refused, valid boundaries pass.

### MT-011: Create a secured session with an allowlist

**Commands:** the create form at `http://localhost:5173/admin` with the access mode set to an allowlist. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/secured_sessions_spec.js`

**Objective:** a secured allowlist session is created unpublished with initial emails.

**Preconditions:** signed in as admin, two test emails available.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Create Session, type Secured, who can join Allowlist, paste `invited@example.com` | Form shows the allowlist box for secured sessions |
| 2 | Submit | Session appears with a Secured badge |
| 3 | In a private window (no account) open the lobby | Neutral "This session is not available." state, with a sign in link |
| 4 | Sign in as `invited@example.com` (code from the console), reopen the lobby | Lobby loads, join form usable |

**Expected Final Result:** outsider blocked, allowlisted voter admitted.

**Pass Criteria:** the visibility gate behaves as stated for both callers.

### MT-012: Session id generation and cleaning

**Commands:** create once with a blank id and once with the id `My Session!!` at `http://localhost:5173/admin`. Automated regression: `cd voting-client && node --test test/admin_workflow_spec.js`

**Objective:** a blank id auto generates, and custom ids are cleaned.

**Preconditions:** signed in as admin.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Create a session leaving the id blank | The list shows an id of the shape `sess_<timestamp>` |
| 2 | Create a session with id `My Session!!` | The stored id is lower case with disallowed characters replaced by dashes |

**Expected Final Result:** usable ids always result.

**Pass Criteria:** both behaviors match the steps.

### MT-013: Join code resolution

**Commands:** `curl -s http://localhost:8090/api/join/<CODE>` with the code shown on the session row. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/join_code_and_discovery_spec.js`, `cd voting-client && node --test test/join_code_spec.js`

**Objective:** a valid code opens the right lobby.

**Preconditions:** a pending session with a visible join code (MT-008).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Open `/join`, type the code exactly as shown | Submit enabled once 6 characters are entered |
| 2 | Submit | Redirected to `/sessions/<id>/lobby` with the correct title |
| 3 | Open `/join/<CODE>` directly (typed in the address bar) | Same lobby, resolved automatically |

**Expected Final Result:** code based entry works both ways.

**Pass Criteria:** the lobby for the intended session opens.

### MT-014: Join code failures and rate limit

**Commands:** `curl -s http://localhost:8090/api/join/ZZZZZZ` for an unknown code, then more than 30 resolver calls inside one minute for the limit. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/join_code_and_discovery_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/hardening_rate_limits_and_timing_spec.js`

**Objective:** bad codes fail consistently and lookups are throttled.

**Preconditions:** backend reachable.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | On `/join` submit `ZZZZZZ` | Error: `Code not found or no longer active.` |
| 2 | Submit a code for a completed session | The same error text (no extra information leaked) |
| 3 | Repeat lookups more than 30 times within one minute from the same address | A `429` answer, shown as `Too many requests, please wait.` |
| 4 | Wait a minute, retry a valid code | Resolution works again |

**Expected Final Result:** consistent errors and a working throttle.

**Pass Criteria:** identical error text for unknown and inactive codes, throttle engages and recovers.

### MT-015: Refresh join code

**Commands:** press Refresh on the session row at `http://localhost:5173/admin`, then `curl -s http://localhost:8090/api/join/<CODE>` with the new code. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/join_code_and_discovery_spec.js`

**Objective:** refreshing replaces the code and invalidates the old one.

**Preconditions:** admin panel open, a pending session with a known code.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Note the current code, press Refresh code | A new 6 character code replaces it in the row |
| 2 | Resolve the old code on `/join` | `Code not found or no longer active.` |
| 3 | Resolve the new code | Lobby opens |

**Expected Final Result:** old access ends, new access works.

**Pass Criteria:** exactly one code works at a time.

### MT-016: QR share modal

**Commands:** press Share on the session row at `http://localhost:5173/admin`. Automated regression: `cd voting-client && node --test test/stage_d_spec.js`

**Objective:** the share dialog shows a scannable join link.

**Preconditions:** a pending session with a join code.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Press Share on the session row | Modal opens with a QR image and the code |
| 2 | Scan the QR with a phone (or decode it) | The encoded URL ends with `/join/<joinCode>` |
| 3 | Close the modal with its close button or the Escape key | Modal closes |

**Expected Result:** a usable share artifact.

**Pass Criteria:** the QR decodes to the join link.

### MT-017: Anonymous voter join

**Commands:** `curl -s -X POST http://localhost:8090/api/sessions/<ID>/join -H "Content-Type: application/json" -d '{"displayName":"Ada"}'`, or the join screen at `http://localhost:5173/join`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/lobby_headcount_spec.js`, `cd voting-client && node --test test/stage_e_spec.js`

**Objective:** a visitor joins a public session with only a display name.

**Preconditions:** a pending public session (MT-008), one browser window.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Open the lobby in a private window | Join form asks for a display name |
| 2 | Enter `Ada` and submit | Joined state: the lobby shows the name and a voter count of 1 |
| 3 | Reload the page | Still joined (token kept in browser storage) |

**Expected Final Result:** anonymous participation established.

**Pass Criteria:** the voter can proceed to vote once the session opens.

### MT-018: Join validation and archived sessions

**Commands:** submit a blank display name in the join form, then open the lobby of an archived session at `http://localhost:5173/sessions/<ID>/lobby`. Automated regression: `cd voting-client && node --test test/stage_e_spec.js`

**Objective:** bad joins are refused clearly.

**Preconditions:** MT-017 browser available.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Submit the join form with a blank name | Error: a display name is required |
| 2 | Open the lobby of an archived session | Archived notice shown, joining refused |
| 3 | Try to join twice with different names in two windows | Both may join; duplicate display names are allowed |

**Expected Final Result:** only sensible joins succeed.

**Pass Criteria:** each refusal shows the stated message.

### MT-019: Live lobby headcount

**Commands:** open `http://localhost:5173/sessions/<ID>/lobby` in two browser windows. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/lobby_headcount_spec.js`, `cd voting-client && node --test test/presence_client_spec.js`

**Objective:** the voter count updates live for everyone.

**Preconditions:** a pending public session.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Window A: open the lobby as voter `One` | Headcount shows 1 |
| 2 | Window B (private): join as voter `Two` | Both windows now show 2 without reloading |
| 3 | Close window B | Both remaining views show 1 connected voter shortly after |

**Expected Final Result:** presence is live.

**Pass Criteria:** counts track joins and disconnects.

### MT-020: Lobby auto transition on start

**Commands:** press Start at `http://localhost:5173/admin` with both lobby windows open. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/lobby_headcount_spec.js`, `cd voting-client && node --test test/stage_c_spec.js`

**Objective:** joined voters move to the arena when voting opens.

**Preconditions:** at least one voter joined in the lobby, admin panel open.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Admin: Manage Session, press Start | Session status becomes open |
| 2 | Observe the voter window | Auto redirected to `/sessions/<id>/vote`; the first pair or ballot is visible |
| 3 | Observe a voter who never joined | The arena shows a display name join form instead of candidates |

**Expected Final Result:** seamless entry into voting.

**Pass Criteria:** joined voters land in the arena, unjoined voters are asked to join.

### MT-021: Lobby states for finished and hidden sessions

**Commands:** open `http://localhost:5173/sessions/<ID>/lobby` for a finished and for a hidden session. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/visibility_and_privacy_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/lobby_headcount_spec.js`

**Objective:** completed, archived and unreadable sessions render their own states.

**Preconditions:** one completed session, one archived session, one secured unpublished session.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Open the lobby of the completed session | Winner announced with a link to the results page |
| 2 | Open the lobby of the archived session | Archived notice, no join possible |
| 3 | Open the lobby of the secured unpublished session as an outsider | One neutral message: `This session is not available.` (never claims the session does not exist) |
| 4 | Open a lobby for a random unknown id | The same neutral message as step 3 |

**Expected Final Result:** honest, non leaking lobby states.

**Pass Criteria:** steps 3 and 4 are visually identical.

### MT-022: Cast a vote (tournament)

**Commands:** open `http://localhost:5173/sessions/<ID>/vote` and click a candidate. Automated regression: `cd voting-client && node --test test/voting_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/early_completion_integration_spec.js`

**Objective:** a voter casts one valid vote in an open round.

**Preconditions:** an open tournament session with at least one voter in the arena.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Wait for the arena to load a pair | Two candidate cards and a countdown are visible |
| 2 | Click one candidate | The card confirms the choice; the cards lock for this round |
| 3 | Watch the admin window | The round completes when the timer ends or everyone voted |

**Expected Final Result:** the vote is counted by the server.

**Pass Criteria:** the choice is confirmed and cannot be changed in that round.

### MT-023: Duplicate vote rejection

**Commands:** from the browser console emit a second socket `action` of type `VOTE` for the same round. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/review_majors_regression_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/core_spec.js`

**Objective:** a second vote in the same round is refused.

**Preconditions:** MT-022 completed in the current round.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Click the other candidate card | Nothing happens locally (cards locked) |
| 2 | Force a second vote from the browser console by dispatching a raw socket `action` of type `VOTE` for the same round | `action_error` with `DUPLICATE_VOTE` |
| 3 | Reload the arena | The original choice is still the only one recorded for that round |

**Expected Final Result:** one vote per round per voter, enforced server side.

**Pass Criteria:** the duplicate is refused with the stated error.

### MT-024: Tallies hidden during an active round

**Commands:** keep the arena at `http://localhost:5173/sessions/<ID>/vote` open during an active round. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/tally_visibility_guard_spec.js`, `cd voting-client && node --test test/results_hardening_spec.js`

**Objective:** no tally leaks while voting is open.

**Preconditions:** an open session with at least one vote cast in the current round.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Open `/sessions/<id>/results` in a voter window | "Voting in Progress" state: contenders only, no chart, no percentages |
| 2 | Inspect the socket payloads in the browser console (network or a socket logger) | `session_state.vote.tally` is an empty object during `VOTING` |
| 3 | Inspect the `rounds` array in the same payload | Not present while the round is live |

**Expected Final Result:** zero premature exposure.

**Pass Criteria:** no numbers are visible on any surface during the round.

### MT-025: Timer expiry closes the round

**Commands:** set `VOTE_TIMER_DURATION=5` in `.env`, then restart with `cd voting-server && npm start`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/timer_integration_spec.js`, `cd voting-client && node --test test/timer_expiry_spec.js`

**Objective:** the server closes the round at zero and refuses late votes.

**Preconditions:** an open session, short timer (5 seconds) recommended, voter in the arena.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Watch the countdown reach `00:00` | The round transitions to the reveal state automatically |
| 2 | Immediately click a candidate | `Voting is closed for this round.` (ROUND_CLOSED) |
| 3 | Observe the results window | The frozen tally of the closed round appears |

**Expected Final Result:** authoritative close, late votes rejected.

**Pass Criteria:** both windows show the reveal at the same moment.

### MT-026: Early completion when everyone votes

**Commands:** vote from two browser windows before the timer ends. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/early_completion_spec.js`, `cd voting-client && node --test test/early_completion_frontend_spec.js`

**Objective:** a round ends early once every eligible voter has voted.

**Preconditions:** two voter windows joined, one round open.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Voter A votes | Round still open (voter B has not voted) |
| 2 | Voter B votes | Round closes at once, before the timer ends |
| 3 | Repeat with a third window closed just before voting | The closed window does not block completion after the 10 second grace period |

**Expected Final Result:** quorum based early close.

**Pass Criteria:** completion follows the last vote, and stale disconnects do not block it.

### MT-027: Reveal window and automatic advancement

**Commands:** watch the reveal at `http://localhost:5173/sessions/<ID>/vote`, then press Next in the admin panel. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/reveal_next_regression_spec.js`, `cd voting-client && node --test test/round_results_lifecycle_spec.js`

**Objective:** the reveal countdown runs, then the next round loads without anyone pressing anything.

**Preconditions:** a round just closed (MT-025 or MT-026).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Observe the arena and results pages | A second countdown labeled `NEXT ROUND IN` runs |
| 2 | Let it reach zero | The next pair (tournament) or the concluded state loads automatically |
| 3 | Watch the admin panel | The round preview updates to the new matchup |

**Expected Final Result:** hands free round progression.

**Pass Criteria:** no client side action advanced the round; all windows stay in sync.

### MT-028: Champion conclusion

**Commands:** play a tournament through to the champion at `http://localhost:5173/sessions/<ID>/vote`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/round_lifecycle_spec.js`, `cd voting-client && node --test test/results_spec.js`

**Objective:** the tournament ends with a champion screen and a completed session.

**Preconditions:** a tournament running, close to a conclusion (or use the seed session and vote decisively each round).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Vote until one candidate remains | The arena shows `TOURNAMENT CONCLUDED` and the winner name |
| 2 | Press View Results | The results page shows the champion banner and full round history |
| 3 | Refresh the results page | The same conclusion renders from the persisted result |

**Expected Final Result:** completed session with a durable result.

**Pass Criteria:** the champion is stable across reloads.

### MT-029: Single ballot voting and plurality completion

**Commands:** create and start a single ballot session with 3 to 6 entries from `http://localhost:5173/admin`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/single_ballot_and_tie_ladder_spec.js`, `cd voting-client && node --test test/single_ballot_tie_ladder_client_spec.js`

**Objective:** a single ballot session completes on a plurality win.

**Preconditions:** a session with 3 to 6 entries, started (MT-009).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | In the arena, review the ballot with all candidates | One choice card per candidate |
| 2 | Voter A votes for candidate X; voter B also votes X | Round closes at timer end (or early if all voted) |
| 3 | Observe the reveal | X has the higher count and the session completes with X as winner |

**Expected Final Result:** plurality victory ends the session immediately.

**Pass Criteria:** the winner banner names X.

### MT-030: Zero vote handling

**Commands:** let two consecutive rounds pass with nobody voting. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/single_ballot_and_tie_ladder_spec.js`

**Objective:** an empty round replays once, and a second empty round ends the session as no result.

**Preconditions:** a started session where you can deliberately not vote (close the voter windows before the timer ends).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Start a round with nobody voting | The round replays once with a zero vote warning (resolution `zero_vote_replay`) |
| 2 | Leave the replay empty too | The session completes with no official champion (`no_result`) |
| 3 | Open the results page and history | Both say no official champion was declared, with the round history still shown |

**Expected Final Result:** dead sessions terminate safely instead of looping forever.

**Pass Criteria:** exactly one replay happens, then the no result outcome.

### MT-031: Vote rejection cases

**Commands:** from the browser console emit the invalid `VOTE` actions listed in the steps. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/core_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/ingress_allowlist_spec.js`

**Objective:** invalid vote intents are refused with the right errors.

**Preconditions:** browser console access, an open session.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Emit a socket `action` of type `VOTE` naming a candidate that is not in the active pair | `INVALID_ENTRY` |
| 2 | Emit `VOTE` for a session whose status is not open | `SESSION_NOT_OPEN` |
| 3 | Emit `VOTE` without any voter token | `VOTER_TOKEN_REQUIRED` |
| 4 | Emit an internal action type such as `SET_ROUND_LIFECYCLE` | `FORBIDDEN_ACTION` (the ingress allowlist) |

**Expected Final Result:** the store is unreachable by invalid intents.

**Pass Criteria:** each case returns the stated error and changes nothing.

### MT-032: Tournament first tie triggers a rematch

**Commands:** tie the first round of a tournament at `http://localhost:5173/sessions/<ID>/vote`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/single_ballot_and_tie_ladder_spec.js`, `cd voting-client && node --test test/single_ballot_tie_ladder_client_spec.js`

**Objective:** a tied pairwise round replays the same matchup.

**Preconditions:** a tournament session with two voters whose votes split (one votes each side).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Voter A votes candidate 1, voter B votes candidate 2 | Round closes tied at 1:1 |
| 2 | Observe the reveal and the next round | The same pair returns for a rematch (resolution `tie_advance` or rematch behavior, tie counter armed) |
| 3 | Vote decisively this time | The winner advances normally and the tie counter resets |

**Expected Final Result:** a first tie owes a rematch, not an admin window.

**Pass Criteria:** the rematch happens and a decisive win clears the ladder.

### MT-033: Single ballot tie triggers a runoff

**Commands:** tie a single ballot session at `http://localhost:5173/sessions/<ID>/vote`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/single_ballot_and_tie_ladder_spec.js`, `cd voting-client && node --test test/single_ballot_tie_ladder_client_spec.js`

**Objective:** a tied single ballot elects a runoff of only the tied candidates.

**Preconditions:** a single ballot session with 3 candidates and 2 voters.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | The two voters choose different candidates (a 1:1:0 tie for first) | Round closes tied |
| 2 | Observe the next ballot | Only the tied candidates appear (runoff, resolution `runoff`) |
| 3 | Vote in the runoff decisively | That candidate wins the session |

**Expected Final Result:** runoff mechanics as designed.

**Pass Criteria:** the runoff ballot contains only the tied candidates.

### MT-034: Second consecutive tie opens the admin window

**Commands:** tie twice in a row and watch the admin panel at `http://localhost:5173/admin`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/single_ballot_and_tie_ladder_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/grace_window_tie_ladder_spec.js`

**Objective:** a second tie arms a 30 second TIE_PENDING window.

**Preconditions:** MT-032 or MT-033 in progress with tied votes again.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Tie the rematch (or runoff) as well | Lifecycle becomes `TIE_PENDING` |
| 2 | Observe the voter arena | Voting is disabled; a waiting state is shown |
| 3 | Observe the admin panel | A tie alert banner appears with a shortcut into resolution, and the manage dialog shows pick and coin flip controls |
| 4 | Watch the timer | A 30 second countdown runs (status `tie_pending`) |

**Expected Final Result:** the host is asked to decide.

**Pass Criteria:** voters cannot vote during the window; the admin controls appear.

### MT-035: Admin resolves a tie by picking a winner

**Commands:** use the pick dropdown in the manage dialog at `http://localhost:5173/admin`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/single_ballot_and_tie_ladder_spec.js`

**Objective:** an explicit admin pick ends the tie.

**Preconditions:** MT-034 window open.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | In the manage dialog, choose a candidate in the tie pick dropdown | Dropdown lists the tied candidates |
| 2 | Press Pick winner | The tie resolves: the chosen candidate advances (tournament) or wins (single ballot); lifecycle returns to `VOTING` or the session completes |
| 3 | Check the round history | The round carries resolution `admin_pick` |

**Expected Final Result:** host authority over ties.

**Pass Criteria:** the pick is applied everywhere at once.

### MT-036: Coin flip and window expiry

**Commands:** press Coin flip in the tie window, then produce another tie and wait 30 seconds without touching it. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/single_ballot_and_tie_ladder_spec.js`

**Objective:** the host can flip a coin, and an unattended window flips one by itself.

**Preconditions:** a tie pending session; the ability to wait 30 seconds.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | New tie: press Coin flip in the window | A winner is chosen and applied at once (resolution `coin_flip`) |
| 2 | Produce another tie and do nothing for 30 seconds | The server resolves it by itself at expiry with a coin flip |
| 3 | Check the history | Both rounds show the coin flip resolution |

**Expected Final Result:** ties never wedge a session.

**Pass Criteria:** both the manual flip and the automatic expiry produce a resolution.

### MT-037: Secured allowlist join flow

**Commands:** open the secured lobby at `http://localhost:5173/sessions/<ID>/lobby` from an allowlisted browser. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/secured_sessions_spec.js`, `cd voting-client && node --test test/secured_session_client_spec.js`

**Objective:** an allowlisted, signed in voter joins and votes.

**Preconditions:** a secured allowlist session listing `invited@example.com`, started only after they join.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Private window: sign in at `/login` with `invited@example.com` (code from the console) | Signed in, nav shows `Hi, <name>` |
| 2 | Open the lobby | Lobby loads (eligibility passes) |
| 3 | Submit the join form | Joined; headcount includes them |
| 4 | Admin starts the session | The voter votes normally in the arena |

**Expected Final Result:** full participation for approved voters.

**Pass Criteria:** the voter reaches the arena and their vote counts.

### MT-038: Allowlist denial

**Commands:** join from a second browser window with an address that is not on the list. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/secured_sessions_spec.js`

**Objective:** a non allowlisted email cannot join.

**Preconditions:** the same secured session, a second email not on the allowlist.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Sign in as `outsider@example.com` | Signed in successfully (accounts are open) |
| 2 | Open the lobby of the secured session | The neutral not available state (same as an unknown id) |
| 3 | Try joining directly via the REST join endpoint (curl, section 3.14) | `403` with error `NOT_ON_ALLOWLIST` |

**Expected Final Result:** access denied without leaking session details.

**Pass Criteria:** the outsider cannot confirm the session exists in the UI and gets 403 at the API.

### MT-039: Approval request and admin decision

**Commands:** request from one browser window, then decide in the admin panel at `http://localhost:5173/admin`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/secured_sessions_spec.js`, `cd voting-client && node --test test/secured_session_client_spec.js`

**Objective:** a voter requests to join, the admin approves, the voter proceeds.

**Preconditions:** a secured approval session.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Voter signs in, opens the lobby, submits a join request | Pending state: waiting for organizer approval |
| 2 | Admin opens Manage Session, participants section | The request appears live with Approve and Reject buttons |
| 3 | Admin presses Approve | The voter is notified over the socket, shows as joined, and can vote once the session starts |
| 4 | Repeat with a second voter and press Reject | That voter sees `Your join request was rejected by the organizer.` |

**Expected Final Result:** host controlled admission.

**Pass Criteria:** approve admits, reject refuses, both notify the voter.

### MT-040: Start locks the roster and auto rejects pending requests

**Commands:** press Start at `http://localhost:5173/admin` while one request is still pending. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/secured_sessions_regression_spec.js`

**Objective:** starting a secured session freezes admissions.

**Preconditions:** a secured approval session with one approved voter and one pending request.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Admin presses Start | Session opens for the approved voter |
| 2 | Observe the pending requester | Receives `Your join request was rejected at session start.` |
| 3 | A brand new voter tries to join | `409` with error `SESSION_STARTED` ("already started, so new joins are closed") |

**Expected Final Result:** a fixed roster during voting.

**Pass Criteria:** no new voter enters after Start.

### MT-041: Start refused without eligible voters

**Commands:** press Start at `http://localhost:5173/admin` with no approved voter on the roster. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/eligibility_integration_spec.js`

**Objective:** a secured session cannot start empty.

**Preconditions:** a secured session with nobody joined.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Admin presses Start | `action_error` with `NO_ELIGIBLE_PARTICIPANTS` |
| 2 | Have one eligible voter join, press Start again | Session opens |

**Expected Final Result:** no empty secured tournaments.

**Pass Criteria:** the refusal and the later success both behave as stated.

### MT-042: Participant removal

**Commands:** press Remove in the manage dialog at `http://localhost:5173/admin`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/removal_token_revocation_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/voter_revocation_unit_spec.js`

**Objective:** removal cuts a voter off, immediately in the lobby and at round end during voting.

**Preconditions:** a secured allowlist session with a joined voter.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | While pending, admin presses Remove on the voter (confirm when asked) | The voter's window shows `You have been removed from this session by the organizer.` and loses its joined state |
| 2 | Rejoin the session as that voter, admin starts voting, then removes them mid round | The roster updates at once; the voter finishes the current round |
| 3 | When the round advances | The voter is disconnected and can no longer vote in the next round (`NOT_ELIGIBLE` or token refusal) |

**Expected Final Result:** removal is enforced by the server, not just the roster UI.

**Pass Criteria:** the removed voter's token stops working after the cut off point.

### MT-043: Allowlist paste diff and access mode switch

**Commands:** paste extra addresses into the allowlist and switch the access mode in the manage dialog at `http://localhost:5173/admin`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/secured_sessions_spec.js`

**Objective:** pasting a new allowlist adds and removes entries, and switching modes clears the roster.

**Preconditions:** a secured pending session with two allowlisted emails, one of whom joined.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Admin replaces the allowlist with only the second email (paste box or add/remove controls) | Counts report the additions and removals |
| 2 | Observe the first voter (who had joined) | Their socket is revoked and they receive the removal message |
| 3 | Press Switch access mode to Approval (confirm when asked) | Roster cleared, mode label changes, old allowlist rows gone |
| 4 | A previously allowlisted voter tries again | Join now goes through the approval queue instead |

**Expected Final Result:** roster edits are authoritative.

**Pass Criteria:** dropped emails lose access, mode switches reset admissions.

### MT-044: Secured sessions hidden from voter sockets

**Commands:** from an anonymous socket (the browser console or the node probe in section 3.14) request the sessions list. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/visibility_and_privacy_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/visibility_matrix_unit_spec.js`

**Objective:** a voter socket never learns about secured sessions.

**Preconditions:** a secured session exists; browser console access.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | As a signed out voter, inspect the `sessions` registry event in the console | Secured sessions are absent |
| 2 | As an admin socket, inspect the same event | Secured sessions present |
| 3 | As a voter without eligibility, emit `subscribe_session` for the secured id | `action_error` with `NOT_ELIGIBLE`; no `session_state` is delivered |
| 4 | GET `/api/sessions` without an admin token (curl) | The same filtered list the voter socket sees |

**Expected Final Result:** enumeration is impossible for voters.

**Pass Criteria:** all four observations match.

### MT-045: Voter registration with OTP

**Commands:** `curl -s -X POST http://localhost:8090/api/auth/otp/request -H "Content-Type: application/json" -d '{"email":"voter1@example.com"}'` and read the code from the backend console, or use `http://localhost:5173/register`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/accounts_and_otp_spec.js`, `cd voting-client && node --test test/voter_auth_slice_spec.js`

**Objective:** a new voter account is created through an emailed code.

**Preconditions:** backend running with empty `SMTP_HOST` (console fallback), registration email available.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Open `/register`, fill email, display name and a username (3 to 20 alphanumeric or underscore) | Form accepts the input |
| 2 | Request the code | Generic confirmation: "If your account exists or can be created, a code was sent." The backend console prints `[OTP-DEV] Code <code> for <email>...` |
| 3 | Enter the 6 digit code and submit | Signed in; nav shows `Hi, <name>`; redirected home |
| 4 | Reload the page | Still signed in (the `vs_voter` cookie restored the profile) |

**Expected Final Result:** a durable voter account without a password.

**Pass Criteria:** registration, sign in and restore all work.

### MT-046: OTP verification failures, cooldown and rate limits

**Commands:** repeat the OTP request `curl` from MT-045 and submit wrong codes at `http://localhost:5173/register`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/accounts_and_otp_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/hardening_rate_limits_and_timing_spec.js`

**Objective:** code abuse is refused with the right errors.

**Preconditions:** a fresh email for clean buckets (or restart the backend to clear the in memory limits).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Request a code, then submit a wrong code | `Incorrect code. N attempts remaining.` |
| 2 | Submit 5 wrong codes in total | The code locks (`CHALLENGE_LOCKED`, shown as locked, request a new code) |
| 3 | Request a second code within 60 seconds | `COOLDOWN_ACTIVE` with the wait in seconds |
| 4 | Request 6 codes for the same email inside one hour | The 6th is refused (`429`, `RATE_LIMITED`) with a `Retry-After` hint |
| 5 | Wait for the announced windows, request and verify a fresh code | Success |

**Expected Final Result:** brute forcing a code is impractical.

**Pass Criteria:** each refusal matches the step and recovery works.

### MT-047: OTP request response parity

**Commands:** time the OTP request for a known and for an unknown address: `curl -s -w "%{time_total}" -X POST http://localhost:8090/api/auth/otp/request -H "Content-Type: application/json" -d '{"email":"voter1@example.com"}'`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/hardening_rate_limits_and_timing_spec.js`

**Objective:** response timing cannot reveal whether an email is registered.

**Preconditions:** curl or a similar timer available; backend with the default `API_MIN_RESPONSE_MS=100`.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Time a request for an unknown email (10 runs) | Every answer takes at least about 100 ms and the body is the generic message |
| 2 | Time a request for a registered email (10 runs) | Same floor and the same generic body |
| 3 | Compare the two sets of timings | No usable difference (both are floored at the configured minimum) |

**Expected Final Result:** the clock leaks nothing useful.

**Pass Criteria:** both groups sit on the same floor with the same body.

### MT-048: Voter profile update and duplicate username

**Commands:** `curl -s -X POST http://localhost:8090/api/auth/profile -H "Content-Type: application/json" -b cookies.txt -d '{"name":"Ada","username":"ada_l"}'` with the cookie saved as in section 3.14. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/accounts_and_otp_spec.js`, `cd voting-client && node --test test/review_minors_client_spec.js`

**Objective:** a signed in voter can change name and username safely.

**Preconditions:** a signed in voter and a second account holding a username.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Update the display name via `POST /api/auth/profile` (curl, section 3.14) | `200` with the new name; the nav greeting changes after reload |
| 2 | Set a username already used by the other account | `409` with `USERNAME_TAKEN` |
| 3 | Set an invalid username (`ab`) | `400` with `INVALID_USERNAME` (3 to 20 characters) |
| 4 | Set a name longer than 80 characters | `400` with `INVALID_DISPLAY_NAME` |

**Expected Final Result:** profile edits are validated.

**Pass Criteria:** valid edits persist, invalid ones are refused.

### MT-049: Voter logout and cookie lifetime

**Commands:** press Log out in the nav bar at `http://localhost:5173`, or `curl -s -X POST -b cookies.txt -c cookies.txt http://localhost:8090/api/auth/logout`. Automated regression: `cd voting-client && node --test test/auth_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/accounts_and_otp_spec.js`

**Objective:** logout clears the voter cookie and the UI forgets the account.

**Preconditions:** a signed in voter.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Press Log out in the nav bar | Redirected home; nav shows Sign in again |
| 2 | Reload any page | Still signed out |
| 3 | Reopen the secured session lobby | Asked to sign in again |

**Expected Final Result:** clean sign out.

**Pass Criteria:** the `vs_voter` cookie is cleared.

### MT-050: Public result visibility

**Commands:** `curl -s http://localhost:8090/api/sessions/<ID>/result`, or open `http://localhost:5173/sessions/<ID>/results`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/visibility_and_privacy_spec.js`, `cd voting-client && npx vitest run test/results_visibility.test.jsx`

**Objective:** anyone can read a public completed result.

**Preconditions:** a completed public session (MT-028).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | In a private window, open `/sessions/<id>/results` | Champion banner, round timeline, totals panel |
| 2 | GET `/api/sessions/<id>/result` (curl, no auth) | `200` with the result payload |
| 3 | The same for `/api/sessions/<id>/rounds` | `200` with the full round list |

**Expected Final Result:** public results are truly public.

**Pass Criteria:** all three reads succeed without credentials.

### MT-051: Secured result gating and publish toggle

**Commands:** the same result `curl` from MT-050 without cookie or token (the same 404 body), then the publish toggle at `http://localhost:5173/admin`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/visibility_and_privacy_spec.js`, `cd voting-client && node --test test/visibility_privacy_client_spec.js`

**Objective:** a secured result stays private until the admin publishes it.

**Preconditions:** a completed secured session; admin and outsider windows.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Outsider: open `/sessions/<id>/results` | Neutral not available state |
| 2 | Outsider: GET `/api/sessions/<id>/result` (curl, no credentials) | `404` with `RESULT_NOT_FOUND` (byte identical to a missing id) |
| 3 | Approved participant: open the same results page | Full result visible |
| 4 | Admin: press the publish toggle in the result visibility panel | The control moves only after the server acknowledges; hint switches to Published |
| 5 | Outsider: reload the results page and the archive | Result now visible; the history card carries a Secured badge |

**Expected Final Result:** publication is an explicit host action.

**Pass Criteria:** every step matches, including the identical 404 bodies.

### MT-052: Publish refused before completion

**Commands:** press the publish toggle at `http://localhost:5173/admin` before the session completes. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/visibility_and_privacy_spec.js`, `cd voting-client && node --test test/visibility_privacy_client_spec.js`

**Objective:** results cannot be published while a session is still running.

**Preconditions:** an open secured session, admin window.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Attempt `SET_PUBLISH_RESULTS` for the open session (curl or socket) | Refused with `SESSION_NOT_COMPLETED` |
| 2 | The results page shows no working publish toggle before the session ends | The hint says publishing becomes available once the session has ended |

**Expected Final Result:** publish is post completion only.

**Pass Criteria:** the refusal is explicit and the UI agrees.

### MT-053: Round history REST guard

**Commands:** `curl -s http://localhost:8090/api/sessions/<ID>/rounds` without credentials. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/round_history_spec.js`

**Objective:** the rounds endpoint respects the same visibility rules as the socket.

**Preconditions:** a live session with a closed round, and a secured session mid voting.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | During active voting, GET `/api/sessions/<id>/rounds` | `200` with an empty or already closed list only (the live round is not exposed) |
| 2 | After a round closes, repeat | The closed round appears with its tally |
| 3 | For the secured session, repeat as an outsider | `404` (gated), same body as a missing result |

**Expected Final Result:** one guard on every path.

**Pass Criteria:** live tallies never leave through REST.

### MT-054: History archive listing

**Commands:** open `http://localhost:5173/history`, or `curl -s http://localhost:8090/api/sessions/history`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/history_api_spec.js`, `cd voting-client && node --test test/history_spec.js`

**Objective:** completed public (and published secured) sessions are listed.

**Preconditions:** at least one completed public session and one published secured session.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Open `/history` | Cards for each visible result with title, date, candidate count and champion |
| 2 | Inspect the badges | Public cards say Public; the published secured card says Secured |
| 3 | A session that ended with no champion | The card says `No official champion was declared.` |
| 4 | Press View Result Details | The results page opens for that session |
| 5 | A secured session that was never published | Absent from the archive |

**Expected Final Result:** an honest archive.

**Pass Criteria:** visibility rules hold in the listing.

### MT-055: Turnout report and CSV export

**Commands:** `curl -s -H "Authorization: Bearer <TOKEN>" http://localhost:8090/api/sessions/<ID>/turnout` with the admin token from section 3.14, and the same call without the header (404). Automated regression: `cd voting-client && node --test test/turnout_csv_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/visibility_and_privacy_spec.js`

**Objective:** the admin sees who voted per round (never what they voted) and can export it.

**Preconditions:** a session with at least one closed round, signed in as admin, plus a voter window.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Admin opens the results page | The turnout panel lists rounds with voter names and emails |
| 2 | Check a round where nobody voted | It appears with a zero count |
| 3 | Press the download button | A file `turnout-<sessionId>.csv` downloads with columns roundIndex, roundId, voterCount, voterName, email |
| 4 | Open the CSV in a spreadsheet | No vote choice column exists anywhere |
| 5 | As a voter, GET `/api/sessions/<id>/turnout` (curl, no admin token) | `404` (the admin surface is not advertised) |

**Expected Final Result:** an audit trail without ballot secrecy loss.

**Pass Criteria:** the report shows participation only, and is admin only.

### MT-056: Real time synchronization

**Commands:** two browser windows on `http://localhost:5173/sessions/<ID>/vote`, act in one and watch the other. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/reveal_timer_socket_hardening_spec.js`, `cd voting-client && node --test test/early_completion_frontend_spec.js`

**Objective:** two browsers stay in sync on votes, timers and presence.

**Preconditions:** a started session, two voter windows side by side.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Both windows open the arena of the same round | Same pair, same countdown (within a tick) |
| 2 | Window A votes | Window A locks its cards; the reveal in both windows agrees at round end |
| 3 | Window B joins late in a fresh round | Both windows show the updated connected count |
| 4 | Close window B mid round | The count drops in window A; early completion still works after the grace window |

**Expected Final Result:** one shared authoritative state.

**Pass Criteria:** no reload is ever needed to see server changes.

### MT-057: Socket reconnect restores state

**Commands:** reload a browser window, or stop the backend with Ctrl+C and start it again with `cd voting-server && npm start`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/timer_integration_spec.js`, `cd voting-client && npx vitest run test/admin_roster_resubscribe.test.jsx`

**Objective:** a dropped connection heals itself.

**Preconditions:** a session page open, ability to toggle the network (devtools offline mode).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Set the browser offline for about 10 seconds, then back online | The socket reconnects automatically |
| 2 | Observe the arena | Room subscription restored: current round state reappears without a manual refresh |
| 3 | Cast a vote after reconnect (in a still open round) | The vote is accepted and counted |

**Expected Final Result:** self healing realtime.

**Pass Criteria:** state and voting resume after the reconnect.

### MT-058: Persistence of completed results

**Commands:** finish a session, restart with `cd voting-server && npm start`, then `curl -s http://localhost:8090/api/sessions/<ID>/result`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/persistence_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/history_api_spec.js`

**Objective:** a completed session and its round history survive a backend restart.

**Preconditions:** a completed session (MT-028) in MongoDB.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Note the winner and the number of rounds | Recorded for comparison |
| 2 | Restart the backend (`Ctrl+C`, `npm start`) | Startup logs show the session recovered |
| 3 | Reload the results page | Same winner, same round history |
| 4 | Check the `results` collection (mongo shell or Compass) | One document with the full original entry roster and the embedded rounds |

**Expected Final Result:** durable outcomes.

**Pass Criteria:** nothing was lost across the restart.

### MT-059: Crash recovery of a live session

**Commands:** stop the backend mid round with Ctrl+C and start it again with `cd voting-server && npm start`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/persistence_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/bootstrap_spec.js`

**Objective:** an interrupted open session returns as pending, not as a broken live round.

**Preconditions:** an open session with one closed round.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Kill the backend mid voting, then start it again | Startup recovers the session |
| 2 | Open the lobby | Status is pending (voting timers are gone, nothing pretends to be live) |
| 3 | Open the results page | The already closed round history is still visible |
| 4 | Admin: Start the session again | A fresh round begins normally |

**Expected Final Result:** safe recovery without leaked or wedged state.

**Pass Criteria:** recovered sessions are usable and their history intact.

### MT-060: Memory cleanup at terminal state

**Commands:** after a session completes, emit a console `VOTE` action with the old token and try to rejoin from `http://localhost:5173/join`. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/review_minors_regression_spec.js`

**Objective:** finished sessions release their voter tokens.

**Preconditions:** a session with joined voters, completed.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Complete a session with two anonymous voters | Status becomes completed |
| 2 | As one of those voters, try to vote (console `VOTE` action) | Refused (the token no longer validates for that session) |
| 3 | Rejoin the completed session from the lobby | Joining is refused (archived or completed cannot be joined) |

**Expected Final Result:** no dangling identities.

**Pass Criteria:** terminal sessions accept nobody.

### MT-061: Navigation and legacy redirects

**Commands:** open the legacy addresses `http://localhost:5173/elections`, `http://localhost:5173/vote` and `http://localhost:5173/results`. Automated regression: `cd voting-client && node --test test/stage_c_spec.js`

**Objective:** every route and redirect behaves.

**Preconditions:** app running, signed out and signed in admin passes available.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Visit `/`, `/join`, `/history`, `/login`, `/register` | Each renders its own page |
| 2 | Visit `/dashboard` while signed in as admin | Redirects to `/admin` |
| 3 | Visit `/sessions` | Redirects to `/join` |
| 4 | Visit `/vote` and `/results` | Redirect to the first available session's pages (or to `/sessions` when none) |
| 5 | Visit `/elections` and `/elections/<id>/vote` | Redirect to the session equivalents |
| 6 | Visit `/totally-unknown` | The 404 page with the standard nav bar |

**Expected Final Result:** no dead ends.

**Pass Criteria:** every step lands on a working page.

### MT-062: Refresh behavior on session pages

**Commands:** reload the lobby, arena and results pages under `http://localhost:5173/sessions/<ID>/...` and the admin panel. Automated regression: `cd voting-client && node --test test/auth_spec.js`, `cd voting-client && node --test test/stage_c_spec.js`

**Objective:** reloading lobby, arena or results keeps working.

**Preconditions:** a session with a voter joined in the arena.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Reload the arena mid round | Still joined (stored token), current round state reappears |
| 2 | Reload the results page | Same presentation state as before the reload |
| 3 | Reload the admin panel as admin | Registry still complete (credential restored from storage) |

**Expected Final Result:** refresh safe everywhere.

**Pass Criteria:** no relogin or rejoin needed for the same browser.

### MT-063: History page states

**Commands:** open `http://localhost:5173/history` in each of its states. Automated regression: `cd voting-client && node --test test/history_spec.js`

**Objective:** loading, empty and error states are honest.

**Preconditions:** backend running; ability to stop and start it.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Open `/history` with a slow connection | Loading card with a spinner |
| 2 | On a database with no completed sessions | `No Completed Tournaments Yet` with a link to `/sessions` |
| 3 | Stop the backend, then open `/history` | `Failed to Load History` with a Try Again button |
| 4 | Start the backend, press Try Again | The list loads |

**Expected Final Result:** all three states reachable and recoverable.

**Pass Criteria:** the error state is recoverable without a full reload.

### MT-064: Results page presentation states

**Commands:** open `http://localhost:5173/sessions/<ID>/results` across the presentation states. Automated regression: `cd voting-client && node --test test/results_spec.js`, `cd voting-client && npx vitest run test/round_history_no_winner.test.jsx`

**Objective:** the results page follows the server lifecycle exactly.

**Preconditions:** a running session, an admin window and a voter window.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | While a round is live | `Voting in Progress`: contenders only, no chart, no percentages |
| 2 | At the reveal | Chart and per candidate counts appear from the frozen round snapshot |
| 3 | Between rounds | Round timeline grows by one entry with its resolution label |
| 4 | After conclusion | Champion banner plus full history and totals |
| 5 | As an outsider on a secured session | Neutral not available state |

**Expected Final Result:** one guarded presentation per lifecycle stage.

**Pass Criteria:** tallies appear only at reveal or later.

### MT-065: Ingress allowlist and forged identity refusals

**Commands:** from the browser console emit the `action` payloads listed in the steps, or use the node probe from section 3.14. Automated regression: `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/ingress_allowlist_spec.js`, `cd voting-server && npx mocha --require @babel/register --require ./test/test_helper.js test/accounts_and_otp_spec.js`

**Objective:** the socket boundary rejects everything outside the allowlist.

**Preconditions:** browser console, or the optional node probe in section 3.14.

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | Emit `action` with type `SET_ROUND_LIFECYCLE` | `FORBIDDEN_ACTION` |
| 2 | Emit an unknown type such as `MAKE_ME_ADMIN` | `FORBIDDEN_ACTION` |
| 3 | As an anonymous socket, emit an admin action (e.g. `START_SESSION`) without a token | Refused with `UNAUTHORIZED` |
| 4 | Emit `VOTE` claiming `voterToken: "user:<someone else's id>"` from an anonymous socket | `FORBIDDEN_VOTER_TOKEN` |

**Expected Final Result:** the store is reachable only through the allowlist with real credentials.

**Pass Criteria:** every attempt is refused and changes nothing.

### MT-066: Admin credential expiry handling

**Commands:** change `JWT_SECRET` in `.env` and restart with `cd voting-server && npm start`, then press any admin control at `http://localhost:5173/admin`. Automated regression: `cd voting-client && node --test test/admin_session_expired_spec.js`, `cd voting-client && node --test test/admin_socket_auth_spec.js`

**Objective:** a dead admin credential degrades gracefully.

**Preconditions:** admin signed in; ability to edit `.env` (`JWT_SECRET`).

**Test Steps:**

| Step | Action | Expected Result |
| ---- | ------ | --------------- |
| 1 | With the admin panel open, change `JWT_SECRET` and restart the backend | Server now rejects the old token |
| 2 | Press any admin control (for example the publish toggle or Start) | `action_error` with `UNAUTHORIZED` |
| 3 | Observe the client | Stored admin keys are dropped, the socket reconnects without admin identity, admin surfaces say the session is gone instead of rendering empty data |
| 4 | Sign in again at `/login` | Full admin function restored |

**Expected Final Result:** no confusing half working admin state.

**Pass Criteria:** the client treats the refusal as a dead credential.

## 3.5 Positive Test Cases

Compact happy path checklist per major feature. Each line is a normal successful scenario; the matching detailed case number is in brackets.

1. Admin login with valid credentials lands on `/admin` with the full registry. [MT-004]
2. Create a public tournament session with 7 or more entries; it appears as pending with a join code. [MT-008]
3. Create a single ballot session with 2 to 6 entries; the arena presents one ballot. [MT-009]
4. Resolve a valid join code and land in the right lobby. [MT-013]
5. Share the QR code and join from a second device. [MT-016]
6. Join a public session with only a display name and see the live headcount. [MT-017, MT-019]
7. Start the session and watch joined voters auto move into the arena. [MT-020]
8. Cast one vote in a pairwise round and see it confirmed. [MT-022]
9. Cast one vote on a single ballot and see a plurality victory conclude the session. [MT-029]
10. Watch a round close at timer expiry with the frozen tally revealed to everyone. [MT-025, MT-027]
11. Watch a round close early when the last eligible voter votes. [MT-026]
12. Reach the champion screen and reload it from the persisted result. [MT-028]
13. Tie a tournament round and see the rematch; tie again and see the 30 second admin window. [MT-032, MT-034]
14. Resolve a tie by picking a winner, and by coin flip. [MT-035, MT-036]
15. Register a voter account with an emailed code and stay signed in across reloads. [MT-045]
16. Join a secured allowlist session after signing in with the invited email. [MT-037]
17. Request to join an approval session, get approved, and vote. [MT-039]
18. Remove a participant and watch their access end. [MT-042]
19. Publish a secured result and see it join the public archive with a Secured badge. [MT-051, MT-054]
20. Read the admin turnout report and download the CSV. [MT-055]
21. Browse the history archive and open any result. [MT-054]
22. Survive a backend restart with results and recovery intact. [MT-058, MT-059]

## 3.6 Negative Test Cases

Invalid inputs and refused actions, with the exact behavior to expect. Do not expect behavior the table does not list.

| # | Action | Expected Error or Behavior |
| - | ------ | -------------------------- |
| N1 | Admin login with a wrong password | HTTP 401, `INVALID_CREDENTIALS`, user stays on the login page |
| N2 | Admin login repeated past 5 failures from one address | HTTP 429 with `retryAfterMs`; backoff grows from 1 s up to 60 s; only correct credentials clear the shared bucket |
| N3 | Anonymous visit to `/admin` | Redirect to `/login` (never an admin page) |
| N4 | Create session with a blank title | Client error, nothing sent; the server would answer `INVALID_TITLE` |
| N5 | Create session with fewer than 2 distinct entries | Client error; server answers `INSUFFICIENT_ENTRIES` |
| N6 | Create session with a duplicate session id | Client error naming the collision; server answers `DUPLICATE_SESSION_ID` |
| N7 | Create a secured session with who can join left public | Server answers `VALIDATION_ERROR` (secured must be allowlist or approval) |
| N8 | Join code lookup for an unknown code | HTTP 404, `Code not found or no longer active.` |
| N9 | Join code lookup for a completed or expired pending session | The same 404 body (no existence leak) |
| N10 | More than 30 join code lookups in a minute from one address | HTTP 429, `Too many requests, please wait.` |
| N11 | Join with a blank display name | Client error: a display name is required |
| N12 | Join an archived session | Refused; the lobby shows the archive notice |
| N13 | Join a secured session anonymously | The neutral not available lobby state; the API answers 401 `AUTHENTICATION_REQUIRED` |
| N14 | Join a secured allowlist session with a non listed email | Neutral lobby state; API 403 `NOT_ON_ALLOWLIST` |
| N15 | Join an approval session as a new voter | HTTP 202 `pending_approval` (not an error, but not access either) |
| N16 | Join or request after Start | HTTP 409 `SESSION_STARTED` |
| N17 | Vote twice in the same round | Second attempt refused, `DUPLICATE_VOTE` (persisted across restarts for signed in voters) |
| N18 | Vote after the round closed | `ROUND_CLOSED`, "Voting is closed for this round." |
| N19 | Vote for a candidate outside the active pair | `INVALID_ENTRY` |
| N20 | Vote with no voter token | `VOTER_TOKEN_REQUIRED` |
| N21 | Vote in a session that is not open | `SESSION_NOT_OPEN` |
| N22 | Vote in a tie pending round | Refused (lifecycle `TIE_PENDING`) |
| N23 | Vote after being removed from a secured session | `NOT_ELIGIBLE` at the next vote |
| N24 | Emit an internal or unknown action type over the socket | `FORBIDDEN_ACTION` |
| N25 | Claim another user's `user:` token | `FORBIDDEN_VOTER_TOKEN` |
| N26 | Subscribe to a secured session without eligibility | `NOT_ELIGIBLE`, no state delivered |
| N27 | OTP request for a malformed email | HTTP 400 `INVALID_EMAIL` |
| N28 | OTP request beyond 5 per hour per email or 20 per hour per address | HTTP 429 `RATE_LIMITED` with `Retry-After` |
| N29 | OTP resend inside 60 seconds | HTTP 429 `COOLDOWN_ACTIVE` with the wait |
| N30 | OTP verify with a wrong code | HTTP 401 with remaining attempts; after 5 the challenge locks (HTTP 423 `CHALLENGE_LOCKED`) |
| N31 | Register with a username already used by another email | `USERNAME_TAKEN` |
| N32 | Profile update with an invalid username or overlong name | HTTP 400 `INVALID_USERNAME` or `INVALID_DISPLAY_NAME` |
| N33 | Outsider reads a secured result before publish | HTTP 404 `RESULT_NOT_FOUND` (identical to a missing id) on every path (result, rounds, lobby) |
| N34 | Publish results for a session that is still open | `SESSION_NOT_COMPLETED` |
| N35 | Non admin reads the turnout endpoint | HTTP 404 (the surface is not advertised) |
| N36 | Voter socket lists sessions | Secured sessions are absent from the registry |
| N37 | Start a secured session with no eligible voters | `NO_ELIGIBLE_PARTICIPANTS` |
| N38 | Resolve a tie with a blank winner while choosing `pick` | `WINNER_REQUIRED` |
| N39 | Resolve a tie outside a pending window | Resolution fails (`RESOLUTION_FAILED` or similar refusal) |
| N40 | Vote in a recovered session that was never restarted by the admin | Refused (status is pending, not open) |

## 3.7 Boundary Test Cases

The exact limits the implementation enforces.

| # | Boundary | Values to test | Expected |
| - | -------- | -------------- | -------- |
| B1 | Session timer duration | `4`, `5`, `300`, `301`, `25.5`, `0`, empty | 4, 301, decimals, 0 and empty refused; 5 and 300 accepted (client messages name the bound; the server answers `INVALID_TIMER_DURATION` for out of range) |
| B2 | Entry count | 1 entry, 2 entries, 6 entries, 7 entries | 1 refused; 2 accepted; 6 is single ballot; 7 is tournament |
| B3 | Entry content | duplicate names, blank lines, commas and newlines mixed | Duplicates collapse, blanks dropped, both separators parsed |
| B4 | Session id | blank (auto `sess_<timestamp>`), `My Session!!`, overlong custom ids | Blank auto generates; disallowed characters become dashes; lower cased |
| B5 | Candidate info (create API) | name or description over 80 characters | `VALIDATION_ERROR` |
| B6 | Join code length | 5 characters, 6 characters, 7 characters, lowercase input | Only a normalized 6 character code resolves; the input field caps at 6 |
| B7 | Join code alphabet | try `0`, `O`, `1`, `I`, `L` | Not part of the generated alphabet; codes you receive never contain them |
| B8 | Lookup rate limits | 30th and 31st join code lookup in a minute; 5th and 6th OTP request per email per hour | First of each pair allowed, second refused with 429 |
| B9 | OTP code | 5 digits, 6 digits, 7 digits, non digits | Only a 6 digit string is accepted (`INVALID_CODE_FORMAT`) |
| B10 | OTP attempts and cooldown | 5th and 6th wrong code; resend at 59 s and 61 s | Lock after the 5th; cooldown active until 60 s elapse |
| B11 | Display name length | 1 character, 80 characters, 81 characters (profile name) | 1 and 80 accepted, 81 refused (`INVALID_DISPLAY_NAME`) |
| B12 | Username | 2 chars, 3 chars, 20 chars, 21 chars, with a dash or space | 3 to 20 alphanumeric or underscore only |
| B13 | Grace window | voter disconnects for under and over 10 s before the last vote | Under: still counted for early completion; over: dropped from eligibility |
| B14 | Tie window | admin acts at 29 s, and at 31 s | 29 s applies the pick; at 31 s the server already coin flipped |
| B15 | Reveal window | `ROUND_REVEAL_DURATION` of 0, 1, 60, 61 | 0 and 61 fall back (1 s default, or the env value if in range 1 to 60) |
| B16 | Pending session expiry | pending session left for 7 days | The MongoDB TTL index deletes the row; its code stops resolving |
| B17 | JSON body size | POST a body over 1 MB | Connection destroyed, no processing |
| B18 | Zero vote rounds | first and second consecutive empty rounds | Replay once, then `no_result` completion with no champion |

## 3.8 Role and Permission Testing

Verify both the UI restrictions and the direct URL or API access for each role.

| Feature | Admin | Signed in voter | Anonymous voter | Public visitor | Expected behavior when the role is missing |
| ------- | ----- | --------------- | --------------- | -------------- | ----------------------------------------- |
| `/admin` panel | Yes | No | No | No | Redirect to `/login`; API admin actions answer 401 |
| Create, start, next, archive session | Yes | No | No | No | `UNAUTHORIZED` on the socket action |
| Refresh join code, resolve ties | Yes | No | No | No | `UNAUTHORIZED` |
| Set allowlist, approve, reject, remove participant | Yes | No | No | No | `UNAUTHORIZED` |
| Switch who can join | Yes | No | No | No | `UNAUTHORIZED` |
| Publish results | Yes (secured, after completion) | No | No | No | `UNAUTHORIZED` or `SESSION_NOT_COMPLETED` |
| Turnout report and CSV | Yes | No | No | No | HTTP 404 on the endpoint; no UI surface |
| Join a public session | Yes (as a voter too) | Yes | Yes | Yes | Works for everyone |
| Join a secured session | Only if also an allowlisted or approved voter account | If eligible | No | No | 401 `AUTHENTICATION_REQUIRED`, neutral lobby state |
| Vote in an open round | If eligible | If eligible | In public sessions | No | `VOTER_TOKEN_REQUIRED` or `NOT_ELIGIBLE` |
| Read a public result and rounds | Yes | Yes | Yes | Yes | Works for everyone |
| Read a secured result before publish | Yes | Approved participants | No | No | HTTP 404 everywhere |
| See secured sessions in the registry | Yes | No | No | No | Filtered out of the `sessions` event and `/api/sessions` |
| Browse `/history` | Yes | Yes | Yes | Yes | Works for everyone (listing already filtered) |

## 3.9 CRUD Testing

Only operations the application actually supports are listed.

### Create

| Test | Steps | Expected |
| ---- | ----- | -------- |
| Valid creation | Admin: Create Session with title, timer and 2+ distinct entries | Session appears as pending with a join code and persists after restart |
| Invalid creation | Blank title; single entry; duplicate id; bad timer | Refused with the named error; nothing is created |
| Required fields | Title and entries are the only hard requirements | Everything else has a default (timer 30, public type, generated id) |
| Duplicate data | Duplicate entry names in the list; duplicate session id | Entries deduplicate; the id collision is refused |

### Read

| Test | Steps | Expected |
| ---- | ----- | -------- |
| Correct display | Admin list, lobby, arena, results, history | Each shows the server state for that session only |
| Empty state | Fresh database: open `/history` | `No Completed Tournaments Yet` |
| Filtering | The registry is filtered per caller (secured hidden from voters) | Voter and admin views differ as documented in 3.8 |

### Update

| Test | Steps | Expected |
| ---- | ----- | -------- |
| Valid update | Refresh join code; add or remove allowlist emails; switch who can join while pending; publish results after completion | Each change persists and broadcasts |
| Invalid update | Change who can join after Start; edit entries mid tournament through the API; publish before completion | Refused (`INVALID_STATUS` / lifecycle guards / `SESSION_NOT_COMPLETED`) |
| Cancel behavior | Cancel create dialog (close button or Escape); decline the archive and mode switch confirm prompts | Nothing changes |

### Delete

| Test | Steps | Expected |
| ---- | ----- | -------- |
| Delete equivalent | Archive a session (two step confirm) | Status archived, archivedAt set, memory released; the row remains readable in history |
| Delete confirmation | First press opens a confirm, the browser prompt asks again | Both confirmations required; one cancels everything |
| Cancel deletion | Decline either prompt | Session unchanged |
| Deleted item unavailable | Try to join or vote in the archived session | Refused everywhere |

## 3.10 Real Time Testing

Run with at least two browser windows (normal plus private, or two browsers) on the same session.

1. Open User A in the lobby of a pending public session; open User B in a second window.
2. Join from both; verify both windows show the same headcount.
3. Start the session as admin; verify both windows auto move to the arena with the same pair.
4. Vote from User A only; verify User B still shows open cards and the round does not close (not everyone voted).
5. Vote from User B; verify both windows close and reveal simultaneously (early completion).
6. Let the reveal countdown run; verify both windows advance to the next pair together.
7. Toggle the network offline for about 10 seconds in one window, then restore it; verify the socket reconnects, the room state reappears, and a vote in a still open round is accepted.
8. Close one window mid round; verify the connected count drops in the other window and that early completion still works once the grace window passes.
9. As admin, remove a joined voter from the lobby; verify their window shows the removal message at once.
10. During a tie pending window, verify no window accepts votes and the admin banner appears only in the admin panel.

Timing notes: client countdowns are visual estimates driven by the server `expiresAt`; a reveal can appear a tick late on a slow machine, which is expected. The server is the only authority on closure.

## 3.11 Navigation Testing

| Test | Steps | Expected |
| ---- | ----- | -------- |
| Major routes | Visit `/`, `/join`, `/history`, `/login`, `/register`, and (as admin) `/admin` | Every page renders with the standard nav bar |
| Session routes | `/sessions/:id/lobby`, `/sessions/:id/vote`, `/sessions/:id/results` for a live session | Each shows its own surface for that session only |
| Nav links | Use Home, Join, History, Admin, Sign in, Log out | Each transitions correctly and updates the bar |
| Back and forward | From lobby to arena, press Back, then Forward | Lobby restores; returning to the arena keeps the joined state |
| Refresh | Reload each session page mid session | State reappears without relogin (see MT-062) |
| Protected route | Visit `/admin` signed out | Redirect to `/login`, then back to `/admin` after signing in |
| Invalid route | Visit `/nope` | 404 page with working nav |
| Legacy redirects | `/dashboard`, `/sessions`, `/vote`, `/results`, `/elections*` | All forward to the session equivalents (see MT-061) |

## 3.12 Validation Testing

Per form, the checks that must hold.

| Form | Field | Valid | Invalid, with expected message |
| ---- | ----- | ----- | ------------------------------ |
| Join code | Code | 6 characters | Under 6 keeps the submit disabled; garbage resolves to the not found error |
| Lobby join | Display name | any non blank text | Blank: "Please enter a display name to join." |
| Register | Email | valid address | Malformed: `INVALID_EMAIL` from the server |
| Register | Username | 3 to 20 alphanumeric or underscore | Bad shape: "Username must be 3 to 20 alphanumeric characters or underscores."; taken: `USERNAME_TAKEN` |
| Register / Login | Code | exactly 6 digits | Wrong: remaining attempts; locked after 5 |
| Login (admin) | Username and password | both non blank | Blank: client message; wrong: `INVALID_CREDENTIALS`; throttled: wait message |
| Create session | Title | non blank | Blank: "Session title is required." |
| Create session | Timer | integer 5 to 300 | Named errors for each bound and for decimals |
| Create session | Entries | 2 or more distinct names | Fewer: "At least 2 distinct entries are required..." |
| Allowlist paste | Emails | valid addresses, separated by commas, semicolons or newlines | Invalid lines are reported as invalid entries; an all invalid paste is refused (`ALL_INVALID`) |
| Tie pick | Winner | one of the tied candidates | Choosing `pick` without a winner: `WINNER_REQUIRED` |

Submit behavior: every form disables its button while the request is in flight and shows server errors inline. Cancel behavior: create dialog closes with its button or Escape and resets on next open; confirm prompts abort cleanly when declined.

## 3.13 UI and UX Verification

Checks to perform by eye on each surface.

| Surface | Check |
| ------- | ----- |
| Home | Sections render, nav and footer links work |
| Join | Submit disabled until 6 characters; spinner while resolving; error box for bad codes |
| Lobby | Live headcount updates; join form validates; pending approval, rejected and removed states each show their own message; the not available state is neutral |
| Arena | Candidate cards lock after voting; countdown turns urgent near zero; server rejections render an inline error; winner screen offers View Results and All Sessions |
| Results | Loading, voting in progress, reveal and concluded states are distinct; chart appears only at reveal; admin panel appears only for admins; publish errors show inline |
| History | Loading spinner, empty state, error state with Try Again, and the card grid each render correctly |
| Admin | Metric cards populate; session rows show badges, join code and timer; create, manage, share and archive dialogs open and close (button and Escape); error and success banners are dismissible |
| Accessibility spot check | Tab through lobby and arena: all controls reachable and labelled; countdown announces itself politely (the project's automated axe scans cover these two screens) |
| Responsive spot check | At a narrow window width the nav collapses to a menu button on the home page and the session pages remain usable |

## 3.14 API and Backend Manual Testing

All examples use `http://localhost:8090`. Replace `<ID>`, `<CODE>` and `<TOKEN>` as indicated. Obtain the admin token once:

```bash
curl -s -X POST http://localhost:8090/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"adminPassword123!"}'
# response: {"success":true,"token":"<TOKEN>","user":{...}}
```

### POST /api/admin/login

**Purpose:** authenticate the host. **Authentication:** none. **Request:** `{"username":"admin","password":"..."}`. **Expected:** `200` with `token`; `401` on bad credentials; `429` with `retryAfterMs` once throttled.

### GET /api/auth/me

**Purpose:** validate an admin token. **Authentication:** `Authorization: Bearer <TOKEN>`. **Expected:** `200` with the admin profile; `401` for a missing or stale token.

### POST /api/auth/otp/request

**Purpose:** send a voter code. **Authentication:** none. **Request:** `{"email":"voter1@example.com"}` (optional `name`, `username` for registration intent). **Expected:** the same generic `200` body whether or not the email exists; the code appears in the backend console when `SMTP_HOST` is empty. **Errors:** `400 INVALID_EMAIL`, `429 COOLDOWN_ACTIVE` or `RATE_LIMITED` with `Retry-After`. Every reply takes at least `API_MIN_RESPONSE_MS` (default 100 ms).

### POST /api/auth/otp/verify

**Purpose:** exchange a code for the `vs_voter` cookie. **Authentication:** none. **Request:** `{"email":"...","code":"123456"}` (use `-c cookies.txt` to store the cookie). **Expected:** `200` with the user profile and `isNewUser`; sets an HttpOnly cookie. **Errors:** `400 INVALID_CODE_FORMAT`, `401 INVALID_CODE` with `remainingAttempts`, `423 CHALLENGE_LOCKED`.

### GET /api/auth/voter/me, POST /api/auth/profile, POST /api/auth/logout

**Purpose:** profile read, profile update (`{"name":"...","username":"..."}`), logout. **Authentication:** the `vs_voter` cookie (`-b cookies.txt`). **Expected:** `200` on success; `401` without a valid cookie; `409 USERNAME_TAKEN` and `400 INVALID_USERNAME` / `INVALID_DISPLAY_NAME` on bad updates.

### POST /api/sessions/<ID>/join

**Purpose:** enroll a voter. **Authentication:** none for public; `vs_voter` cookie for secured. **Request:** `{"displayName":"Ada"}`. **Expected:** `200` with `voterToken` and `voterCount` (an anonymous join also sets a per session HttpOnly cookie). **Errors:** `404 SESSION_NOT_FOUND`, `401 AUTHENTICATION_REQUIRED`, `403 NOT_ON_ALLOWLIST`, `409 SESSION_STARTED`, `202 pending_approval` for approval mode.

### GET /api/join/<CODE>

**Purpose:** resolve a join code. **Authentication:** none. **Expected:** `200` with `{sessionId, name, status, sessionType, votingMode}`. **Errors:** `404` for unknown, expired or inactive codes (identical body), `429` after 30 lookups per minute, `503` when the database is unreachable.

### GET /api/sessions

**Purpose:** list session summaries. **Authentication:** optional admin token (changes what is visible). **Expected:** `200` with `sessions` and `count`; secured sessions appear only with a valid admin token.

### GET /api/sessions/<ID>/lobby

**Purpose:** lobby metadata. **Authentication:** optional (`vs_voter` cookie or admin token for secured sessions). **Expected:** `200` with title, status, type, whoCanJoin, entryCount, voterCount, winner. **Errors:** `404 SESSION_NOT_FOUND` with the body `Session was not found.` for unknown, expired and gated secured ids alike.

### GET /api/sessions/history, GET /api/sessions/<ID>/result, GET /api/sessions/<ID>/rounds

**Purpose:** archive list (`?limit=50`), one result, one round list. **Authentication:** optional (cookie or admin token unlock secured reads). **Expected:** `200`; the archive lists public rows and published secured rows with their `type`. **Errors:** `404 RESULT_NOT_FOUND` for missing and for gated secured reads (identical), `500 DATABASE_ERROR` when the database is down.

### GET /api/sessions/<ID>/turnout

**Purpose:** per round participation for the host. **Authentication:** admin token required. **Expected:** `200` with rounds of `{roundIndex, roundId, voters:[{name,email}]}`. **Errors:** `404` for everyone else (the endpoint is not advertised), `404 SESSION_NOT_FOUND` for a real admin on an unknown id.

### Socket probing (optional)

The socket boundary can be probed from the backend package, where `socket.io-client` is installed. Save as `socket_probe.cjs` and run `node socket_probe.cjs <TOKEN> <ID>`:

```js
const { io } = require('socket.io-client');
const socket = io('http://localhost:8090', { auth: { token: process.argv[2] } });
socket.on('sessions', (s) => console.log('registry:', s.length));
socket.on('session_state', (s) => console.log('state:', s.status, s.roundLifecycle));
socket.on('action_error', (e) => console.log('error:', e));
socket.emit('subscribe_session', { sessionId: process.argv[3] });
```

Use it to verify registry filtering (MT-044) and ingress refusals (MT-065). Do not use it to mutate sessions that matter.

## 3.15 Complete Feature Coverage Matrix

Status starts as Not Tested. Tick each row as cases pass and record defects against the MT ids.

| ID | Feature | Positive | Negative | Boundary | Role Test | Cases | Status |
| -- | ------- | -------- | -------- | -------- | --------- | ----- | ------ |
| F1 | Backend and frontend startup | Yes | Yes | N/A | N/A | MT-001 to MT-003 | Not Tested |
| F2 | Admin login, throttle, guard, logout | Yes | Yes | B8 | Yes | MT-004 to MT-007 | Not Tested |
| F3 | Session creation (both modes) | Yes | Yes | B1, B2, B3, B4, B5 | Yes | MT-008 to MT-012 | Not Tested |
| F4 | Join codes, refresh, QR share | Yes | Yes | B6, B7, B8 | N/A | MT-013 to MT-016 | Not Tested |
| F5 | Public join and lobby | Yes | Yes | B11 | Yes | MT-017 to MT-021 | Not Tested |
| F6 | Pairwise voting and round lifecycle | Yes | Yes | B13, B18 | Yes | MT-022 to MT-028, MT-031 | Not Tested |
| F7 | Single ballot mode | Yes | Yes | B2 | Yes | MT-009, MT-029, MT-030 | Not Tested |
| F8 | Tie ladder and admin resolution | Yes | Yes | B14 | Yes | MT-032 to MT-036 | Not Tested |
| F9 | Secured sessions (allowlist and approval) | Yes | Yes | B16 | Yes | MT-037 to MT-044 | Not Tested |
| F10 | Participant removal and revocation | Yes | Yes | N/A | Yes | MT-042, MT-043 | Not Tested |
| F11 | Voter accounts and OTP | Yes | Yes | B9, B10, B11, B12 | Yes | MT-045 to MT-049 | Not Tested |
| F12 | Result visibility and publish | Yes | Yes | N/A | Yes | MT-050 to MT-053 | Not Tested |
| F13 | History archive | Yes | Yes | N/A | Yes | MT-054 | Not Tested |
| F14 | Turnout report and CSV | Yes | Yes | N/A | Yes | MT-055 | Not Tested |
| F15 | Real time sync, presence, reconnect | Yes | Yes | B13 | N/A | MT-056, MT-057 | Not Tested |
| F16 | Persistence and crash recovery | Yes | Yes | B16 | N/A | MT-058 to MT-060 | Not Tested |
| F17 | Navigation and redirects | Yes | Yes | N/A | Yes | MT-061, MT-062 | Not Tested |
| F18 | Page states (history, results, lobby) | Yes | Yes | N/A | N/A | MT-063, MT-064 | Not Tested |
| F19 | Security boundary (ingress, forged identity) | N/A | Yes | B17 | Yes | MT-065, MT-066 | Not Tested |

## 3.16 Manual Testing Execution Instructions

Follow this order for a full pass.

```text
1. Prepare the environment: Node 18+, MongoDB running, .env in place (section 3.1)
2. Start the services: backend in one terminal, frontend in another
3. Prepare test data: admin credentials, two browser windows, two emails (section 3.3)
4. Smoke the app: MT-001 to MT-003
5. Execute cases in id order, section by section
6. Record Pass or Fail for every MT id
7. Record defects with the MT id, the exact steps, and the observed result
8. Re-run failed cases after fixes, then re-run neighboring cases in the same section
9. Complete the coverage matrix in 3.15
```

### What to record for every case

| Field | Example |
| ----- | ------- |
| Test ID | MT-025 |
| Date | 2026 10 06 |
| Tester | initials |
| Environment | Windows 11, Chrome 139, localhost, MongoDB 8.0 |
| Result | Pass or Fail |
| Actual result | "Reveal appeared 1.2 s after 00:00 on a busy machine" |
| Expected result | quote the case's Expected Final Result |
| Defect | issue id or a short description, or None |
| Evidence | screenshot file name, console log excerpt, or curl output |

### Defect reporting rules

* One defect per issue; include the MT id and the environment line.
* Attach the server console excerpt when the failure involves an error code or a refusal.
* For timing or sync issues, note the wall clock gap and both window titles.
* Security failures (anything in section 3.6 rows N17 to N39 or the MT-065 family) are release blockers: stop the pass and report immediately.

### Suggested session plan

A full pass needs roughly: 30 minutes of setup and smoke, 2 to 3 hours for sections A to G (startup, admin, creation, join, lobby, arena, ties), 2 hours for section H (secured sessions, which needs the two email addresses), 2 hours for sections I to K (visibility, OTP, realtime), and 1 hour for persistence, navigation and the API sweep. Restarting the backend clears the in memory rate limits and throttles, which keeps negative cases repeatable.
