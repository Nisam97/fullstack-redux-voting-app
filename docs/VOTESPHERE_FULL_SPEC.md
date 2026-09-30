# VoteSphere — Full Application Specification (Target Design v2)

> Output of a design interview on branch `develop1`. Every decision below was explicitly confirmed by the project owner unless it appears in **Section 16 (Assumed Defaults)**. This file is the source of truth for building the next phases with an AI coding assistant.

---

## 0. How to Use This Document With an AI Coding Assistant

**Standing rules to paste at the start of every AI session:**

1. **Test-first.** Write or update Mocha tests before the implementation. Never finish a phase with a failing test.
2. **Do not modify `voting-server/src/core.js`.** It is a protected pure engine (SHA-256 `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`). New behavior wraps around it; it is never edited.
3. **One phase at a time** (Section 15). Do not start Phase N+1 until Phase N's tests pass.
4. **Do not break the existing suites** (backend + frontend, 500+ tests). Run both after every change.
5. **Server authority.** The frontend never calculates tallies, quorum, ties, or advances rounds. It only renders server state.
6. **Stay inside this spec.** If something is not covered, list the question instead of inventing behavior.
7. Admin lifecycle mutations go through authenticated Socket.io `action` messages (existing convention). Voter identity flows (OTP, profile, login) are REST.

**Stack (unchanged):** React + Redux Toolkit + Vite (client, port 5173); Node.js + Redux + Immutable.js + Socket.io + Mongoose/MongoDB (server, port 8090); Mocha/Chai for tests; Recharts for charts; `qrcode` for QR.

---

## 1. Product Summary

VoteSphere is a live, real-time voting app. An admin creates voting **sessions**. Voters join a session by **QR code or typed 6-character join code**, wait in a **lobby**, and the admin presses **Start**. Voting runs live in timed rounds, the **winner is revealed**, and afterwards everyone allowed to see the results can view **how many votes each candidate received**, round by round and in total.

There are two session types:

| | **Public** | **Secured** |
|---|---|---|
| Who can join | Anyone with the code/QR | Only verified, eligible users |
| Identity | Display name only (cosmetic) | Email + OTP-verified permanent profile |
| Double-vote protection | Session-scoped token cookie (deliberately "less secured") | Database user ID (survives cookie loss and restarts) |
| Results visibility | Public (`/history`) | Participants + admin only, unless admin publishes |

---

## 2. Baseline: What Already Exists vs. What Changes

### Already built (keep; do not regress)
- Single seeded admin (bcrypt + JWT), admin panel at `/admin`, session creation/management/archive modals.
- Multi-session isolation via Socket.io rooms `session:${sessionId}`.
- Lobby with live headcount (`lobby_update`), admin **Start** (`START_SESSION`), automatic lobby → vote redirect.
- Server-authoritative timer (`TimerManager`), early close on full turnout, idempotent `closeRoundOnce`, monotonic round identity `${sessionId}:::r${roundIndex}`.
- Round lifecycle `VOTING → ROUND_CLOSED → RESULTS_REVEALED → NEXT`, frozen `finalVote` snapshot `{ pair, tally, closedAt }`, reveal timer.
- Duplicate-vote blocking key `${sessionId}:::${sortedPair}:::${voterToken}`.
- MongoDB persistence, startup recovery (interrupted `open` → `pending`), `/history` archive, Recharts results chart, tally hidden during active rounds.

### Gaps this spec closes
1. No secured voting (no email, OTP, profile, allowlist/approval). Voters live only in server memory.
2. `Register.jsx` is a non-functional static form with a "Register As: Admin" dropdown (must be reworked).
3. No typed join code; sessions are joinable only by URL/QR and all are listed publicly at `/sessions`.
4. Per-candidate vote counts cannot be shown: tallies reset each round and `Result` stores only the winner.
5. No tie handling: `core.js` sends both tied candidates back to the pool, so a tied final can replay forever and a 0–0 round can loop forever.
6. No single-ballot mode; every session is a pairwise tournament.
7. "Everyone voted" early-close counts ghost voters and a moving headcount.

---

## 3. Roles & Identities

