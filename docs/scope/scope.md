# Scope: VoteSphere

A live, real-time voting platform for a single admin who creates public or secured sessions. Voters join by QR code or a short join code, wait in a lobby, and vote in server-authoritative timed rounds. Two voting modes: single ballot (2 to 6 candidates) and pairwise tournament (7+).

**Build approach:** Tracer Bullet (each phase adds one real, thin end-to-end strand through the full stack; nothing faked).
**Workflow:** Beta (after `/develop`: `/check verify` then `/test`; risky features tagged `· GA` get an additional fresh-model `/check review` and `/document`).

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

---

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Pairwise tournament engine | Existing | existing |
| B | Admin panel and session management | Existing | existing |
| C | Lobby and real-time headcount | Existing | existing |
| D | Timer and round lifecycle | Existing | existing |
| E | Duplicate-vote protection (public) | Existing | existing |
| F | MongoDB persistence and startup recovery | Existing | existing |
| G | History archive and Recharts results | Existing | existing |
| 1 | Cleanup and env bootstrap | Phase 0 | done |
| 2 | Session model extension | Phase 1 | done |
| 3 | Join code and discovery | Phase 2 | done |
| 4 | Round history and full results | Phase 3 | done |
| 5 | Single ballot mode and tie ladder | Phase 4 | done |
| 6 | Eligibility and presence | Phase 5 | done |
| 7 | Accounts and OTP | Phase 6 | done |
| 8 | Secured sessions | Phase 7 | done |
| 9 | Visibility and privacy | Phase 8 | done |
| 10 | Hardening and docs | Phase 9 | in-progress |
| 11 | Lobby existence gate | Phase 9 | done |

---

## Existing

### A. Pairwise tournament engine · existing
Server authoritative tournament math in `core.js` (protected), plus `roundManager.js` for the round lifecycle: `VOTING → ROUND_CLOSED → RESULTS_REVEALED → NEXT`, idempotent `closeRoundOnce`, monotonic round identity.
Code in `voting-server/src/core.js`, `voting-server/src/roundManager.js`

### B. Admin panel and session management · existing
Single seeded admin with bcrypt and JWT. Admin panel at `/admin`. Session creation, editing, archive modals. All lifecycle mutations travel over authenticated Socket.io actions.
Code in `voting-server/src/auth/admin.js`, `voting-server/src/server.js`, `voting-client/src/pages/`

### C. Lobby and real-time headcount · existing
Live lobby with headcount via `lobby_update`. Admin Start sends `START_SESSION`, auto-redirects joined voters from lobby to vote.
Code in `voting-server/src/server.js`, `voting-client/src/pages/`

### D. Timer and round lifecycle · existing
`TimerManager` for voting and reveal countdowns, early close on full turnout, reveal timer after close. Timers never run concurrently.
Code in `voting-server/src/timer.js`

### E. Duplicate-vote protection (public) · existing
Public voter token in cookie. Duplicate vote key `${sessionId}:::${sortedPair}:::${voterToken}`. Session-scoped in-memory voter registry.
Code in `voting-server/src/auth/voter.js`

### F. MongoDB persistence and startup recovery · existing
Store subscriber persistence, startup recovery of interrupted `open` sessions back to `pending`. `Session` and `Result` Mongoose schemas.
Code in `voting-server/src/db/`

### G. History archive and Recharts results · existing
Completed public sessions viewable at `/history`. Recharts pairwise chart. Tallies hidden during active rounds.
Code in `voting-client/src/components/results/`, `voting-server/src/db/repository.js`

---

## Phase 0: Cleanup

