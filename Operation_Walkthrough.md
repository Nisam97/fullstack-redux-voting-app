# VoteSphere — Operation Walkthrough (Presentation & Viva Manual)

> This document was generated from a direct inspection of the repository on **2026-10-07** (branch `develop1`).
> Every command, port, route, endpoint, and feature below was verified against the actual source files.
> Anything that could not be confirmed from the code is explicitly marked **Needs verification**.

---

# 1. Project Overview

- **Project name:** VoteSphere — Full-Stack Real-Time Pairwise Voting Application
- **Short description:** An enterprise-grade, real-time voting platform that avoids voter fatigue and tactical voting by breaking a candidate pool into head-to-head **pairwise tournament matchups** (or a clean **single ballot** for small pools of 2–6 candidates), all synchronized live across connected voters and backed by durable MongoDB persistence.
- **Purpose:** Solve the problems of traditional multi-candidate ballots — cognitive fatigue, tactical voting, and split-vote anomalies — through head-to-head elimination rounds until an undisputed champion emerges. All voting math runs on an **authoritative backend**; clients are purely reactive views.

## Technology Stack (verified from `package.json` files)

| Layer | Technology | Where verified |
|---|---|---|
| **Language / Runtime** | JavaScript (ES modules), Node.js 18+ (this machine runs v24.14.0) | `voting-server/package.json`, README |
| **Frontend** | React 19, Redux Toolkit 2, React Router 7, Recharts 3 (charts), Lucide React + React Icons, `qrcode` (lobby QR codes) | `voting-client/package.json` |
| **Frontend tooling** | Vite 8, ESLint 10, Vitest 5 + node:test | `voting-client/package.json` |
| **Backend** | Node `http` server, Socket.io 4 (WebSockets + polling fallback), Redux 5 **over Immutable.js 3** | `voting-server/package.json`, `voting-server/src/server.js` |
| **Database** | MongoDB 6.0+ via Mongoose 9 (`mongoose`) | `voting-server/src/db/` |
| **Security** | `jsonwebtoken` (admin JWT + voter JWT cookie), `bcrypt` (admin password hashing) | `voting-server/src/auth/` |
| **Email / OTP** | Nodemailer 10 (SMTP; logs OTP to console when `SMTP_HOST` is empty) | `voting-server/src/email/` |
| **Other** | `csv-parse` (allowlist upload), `socket.io-client` | `package.json` files |

## Architecture Overview

VoteSphere follows a **Server-Authoritative Flux** model:

1. **Frontend (React 19 + Redux Toolkit):** renders state and emits *intent* only. It never computes tallies, quorum, or round advancement.
2. **Backend (Node + Redux over Immutable.js):** the single source of truth. All lifecycle mutations (`CREATE_SESSION`, `START_SESSION`, `NEXT`, `ARCHIVE_SESSION`, …) arrive **only** over Socket.io behind an admin JWT — there are no REST mutation endpoints. Timers run here (`TimerManager`), the tournament engine is the protected pure module `voting-server/src/core.js` (pinned SHA-256, ~40 lines).
3. **Database (MongoDB via Mongoose):** a store subscriber asynchronously persists sessions, results, users, OTP challenges, allowlists, join requests, and per-round vote participation.

**Communication flow:**

```
Browser (React)  ──REST fetch──▶  Node HTTP API (port 8090)   ──Mongoose──▶  MongoDB (votesphere_dev)
      │                                ▲
      └────Socket.io (ws + fallback)──▶┘  ← all state changes & lifecycle actions
                                           flow through Socket.io; server broadcasts
                                           session_state / timer_state back to rooms
```

**Important services:**
- MongoDB (local, port 27017)
- SMTP email provider for OTP mail — **optional**: with `SMTP_HOST` empty, OTP codes print to the server console (perfect for the viva).

---

# 2. System Requirements

| Requirement | Value | Source |
|---|---|---|
| Operating system | Windows 10/11 (commands in this doc are CMD/PowerShell). The stack is cross-platform. | verified commands |
| Node.js | **v18.0.0 or higher** (README: tested on 18/20/22/24; this machine has **v24.14.0**) | README, local `node --version` |
| npm | **v9+** (this machine has **11.9.0**) | README, local `npm --version` |
| Database | MongoDB **6.0+**, local on port 27017 (or any MongoDB URI) | README, `.env.example` |
| Database name | `votesphere_dev` (default `MONGODB_URI`) | `.env.example` |
| Browser | Any current Chromium/Firefox/Safari (React 19 target); two browser windows are useful for the multi-voter demo | — |
| Tools | Git (to clone), two terminal windows, optional MongoDB Compass for inspection | — |
| No `.nvmrc` or Docker files exist in the repo | — | verified — no `Dockerfile` / `.nvmrc` found |

Check your versions before the presentation:

```cmd
node --version
npm --version
```

---

# 3. Project Structure

```text
votesphere/  (repo root)
├── .env / .env.example        ← single env file shared by BOTH packages (server reads it directly,
│                                 Vite reads it via envDir: '..' in vite.config.js)
├── AGENTS.md                  ← architecture rules (server authoritative, protected core.js, …)
├── Architecture.md            ← in-depth architecture documentation
├── User Manual.md             ← end-user guide
├── Manual Test.md             ← manual QA script
├── Operation_Walkthrough.md   ← THIS document
├── entries.json (via voting-server/entries.json)
├── docs/
│   ├── API_CONTRACT.md        ← full REST + Socket.io protocol documentation
│   └── specs/                 ← numbered feature specifications (0001–0009)
├── scripts/
│   ├── inspect-db.cjs         ← prints collections & counts (presentation data check)
│   ├── archive-demo-data.cjs  ← archive/restore demo data (dry-run by default; --commit / --restore)
│   ├── smoke-socket.cjs       ← Socket.io smoke test client
│   └── smoke-voter.cjs        ← voter REST smoke test
├── voting-client/             ← React 19 frontend (Vite)
│   ├── package.json           ← scripts: dev, build, lint, test, preview
│   ├── vite.config.js         ← envDir: '..' (reads repo-root .env for VITE_SERVER_URL)
│   └── src/
│       ├── pages/             ← Home, Join, Login, Register, Lobby, Voting, Results,
│       │                          History, Admin, NotFound
│       ├── routes/AppRoutes.jsx  ← all URL routes; AdminGuard protects /admin
│       ├── redux/             ← RTK store, voteSlice, voterAuthSlice
│       ├── services/          ← socket.js (Socket.io singleton), auth.js (REST auth), history.js
│       └── components/        ← Navbar, Timer, charts, layout
└── voting-server/             ← Authoritative backend
    ├── package.json           ← scripts: start, test, test:watch
    ├── index.js               ← entrypoint: connect Mongo → recover sessions → seed → listen on PORT
    ├── entries.json           ← 11 Danny Boyle film candidates used to seed sess_default
    └── src/
        ├── core.js            ← PROTECTED pure tournament engine (pinned SHA-256 — do not edit)
        ├── server.js          ← HTTP routes + Socket.io protocol + ingress guards
        ├── reducer.js/store.js← Redux root reducer over Immutable Map keyed sessions.<sessionId>
        ├── timer.js           ← TimerManager: authoritative round clock
        ├── roundManager.js    ← round lifecycle (VOTING → ROUND_CLOSED → RESULTS_REVEALED → NEXT)
        ├── ballot.js          ← single-ballot plurality + instant runoff for ties
        ├── bootstrap.js       ← seeds sess_default & sess_horror; honors SEED_AUTO_START
        ├── constants.js       ← SINGLE_BALLOT_MAX=6, GRACE_PERIOD_MS=10000
        ├── auth/              ← admin JWT, voter tokens, vs_voter HttpOnly cookie, OTP
        ├── db/                ← connection, 7 Mongoose models, repository, persistence
        └── email/             ← Nodemailer transporter (console fallback)
```

