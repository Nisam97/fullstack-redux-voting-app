# 0002. Join Code and Discovery

**Date**: 2026-09-23
**Status**: Accepted

## Summary

Phase 1 added a `joinCode` field to every session. Phase 2 makes it the sole voter entry point. A voter types or scans a 6-character code, the server resolves it to a session and redirects them to the lobby, and the old public session list is retired. Secured sessions are hidden from voter-facing socket broadcasts so they cannot be discovered without a code. An admin can rotate any session''s code at any time using a new socket action.

## Context

Today voters reach sessions by browsing the public `/sessions` list, which exposes every active session title to anyone who loads the page. This breaks the intended privacy model for secured sessions and makes it impossible to give voters a controlled join flow. The `joinCode` field was added in Phase 1 precisely to support a code-first entry model; Phase 2 wires the resolver, the join page, and the admin tooling needed to complete the flow.

Three forces shape the design. First, the server uses raw Node `http`, not Express, so middleware libraries that require Express cannot plug in. Second, the existing `getSessionsSummary` broadcast is the only voter-facing session discovery surface; filtering it at that point is sufficient to hide secured sessions. Third, `generateJoinCode` and `getUniqueJoinCode` already exist in `voting-server/src/utils/joinCode.js` and `server.js`; the code generation alphabet, length, and collision retry loop are already production grade and must be reused exactly.

The consequence of not acting is that Phase 3 onward (secured sessions, eligibility, accounts) has no coherent entry point and secured session titles continue leaking to unauthenticated clients.

## Requirements

**User stories**:
- As a voter, I want to type or scan a 6-character code so that I land in the right session lobby without needing to browse a list.
- As a voter scanning a QR code, I want it to auto-resolve and drop me into the lobby so that there is no extra step.
- As an admin, I want to rotate a session''s join code so that a leaked code stops working immediately.
- As a voter trying an invalid code, I want a clear message that does not reveal whether the session exists or is secured.

**Acceptance criteria** (the contract):
- **AC-1**: `GET /api/join/:code` resolves a 6-character code (normalized to uppercase, non-alphanumeric characters stripped) against sessions whose status is `pending` or `open`. On success it returns HTTP 200 with `{ sessionId, name, status, sessionType, votingMode }`. For any other outcome (unknown code, wrong status, expired by `pendingExpiresAt`, archived, or `sessionType === ''secured''`) it returns HTTP 404 with `{ error: "Code not found or no longer active." }`. If MongoDB is unreachable when the resolver is called, the endpoint returns HTTP 503 with `{ error: "Service temporarily unavailable." }` rather than propagating an unhandled error.
- **AC-2**: The `/join` page renders a 6-character code entry field with an inline error display area. The Join button is disabled until exactly 6 characters are entered. On a successful resolve it redirects the browser to `/sessions/:id/lobby` without a full page reload.
- **AC-3**: The `/join/:code` URL (e.g. `https://<origin>/join/ABC123`) auto-resolves on page load: the code is taken from the URL parameter, the resolver is called immediately, and the voter is redirected to the lobby on success or shown the inline error on failure.
- **AC-4**: The `/sessions` route (no session id, the public session list page) is removed. Any navigation to `/sessions` (without a path segment following it) redirects to `/join`.
- **AC-5**: The home page links to `/join` as the primary voter entry point instead of `/sessions`.
- **AC-6**: QR codes in the admin lobby encode `<origin>/join/<code>` using the existing `qrcode` package. The origin is derived from `window.location.origin` on the client. Scanning the QR code takes the voter to `/join/:code` which auto-resolves per AC-3.
- **AC-7**: `GET /api/join/:code` enforces a rate limit of 30 requests per minute per IP address using a hand-rolled in-memory fixed-window counter keyed by `req.socket.remoteAddress`. Requests that exceed the limit return HTTP 429 with `{ error: "Too many requests, please wait." }`.
- **AC-8**: The voter-facing `sessions` socket broadcast omits sessions where `type === ''secured''`. Admin socket connections are unaffected.
- **AC-9**: A new `REFRESH_JOIN_CODE` socket action, guarded by admin JWT in `ADMIN_ACTION_TYPES`, regenerates a session''s join code using the existing `getUniqueJoinCode` retry loop (up to 10 attempts; `action_error` on exhaustion), persists the new code to MongoDB via the Session model, updates the Immutable store via the reducer, and re-emits the updated session list. The old code returns 404 immediately after the update. A Refresh Code button is visible in the admin panel for each session.
- **AC-10**: Tests for `generateJoinCode` confirm no character outside `ABCDEFGHJKMNPQRSTUVWXYZ23456789` is produced and that 10,000 generated codes all have length 6. A collision-handling test confirms the retry loop skips a colliding candidate and returns a unique code.