### 1. Cleanup and env bootstrap · done
Remove the non-functional "Admin / Student / Faculty" dropdown from `Register.jsx`, add all new `.env` variables, and define the `SINGLE_BALLOT_MAX = 6` constant. No behavior change; existing test suites stay green.
**Done when:** the Register form has no admin or role option; `.env.example` declares `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `VOTER_JWT_SECRET`, `VOTER_SESSION_DAYS`, `OTP_TTL_MINUTES`, `CLIENT_ORIGIN`, `COOKIE_SECURE`; `SINGLE_BALLOT_MAX` is defined; both suites pass.
- [x] `/develop cleanup and env bootstrap` · code in `voting-client/src/pages/Register.jsx`, `voting-server/src/constants.js`, `.env.example`

---

## Phase 1: Session Model

### 2. Session model extension · done
Extend the `Session` schema and `CREATE_SESSION` handler with session type (`public` or `secured`), voting mode (auto-derived from candidate count via `SINGLE_BALLOT_MAX`), `joinCode` (generated, unique), `whoCanJoin`, `candidateInfo` (name + description up to 80 chars), mode-specific timer ranges, `publishResultsPublicly`, and 7-day pending expiry. The create-session form shows a live mode note.
**Done when:** a session created with 2 to 6 candidates is stored as `single_ballot`; 7+ as `tournament`; timer out-of-range is rejected server side; `pendingExpiresAt` is set; the create form shows the live mode note; existing suites pass.
spec [0001](../specs/0001-session-model-extension/index.md) · code in `voting-server/src/db/models/Session.js`, `voting-server/src/server.js`, `voting-client/src/pages/Admin.jsx`
- [x] Design it (spec): `/architect session model extension`
- [x] Build it: `/develop session model extension`
  - [x] `joinCode` generator + Session schema migration (AC-1, AC-2, AC-4)
  - [x] `CREATE_SESSION` ingress validation + derivations (AC-1, AC-2, AC-3, AC-7)
  - [x] Reducer extension + sessions broadcast update (AC-6)
  - [x] Admin form live mode note + client constants (AC-5)
  - [x] Bootstrap compat + both suites green (AC-7, AC-8)
- [x] Verify it: `/check verify session model extension`
- [x] Test it: `/test session model extension`

---

## Phase 2: Join Code and Discovery

### 3. Join code and discovery · done
Generate a 6-character join code (alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`) for every session. Add `GET /api/join/:code` with a generic 404 for unknown, expired, archived, and secured sessions. Add a `/join` page with a code entry box on the home page. QR codes encode the join link. Remove the public session listing at `/sessions` (redirect to `/join`). Filter secured sessions from the voter-facing `sessions` broadcast.
**Done when:** typing a valid 6-character code resolves to the session; an invalid or expired code returns the same 404; the public `/sessions` page is gone; secured sessions do not appear in voter socket broadcasts; rate-limit of 30 req/min/IP is enforced on the resolver; tests for code generation alphabet and collision handling pass.
spec [0002](../specs/0002-join-code-and-discovery.md) · code in `voting-server/src/server.js`, `voting-server/src/reducer.js`, `voting-client/src/pages/Join.jsx`, `voting-client/src/pages/Admin.jsx`
- [x] Design it (spec): `/architect join code and discovery`
- [x] Build it: `/develop join code and discovery`
  - [x] Server resolver endpoint and rate limiter (AC-1, AC-7)
  - [x] Secured session broadcast filter and `REFRESH_JOIN_CODE` action (AC-8, AC-9)
  - [x] Client `/join` page, route wiring, retire `/sessions`, update home and QR (AC-2, AC-3, AC-4, AC-5, AC-6)
  - [x] Admin Refresh Code button (AC-9)
  - [x] Test suite: resolver, code generation, rate limiter (AC-10)
- [x] Verify it: `/check verify join code and discovery`
- [x] Test it: `/test join code and discovery`

---

## Phase 3: Round History and Full Results

### 4. Round history and full results · done
After each round closes, append a frozen snapshot to `Result.rounds[]` with `roundIndex`, `kind`, `candidates`, `tally`, `totalVotes`, `closedAt`, `resolution`, and `advanced`. Extend the results page to show round-by-round matchups with per-candidate vote counts and a totals panel (total votes per candidate plus rounds played). Tallies stay hidden during an active round.
**Done when:** the `rounds[]` array is persisted; the results page renders every round and the totals panel; the resolution label shows how each round was settled; tallies are invisible during `VOTING`; tests confirm `rounds[]` persistence and totals derivation.
spec [0003](../specs/0003-round-history-and-results.md) · code in `voting-server/src/db/models/Result.js`, `voting-server/src/reducer.js`, `voting-server/src/server.js`, `voting-client/src/components/results/`
- [x] Design it (spec): `/architect round history and full results`
- [x] Build it: `/develop round history and full results`
  - [x] Result schema + round persistence + persistCompletedResult update (AC-2)
  - [x] APPEND_ROUND_RESULT reducer, server dispatch, and broadcast guard (AC-1, AC-3, AC-9)
  - [x] Client state, selectors, totals derivation, and accordion timeline + totals panel (AC-4, AC-5, AC-6)
  - [x] REST endpoint, history detail page, and recovery (AC-7, AC-8)