**Files you will interact with during the presentation:** only `.env` (once), and terminal commands. You should *explain* `core.js`, `server.js`, `timer.js`, and the client `services/socket.js` if the examiner asks, but never need to open them.

---

# 4. Environment Configuration

**One file for everything:** `.env` at the repo root. The server loads it first thing (`src/env-loader.cjs`), and Vite is configured with `envDir: '..'` so the client also reads it. There is **no** `.env` inside either package.

Copy the template (see §5 for both shells):

- CMD: `copy .env.example .env`
- PowerShell: `Copy-Item .env.example .env`

Key variables (values below are the documented defaults from `.env.example`; replace secrets with your own before committing anywhere):

```env
# Server
PORT=8090                                        # HTTP + WebSocket port (verified in index.js)
MONGODB_URI=mongodb://localhost:27017/votesphere_dev
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
CLIENT_ORIGIN=http://localhost:5173
COOKIE_SECURE=false                              # true only behind HTTPS

# Admin auth (seeded on boot, bcrypt-hashed)
JWT_SECRET=<your-admin-jwt-secret>
JWT_EXPIRES_IN=24h
ADMIN_USERNAME=<your-admin-username>             # you log into /admin with this
ADMIN_EMAIL=<your-admin-email>
ADMIN_PASSWORD=<your-admin-password>             # check your local .env — do not share it

# Voter auth (passwordless OTP)
VOTER_JWT_SECRET=<your-voter-jwt-secret>         # signs the HttpOnly vs_voter cookie
VOTER_SESSION_DAYS=7
SMTP_HOST=                                       # EMPTY = OTP printed to server console (use this in the viva)
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=noreply@votesphere.local
OTP_TTL_MINUTES=10

# Demo behaviour
SEED_AUTO_START=false                            # presentation mode: seeds boot as PENDING waiting rooms
                                                 # that you start manually from the admin panel.
                                                 # Unset/true = seeds start themselves immediately.

# Timers (authoritative, server-side)
VOTE_TIMER_DURATION=30                           # seconds per round (allowed 5–300)
ROUND_REVEAL_DURATION=10                         # results reveal window

# Hardening
API_MIN_RESPONSE_MS=100
OTP_RATE_LIMIT_MAX_PER_EMAIL=5
OTP_RATE_LIMIT_MAX_PER_IP=20
TRUST_PROXY=false

# Frontend (read by Vite from the SAME root .env)
VITE_SERVER_URL=http://localhost:8090            # backend URL for the browser
```

Where each value comes from:
- `JWT_SECRET`, `VOTER_JWT_SECRET`, `ADMIN_PASSWORD`: you choose them (random strings). `VOTER_JWT_SECRET` is **required in production** (startup throws in production if missing; only warns in dev).
- `MONGODB_URI`: your local MongoDB default, or an Atlas/remote URI.
- `VITE_SERVER_URL`: must match `http://localhost:8090` locally; the client falls back to this even if unset (`services/socket.js`).

---

# 5. Installation Instructions

From a clean machine:

```cmd
:: 1. Get the code
git clone <your-repo-url> votesphere
cd votesphere

:: 2. Environment file
copy .env.example .env
notepad .env
```

```powershell
# PowerShell equivalents
git clone <your-repo-url> votesphere
cd votesphere
Copy-Item .env.example .env
notepad .env
```

Install dependencies — **two separate npm packages**, run inside each:

```cmd
cd voting-server
npm install

cd ..
cd voting-client
npm install
```

```powershell
cd voting-server; npm install
cd ..; cd voting-client; npm install
```

> `npm install` of `voting-server` also builds `bcrypt` (native module). On Windows this needs the VS Build Tools prebuilt binaries that npm downloads automatically; if it fails see §16.

Optional (recommended once, before presentation day — proves the project is healthy):

```cmd
cd voting-client
npm run build
npm run lint
npm test

cd ..\voting-server
npm test
```

(`npm test` on the server runs Mocha via `test/runner.cjs`; on the client it runs node:test unit specs then Vitest component specs.)

---

# 6. Database Setup

- **Type:** MongoDB (document store), **local** by default at `mongodb://localhost:27017/votesphere_dev`.
- **ODM:** Mongoose 9; connection is made in `voting-server/index.js` → `connectMongo(MONGODB_URI)`. **Startup fails if MongoDB is unreachable** (fatal error, exit 1) — this is your "database connected" signal.

**Start MongoDB (Windows):**

```cmd
:: If installed as a service it is usually already running:
net start MongoDB
```

```powershell
Start-Service MongoDB
```