| Role | How created | Auth | Notes |
|---|---|---|---|
| **Admin** | Exactly one, seeded from `.env` (`ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) | Username/email + password → JWT (client storage in v1) | No admin registration, no multi-admin, no "Admin" option anywhere in voter UI |
| **Public voter** | Joins a public session with a display name | Session-scoped random token (`crypto.randomUUID()`) in cookie | Duplicate display names allowed |
| **Secured user** | Verifies email by OTP, creates profile once | Passwordless. 7-day `httpOnly` cookie holding a signed voter JWT | Permanent account keyed by lowercase email; profile = name + email only |

---

## 4. Decision Log (all confirmed)

| # | Decision |
|---|---|
| 1 | Single seeded admin. Admin manages many sessions. Remove "Admin" from Register. |
| 2 | Secured entry order: user opens link/code → email → OTP → profile (first time only) → lobby. Eligibility is enforced by allowlist or admin approval (see #10, #11). |
| 3 | Secured users are permanent, passwordless accounts keyed by email. Profile = name + email. No password, no photo, no Student/Faculty dropdown. |
| 4 | OTP delivered by Nodemailer + Gmail SMTP (app password). If SMTP is not configured (tests/dev), the OTP is logged to the server console instead of emailed. OTP: 6 digits, 10-minute TTL, single use, stored hashed, 5 wrong attempts → locked, 60 s resend cooldown, generic response that never reveals whether an email is eligible. |
| 5 | Each session gets a server-generated, unique, non-editable **6-character join code** (alphabet without 0/O/1/I/L). Home page has "Enter session code"; QR encodes a link with the same code. Live sessions are **not browsable**. Completed public sessions appear on `/history`. Wrong code and unavailable secured session show the **same** "not found or not available" message. |
| 6 | Secured login lasts **7 days** in an `httpOnly` cookie. Fresh OTP is required on expiry, new browser/device, or logout. Eligibility (allowlist/approval) is checked on **every** secured session entry regardless of login. Visible **Log out** button. |
| 7 | After the winner is revealed, results show **round-by-round** matchups and **per-candidate totals** (with rounds played). Each frozen round snapshot is appended to a `rounds` array on `Result`. `core.js` untouched. |
| 8 | Voting mode is **automatic**: **2–6 candidates → single ballot**, **7+ → pairwise tournament**. Cutoff is one constant (`SINGLE_BALLOT_MAX = 6`). No manual override. Create form shows a live note of which mode will run. |
| 9 | **Zero-vote round:** replay once with a fresh timer; if still zero → session ends as **"No result"** (`winner: null`). **Real tie:** automatic rematch once (single ballot: runoff among tied candidates only) → if still tied, admin chooses **Pick winner (from tied only)** or **Coin flip**; no response in **30 s** → automatic server coin flip. Results label how each round was settled. |
| 10 | Secured sessions have a **"Who can join"** setting: (a) **Listed emails only** or (b) **Anyone with the code, admin approves**. Allowlist input: paste or CSV, one email per line, normalized/deduped/validated with line-numbered errors. Editable while `pending`; **locked at Start**. Removing someone in the lobby drops them immediately. Emails are visible to the admin only. |
| 11 | Eligibility is **snapshotted at the start of each round**. Only **connected** voters count toward "everyone voted" (10 s disconnect grace; a reconnecting voter can still vote until close). Timer is always the backstop. Public late joiners become eligible from the next round. Secured approved set is frozen at Start. |
| 12 | Time ranges: **tournament** 5–300 s per round (default 30); **single ballot** 30 s–10 min (default 2 min). Form label changes by mode. Validated server-side. Sessions are **live-only** (no asynchronous long-running mode). |
| 13 | **Ballot secrecy:** store *that* a user voted in round N, never *what* they chose. Public-session results are public. Secured results are visible only to approved participants (signed in) and the admin; admin has a per-session **"Publish results publicly"** toggle (default off). Admin also sees per-round turnout (who voted, not for whom). |
| 14 | Candidate = unique name + optional description (≤ 80 chars). Names unique per session (core.js keys on the name string). No photos in v1. Voter profile has no picture. |
| 15 | No scheduling. Manual Start only. A session left `pending` for **7 days** expires automatically and its code stops working. |

---

## 5. Session Model

### 5.1 Create-session form (admin)

| Field | Applies to | Rules |
|---|---|---|
| Title | all | required, trimmed, max length enforced |
| Session type | all | `public` or `secured` |
| Who can join | secured | `listed` or `approval` |
| Email list | secured + `listed` | paste/CSV, see 5.3 |
| Candidates | all | 2+ entries, each `name` (unique, trimmed, case-insensitive uniqueness) + optional `description` ≤ 80 chars |
| Timer | all | range depends on mode (5.2), server-validated |
| Publish results publicly | secured | default `false` |
| *(generated)* Join code | all | 6 chars, unique, not editable |
| *(generated)* Voting mode | all | derived from candidate count |

The form shows a live note: "This will run as a single ballot" (2–6) or "This will run as a pairwise tournament (N−1 rounds)" (7+).

### 5.2 Voting modes

| | Single ballot | Pairwise tournament |
|---|---|---|
| Candidates | 2–6 | 7+ |
| Ballot | All candidates shown; each voter picks one | Head-to-head pair per round |
| Rounds | 1 (plus tie runoff/replay if needed) | N−1 rounds (plus ties/replays) |
| Timer | 30 s – 10 min, default 2 min | 5 – 300 s, default 30 s |
| Engine | New pure module `ballot.js` (beside `core.js`) | Existing `core.js` |
| Winner | Most votes | Last surviving candidate |

A single ballot is stored as a tournament with a one-entry `rounds` array, so results, storage, and history use one shape.

### 5.3 Allowlist rules (secured + `listed`)

- Input: pasted text or CSV; one email per line; no other columns.
- Server lowercases, trims, removes duplicates, validates format. Invalid entries are rejected with line numbers (e.g. "3 invalid emails: lines 4, 9, 12").
- Editable while session is `pending`. **Locked at Start** (forgotten voter → admin creates a new session).
- Removing an email during the lobby removes that person from the lobby immediately and blocks re-entry.
- Allowlisted emails are never sent to voter clients or included in any broadcast.

### 5.4 Session status

`pending → open → completed` and `archived` (existing), plus `expired` (pending > 7 days).
A completed session has `outcome: 'winner' | 'no_result'`.

---

## 6. Join & Entry Flows

### 6.1 Resolving a code
`GET /api/join/:code` → `{ sessionId, type, title, status, whoCanJoin? }` or a generic **404 "Session not found or not available."** The same 404 is returned for: unknown code, expired, archived, and secured-session lookups that must not be probeable. Rate-limit this endpoint per IP (30 req/min) to stop code guessing (31⁶ ≈ 887 M combinations, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`).