- [x] Verify it: `/check verify round history and full results`
- [x] Test it: `/test round history and full results`
- [x] Review it: `/check review round history and full results`

---

## Phase 4: Single Ballot Mode and Tie Ladder

### 5. Single ballot mode and tie ladder · done
Build `ballot.js` (new pure module beside `core.js`) for 2 to 6 candidate sessions. Implement the full tie ladder: first tie triggers an automatic rematch (runoff for single ballot); if still tied, broadcast `tie_pending` to admin with a 30-second countdown; admin can Pick winner or Coin flip; no response in 30 s triggers an automatic server coin flip. Zero-vote round: replay once with a fresh timer; second zero ends the session as `no_result`. Every round records its resolution method. Admin sees a two-button panel with countdown.
**Done when:** every tie path (rematch, admin decision, auto coin flip) is covered by tests; zero-vote replay and `no_result` path pass; `ballot.js` is a new module and `core.js` SHA-256 is unchanged; the admin tie panel renders with the 30 s countdown.
spec [0004](../specs/0004-single-ballot-and-tie-ladder.md) · code in `voting-server/src/ballot.js`, `voting-server/src/roundManager.js`, `voting-server/src/timer.js`, `voting-server/src/reducer.js`, `voting-client/src/`
- [x] Design it (spec): `/architect single ballot mode and tie ladder`
- [x] Build it: `/develop single ballot mode and tie ladder`
  - [x] Pure `ballot.js` module, single ballot mode initialization, and multi-candidate vote reducer (AC-1, AC-2, AC-3)
  - [x] Zero-vote replay and terminal `no_result` closure in `roundManager.js` (AC-4)
  - [x] First tie ladder: single ballot runoff and pairwise immediate rematch (AC-5)
  - [x] Second tie ladder: `TIE_PENDING` lifecycle, 30 s timer, `RESOLVE_TIE` admin action, and auto coin flip (AC-6, AC-7, AC-8, AC-9)
  - [x] Client UI: multi-candidate grid, admin tie resolution panel, and round history resolution badges (AC-2, AC-6, AC-7, AC-10)
- [x] Verify it: `/check verify single ballot mode and tie ladder`
- [x] Test it: `/test single ballot mode and tie ladder`
- [x] Review it (fresh model): `/check review single ballot mode and tie ladder`
- [x] Document it: `/document single ballot mode and tie ladder`

---

## Phase 5: Eligibility and Presence

### 6. Eligibility and presence · done
Build a presence map `sessionId → voterKey → { socketIds, lastSeenAt }` updated on connect and disconnect. At the start of each round the server snapshots the eligible connected voter set; that set does not change until the next round. A voter disconnected more than 10 seconds is excluded from the early-close check; if they reconnect before close, their vote still counts. Ghost voters no longer inflate the "everyone voted" count. Public late joiners are eligible from the next round only.
**Done when:** per-round snapshot is immutable after round start; a voter disconnected more than 10 s does not block early close; a voter who reconnects before close can vote and their vote counts; public late joiners cannot trigger early close for the current round; ghost voter tests pass.
spec [0005](../specs/0005-eligibility-and-presence.md) · code in `voting-server/src/reducer.js`, `voting-server/src/server.js`, `voting-server/src/roundManager.js`, `voting-client/src/`
- [x] Design it (spec): `/architect eligibility and presence` (revised 2026-09-27: snapshot-relative quorum AC-6, snapshot ordering rules AC-9, serializer enforcement AC-10)
- [x] Behavioral pin (failing-first, pre-build): `voting-server/test/grace_window_tie_ladder_spec.js` — 14 headless tests locking the AC-6/AC-9 grace window × tie ladder contract (zero-vote replays, runoffs/rematches, `TIE_PENDING`, 2-voter sessions). 7 red until the snapshot-relative quorum and ordering rules land; the other 7 pin behavior that must survive implementation unchanged.
  - Finding: `canCompleteEarly` is a gate while `closeRoundOnce` executes unconditionally, so the implementation must make the executor presence-aware (or prove every call site gates first). The injection seam `canCompleteEarly({ sessionId, roundId, presence, snapshot, now, graceMs })` is part of the pinned contract.