*(If your MongoDB was installed another way — e.g. MongoDB Compass's local shell or `mongod.exe` — start it the way you installed it. There is no Docker compose file in this repo.)*

**Collections created automatically by Mongoose models** (no manual migration, no seed script to run — the server bootstraps everything):

| Collection | Model | Contents |
|---|---|---|
| `sessions` | `Session` | every session (pending/open/completed/archived), join code, candidates, type |
| `results` | `Result` | completed tournament outcomes (winner, roster, per-round tallies); secured results appear only after the admin publishes them |
| `users` | `User` | admin (bcrypt hash) + OTP voter accounts (email, display name, username) |
| `otpchallenges` | `OtpChallenge` | salted+hashed OTP codes with TTL — never plain text |
| `sessionallowlistentries` | `SessionAllowlistEntry` | pre-approved emails for secured sessions |
| `sessionjoinrequests` | `SessionJoinRequest` | pending approval requests for secured sessions |
| `voteparticipations` | `VoteParticipation` | audit trail: who voted in each round (voter + round only, never the choice) |

**Seed data (automatic, on every boot if not already recovered):**
- `sess_default` — **"Danny Boyle Film Tournament"**, 11 film candidates from `voting-server/entries.json`.
- `sess_horror` — **"Horror Classics"**, candidates: The Shining, Psycho, Alien.

These are created by `src/bootstrap.js` and persisted idempotently. With `SEED_AUTO_START=false` they boot as **pending** waiting rooms — that is the presentation-friendly mode (§15).

**Verify the database is connected:**
1. Backend console shows `[Startup] Recovered N session(s) from MongoDB` and `[Startup] Server listening on port 8090`.
2. Open `http://localhost:8090/api/sessions` in a browser — you should get JSON listing the two seed sessions.
3. Optionally run the inspection script:

```cmd
cd scripts
node inspect-db.cjs
```

---

# 7. How to Start the Project

Open **two terminal windows** (plus MongoDB already running from §6).

### Step 1 — Start the Backend (Terminal 1)

```cmd
cd voting-server
npm start
```

```powershell
cd voting-server
npm start
```

(The script is `node -r @babel/register index.js`. There is no separate `dev` script — `npm start` is the only supported way.)

**Expected terminal output:**
```
[Startup] Recovered N session(s) from MongoDB
[Startup] Server listening on port 8090
```
(On first run you may also see seed/bootstrap logs.)

- **Backend port:** `8090` (from `PORT` in `.env`)
- **API base URL:** `http://localhost:8090/api`
- **Verify:** open `http://localhost:8090/api/sessions` → JSON with session summaries.
- The server hosts **both** REST and Socket.io on this one port.

### Step 2 — Start the Frontend (Terminal 2)

```cmd
cd voting-client
npm run dev
```

```powershell
cd voting-client
npm run dev
```

**Expected terminal output:** Vite banner with
```
  ➜  Local:   http://localhost:5173/
```
- **Frontend port:** `5173` (Vite default; no custom port in `vite.config.js`)
- **Browser URL:** `http://localhost:5173`
- **How it connects to the backend:** the Socket.io singleton in `src/services/socket.js` connects to `VITE_SERVER_URL` (default `http://localhost:8090`); REST calls use the same base URL. CORS on the server already allows `http://localhost:5173`.

### Step 3 — Other Services

- **MongoDB** — must already be running (§6). Nothing to start in the app.
- **Socket.io** — not a separate process; it is attached to the same HTTP server on port 8090.
- **SMTP** — leave `SMTP_HOST` empty for the presentation; OTP codes appear in Terminal 1's console. (Only configure real SMTP if you want actual emails.)
- **No Redis, Docker, or background workers** are required (verified — none in the code or configs).

---

# 8. Verify That the Project Is Running (Pre-Presentation Checklist)

```text
[ ] MongoDB is running        → net start shows service, or mongod console is up
[ ] Backend is running        → Terminal 1 shows "[Startup] Server listening on port 8090"
[ ] Database is connected     → "Recovered N session(s)" in the backend log; /api/sessions returns JSON
[ ] Frontend is running       → Terminal 2 shows Vite "Local: http://localhost:5173"
[ ] API requests are working  → open http://localhost:8090/api/sessions in the browser
[ ] Admin authentication works→ log in at /admin with ADMIN_USERNAME / ADMIN_PASSWORD from .env
[ ] Real-time works           → open lobby in two browser windows; headcount updates instantly
[ ] No console errors         → F12 in the browser; Terminal 1 should show no red stack traces
[ ] Presentation data is clean→ run "node scripts/inspect-db.cjs" (see §15)
[ ] Seeds are PENDING         → SEED_AUTO_START=false in .env; sessions show "pending" in /admin
```

**Per-item verification:**
- *Backend running:* the exact line `[Startup] Server listening on port 8090`.
- *Database:* absence of `[Startup] Fatal error` — the process **exits** when Mongo is unreachable, so a live process means Mongo is fine.
- *Auth:* `POST /api/admin/login` returns `{"success": true, "token": …}` (test via the /admin login form).
- *Real-time:* open `/sessions/sess_default/lobby` in two browsers; the connected count changes in both at once.
- *Console errors:* Vite errors would print in Terminal 2; browser errors in DevTools → Console.

---

# 9. Presentation Walkthrough (Suggested Demo Flow)

All URLs are on `http://localhost:5173` (client) and `http://localhost:8090` (server).

### Step 1 — Open the Application
- URL: `http://localhost:5173`
- **Explain:** this is the public Home page (`src/pages/Home.jsx`, route `/`). It introduces the pairwise-voting concept and links to join/history/admin.

### Step 2 — Admin Login
- Click the admin link / go to `http://localhost:5173/admin`.
- You are redirected to the login form (`/login` page handles both admin and voter login).
- Enter the admin username & password from your `.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`).
- **Feature demonstrated:** JWT admin authentication; the token is stored under the localStorage key `votesphere_admin_jwt` and attached to the Socket.io handshake.
- **Explain to the examiner:** credentials are checked server-side against a bcrypt hash; a signed JWT with `JWT_EXPIRES_IN` is issued; every lifecycle action carries this token and is re-verified at ingress.

### Step 3 — Admin Dashboard (Admin Panel)
- What is displayed: session list with status chips (pending/open/completed/archived), create-session form (title, ID, entries, timer duration 5–300s, session type public/secured), per-session management (start, join code, allowlist/approval queues, publish results, archive with two-step confirm), live updates arriving over the socket.
- **Backend involved:** the admin panel never calls REST mutations — it emits Socket.io `action` events (`CREATE_SESSION`, `START_SESSION`, …) guarded by `ADMIN_ACTION_TYPES`.

### Step 4 — Create a Session (live demo of lifecycle)
1. In the admin panel, fill the **Create Session** form (e.g. title "Demo Election", 3–4 entries, timer 30s).
2. Submit → the session appears instantly in the list (status `pending`).
3. **Explain:** validation (≥2 distinct entries, timer 5–300) happens server-side; the new session is broadcast to every connected client via the `sessions` event.