Entry points: Home "Enter session code" box (`/join`) and the QR/link (`/join/:code`). Both call the same resolver, then branch by session type.

### 6.2 Public flow
1. Resolve code → public session → lobby page asks for a **display name**.
2. `POST /api/sessions/:id/join { displayName }` → session-scoped voter token (JSON + cookie).
3. Voter appears in lobby headcount. On Start, auto-redirect to voting.

### 6.3 Secured flow — "Listed emails only"
1. Resolve code → secured/`listed` → enter **email**.
2. `POST /api/auth/otp/request { email, sessionCode }` → always responds "If this email is eligible, a code was sent." (Sends only if the email is on the session's list. Same response and timing either way.)
3. `POST /api/auth/otp/verify { email, code }` → on success: create the `User` if new, set the 7-day `httpOnly` cookie.
4. If profile incomplete → `POST /api/auth/profile { name }` (first time only).
5. Server re-checks the email is on the session's list → enter lobby (status `approved`).

### 6.4 Secured flow — "Anyone with the code, admin approves"
1–4 as above, except OTP is sent to **any** valid email (rate-limited per email and IP; the generic message no longer applies because nothing is being hidden).
5. Participant is created with status `pending` and sits in a **waiting-for-approval** screen. They cannot vote.
6. Admin sees the pending queue (name + email) in the lobby and taps **Approve** or **Reject**. Approved → lobby, rejected → told "not approved".
7. The pending queue **closes at Start**; still-pending users are shown "Session started without approval."

### 6.5 Returning secured users
Valid cookie → skip OTP/profile → server still checks allowlist/approval for *this* session → lobby. Expired cookie, new device, or logout → OTP again.

### 6.6 Late joiners
- **Public:** may join after Start; they watch the current round and become eligible from the next round.
- **Secured:** the approved set is frozen at Start; no late entries.

---

## 7. Lobby

- Shown before Start. Voters see: title, joined **headcount**, and **display names** (secured: profile names). Never emails.
- **Admin lobby view** (secured): counts for **allowlisted** and **joined** (or **approved / pending** in approval mode), a list of who has not joined yet, approve/reject controls, and the **Start** button.
- Start (`START_SESSION`): `pending → open`, closes lobby, freezes secured eligibility, begins Round 1, redirects joined voters to voting.
- Secured lobby/vote sockets identify the user from the handshake cookie, not from client-supplied fields.

---

## 8. Voting Engine

### 8.1 Round lifecycle (per round)

```
VOTING
  └─ closes on: timer expiry  OR  every eligible connected voter has voted
ROUND_CLOSED  (frozen snapshot captured: { candidates, tally, closedAt })
  ├─ decisive winner ───────────────────────────► RESULTS_REVEALED ─► next round / COMPLETED
  ├─ zero votes, 1st time ──► replay same round with fresh timer
  ├─ zero votes, 2nd time ──► session COMPLETED, outcome = 'no_result'
  ├─ tie, 1st time ─────────► automatic rematch (single ballot: runoff among tied only)
  └─ tie after rematch ─────► AWAITING_ADMIN (30 s)
                               ├─ admin: Pick winner (tied candidates only)
                               ├─ admin: Coin flip
                               └─ no response in 30 s ► automatic server coin flip
                                                        └─► RESULTS_REVEALED
```

Rules:
- Voting and reveal timers never run concurrently. The frontend countdown is visual only.
- Late votes during `ROUND_CLOSED` / `RESULTS_REVEALED` / `AWAITING_ADMIN` return `action_error { action: 'VOTE', error: 'ROUND_CLOSED' }`.
- A rematch that itself gets **zero** votes is treated as still tied → goes to the admin step (assumed, see §16).
- Every round record stores how it was settled: `votes | rematch | admin_decision | coin_flip | no_contest`.

### 8.2 Eligibility & "everyone voted"
- At the start of each round the server **snapshots** the eligible set. It cannot change until the next round.
- Public: everyone joined before the round began. Secured: the approved set frozen at Start.
- Only **connected** eligible voters count toward early close. A voter disconnected > **10 s** is excluded from that round's check. If they reconnect before close, they may still vote and their vote counts.
- Minimum 2 eligible connected voters for early close; zero-voter protection remains. The timer is always the backstop.
- Implementation: presence map `sessionId → voterKey → { socketIds, lastSeenAt }`, updated on connect/disconnect.

### 8.3 Duplicate-vote protection
- **Public:** key `${sessionId}:::${roundId}:::${voterToken}` (round identity `${sessionId}:::r${roundIndex}`).
- **Secured:** unique DB record `VoteParticipation { sessionId, roundId, userId }`. Stores **only that** the user voted, never their choice.
- Tallies are aggregate counters only.

### 8.4 Tiebreak implementation hint (keeps `core.js` untouched)
Compute the resolved winner in the wrapper layer (`roundManager.js` / new `tieResolver.js`). To advance a tournament with a single winner, pass a **transient copy** of the state with one synthetic `+1` on the chosen candidate into `core.next()`. The **persisted/frozen snapshot keeps the real tally** and records the resolution method.

### 8.5 Tournament totals
Votes cast in rematches and replays **count toward totals**. Totals are derived from `rounds`, not stored separately.

---

## 9. Results, History & Visibility

### 9.1 What is stored (`Result`)
`sessionId, title, mode, type, entries[], candidates[{name,description}], winner (nullable), outcome, rounds[], completedAt, publishResultsPublicly`.

Each `rounds[]` element:
```json
{
  "roundIndex": 3,
  "kind": "ballot | matchup | rematch | runoff | replay",
  "candidates": ["Dune", "Barbie"],
  "tally": { "Dune": 14, "Barbie": 9 },
  "totalVotes": 23,
  "closedAt": "2026-09-21T10:15:00Z",
  "resolution": "votes | rematch | admin_decision | coin_flip | no_contest",
  "advanced": ["Dune"]
}
```

### 9.2 What the results page shows (after the winner is revealed)
1. **Winner** (or "No result" with an explanation).
2. **Round-by-round:** each matchup with counts, e.g. "Round 3: Dune 14 – Barbie 9", labeled "decided by votes / won on rematch / admin's decision / coin flip".
3. **Totals:** each candidate's total votes across all their rounds **and rounds played** (so totals aren't misleading).
4. During an active round, tallies/percentages/charts stay **hidden** (existing rule); the revealed snapshot is shown after close.