- [x] Build it: `/develop eligibility and presence`
  - [x] Redux presence reducers and snapshot state in reducer.js (AC-1, AC-2, AC-3)
  - [x] Transport level socket reverse index, connect and disconnect handlers, and sanitized broadcasts in server.js (AC-2, AC-8)
  - [x] Round snapshot integration at round start and active voter evaluation in roundManager.js (AC-1, AC-3, AC-4, AC-5, AC-6, AC-7)
  - [x] Client Redux presence state and active voter UI badge in lobby and arena header (AC-8)
- [x] Verify it: `/check verify eligibility and presence`
- [x] Test it: `/test eligibility and presence`
- [x] Review it: `/check review eligibility and presence` (2026-09-28 review addressed: Blockers and Majors resolved, snapshot dispatch, client presence, live early close, fallback synthesis deletion, and AC-7 guard verified)

---

## Phase 6: Accounts and OTP

### 7. Accounts and OTP · GA · done
Add `User` (email, name, timestamps) and `OtpChallenge` (email, codeHash, expiresAt, attempts, lastSentAt, consumedAt with TTL index) Mongoose models. Wire Nodemailer with Gmail SMTP; if SMTP is not configured, log the OTP to the server console instead. REST endpoints: `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`, `POST /api/auth/profile`, `GET /api/auth/voter/me`, `POST /api/auth/logout`. Issue a signed `vs_voter` cookie: `httpOnly`, `SameSite=Lax`, 7-day TTL. Enable CORS with `credentials: true` for the client origin. OTP: 6 digits, 10-minute TTL, hashed at rest, single use, 5 wrong attempts locks the challenge, 60 s resend cooldown, generic response that never reveals email eligibility. Add a visible Log out button.
**Done when:** passwordless login works locally end-to-end (request OTP, verify, set profile, cookie set); cookie has correct flags; logout clears cookie; 5-attempt lock, cooldown, and single-use enforcement are tested; OTP never appears in a response body; SMTP fallback logs to console; existing suites pass.
spec [0006](../specs/0006-accounts-and-otp/index.md) · code in `voting-server/src/auth/`, `voting-server/src/email/`, `voting-server/src/db/models/`, `voting-server/src/server.js`, `voting-client/src/`
- [x] Design it (spec): `/architect accounts and OTP`
- [x] Build it: `/develop accounts and OTP`
  - [x] Mongoose models, OTP service, and Nodemailer transport (AC-1, AC-3, AC-6, AC-14)
  - [x] OTP request/verify endpoints with cookie issuance and CORS (AC-1, AC-2, AC-4, AC-5, AC-7, AC-11)
  - [x] Voter /me, profile, logout endpoints (AC-8, AC-9, AC-10)
  - [x] Session join integration for signed in voters (AC-12, AC-13)
  - [x] Client register, login pages, auth state, and navbar (AC-15, AC-16, AC-17)
- [x] Verify it: `/check verify accounts and OTP`
- [x] Test it: `/test accounts and OTP`
- [x] Review it (fresh model): `/check review accounts and OTP` (2026-09-29 review blockers, majors, and minors resolved: socket identity trust, failed email delivery, cooldown ordering, voter secret validation, outer error handling, fallback username collision retry, safe regex escaping, cooldown countdown UI, and join displayNameSource signaling fixed and regression tested; see docs/reviews/2026-09-29-develop1-accounts-and-otp.md)
- [x] Document it: `/document accounts and OTP`

---

## Phase 7: Secured Sessions