### Step 5 — Voters Join (two browser windows)
1. Open a second browser window (or use the join code / QR code shown for the session).
2. Go to `/join` (or `/join/<code>`), pick the session, enter a display name → lands on `/sessions/<id>/lobby`.
3. **Feature:** frictionless public join (`POST /api/sessions/:id/join`) issues a session-scoped `voterToken`; the lobby shows live headcount via `lobby_update`/`presence_update` socket events.
4. Optionally demonstrate a **secured session**: register a voter with email OTP at `/register` (`POST /api/auth/otp/request` → code printed in Terminal 1 → `POST /api/auth/otp/verify` sets the HttpOnly `vs_voter` cookie), and show the admin approving/rejecting the join request.

### Step 6 — Start the Session & Vote
1. Back in admin, click **Start** on the pending session.
2. Both voter windows instantly switch to the voting arena (`/sessions/<id>/vote`) — highlight this real-time transition.
3. Vote in both windows; watch tallies and the countdown (`timer_state`) update live.
4. **Explain:** the server closes the round on timer expiry **or** when 100% of active voters have voted (early completion with a 10-second disconnect grace window); a frozen `finalVote` snapshot is revealed during `ROUND_REVEAL_DURATION`, then the server dispatches `NEXT`.

### Step 7 — Results, History & Archive
1. Let the tournament run to a winner → podium + Recharts vote bars at `/sessions/<id>/results`; per-round history at `/history` (`GET /api/sessions/history`).
2. Show the admin **turnout** view (`GET /api/sessions/:id/turnout` — who voted per round, never what they voted).
3. Archive the finished session from the admin panel (two-step confirmation) → `ARCHIVE_SESSION`.

### Step 8 — Tie Handling (if time allows)
- Use a 2-candidate session and split votes evenly → rematch, then a `TIE_PENDING` 30-second admin window (`RESOLVE_TIE`); if the admin does nothing, the server resolves the tie itself (coin flip).

---

# 10. Feature-by-Feature Demonstration

## Feature: `Admin Login (JWT)`

### Purpose
Authenticate the single session administrator; every lifecycle mutation requires this identity.

### How to Access
`/admin` → redirects to the login form when not authenticated (`AdminGuard`).

### Steps to Demonstrate
1. Go to `http://localhost:5173/admin`.
2. Enter `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your `.env`.
3. Submit.
4. Verify the admin panel renders and the session list populates.

### Expected Result
Panel loads with live session data; a JWT is stored in `localStorage` (`votesphere_admin_jwt`) and attached to the socket handshake.

### Backend/API Used
`POST /api/admin/login` (issues JWT) and `GET /api/auth/me` (validates Bearer token). Also socket event `admin_login`.

### Database Interaction
Reads the `users` collection (admin record, bcrypt hash compare on the server).

### What to Explain During Presentation
"Passwords are never stored in plain text — bcrypt hashing — and the server issues a signed, expiring JWT. The client can *look* valid, but every admin action is re-verified at the server's ingress; an expired token is rejected with `UNAUTHORIZED` and the client drops the dead credential."

## Feature: `Session Creation & Lifecycle`

### Purpose
Admin creates a tournament and drives it: `pending → open → completed → archived`.

### How to Access
Admin panel → Create Session form; per-session action buttons.

### Steps to Demonstrate
1. Fill title, session ID, candidate entries (≥2), timer duration.
2. Choose type: **public** (open) or **secured** (allowlist/approval).
3. Submit; observe the new `pending` session.
4. Click **Start** to open voting; later use **Archive** (two-step confirm).

### Expected Result
Session appears/updates in real time everywhere, with correct status transitions.

### Backend/API Used
Socket.io `action` events: `CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `SET_ENTRIES`, `NEXT` (all in `ADMIN_ACTION_TYPES`). **No REST mutation endpoints exist by design.**

### Database Interaction
`sessions` collection upserts on every state change (sequenced per-session write queue); results go to `results` at completion.

### What to Explain
"All lifecycle mutations travel over Socket.io behind the admin JWT — there are no REST mutation endpoints, so the server is the single authority for state changes."

## Feature: `Public Voter Join & Lobby`

### Purpose
Frictionless, passwordless participation with a display name; live waiting room.

### How to Access
`/join` (or `/join/<6-char-code>`; lobby QR codes are generated client-side with `qrcode`).

### Steps to Demonstrate
1. Open `/join` in a fresh browser window (or scan the lobby QR).
2. Select the pending session, enter a display name, submit.
3. Observe the lobby: live connected count, join code.

### Expected Result
Redirect to `/sessions/<id>/lobby`; headcount updates instantly in all windows.

### Backend/API Used
`POST /api/sessions/:id/join` (returns session-scoped `voterToken` + cookie); `GET /api/sessions/:id/lobby`; `GET /api/join/:code` (rate-limited 30 req/min/IP). Socket: `subscribe_session`, `lobby_update`, `presence_update`.

### Database Interaction
Voter identity lives in server memory + cookie; the session document's voter count is persisted.

### What to Explain
"The display name is cosmetic — the real credential is an unguessable session-scoped token. Duplicate names are fine because tokens are unique. The lobby headcount is sanitized: no tokens or socket IDs are ever broadcast."

## Feature: `Voter OTP Registration & Login (Secured Identity)`

### Purpose
Passwordless voter accounts verified by emailed 6-digit OTP — required for **secured** sessions.

### How to Access
`/register` (create account) and `/login` (returning voter).

### Steps to Demonstrate
1. At `/register`, enter email, display name, username → submit.
2. Point at Terminal 1: the OTP code is printed there (because `SMTP_HOST` is empty).
3. Enter the code → account verified; profile saved.
4. At `/login`, repeat request + verify to sign back in.

### Expected Result
`vs_voter` HttpOnly cookie is set; the navbar/profile shows the voter identity; the voter can join secured sessions.

### Backend/API Used
`POST /api/auth/otp/request` (5/hour/email, 20/hour/IP, min 100 ms response for timing parity), `POST /api/auth/otp/verify`, `POST /api/auth/profile`, `GET /api/auth/voter/me`, `POST /api/auth/logout`.

### Database Interaction
`users` (account), `otpchallenges` (salted+hashed code with TTL — never plain text).