### 9.3 Who can see what

| Data | Public session | Secured session |
|---|---|---|
| Live/final results | Anyone (`/history`, results page) | Approved participants (signed in) + admin |
| On public `/history` | Yes | No, unless admin toggles **Publish results publicly** |
| Participant list & per-round turnout (who voted, not for whom) | Admin | Admin |
| Emails / allowlist | — | Admin only |

Live sessions are not listed publicly. The Socket.io `sessions` broadcast must **exclude secured sessions** for voters; only the authenticated admin connection receives the full list.

---

## 10. Data Models

```
User {                         // secured voters (permanent)
  _id, email (unique, lowercase), name, createdAt, lastLoginAt
}

OtpChallenge {
  email, codeHash, expiresAt, attempts (max 5), lastSentAt, consumedAt
}                              // TTL index cleans expired rows

Session (extend existing) {
  sessionId, title, entries[String], status (+ 'expired'),
  type ('public'|'secured'), mode ('single_ballot'|'tournament'),
  joinCode (unique, indexed), whoCanJoin ('listed'|'approval'|null),
  candidateInfo { [name]: description },
  timerDuration, publishResultsPublicly (default false),
  pendingExpiresAt (createdAt + 7 days),
  winner (nullable), outcome ('winner'|'no_result'|null),
  createdAt, updatedAt, completedAt, archivedAt
}

SessionParticipant {           // secured sessions only
  sessionId, email, userId?, 
  status ('invited'|'pending'|'approved'|'rejected'|'removed'),
  joinedAt, decidedAt
}                              // unique (sessionId, email)

VoteParticipation {            // secured only; records THAT a vote happened
  sessionId, roundId, userId
}                              // unique (sessionId, roundId, userId)

Result (extend existing) {  ... + mode, type, rounds[], outcome, candidates[], publishResultsPublicly }
```