### 8. Secured sessions · GA · done
Add `SessionParticipant` (sessionId, email, userId, status, joinedAt, decidedAt) and `VoteParticipation` (sessionId, roundId, userId; stores only that a vote happened, never the choice) Mongoose models. Implement both "Who can join" modes: Listed emails only (allowlist CSV with line-numbered validation, locked at Start, server-side eligibility check on every entry) and Anyone with the code, admin approves (pending queue, approve/reject controls, queue closes at Start). Socket identity on lobby and vote sockets comes from the `vs_voter` handshake cookie only. Admin lobby view shows allowlisted/joined/pending counts. New socket actions: `SET_ALLOWLIST`, `APPROVE_PARTICIPANT`, `REJECT_PARTICIPANT`, `REMOVE_PARTICIPANT`. Secured users bypass OTP on a valid cookie but eligibility is rechecked for each session.
**Done when:** both "Who can join" modes work end-to-end; removing an email in lobby drops that person immediately; the pending queue closes at Start; `VoteParticipation` stores no vote choice; duplicate secured vote is blocked after a simulated restart; emails never appear in voter-facing payloads; existing suites pass.
spec [0007](../specs/0007-secured-sessions/index.md) · code in `voting-server/src/db/models/`, `voting-server/src/server.js`, `voting-server/src/auth/`, `voting-client/src/`
- [x] Design it (spec): `/architect secured sessions`
- [x] Build it: `/develop secured sessions`
  - [x] Mongoose models, ingress validation, and join resolver (AC-1, AC-9, AC-12)
  - [x] Allowlist and approval join gating, actions, and auto-reject (AC-3, AC-4, AC-5, AC-6, AC-8, AC-15)
  - [x] Participant management (SET_WHO_CAN_JOIN, REMOVE_PARTICIPANT, session_participants) (AC-2, AC-7, AC-10, AC-11, AC-14)
  - [x] VoteParticipation audit trail, vote flow integration, and client secured UI (AC-11, AC-12, AC-13, AC-15, AC-16)
- [x] Verify it: `/check verify secured sessions`
- [x] Test it: `/test secured sessions`
  - [x] 2026-10-05 pass: `voting-server/test/voter_revocation_unit_spec.js` is new and pins `revokeSessionVoter` and `revokeSessionVoters` at the module level, which the socket level spec could only reach indirectly: the cross session guard, the `tokensBySession` shortcut hole the helper exists to close, the anonymous token skip, whitespace trimming, and idempotence (AC-3, AC-8)
  - [x] `voting-server/test/reducer_spec.js` gained the `SET_PUBLISH_RESULTS` reducer guards: a non boolean flag, a missing or unknown session, the `electionId` alias, an archived session, and no mutation of the state it was handed (AC-3)
  - [x] `voting-server/test/db_models_spec.js` gained the `Result.type` and `publishResultsPublicly` defaults, the enum rejection of an unknown type, and the compound index the archive query leans on (AC-9)
- [x] Review it (fresh model): `/check review secured sessions`
- [x] Document it: `/document secured sessions`

---

## Phase 8: Visibility and Privacy

### 9. Visibility and privacy · GA · done
Enforce the results visibility matrix: public session results are visible to all; secured session results are visible only to approved participants (signed in) and the admin; `GET /api/sessions/history` returns public sessions and published secured results only. Add the admin per-session Publish results publicly toggle (`SET_PUBLISH_RESULTS` socket action). Admin can see per-round turnout (who voted per round, not for whom) in the admin panel. Ensure emails and allowlists never reach voter-facing REST or socket payloads at any point.
**Done when:** the visibility matrix is fully tested; the publish toggle flips a secured result into `/history`; an unpublished secured result is absent from `/history`; per-round turnout is visible only to the admin; no voter-facing payload contains an email.
spec [0008](../specs/0008-visibility-and-privacy/index.md)
- [x] Design it (spec): `/architect visibility and privacy`
- [x] Build it: `/develop visibility and privacy`
  - [x] Result schema fields, the completion write, the backfill, and the create form cleanup (AC-9, AC-11)
  - [x] Shared visibility resolver and the read gates over history, result, rounds, and lobby (AC-1, AC-2, AC-4, AC-5, AC-6)
  - [x] `SET_PUBLISH_RESULTS` action, reducer case, and store update (AC-3)
  - [x] Admin turnout view over REST and socket (AC-7, AC-8)
  - [x] Client publish toggle, turnout panel, gated states, and the payload leak guard (AC-12, AC-10, AC-13)
  - code in `voting-server/src/server.js`, `voting-server/src/db/models/Result.js`, `voting-server/src/db/repository.js`, `voting-server/src/reducer.js`, `voting-client/src/pages/Results.jsx`, `voting-client/src/pages/History.jsx`, `voting-client/src/redux/voteSlice.js`