### What to Explain
"OTP codes are stored salted and hashed, expire after `OTP_TTL_MINUTES`, rate limits stop guessing, and the session cookie is HttpOnly and signed with a secret separate from the admin JWT."

## Feature: `Secured Sessions (Allowlist / Approval)`

### Purpose
Restrict who can join: `whoCanJoin: allowlist` (pre-approved emails) or `approval` (admin admits from a queue).

### How to Access
Admin panel → create session with type **secured** → choose allowlist/approval; manage lists and queues per session.

### Steps to Demonstrate
1. Create a secured session (paste allowlist emails, or leave empty and switch to approval).
2. As a voter (OTP account), request to join.
3. As admin, approve/reject the request (or add/remove allowlist emails).
4. Show that secured sessions are hidden from public listings for non-members.

### Expected Result
Only approved voters enter; unauthorized callers get the *same* neutral 404 as an unknown session — nothing confirms the session exists.

### Backend/API Used
Admin socket actions `SET_ALLOWLIST`, `APPROVE_PARTICIPANT`, `REJECT_PARTICIPANT`, `REMOVE_PARTICIPANT`, `SET_WHO_CAN_JOIN`, `SET_PUBLISH_RESULTS`. The join-code resolver returns only summary metadata for secured sessions.

### Database Interaction
`sessionallowlistentries`, `sessionjoinrequests`.

### What to Explain
"Privacy fails closed: reads that can't resolve a session's visibility are gated as secured, and a caller who may not see a session gets an identical response to one that doesn't exist."

## Feature: `Pairwise Voting Arena (VOTE + Live Timer)`

### Purpose
The core voting experience: head-to-head matchups with an authoritative countdown.

### How to Access
Automatic once the session starts: `/sessions/<id>/vote`.

### Steps to Demonstrate
1. Start the session in admin.
2. In voter windows, see the current pair + countdown.
3. Click a candidate in each window.
4. Watch the timer; note a vote after expiry is rejected.

### Expected Result
Votes count live; when every active voter has voted the round closes **early**; otherwise it closes at 00:00. Late ballots get `action_error: ROUND_CLOSED`.

### Backend/API Used
Socket event `action` with type `VOTE` (token resolved from action/cookie). Server emits `session_state`, `timer_state`, `action_error`.

### Database Interaction
`voteparticipations` records voter + round (audit only, never the choice). Duplicate ballots are blocked on the composite key `sessionId:::roundId:::sortedPair:::voterToken`.

### What to Explain
"The client never computes anything — it only emits intent. Duplicates are impossible because the server keys each ballot per voter, per round, per pair; and a pair that rematches after a tie gets a fresh round ID so earlier votes don't carry over."

## Feature: `Round Lifecycle, Reveal & Tie Resolution`

### Purpose
Monotonic round flow `VOTING → ROUND_CLOSED → RESULTS_REVEALED → NEXT`, with a deterministic tie ladder.

### How to Access
Automatic during an open session; tie window appears in the admin panel.

### Steps to Demonstrate
1. Observe the reveal countdown after a round closes (`ROUND_REVEAL_DURATION`, 10 s).
2. For a tie: first tie → automatic rematch/runoff; second consecutive tie → 30-second `TIE_PENDING` admin window.
3. Either click resolve (choose winner) or let it expire → automatic coin flip.
4. Zero votes → round replays once with a warning; again → `no_result`.

### Expected Result
Deterministic advancement with no client involvement; `finalVote` freezes each round's outcome.

### Backend/API Used
Server-internal: `TimerManager` + `roundManager`; admin socket action `RESOLVE_TIE`; broadcast `tie_pending`.

### Database Interaction
Round tallies persisted with the session; completed outcome in `results`.

### What to Explain
"Timers are server-authoritative; client countdowns are just visual estimates synchronized on `timer_state`. Tallies are hidden while a round is open and released only at reveal — the visibility guard enforces this centrally."

## Feature: `Results, Round History & Turnout`

### Purpose
Public archive of completed tournaments; admin-only turnout audit.

### How to Access
`/history` (public), `/sessions/<id>/results` (podium + Recharts bars), admin panel turnout tab.

### Steps to Demonstrate
1. Complete a small session.
2. Open the results page → podium, vote totals, round-by-round tallies.
3. Open `/history` → list of completed tournaments.
4. In admin, open turnout → names/emails of who voted in each round.

### Expected Result
Secured results stay hidden until the admin publishes (`SET_PUBLISH_RESULTS`); turnout shows participation, never choices.

### Backend/API Used
`GET /api/sessions/history`, `GET /api/sessions/:id/result` (alias `/history`), `GET /api/sessions/:id/rounds`, `GET /api/sessions/:id/turnout` (admin only). Socket: `session_turnout` (admin room).

### Database Interaction
Reads `results`, `voteparticipations`, `users` (names for turnout).

### What to Explain
"Result visibility is one matrix resolved only on the backend: public results are visible to everyone; secured results only to the admin and approved participants until published."

## Feature: `Join Codes & QR Sharing`

### Purpose
Fast room sharing: a 6-character code resolves to the session.

### How to Access
Lobby shows the code + generated QR; `/join/:code` preselects the session.

### Steps to Demonstrate
1. Open a pending session's lobby.
2. Show the QR code / code.
3. Open `/join/<code>` in another window → lobby loads with correct session.

### Expected Result
Resolver returns session summary; secured sessions expose only minimal metadata; 30 requests/min/IP with a minimum 100 ms response time.

### Backend/API Used
`GET /api/join/:code`.

### Database Interaction
Looks up `sessions` by join code (pending/open only).

### What to Explain
"Response times are deliberately leveled so an attacker can't time-probe which codes exist."

---

# 11. Important API Endpoints (verified in `voting-server/src/server.js`)