Public voters remain in the existing in-memory registry (no DB). Aggregate tallies stay in the Redux store and are persisted through `rounds`.

---

## 11. API Contract Additions

### REST (new/changed)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/join/:code` | none | Resolve join code (generic 404) |
| `POST /api/auth/otp/request` | none, rate-limited | Send OTP (generic response) |
| `POST /api/auth/otp/verify` | none | Verify OTP → set `vs_voter` cookie |
| `POST /api/auth/profile` | voter cookie | Create profile (first time) |
| `GET /api/auth/voter/me` | voter cookie | Current secured user |
| `POST /api/auth/logout` | voter cookie | Clear cookie |
| `POST /api/sessions/:id/join` | none | Public join (existing) |
| `GET /api/sessions/:id/lobby` | none (public) / voter cookie (secured) | Lobby hydration |
| `GET /api/sessions/:id/result` | per §9.3 | Result + `rounds[]` |
| `GET /api/sessions/history` | none | **Public sessions and published secured results only** |
| ~~`GET /api/sessions`~~ | — | **Remove public listing** (admin gets list over authenticated socket) |

### Socket.io admin `action` messages (JWT required)
Existing: `CREATE_SESSION` (extended with type, whoCanJoin, candidates+descriptions, publish toggle), `START_SESSION`, `NEXT`, `ARCHIVE_SESSION`, `SET_ENTRIES`.
New: `SET_ALLOWLIST`, `APPROVE_PARTICIPANT`, `REJECT_PARTICIPANT`, `REMOVE_PARTICIPANT`, `RESOLVE_TIE { decision: 'pick'|'coin_flip', winner? }`, `SET_PUBLISH_RESULTS`.

### Socket events (new)
`participants_update` (admin only: allowlisted/joined/pending), `approval_status` (to the affected voter), `tie_pending` (admin: tied candidates + 30 s deadline), `round_resolution` (how the round was settled). Existing `session_state`, `lobby_update`, `timer_state`, `action_error` are kept.

### New error codes
`NOT_ELIGIBLE`, `NOT_APPROVED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_LOCKED`, `OTP_COOLDOWN`, `RATE_LIMITED`, `SESSION_UNAVAILABLE` (generic), `ALLOWLIST_LOCKED`, `INVALID_EMAILS` (with line numbers), `MODE_TIMER_OUT_OF_RANGE`.