- [x] Verify it: `/check verify visibility and privacy`
- [x] Test it: `/test visibility and privacy`
  - [x] Server gaps closed in `voting-server/test/visibility_and_privacy_spec.js`: public flag off, lobby winner, approval mode eligibility, 404 parity with a missing result, `VALIDATION_ERROR` and `SESSION_NOT_FOUND`, Session and Result drift both directions, published rounds, history membership, signed in outsider on a live session, live turnout from the round manager, the anonymous vote refusal, the turnout admin gate, the completion write, and the archive round trip (a legacy public row reappears only once the backfill gives it a type, while a legacy secured row does not) (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10)
  - [x] Client component tests in `voting-client/test/results_visibility.test.jsx` for the gated panel, the admin toggle and turnout panel, the acknowledgement driven publish toggle, the public session copy, and the non admin view (AC-1, AC-3, AC-7, AC-8, AC-10, AC-12)
  - [x] Create form has no publish control in `voting-client/test/admin_roster_resubscribe.test.jsx` (AC-11)
  - [x] 2026-10-05 pass: `voting-server/test/visibility_matrix_unit_spec.js` is new and pins the five exported helpers in `src/server.js` directly, so the matrix no longer depends on an end to end caller reaching each branch: `filterSessionsForCaller`, `getAdminTokenFromRequest`, `getSocketSessionsSummary` across all three admin token sources, `isApprovedParticipant` including the fail closed lookup, and `resolveResultVisibility` across every viewer kind (AC-1, AC-2, AC-4, AC-6)
  - [x] `voting-server/test/visibility_and_privacy_spec.js` gained the completion write precedence (the persisted `Session` row wins over the live store copy), both fall back branches when no publish switch is named anywhere, the rewrite of the visibility fields when a partial row is completed, and the `no_result` completion in `roundManager.js`, which had no coverage at all (AC-1, AC-2, AC-5, AC-9)
  - [x] Client: `voting-client/test/results_visibility.test.jsx` gained the archive type badge cases, including that the badge reads the same for the admin, an anonymous caller and a signed in participant. That is the automated half of the "vary the viewer" step the `/check verify` record left open, and `voting-client/test/visibility_privacy_client_spec.js` gained the anonymous read sending no `Authorization` header, the rounds read carrying the same headers as the result read, and the turnout subscription guards (AC-4, AC-7, AC-9, AC-10)
- [x] Review it (fresh model): `/check review visibility and privacy`
- [x] Document it: `/document visibility and privacy`
  - Changelog entry appended to `docs/CHANGELOG.md` (Phase 8: Visibility and Privacy, spec 0008)

---

## Phase 9: Hardening and Docs

### 10. Hardening and docs · in-progress
Add rate limits on `POST /api/auth/otp/request` (5 req/hour/email, 20/hour/IP) and `GET /api/join/:code` (30/min/IP). Enforce timing parity on OTP and join-code responses so guessing yields no timing signal. Accessibility pass (WCAG 2.1 AA on voting and lobby screens). Update `README`, `ARCHITECTURE.md`, `API_CONTRACT.md`, and `USER_MANUAL.md` for v2. Run all suites, lint, and build.
**Done when:** rate limits are enforced and tested; OTP and join code responses have similar timing; axe reports no critical accessibility violations on voting screens; all suites pass; lint and build are green.
- [x] Build it: `/develop hardening and docs`
  - [x] Shared fixed window limiter, OTP request ceilings (5/hour/email, 20/hour/IP) enforced before any database work, `429` with `Retry-After` (AC-1)
  - [x] Response timing floor on the OTP request and join resolver paths, with the join resolver moved onto the shared limiter unchanged (AC-1, AC-2)
  - [x] axe audit of the voting arena, join prompt, and four lobby states, plus the join alert role and the navbar nested control fix (AC-3)
  - [x] `README`, `ARCHITECTURE.md`, `API_CONTRACT.md`, `USER_MANUAL.md`, `CHANGELOG.md`, and `.env.example` updated for v2 (AC-4, AC-5)
  - [x] Full server and client suites, client lint, and production build green (AC-4, AC-5)
  - code in `voting-server/src/utils/rateLimit.js`, `voting-server/src/utils/timing.js`, `voting-server/src/server.js`, `voting-client/test/a11y_voting_and_lobby.test.jsx`, `voting-client/src/pages/Voting.jsx`, `voting-client/src/components/layout/Navbar.jsx`
