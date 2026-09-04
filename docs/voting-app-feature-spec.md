# Full-Stack Real-Time Voting Application — Feature Expansion Spec
### (v2 — refined through requirements interview)

## Project Context

**Current Stack:** React, Redux, Node.js, Socket.io (WebSockets), Immutable.js, ES6, Babel, Webpack, Mocha (unit testing)

**Current Architecture:** Two separate but communicating applications:
- **Client** — React app serving a mobile-friendly voting interface and a live results display, connected to a Redux store
- **Server** — Node.js backend managing voting logic, using Redux for state management, with real-time bidirectional sync via Socket.io

**Current Behavior:** Users vote on entries compared in pairs; votes and results update live across all connected clients without a page refresh. Data is currently in-memory only (no persistence — state is lost on server restart) and there is no authentication or access control.

**Development methodology:** Test-first (Mocha-based unit tests should be written/updated alongside each feature).

**Goal of this spec:** Add features to the existing app without breaking the current real-time voting flow, implementing one feature at a time with tests.

---

## Key Architectural Decisions (from requirements interview)

These decisions shape every feature below and should not be re-litigated mid-implementation without updating this doc:

1. **Two-tier identity model, not one login system for everyone:**
   - **Admin** (exactly one, seeded via env var / seed script — no promotion/multi-admin flow) has a real account: username + email + password (bcrypt-hashed), authenticated via JWT.
   - **Voters** have no password at all. They join a specific session via a unique link or QR code the admin generates, enter only a **display name**, and get a random **session-scoped token in a cookie**. That hidden token — not the name — is what prevents double-voting. Duplicate display names across voters are allowed (cosmetic only).
   - Old-style fully anonymous voting (no identity at all) is removed entirely.
2. **JWT storage is phased:** build v1 with the token in client-side storage (simplest to build/debug), then migrate to an httpOnly cookie as a follow-up hardening pass.
3. **Session flow has a one-time lobby, not a per-round lobby:**
   - When a session is created, voters trickle in via the link/QR into a **waiting room**.
   - The admin manually clicks "Start" when ready — this closes the lobby, locks in the eligible-voter headcount, and starts Round 1.
   - From Round 2 onward, rounds auto-advance via the timer (no lobby). Anyone joining after Round 1 has started simply waits and is included starting from the next round.
4. **Round timers are admin-configurable per session** (default 30s), and a round **ends early** if every eligible voter (the headcount locked at lobby close) has voted before time runs out.
5. **Results visibility:** the live chart is **hidden while a round is open** and only revealed once the round closes, to avoid bandwagon effects on a pairwise vote.
6. **Database stores aggregate results only** (vote counts per entry, per session) — not who voted for what — consistent with the no-password voter model and simpler privacy story.
7. **History page is public** — anyone can browse past sessions and results, no login required.
8. **Chart type: bar chart** (better than pie for 2-way comparisons).

---

## Implementation Order & Dependencies

1. **Feature 1 — Two-Tier Authentication** (admin account + voter session-join flow; foundation for everything else)
2. **Feature 4 — Results History with Database** (introduces MongoDB/Mongoose before Admin Panel needs to persist sessions)
3. **Feature 3 — Admin Panel + Waiting Room** (depends on auth roles + database)
4. **Feature 2 — Timer-Based Voting** (extends existing Socket.io round logic; plugs into the lobby → Round 1 handoff from Feature 3)
5. **Feature 5 — Real-Time Results Chart** (front-end only; reads from the existing Redux store, safest to build last)

---

## Feature 1 — Two-Tier Authentication (Admin Login + Voter Session Join)

**Goal:** Give the single admin a real, secure account, and give voters a frictionless, identity-preserving way to join a specific session without registering.

**Admin side:**
- Admin account is created via a seed script / environment variables — no public admin registration endpoint
- Password hashed with `bcrypt`
- On login, server issues a JWT; client stores it in-memory/client-side for v1 (plan to migrate to an httpOnly cookie later)
- Server middleware verifies the admin's JWT before accepting any admin-only action

**Voter side:**
- Admin generates a unique join link / QR code per session
- Scanning/opening it takes the voter to a name-entry screen (no email or password field)
- Voter submits a display name only; server creates a session-scoped voter record and sets a random token in a cookie on their browser
- That cookie token — never the display name — is what the server checks to block a second vote from the same voter in a round
- Duplicate display names within the same session are allowed and not deduplicated

**Tech:** `jsonwebtoken`, `bcrypt` (admin only), MongoDB (admin + voter session records), `crypto`/`uuid` for voter session tokens

**Suggested data models:**
```
AdminUser {
  _id
  username (unique)
  email (unique)
  passwordHash
}

Voter {
  _id
  sessionId        // which voting session this voter joined
  displayName       // not unique
  sessionToken       // random, stored in voter's cookie
  joinedAt
}
```

**Acceptance criteria:**
- [ ] Admin cannot be created except via the seed process
- [ ] Admin actions (create session, start round, etc.) require a valid admin JWT
- [ ] Voter can join a session with just a display name, no password anywhere in that flow
- [ ] A voter's cookie token, not their name, is what blocks a duplicate vote
- [ ] Unit tests cover: admin password hashing, admin JWT verification (valid/expired/missing/tampered), voter join → token issuance, duplicate-name-allowed / duplicate-token-blocked vote attempts

---

## Feature 2 — Timer-Based Voting