| Method | Endpoint | Purpose | Authentication | Used By |
| ------ | -------- | ------- | -------------- | ------- |
| POST | `/api/admin/login` | Admin login, issues JWT | Public | Admin login page |
| GET | `/api/auth/me` | Validate admin Bearer token | Admin JWT | Admin client |
| POST | `/api/auth/otp/request` | Request 6-digit voter OTP (rate limited) | Public | Register/Login pages |
| POST | `/api/auth/otp/verify` | Verify OTP, set `vs_voter` cookie | Public | Register/Login pages |
| POST | `/api/auth/profile` | Set voter display name/username | Voter cookie | Register page |
| GET | `/api/auth/voter/me` | Current voter profile from cookie | Voter cookie | App bootstrap |
| POST | `/api/auth/logout` | Clear `vs_voter` cookie | Voter cookie | Navbar logout |
| POST | `/api/sessions/:id/join` | Register voter (display name), issue session token | Public | Lobby/Join pages |
| GET | `/api/join/:code` | Resolve 6-char join code to session summary (30 req/min/IP) | Public | Join page |
| GET | `/api/sessions` | Public session catalog summaries | Public | Home/Join/Admin |
| GET | `/api/sessions/:id/lobby` | Lobby metadata + headcount | Public | Lobby page |
| GET | `/api/sessions/history` | Completed tournament archive | Public | History page |
| GET | `/api/sessions/:id/result` | One completed result (alias: `/api/sessions/:id/history`) | Public* | Results page |
| GET | `/api/sessions/:id/rounds` | Round-by-round tally history (revealed rounds only) | Public* | Results page |
| GET | `/api/sessions/:id/turnout` | Who voted per round (never the choice) | Admin | Admin panel |

\* Public for public sessions; gated server-side for secured sessions until published.

**There are no REST mutation endpoints for sessions** — all lifecycle changes go through Socket.io `action` events guarded by `ADMIN_ACTION_TYPES` (`CREATE_SESSION`, `START_SESSION`, `NEXT`, `SET_ENTRIES`, `ARCHIVE_SESSION`, `REFRESH_JOIN_CODE`, `RESOLVE_TIE`, `SET_ALLOWLIST`, `APPROVE_PARTICIPANT`, `REJECT_PARTICIPANT`, `REMOVE_PARTICIPANT`, `SET_WHO_CAN_JOIN`, `SET_PUBLISH_RESULTS`); voters may send only `VOTE`.

---

# 12. Real-Time Features (Socket.io, port 8090)

**How the connection starts:** a single Socket.io client is created at module load in `voting-client/src/services/socket.js`, connecting to `VITE_SERVER_URL` with transports `websocket` then `polling` fallback. The stored admin JWT is passed in the handshake `auth`, and voter tokens are attached per session.

**Client → Server events (verified):**
| Event | Payload / purpose |
|---|---|
| `subscribe_session` | `{ sessionId }` — join room `session:<id>`, triggers immediate `session_state` + `timer_state` |
| `unsubscribe_session` | leave the room |
| `subscribe_participants` / `unsubscribe_participants` | admin participant roster feed |
| `subscribe_turnout` / `unsubscribe_turnout` | admin turnout feed (`session_turnout`) |
| `sessions` | request the registry summary |
| `admin_login` | authenticate admin over the socket |
| `join_session` | register a voter over the socket |
| `action` | dispatch `VOTE` or an admin lifecycle action |

**Server → Client events (verified):**
| Event | Reaches | Purpose |
|---|---|---|
| `sessions` | all clients | registry summary updates (secured sessions filtered per caller) |
| `session_state` | room | authoritative state: pair, tallies, `roundLifecycle`, `finalVote` |
| `lobby_update` | lobby room | status + headcount |
| `presence_update` | room | sanitized active-voter headcount |
| `timer_state` | room | `{ duration, remaining, expiresAt, status }` |
| `tie_pending` | room/admin | armed tie-resolution window |
| `session_turnout` | admin turnout room | per-round voter lists |
| `action_error` | calling socket | `DUPLICATE_VOTE`, `ROUND_CLOSED`, `UNAUTHORIZED`, … |

**What triggers updates:** any store change on the backend is broadcast to the affected room only (`session:<id>`), so sessions never bleed into each other.

**How to demonstrate:** two browser windows on the same lobby/vote page — join, vote, or start the session in one and watch both update simultaneously.

**One-liner for the examiner:** "Every state change is computed once on the server and pushed to room-scoped Socket.io channels; clients just render what arrives."

---

# 13. Authentication and Authorization

**Two separate tiers, two separate secrets:**

1. **Admin tier — JWT.** `POST /api/admin/login` verifies username/email + password against a bcrypt hash (seeded from `ADMIN_*` env vars), returns a signed JWT (`JWT_EXPIRES_IN`, default 24 h). The client stores it in `localStorage` and sends it (a) as a Bearer header for REST, (b) in the socket handshake, (c) inside each `action` payload. Every admin action type is re-verified at ingress; a failure emits `action_error UNAUTHORIZED`, which the client treats as a dead credential — it drops both keys and surfaces "session expired" instead of showing empty data.
2. **Voter tier — two flavors.**
   - *Public sessions:* display name only → the server issues an unguessable session-scoped `voterToken` (`crypto.randomUUID()`), delivered in JSON + cookie. The token works in exactly one session.
   - *Secured sessions:* passwordless email OTP; the server sets an HttpOnly `vs_voter` cookie signed with `VOTER_JWT_SECRET` (separate from the admin secret). OTP codes are salted+hashed with a TTL.

**Protected routes / permissions:**
- `/admin` is wrapped by `AdminGuard` (client-side check) — but the real protection is server-side: admin socket actions are dropped without a valid JWT.
- `GET /api/sessions/:id/turnout` requires an admin token server-side.
- Secured sessions, allowlists, and join requests are visible only to the admin/approved members; unknown and forbidden lookups return identical responses (no existence leak).

**Logout:** admin — `logoutAdmin()` clears localStorage keys and socket auth; voter — `POST /api/auth/logout` clears the `vs_voter` cookie.

**Unauthorized access handling:** socket actions → `action_error` (`UNAUTHORIZED` / `INVALID_TOKEN` / `FORBIDDEN`); REST → 401 with generic messages that never reveal which part was wrong.

---

# 14. Error Handling