## Options considered

### Option 1: REST resolver only (no socket action for code refresh)

Add `GET /api/join/:code` and manage code rotation through a REST endpoint with admin JWT in the Authorization header.

**Pros**:
- REST is stateless and easy to test in isolation.

**Cons**:
- Inconsistent with the rest of the admin surface, which uses authenticated socket actions exclusively for lifecycle mutations. A second auth pattern means two places to audit.
- No push of the updated session list after rotation without polling.

### Option 2: REST resolver plus socket action for refresh (chosen)

`GET /api/join/:code` as a public REST endpoint. `REFRESH_JOIN_CODE` as a new entry in `ADMIN_ACTION_TYPES` dispatched over the existing authenticated socket action pipeline.

**Pros**:
- Consistent with the existing admin action pattern; the ingress guard enforces auth automatically.
- After rotation the store update triggers the existing sessions re-broadcast, so connected admin clients see the new code without polling.
- No new auth code path; `ADMIN_ACTION_TYPES` is the single source of truth.

**Cons**:
- Mixes transports (REST resolver, socket mutation) for one feature; a reader must understand both to trace the full flow.

### Option 3: Socket-only (resolver also over socket)

Run the join code resolver as a socket event rather than a REST call.

**Pros**:
- Single transport, simpler mental model.

**Cons**:
- The join flow starts before the voter has a session socket connection. A REST call is the right tool for a single-request lookup that precedes registration; forcing a socket connection first adds a round trip and complicates deep linking from QR codes.

## Decision

**Chosen option**: Option 2: REST resolver plus socket action for refresh.

Add `GET /api/join/:code` as a public REST endpoint and `REFRESH_JOIN_CODE` as a new entry in `ADMIN_ACTION_TYPES` following the existing authenticated socket action pattern.

**Implementation skills**: `model-redux-state/build-slices-and-selectors` (`reduxjs/redux-toolkit`, `.agents/skills/model-redux-state-build-slices-and-selectors/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.agents/skills/vercel-react-best-practices/`)

## Rationale

Option 2 respects the existing architecture contract (REST for reads, authenticated socket actions for admin mutations) rather than inventing a third pattern. The ingress guard in `server.js` is the project''s auth enforcement point for admin mutations; adding `REFRESH_JOIN_CODE` to `ADMIN_ACTION_TYPES` costs one line and inherits all existing protections. Option 1''s REST-only refresh breaks the invariant stated in AGENTS.md that lifecycle mutations travel over socket. Option 3''s socket-only resolver requires a live socket before the voter joins any session, which defeats deep linking from QR codes.

The hand-rolled in-memory rate limiter is the right call. The server is raw Node `http` with no middleware layer; `express-rate-limit` cannot plug in. `rate-limiter-flexible` with an in-memory backend works but is a heavier dependency than needed: 30 req/min/IP is a simple fixed-window counter in under 20 lines. The in-memory map resets on server restart; that is acceptable for Phase 2 and noted as a Phase 9 follow-up.

## Feature design

**Data model sketch**:

No schema migration. The `Session` document already carries all required fields from Phase 1:
- `joinCode` (String, unique index, 6 chars, required): set at `CREATE_SESSION`, read by the resolver.
- `type` (String, `public` or `secured`): filters the voter broadcast and rejects secured codes.
- `status` (String): gates the resolver on `pending` or `open`.
- `pendingExpiresAt` (Date): checked by the resolver; past this date returns 404.

`REFRESH_JOIN_CODE` overwrites `joinCode` in place on both the Mongoose document and the Immutable store.

**State transitions**:

`REFRESH_JOIN_CODE` is valid for any session not in a terminal state (`archived`, `done`). No state check beyond what the ingress guard provides is needed in Phase 2.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/join/:code` | GET | `code` (URL param, normalized to uppercase) | `{ sessionId, name, status, sessionType, votingMode }` | None (public) | 404 code not found or not active; 429 rate limit exceeded |
| Socket `action`, type `REFRESH_JOIN_CODE` | Socket | `{ type: ''REFRESH_JOIN_CODE'', sessionId }` | Sessions re-broadcast via `sessions` event | Admin JWT | `action_error UNAUTHORIZED`; `action_error` on 10 collision retries |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `GET /api/join/:code` | `sessionId` | `Session.findOne({ joinCode: normalizedCode, status: { $in: [''pending'',''open''] } }).lean()` |
| `GET /api/join/:code` | `name` | Same DB query, `title` field |
| `GET /api/join/:code` | `status` | Same DB query, `status` field |
| `GET /api/join/:code` | `sessionType` | Same DB query, `type` field |
| `GET /api/join/:code` | `votingMode` | Same DB query, `votingMode` field |
| `GET /api/join/:code` | 404 (expired) | `pendingExpiresAt` field compared to `Date.now()` |
| `GET /api/join/:code` | 404 (secured) | `type === ''secured''` check on the DB doc |
| `REFRESH_JOIN_CODE` | new `joinCode` | `getUniqueJoinCode()` (existing utility in `server.js`), up to 10 retries |
| `REFRESH_JOIN_CODE` | DB persistence | `Session.findOneAndUpdate({ _id: sessionId }, { joinCode: newCode })` |
| `REFRESH_JOIN_CODE` | Immutable store update | Reducer handles `REFRESH_JOIN_CODE`, sets new `joinCode` on the session |
| `REFRESH_JOIN_CODE` | sessions re-broadcast | `io.emit(''sessions'', getSessionsSummary(...))` after reducer update |
| Voter broadcast filter | omit secured sessions | `type !== ''secured''` filter applied at `getSessionsSummary` or call site |
| `/join` page redirect | lobby URL | `sessionId` from resolver response, composed as `/sessions/${sessionId}/lobby` |
| QR code URL | encoded URL | `window.location.origin + ''/join/'' + session.joinCode` from Redux state |

**Key invariants**:
- A join code resolves only for `pending` or `open` sessions. Any other status returns 404 with the generic message.
- Secured sessions always return 404 from the resolver regardless of status. The code-based path must not reveal that the session exists.
- The `joinCode` field is unique across all sessions. `REFRESH_JOIN_CODE` uses the `getUniqueJoinCode` retry loop; a write collision at the DB layer surfaces as `action_error`, not silently ignored.
- If the `sessionId` in a `REFRESH_JOIN_CODE` action is unknown or the session is archived, emit `action_error INVALID_SESSION` and take no other action.
- The voter-facing `sessions` socket broadcast never includes a secured session in Phase 2.
- Rate limit state is per-process only and resets on server restart.

**Security model**:
- `GET /api/join/:code` is fully public. Rate-limited to 30 req/min/IP to prevent brute-force enumeration (32^6 is approximately 1 billion codes; 30 req/min throttles a brute-force to impracticality without Redis).
- `REFRESH_JOIN_CODE` is in `ADMIN_ACTION_TYPES`. The ingress guard in `server.js` rejects it without a valid admin JWT.
- The generic 404 message `"Code not found or no longer active."` is returned for all non-resolving cases. It reveals nothing about whether a session exists or why it is not accessible.
- IP extraction uses `resolveClientIp(req.headers, req.socket.remoteAddress)` (the existing helper) so the rate limiter respects the `TRUST_PROXY` setting consistently with the admin login throttle.

**Configuration required**: None. The rate limiter window and limit are hardcoded constants; no new environment variables.

**Critical test scenarios**:
- Happy path: voter resolves a valid code for a `pending` session, server returns 200 with correct shape, client redirects to lobby, verifies **AC-1**, **AC-2**
- QR auto-resolve: client loads `/join/ABC123`, code extracted from URL, resolver called without user input, lobby redirect fires, verifies **AC-3**
- Secured session 404: valid code for a secured session returns 404 with generic message, verifies **AC-1**, **AC-8**
- Expired session 404: valid code past `pendingExpiresAt` returns 404, verifies **AC-1**
- Rate limit exceeded: 31st request from same IP within one minute returns 429, verifies **AC-7**
- Code rotation: admin dispatches `REFRESH_JOIN_CODE`, new code resolves, old code returns 404, updated session list broadcast, verifies **AC-9**
- Auth guard: unauthenticated socket client dispatches `REFRESH_JOIN_CODE`, ingress rejects with `action_error UNAUTHORIZED`, verifies **AC-9**
- Alphabet test: 10,000 generated codes contain only `ABCDEFGHJKMNPQRSTUVWXYZ23456789` and are each 6 characters long, verifies **AC-10**
- `/sessions` redirect: navigation to `/sessions` list redirects to `/join`, verifies **AC-4**

## Build plan

Tracer Bullet: each slice adds one thin end-to-end strand through every layer; no placeholder data.

1. [x] **Server: resolver endpoint and rate limiter** Add `GET /api/join/:code` to the `http.createServer` handler in `server.js`. Normalize the code (uppercase, strip non-alphanumeric). Look up via `Session.findOne`. Apply the `pending`/`open` status check, the `pendingExpiresAt` expiry check, and the `type === ''secured''` check, all returning the generic 404. Add the in-memory fixed-window rate limiter using `resolveClientIp`. Return 200 on success. Satisfies **AC-1**, **AC-7**.

2. [x] **Server: secured session broadcast filter** In `getSessionsSummary` or at the `io.emit(''sessions'', ...)` call site, filter out sessions where `type === ''secured''` before emitting to voter clients. Admin connections are unfiltered. Satisfies **AC-8**.

3. [x] **Server: `REFRESH_JOIN_CODE` action and reducer** Add `''REFRESH_JOIN_CODE''` to `ADMIN_ACTION_TYPES` and `ALLOWED_ACTION_TYPES`. Add a handler: call `getUniqueJoinCode()` (up to 10 retries), persist via `Session.findOneAndUpdate`, dispatch to the store (reducer sets new `joinCode` in Immutable state), re-emit the sessions broadcast. Add the reducer case in `reducer.js`. Satisfies **AC-9**.

4. [x] **Client: `/join` page and route** Create `voting-client/src/pages/Join.jsx`. Render a 6-character code input (auto-uppercase, max 6 chars) with a Join button and inline error area. On submit, call `GET /api/join/:code` and redirect to `/sessions/:id/lobby` on 200; display error message on 404 or 429 without page reload. If the URL has a code path param (`/join/:code`), auto-resolve on mount. Add `/join` and `/join/:code` routes to `AppRoutes.jsx`. Satisfies **AC-2**, **AC-3**.

5. [x] **Client: retire `/sessions` list and update home page** Remove or redirect the `/sessions` list route in `AppRoutes.jsx` to `/join`. Update `Home.jsx` to link to `/join`. Remove `SessionList.jsx` if it has no other callers. Satisfies **AC-4**, **AC-5**.

6. [x] **Client: update QR codes** In the admin lobby component rendering the QR code, replace the encoded URL with `window.location.origin + ''/join/'' + session.joinCode`. The `joinCode` field is already in Redux session state from the sessions broadcast. Satisfies **AC-6**.

7. [x] **Client: admin Refresh Code button** In the admin panel session view, add a Refresh Code button that dispatches `REFRESH_JOIN_CODE` with the session id over the existing admin-authenticated socket. Visible for non-archived sessions only. Satisfies **AC-9**.

8. [x] **Tests: resolver and code generation** Write tests for: alphabet correctness and length (10,000 samples), collision retry logic, resolver returns correct shape for `pending`/`open`, resolver returns 404 for wrong status/expired/secured, rate limiter returns 429 on the 31st request, `REFRESH_JOIN_CODE` auth guard. Satisfies **AC-1**, **AC-7**, **AC-9**, **AC-10**.

## Consequences

**Positive**:
- Voters reach sessions through a controlled, code-first flow with no accidental discovery.
- Secured sessions are invisible in all voter-facing surfaces from Phase 2 onward.
- The rate limiter prevents code enumeration attacks at minimal infrastructure cost.
- Admin code rotation propagates immediately via the existing sessions broadcast; no page reload required.

**Negative / tradeoffs**:
- The in-memory rate limiter resets on server restart; a restart under attack re-opens the full window. Replace with a persistent store in Phase 9 (Hardening).
- Removing `/sessions` breaks any existing bookmarks or external links to that route. The redirect to `/join` mitigates the UX impact.
- An admin rotating the code while voters are scanning the old QR code sends those voters to an error page. This is intentional and documented behavior.

**Neutral**:
- `SessionList.jsx` becomes dead code; remove it in slice 5 to avoid confusion.
- The admin broadcast filter decision (per-socket admin flag vs. separate admin room vs. emit-time filter) is an implementation detail for `/develop` to resolve. Two viable patterns: (a) pass a `filterSecured` flag into `getSessionsSummary` and call it twice (once for voter-facing `io.emit(''sessions'', publicList)`, once for admin-facing), or (b) emit the full list only to an `admin_room` socket room. Read the existing admin socket connection flow in `server.js` and pick the approach that matches the current room structure.

## Follow-up

- [ ] Phase 9 (Hardening): replace the in-memory rate limiter with a persistent store (Redis or MongoDB) to survive server restarts.
- [ ] Add a session state guard to `REFRESH_JOIN_CODE` if UX feedback shows admins are rotating codes accidentally on active sessions.
- [ ] Verify `resolveClientIp` is used consistently for the join code rate limiter (matching the admin login throttle behavior for `TRUST_PROXY`).