---

## 12. Security & Privacy Rules

- OTP hashed at rest (bcrypt, already a dependency, or HMAC-SHA-256 with a server secret). Never log OTPs except in the no-SMTP dev fallback.
- OTP limits: 5 requests/hour/email, 20/hour/IP, 60 s resend cooldown, 5 wrong attempts → challenge locked.
- Voter cookie `vs_voter`: signed JWT (`userId`), 7 days, `httpOnly`, `SameSite=Lax`, `Secure` in production. Client (5173) and server (8090) are different origins: enable CORS with an explicit origin + `credentials: true`, and Socket.io `withCredentials`.
- Never expose emails or the allowlist to non-admin clients (REST or socket).
- Same response body and similar timing for "unknown code" vs. "secured, unavailable".
- Server derives voter identity from cookie/token only; never trust client-supplied user IDs.
- Admin JWT stays in client storage for v1 (cookie migration is later hardening).
- Allowlist is checked on every secured entry, not just at OTP time.

**New `.env` variables:** `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, VOTER_JWT_SECRET, VOTER_SESSION_DAYS=7, OTP_TTL_MINUTES=10, CLIENT_ORIGIN, COOKIE_SECURE`.

---

## 13. Frontend Screens & Routes

| Route | Who | Purpose |
|---|---|---|
| `/` | all | Home with **"Enter session code"** box |
| `/join`, `/join/:code` | all | Resolve code, branch by type |
| `/verify` | secured | Email → OTP |
| `/profile` | secured | First-time name entry |
| `/sessions/:id/lobby` | joined | Lobby (+ pending-approval state) |
| `/sessions/:id/vote` | eligible | Ballot (all candidates) or matchup |
| `/sessions/:id/results` | per §9.3 | Winner, round-by-round, totals |
| `/history` | all | Completed public + published results |
| `/login` | admin | Admin login |
| `/admin` | admin | All sessions, create/manage, allowlist, approvals, tie decisions, publish toggle |
| `/sessions` | — | Public catalog removed → redirect to `/join` |

Register page rework: remove password, confirm-password, "Register As", and photo. It becomes the OTP + name profile flow (or is replaced by `/verify` + `/profile`). Admin login stays separate. Add a visible **Log out** for secured users.

Candidate UI: name + optional ≤ 80-char description. Single ballot shows all candidates (max 6) as cards. Tie state shows "Tie — rematch"; admin sees the two-button decision panel with a 30 s countdown.

---

## 14. Testing Strategy (test-first, Mocha)

For every phase: write failing tests → implement → run **both** full suites → verify `core.js` SHA-256 is unchanged.

Key test groups to add:

- **Code & discovery:** code generation (alphabet, length, uniqueness, collisions), resolver generic-404 parity, rate limiting, `/api/sessions` no longer lists live sessions, secured sessions absent from voter `sessions` broadcasts.
- **Mode selection:** 2–6 → single ballot, 7+ → tournament, boundary values (6/7), mode-specific timer ranges rejected server-side.
- **Engine:** `ballot.js` winner/tie, tie ladder (rematch → admin → 30 s auto coin flip), zero-vote replay then `no_result`, rematch-with-zero-votes, synthetic-increment tiebreak leaves the stored tally real.
- **Eligibility:** per-round snapshot immutability, disconnect grace (10 s), reconnect-then-vote, ghost voter no longer blocks early close, public late joiner eligible next round only.
- **OTP/accounts:** generation, hashing, expiry, single use, 5-attempt lock, cooldown, generic responses, cookie flags, 7-day expiry, logout.
- **Secured access:** listed vs. approval modes, allowlist normalization/dedup/line-numbered errors, lock at Start, removal drops lobby member, approval queue closes at Start, eligibility checked on every entry.
- **Privacy:** `VoteParticipation` stores no choice, duplicate secured vote blocked after simulated restart, emails never appear in voter-facing payloads, results visibility matrix (§9.3) including the publish toggle.
- **Results:** `rounds[]` persisted, totals/rounds-played derived correctly, resolution labels, "No result" rendering.

---

## 15. Build Phases (give the AI one phase at a time)