- [x] Verify it: `/check verify hardening and docs` (2026-10-06 runtime pass: all three ceilings hit live over HTTP with `Retry-After`, timing parity measured at 10 samples per class, axe clean in a real browser on lobby and vote screens, server 799 and client 468 plus 127 green, lint and build exit 0)
- [x] Test it: `/test hardening and docs` (2026-10-07: 14 tests added, 9 in a new navbar a11y suite closing the untested Navbar nesting fix and logout flows, 5 unit edges for the rate limit and timing modules. Server 804 passing, client 468 unit plus 136 component passing, lint clean, all exit 0)

### 11. Lobby existence gate · from spec 0008 · done
Gate `GET /api/sessions/:id/lobby` so a secured session the caller may not read answers the same `404`, with the same body, that an unknown session id answers, and replace the client "Session Not Found" panel with one neutral not available state carrying a sign in prompt. Closes the last voter facing surface where holding a session id still confirmed that a gated secured session exists.
**Done when:** an anonymous caller and a signed in non participant both get the unknown id `404` body from the lobby of an unpublished secured session; the admin and an approved participant still get `200` with full metadata; a public session lobby read is unchanged; the client renders identical neutral copy for a missing session and a gated one, and that copy never claims the session does not exist.
spec [0008](../specs/0008-visibility-and-privacy/index.md) (amendment of 2026-10-04, AC-14 and AC-15)
- [x] Design it (spec): `/architect visibility and privacy`
- [x] Build it: `/develop lobby existence gate`
  - [x] Lobby read gate: run the shared resolver on both the in memory and the database path, and answer a gated secured session with the unknown id body (AC-14)
  - [x] Client lobby fetch credentials, plus the neutral not available state that replaces the Session Not Found panel and its discovery link (AC-14, AC-15)
  - [x] Tests: the secured lobby case rewritten in `voting-server/test/visibility_and_privacy_spec.js` as a deliberate contract change, a client neutral state case, and the public session lobby read left unchanged (AC-14, AC-15, AC-13)
  - code in `voting-server/src/server.js`, `voting-client/src/pages/Lobby.jsx`, `voting-server/test/visibility_and_privacy_spec.js`, `voting-client/test/lobby_secured.test.jsx`
  - Note: the unknown session message no longer echoes the requested id (`Session was not found.`). Echoing it made byte identical bodies impossible across two different ids, which AC-14 requires.
- [x] Verify it: `/check verify lobby existence gate` (2026-10-05 runtime pass: four caller kinds over REST and in a real browser, the publish flag flipped open and closed again, the public lobby unchanged, both suites and lint and build green, zero server or client errors)
- [x] Test it: `/test lobby existence gate` (2026-10-05: 8 tests added in the two existing spec files, closing the approval mode and forged credential gaps on the server plus accessibility coverage of the neutral state. Server 701 passing, client 456 unit plus 82 component passing, lint clean, all exit 0)

---

## Deferred

Out of scope for v1, kept so the plan stays honest.

- **Multiple admins**: multi-admin with role management.
- **Scheduled sessions**: schedule start and end times; async long-running polls.
- **Admin JWT cookie migration**: move admin JWT from client storage to an httpOnly cookie (future hardening).
- **Candidate photos and voter avatars**: media upload and display.
- **Social and SSO login**: OAuth providers for voter auth.
- **Ranked-choice or multi-select ballots**: alternative ballot types.
- **Deployment and hosting**: infrastructure, CI/CD, production config.
- **Turnout CSV export**: delivered in Phase 8 as a browser side export (`buildTurnoutCsv` plus a Download CSV button inside the admin gated turnout panel). Removed from this list.

---

## Legend

**The decision box.** Every feature carries exactly one, the sub-task whose label ends with `(spec)`. Skills locate it by that `(spec)` suffix. Every other box is an execution box.

**Feature lifecycle**:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | `/architect` at spec capture | `Design it` ticked; spec linked; `Build it: /develop <feature>` + 2 to 5 milestones; tier closing boxes |
| `in-progress` (building) | `/develop` | milestone sub-boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | you, when you decide it is | Beta: last required stage is `/test` |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; the tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here.**
- **Status**: `planned` → `in-progress` → `done`, plus `existing` (pre-workflow) and `dropped` (de-scoped, kept for history).
- **Workflow tier tag** (`· GA`) beside a heading sets that feature above the Beta default: adds `/check review` then `/document` after `/test`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