| Scenario | What happens |
|---|---|
| Invalid admin login | `401 INVALID_CREDENTIALS`, generic message (no enumeration); throttled logins answer `429` with retry info |
| Vote after round closes | `action_error ROUND_CLOSED`; late ballots never count |
| Duplicate vote | `action_error DUPLICATE_VOTE` — blocked server-side by the composite vote key |
| Vote without token / wrong session | `VOTER_TOKEN_REQUIRED` / `SESSION_MISMATCH` — anonymous voting is impossible |
| Vote for a candidate not in the pair | `INVALID_ENTRY` |
| Create session with <2 distinct entries / bad timer | `INSUFFICIENT_ENTRIES` / `INVALID_TIMER_DURATION` (5–300 enforced server-side) |
| Duplicate session ID | `DUPLICATE_SESSION_ID` |
| Unknown session read | `404 SESSION_NOT_FOUND` (identical body for gated secured sessions) |
| Missing/expired admin token | `401 UNAUTHORIZED` / `INVALID_TOKEN`; client shows "session expired" state |
| MongoDB down at boot | Startup is **fatal** with `[Startup] Fatal error: …` — the process exits rather than serving broken state |
| Database query failure on history/result | `500 DATABASE_ERROR` with a safe message |
| OTP abuse | Rate limits: 5/hour/email, 20/hour/IP, `429` + `Retry-After`; responses held ≥ `API_MIN_RESPONSE_MS` for timing parity |
| Zero votes in a round | Round replays once with a warning; if it repeats, the match ends safely as `no_result` |
| Network drop mid-session | 10-second disconnect grace window before a voter is excluded from early-completion quorum |
| Unknown socket action types | Rejected at ingress — clients can only dispatch the whitelisted action types |

---

# 15. Clean Presentation Data

**Goal:** only the two seed sessions and no test residue.

1. **Stop the backend** (Ctrl+C in Terminal 1) so it doesn't re-persist state while you clean.
2. **Run the archive script** (dry-run first — nothing is deleted, data is moved to `archive_*` collections and can be restored):
   ```cmd
   cd scripts
   node archive-demo-data.cjs
   node archive-demo-data.cjs --commit
   ```
   ```powershell
   cd scripts
   node archive-demo-data.cjs
   node archive-demo-data.cjs --commit
   ```
   It automatically **keeps** the seeds `sess_default` and `sess_horror` and archives every other session, plus test users, join requests, allowlist rows, and participation records. `--restore` reverses it.
3. **Full reset (nuclear option, still safe for source code):** stop the backend, then drop the dev database — this wipes the seed sessions too; the server recreates them on next boot:
   ```cmd
   mongosh --quiet --eval "db.getSiblingDB('votesphere_dev').dropDatabase()"
   ```
   ```powershell
   mongosh --quiet --eval "db.getSiblingDB('votesphere_dev').dropDatabase()"
   ```
4. **Set presentation mode:** in `.env`, `SEED_AUTO_START=false` → seeds boot as **pending** waiting rooms and never play themselves; you start them from the admin panel when you're ready.
5. **Restart the backend** and verify with `node scripts/inspect-db.cjs` (or `http://localhost:8090/api/sessions`).
6. **Create your demo session** fresh from the admin panel (e.g. "Demo Election", 4 candidates, 30 s) — do this *before* the audience arrives so the admin panel is tidy.
7. **Clear browser state** on the presentation machine: DevTools → Application → Clear site data for `localhost:5173` (removes the old admin JWT and voter tokens so you start logged out).

**Should NOT be shown:** `otpchallenges` documents, hashed passwords/`passwordHash` fields, JWTs or voter tokens in localStorage during screen share, and any `archive_*` collections.

---

# 16. Troubleshooting

| Problem | Possible Cause | Solution |
|---|---|---|
| Backend won't start: `[Startup] Fatal error` | MongoDB not running / wrong URI | Start MongoDB (`net start MongoDB`), check `MONGODB_URI` in `.env` |
| Backend won't start: bcrypt/native errors during install | Native module build failure on Windows | Delete `node_modules`, run `npm install` again from an **admin-free** terminal; ensure Node ≥18 and prebuilt binaries were downloaded |
| Backend won't start: `VOTER_JWT_SECRET` warning/error | Missing secret | Set `VOTER_JWT_SECRET` in `.env` (throws only in production, but set it anyway) |
| Frontend won't start | Port 5173 busy or deps missing | Check `npm install` ran; free the port (below); rerun `npm run dev` |
| Port already in use (8090) | Previous server still running | ```cmd\nnetstat -ano \| findstr :8090\ntaskkill /PID <pid> /F\n``` / PowerShell: `Get-NetTCPConnection -LocalPort 8090 \| Select OwningProcess` then `Stop-Process -Id <pid> -Force` |
| Database connection failed (runtime) | Mongo stopped after boot | Restart MongoDB; the store subscriber logs persistence errors — restart the backend after Mongo is back |
| API request failed / CORS error in console | Backend on a different port, or origin mismatch | Keep `PORT=8090`, `VITE_SERVER_URL=http://localhost:8090`, and the default `CORS_ALLOWED_ORIGINS` |
| Login doesn't work | Wrong `ADMIN_USERNAME`/`ADMIN_PASSWORD` vs `.env`; stale token | Check `.env` values; DevTools → Application → Clear site data; if you changed `JWT_SECRET`, all old tokens are invalid — log in again |
| Real-time feature doesn't work | Socket blocked / polling only | Confirm Terminal 1 shows the socket connection; keep both windows on `localhost` (same origin); check DevTools Network → WS |
| OTP never arrives | Expected with `SMTP_HOST` empty | Read the code from **Terminal 1's console output** |
| OTP request says 429 | Rate limit hit (5/hour/email) | Wait, restart the backend (in-memory limits reset), or raise the env limits |
| Admin panel shows empty sessions | Admin JWT invalid for this server (e.g. `JWT_SECRET` changed, server restarted with different secret) | Log out and log in again at `/admin` |
| Secured session invisible to a voter | Intended behavior (fail-closed visibility) | Approve the voter / publish results as admin |
| Seed session already completed during setup | `SEED_AUTO_START` not `false` | Set `SEED_AUTO_START=false`, drop DB (§15 step 3), restart |

---

# 17. Port and Service Reference

| Service | Port | URL | Start Command |
| --- | ---: | --- | ------------- |
| MongoDB | 27017 | `mongodb://localhost:27017/votesphere_dev` | `net start MongoDB` (service) |
| Backend (HTTP + Socket.io) | 8090 | `http://localhost:8090` (API base: `/api`) | `cd voting-server && npm start` |
| Frontend (Vite dev) | 5173 | `http://localhost:5173` | `cd voting-client && npm run dev` |

---

# 18. Presentation-Day Quick Start

### CMD
```cmd
:: 1. Database (skip if the service is already running)
net start MongoDB

:: 2. Backend — Terminal 1
cd voting-server
npm start

:: 3. Frontend — Terminal 2
cd voting-client
npm run dev

:: 4. Browser
start http://localhost:5173
:: 5. Log in at /admin (credentials in .env)
:: 6. Demonstrate features (§9)
```