| Phase | Scope | Done when |
|---|---|---|
| **0. Cleanup** | Remove "Admin/Student/Faculty" from Register, add new `.env` vars, add `SINGLE_BALLOT_MAX` constant | Existing suites still green |
| **1. Session model** | Extend `Session` (type, mode, joinCode, whoCanJoin, candidateInfo, publish toggle, pending expiry), extended `CREATE_SESSION` validation, automatic mode selection, mode-specific timer ranges, 7-day expiry job | Create form + server validation tests pass |
| **2. Join code & discovery** | Code generator, `GET /api/join/:code`, `/join` UI, QR carries code, remove public `/sessions` listing, filter `sessions` broadcast | Code entry works for public sessions end-to-end |
| **3. Round history & results** | Append frozen snapshots to `Result.rounds`, totals derivation, round-by-round + totals UI | Winner reveal followed by full vote breakdown |
| **4. Single ballot & ties** | `ballot.js`, tie ladder, zero-vote replay/`no_result`, `RESOLVE_TIE`, tie admin panel + 30 s timeout, resolution labels | Every tie path covered by tests |
| **5. Eligibility & presence** | Per-round snapshot, presence map, 10 s grace, connected-only early close | Ghost voters no longer stall rounds |
| **6. Accounts & OTP** | `User`, `OtpChallenge`, Nodemailer + console fallback, OTP/profile/logout REST, `vs_voter` cookie, CORS credentials | Passwordless login works locally |
| **7. Secured sessions** | `SessionParticipant`, allowlist input/CSV, approval queue, admin lobby counts, lock at Start, socket cookie identity, `VoteParticipation` | Both "Who can join" modes work end-to-end |
| **8. Visibility & privacy** | Results visibility matrix, publish toggle, admin turnout view, secured results excluded from `/history` | Matrix in §9.3 fully tested |
| **9. Hardening & docs** | Rate limits, timing parity, accessibility, update README/ARCHITECTURE/API_CONTRACT/USER_MANUAL | All suites + lint + build green |

Phases 2–3 are independent of OTP and deliver visible progress on public sessions first. Phases 6–8 are the secured-voting core.

---

## 16. Assumed Defaults (NOT yet confirmed — change any you disagree with)

1. **Server restart mid-session:** keep existing recovery (an interrupted `open` session resets to `pending`); in-progress round data for that run is discarded, and voters rejoin. Secured `VoteParticipation` from the interrupted run is cleared with it.
2. **Rematch/replay that gets zero votes** counts as still tied → goes to the admin decision step.
3. **Tie reveal:** the reveal window shows the tied tally briefly labeled "Tie — rematch" before the rematch starts.
4. **Rematch and replay votes count** toward candidate totals.
5. **Code lifetime:** a code stops admitting new participants once the session is `completed`, `archived`, or `expired`; results remain viewable per §9.3.
6. **Public voter token** keeps the current mechanism (session-scoped, in-memory). Clearing cookies/re-joining can let a public voter vote again — accepted because public mode is deliberately "less secured."
7. **Secured lobby names** are the profile name (not editable per session).
8. **Rejected approval requests** may re-request only after the admin removes the rejection (no automatic retry).
9. **Admin can archive/cancel** a session at any time (existing `ARCHIVE_SESSION`).
10. **Hosting/deployment** is out of scope for this document.

---

## 17. Explicitly Out of Scope (v1)

Multiple admins · scheduled start/end times · asynchronous long-running polls · candidate photos · voter profile pictures · passwords for voters · social/SSO login · role labels (Student/Faculty) · moving the admin JWT to a cookie (future hardening) · ranked-choice or multi-select ballots.

---

## 18. One-Paragraph Summary (for the report/abstract)

VoteSphere is a live, real-time voting platform where a single administrator creates public or secured sessions, shared through a QR code or a short join code. Public sessions admit anyone with a display name; secured sessions require an email-verified, passwordless account and either a pre-approved email list or live admin approval. Voters gather in a lobby; the admin starts the session; and a server-authoritative Redux engine runs either a single ballot (2–6 candidates) or a pairwise elimination tournament (7+), with timed rounds, early close on full turnout, a deterministic tie ladder, and no-vote protection. Ballots are secret — the system records only that a user voted — and after the winner is revealed, participants can see round-by-round and total votes for every candidate, with secured results kept private unless the admin publishes them.