**Goal:** Each round (after Round 1's lobby) has an admin-configurable countdown; the round ends when time runs out **or** when every eligible voter has voted, whichever comes first.

**Requirements:**
- Admin sets round duration when creating/configuring a session (default 30s)
- Server starts the countdown when a round begins and broadcasts the remaining time to all clients via Socket.io on a fixed interval (e.g. every 1s)
- Eligible-voter headcount for early-end checks is the count locked in when the lobby closed (see Feature 3) — it does not change mid-session
- Round ends the moment either the timer hits 0 **or** votes-cast reaches the eligible headcount
- On round end, server finalizes that round's tally and automatically starts the next round (Round 2 onward — no lobby, no admin click needed)
- A client reconnecting mid-round receives the correct time remaining, not a restarted timer

**Tech:** Node.js `setInterval`, existing Socket.io setup

**Acceptance criteria:**
- [ ] Countdown is synchronized (±1s) across all connected clients
- [ ] Round ends early the instant the eligible headcount has all voted, without waiting for the timer
- [ ] Round also ends correctly via timeout if not everyone votes
- [ ] Round 2+ auto-advances with no admin action
- [ ] A client joining mid-round receives correct remaining time
- [ ] Unit tests cover: timer start/stop, early-end-on-full-turnout logic, timeout-based auto-advance, reconnect mid-round

---

## Feature 3 — Admin Panel + Waiting Room

**Goal:** Give the admin a dashboard to create sessions, generate the join link/QR, manage the pre-Round-1 lobby, and control the session — while voters only ever see the join screen, the lobby, or the voting/results screens.

**Requirements:**
- Dashboard accessible only to the authenticated admin (protected route on client, JWT + role check on server)
- Admin creates a poll topic and adds entries dynamically (not hardcoded)
- Creating a session generates a unique join link and QR code for that session
- Voters who join before the admin starts Round 1 sit in a **waiting room** showing a live count of who's joined
- Admin clicks "Start" to close the lobby, lock the eligible-voter headcount, and begin Round 1
- After Round 1, rounds auto-advance per Feature 2 — admin can still manually end the whole session early if needed
- Voters who join after Round 1 has started skip the lobby and wait for the next round

**Tech:** React Router (protected routes), Redux (role-aware state), server-side JWT/role middleware, a QR code generation library (e.g. `qrcode`)

**Acceptance criteria:**
- [ ] Non-admin requests to admin-only endpoints are rejected server-side, not just hidden client-side
- [ ] Admin can create a poll with a topic and 2+ entries, and get back a working join link + QR code
- [ ] Waiting room shows joined voters in real time and does not start voting until the admin clicks "Start"
- [ ] Headcount locked at lobby close matches what Feature 2's early-end logic uses
- [ ] Late joiners after Round 1 land directly in the voting/spectator view, not the lobby
- [ ] Unit tests cover: session/poll creation validation, join-link/QR generation, lobby-to-Round-1 handoff, admin-only middleware rejection

---

## Feature 4 — Results History with Database

**Goal:** Persist voting sessions and their aggregate results so data survives server restarts, and let anyone browse past polls.

**Requirements:**
- MongoDB stores each session with its entries and **final aggregate vote counts** (no per-voter vote records)
- Results are saved automatically when a session ends
- A public History page/endpoint lists past sessions, newest first, with entries/vote counts/winner — no login required to view

**Tech:** MongoDB, Mongoose

**Suggested data model:**
```
Session {
  _id
  topic
  entries: [{ name, votes }]   // aggregate counts only
  winner
  startedAt
  endedAt
  createdBy (admin userId)
}
```

**Acceptance criteria:**
- [ ] Server restart no longer loses completed session data
- [ ] History page is reachable without logging in
- [ ] History page lists past sessions in reverse-chronological order with correct aggregate counts and winner
- [ ] No per-voter identifying data is persisted anywhere in session records
- [ ] Unit tests cover: session save-on-completion, history query/pagination, schema validation (aggregate-only shape)

---

## Feature 5 — Real-Time Results Chart

**Goal:** Show a live bar chart of the current round's results, but only once that round has closed — not while voting is still open.

**Requirements:**
- Bar chart (not pie) — appropriate for the pairwise, 2-entries-per-round format
- Chart is hidden/replaced with a "voting in progress" state while a round is open
- The moment a round ends (early or via timeout), the chart reveals and renders that round's final tally
- Built with Recharts or Chart.js, subscribed to the same Redux state that already drives the numeric results
- Chart updates automatically on the next round without a page refresh

**Tech:** Recharts or Chart.js

**Acceptance criteria:**
- [ ] Chart is not visible/renders a "hidden" state during an open round
- [ ] Chart appears and is accurate within one Redux state change of round close
- [ ] Chart numbers match the existing numeric results exactly (no drift)
- [ ] Component tests confirm the hidden→revealed transition and re-render on new round data

---

## Cross-Cutting Notes for the Agentic Dev Platform

- **Test-first:** Write/update Mocha unit tests before or alongside each feature, per the project's existing methodology.
- **Don't break existing real-time flow:** Pairwise voting + instant Socket.io updates must keep working after every feature. Regression-test after each one.
- **Build one feature at a time**, in the order above — each should be independently testable before starting the next.
- **Env/config:** MongoDB connection string, JWT secret, and admin seed credentials come from environment variables, never hardcoded.
- **JWT storage migration:** ship v1 with client-side token storage; track the httpOnly-cookie migration as a distinct follow-up task rather than blocking the rest of the features on it.