### PowerShell
```powershell
# 1. Database
Start-Service MongoDB

# 2. Backend — Terminal 1
cd voting-server; npm start

# 3. Frontend — Terminal 2
cd voting-client; npm run dev

# 4. Browser
Start-Process "http://localhost:5173"
# 5–6: same as above
```

Sanity check before walking in: `http://localhost:8090/api/sessions` returns JSON, and the admin panel lists the pending seed sessions.

---

# 19. Presentation Checklist

## Before Presentation
- [ ] `node --version` ≥ 18, MongoDB service running
- [ ] `SEED_AUTO_START=false` in `.env` (pending seeds) and demo data cleaned (§15)
- [ ] Backend starts with no errors (`Server listening on port 8090`)
- [ ] Frontend starts (`Local: http://localhost:5173`)
- [ ] `/api/sessions` returns JSON in the browser
- [ ] Admin login works; old localStorage cleared
- [ ] Demo session pre-created (pending) and timer duration set
- [ ] A voter OTP flow tested once (code visible in Terminal 1)
- [ ] Both browser windows tested for real-time updates
- [ ] No red errors in either terminal or the browser console

## During Presentation
- [ ] Explain architecture: authoritative server, reactive clients, Socket.io + REST + MongoDB
- [ ] Admin login → JWT explanation
- [ ] Create session → pending waiting room
- [ ] Two voters join (public) → live lobby headcount
- [ ] Start session → voting arena, countdown, live tallies
- [ ] Round close + reveal → next round; early completion if everyone votes
- [ ] Tie handling if it occurs (rematch → admin window → auto coin flip)
- [ ] Results podium, `/history` archive, admin turnout
- [ ] OTP voter registration (code printed in Terminal 1) + secured session approval
- [ ] Explain duplicate-vote protection and rate limits
- [ ] Archive session; mention persistence & crash recovery (sessions reset to pending on reboot)

---

# 20. Viva Preparation

**Q: Why did you choose this technology stack?**
A: React 19 + Redux Toolkit give a predictable, normalized client store; Vite gives fast dev iteration. On the backend, Redux over Immutable.js means every state change is a pure reducer transition — the same engine pattern as the client but authoritative — and Socket.io gives low-latency room-scoped broadcasts with polling fallback. Mongoose fits the document-shaped session/result data; jsonwebtoken and bcrypt cover the two auth tiers without extra services.

**Q: How does the frontend communicate with the backend?**
A: Two channels on one port (8090): REST `fetch` for read-only queries and auth, and a Socket.io connection for everything real-time — including *all* state mutations, which the client emits as Redux-style actions; the server validates, authorizes, and dispatches them.

**Q: How does the backend communicate with the database?**
A: A store subscriber watches the in-memory Redux state and asynchronously upserts sessions/results via Mongoose, with a per-session write queue guaranteeing ordered writes. Reads at boot recover sessions from MongoDB. Nothing blocks the voting path on I/O.

**Q: How does authentication work?**
A: Admin: credentials → bcrypt compare → signed JWT (24 h) reused on REST and every socket action. Voters in public sessions get a session-scoped random token; secured sessions use email OTP with a hashed, expiring code and an HttpOnly `vs_voter` cookie signed by a separate secret. All authorization is re-checked server-side on every request.

**Q: How is data validated?**
A: At ingress, before anything touches the engine: session IDs, titles, entries (≥2 distinct), timer durations (5–300), token presence and scope, pair membership, and round openness. Unknown action types are rejected outright by a whitelist.

**Q: How are errors handled?**
A: Machine-readable `action_error` codes over the socket and typed HTTP errors over REST, all generic where they could leak information (login, session existence). Startup fails fast if MongoDB is missing; runtime persistence errors are logged without crashing the vote path.

**Q: How does the real-time functionality work?**
A: Clients join Socket.io rooms per session; the backend broadcasts `session_state`, `timer_state`, `presence_update`, etc. only to the affected room whenever its authoritative store changes. Clients render; they never recompute.

**Q: What happens if the server goes down?**
A: In-memory state is lost, but MongoDB has every session, result, and participation record. On reboot the server recovers persisted sessions and resets interrupted `open` sessions to `pending` so tournaments resume cleanly. Vote choices are never persisted per-voter, so a crash can't leak them.

**Q: What are the major APIs?**
A: REST: `/api/admin/login`, `/api/auth/otp/*`, `/api/sessions*` (discovery, lobby, history, result, rounds, turnout), `/api/join/:code`. Socket: `action` (VOTE + 13 admin action types) and the broadcast events `session_state`, `timer_state`, `sessions`, `lobby_update`, `presence_update`, `tie_pending`, `session_turnout`, `action_error`.

**Q: What is the project architecture?**
A: Server-authoritative Flux. A protected, pinned pure engine (`core.js`) computes tournament outcomes; reducers over Immutable state manage multi-session state; TimerManager and roundManager orchestrate lifecycle; a persistence subscriber mirrors state into MongoDB; clients are thin reactive views.

**Q: What challenges did you face?** *(adapt to your own experience)*
A: Keeping tallies hidden while rounds are live (solved by the centralized visibility guard and the frozen `finalVote` snapshot), preventing duplicate votes across rematches (round-scoped composite keys), designing fail-closed privacy for secured sessions (identical 404s), and making OTP endpoints timing-safe and rate-limited.

**Q: How would you scale the project?**
A: Socket.io + the Redis adapter for multi-node broadcasting, a managed MongoDB replica set, extracting the engine into stateless workers keyed by session, and moving rate-limit/throttle state into Redis so it's shared across nodes. The REST read layer is already stateless, so horizontal scaling of reads is straightforward.

**Q: What improvements can be made in the future?**
A: Ranked-choice/Condorcet extensions to the engine, end-to-end voter-verification receipts, richer analytics on the turnout audit trail, automated E2E browser tests alongside the current 1,394 automated tests, and a production deployment with HTTPS (then `COOKIE_SECURE=true` and real SMTP).

---

## Verification Notes

- All ports, commands, endpoints, socket events, collections, routes, and defaults above were read directly from `voting-server/src/server.js`, `voting-server/index.js`, `voting-server/src/bootstrap.js`, `voting-server/src/constants.js`, `voting-client/src/routes/AppRoutes.jsx`, `voting-client/src/services/*.js`, both `package.json` files, and `.env.example`.
- **Needs verification:** the exact MongoDB service name on *your* machine (`net start MongoDB` assumes the standard MSI install name); the clone URL (insert your own repository URL); and your actual `.env` values for the admin credentials.
