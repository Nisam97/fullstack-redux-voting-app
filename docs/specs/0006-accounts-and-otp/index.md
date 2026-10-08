# 0006. Accounts and OTP

**Date**: 2026-09-28
**Status**: Accepted

## Summary

VoteSphere gets passwordless voter accounts. A voter registers with email, username, and display name, verifies with a 6 digit one time code, and receives a signed cookie that proves their identity across sessions. Public sessions still allow anonymous join (with a gentle nudge to sign in). The existing per session cookie is replaced by an account level JWT for signed in voters, while anonymous voters keep the old flow unchanged.

## Requirements

**User stories**:
- As a voter, I want to create an account with my email so I can have a persistent identity across voting sessions.
- As a voter, I want to sign in without a password so I can authenticate quickly and securely using a code sent to my email.
- As a voter, I want my display name to pre fill from my profile when joining a session so I do not have to re enter it every time.
- As a voter, I want to log out so I can end my session and clear my identity from the browser.
- As an admin, I want voter accounts to be separate from the admin system so the two auth domains do not interfere.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: A voter can register by providing email, display name, and username, then verifying a 6 digit OTP sent to their email. On successful verify, a `User` document is created in MongoDB and a signed `vs_voter` httpOnly cookie is set.
- **AC-2**: A returning voter can sign in by entering only their email, verifying the OTP, and receiving the `vs_voter` cookie. No password is involved at any step.
- **AC-3**: The OTP is 6 digits, generated with `crypto.randomInt`, hashed at rest with SHA-256 plus a per challenge random salt, valid for 10 minutes, single use (consumed on successful verify), and capped at 5 wrong attempts per challenge.
- **AC-4**: A 60 second resend cooldown prevents spamming. A new OTP request within 60 s of the last is rejected. After 60 s the old challenge is replaced by a fresh one (only one active challenge per email at a time).
- **AC-5**: The response to `POST /api/auth/otp/request` is always generic ("If an account exists or can be created, a code was sent.") and never reveals whether the email is registered. If a register request is made for an already registered email, the pending registration fields are silently discarded and a normal OTP is sent.
- **AC-6**: When SMTP is not configured (SMTP_HOST is empty), the server logs the OTP to the console in the format `[OTP-DEV] Code 482910 for voter@example.com, expires in 10 min`. The OTP never appears in any HTTP response body.
- **AC-7**: The `vs_voter` cookie is a JWT signed with `VOTER_JWT_SECRET`, carrying `{ userId, email, role: 'voter' }`, set as `httpOnly`, `SameSite=Lax`, with `Secure` when `COOKIE_SECURE=true`, and a 7 day TTL.
- **AC-8**: `GET /api/auth/voter/me` returns the current voter profile when a valid `vs_voter` cookie is present, or 401 when absent or expired.
- **AC-9**: `POST /api/auth/profile` updates the signed in voter's display name and/or username (with the same validation constraints), requiring a valid `vs_voter` cookie.
- **AC-10**: `POST /api/auth/logout` clears the `vs_voter` cookie via `Set-Cookie: vs_voter=; Max-Age=0`. The client clears local state and redirects to home.
- **AC-11**: CORS is configured with `credentials: true` for the client origin (`CLIENT_ORIGIN` env var). The `Access-Control-Allow-Origin` header is set to the specific origin, not `*`.
- **AC-12**: When a signed in voter joins a session, the server uses their `userId` (via the synthetic key `user:${userId}`) as the voter identity in the in memory registry. No per session cookie is set. The join form pre fills the display name from the profile. Anonymous voters continue with the existing per session cookie flow.
- **AC-13**: Duplicate vote prevention for signed in voters uses the composite key `${sessionId}:::${roundId}:::${sortedPair}:::user:${userId}`.
- **AC-14**: Username uniqueness is validated at OTP request time. A taken username returns a clear error. Usernames are 3 to 20 characters, alphanumeric plus underscores.
- **AC-15**: The client has separate `/register` and `/login` pages. Both are passwordless OTP flows. The register page collects email, display name, and username. The login page collects email only.
- **AC-16**: A visible "Log out" button appears in the header/navbar when signed in. A "Sign in" link appears when not signed in. Public session join shows a "Sign in for a better experience" prompt for anonymous voters.
- **AC-17**: Existing test suites pass. The admin auth system is unchanged.

## Decision

**Chosen option**: Option 1: Roll your own passwordless OTP with Nodemailer, Mongoose, and jsonwebtoken

Build OTP auth in house using the project's existing stack (Mongoose for storage, jsonwebtoken for the cookie, Nodemailer for email delivery, Node `crypto` for OTP generation and hashing). No new auth library or service.

**Implementation skills**: `model-redux-state-build-slices-and-selectors` (`reduxjs/redux-toolkit`, `.agents/skills/model-redux-state-build-slices-and-selectors/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

| Entity | Field | Type | Constraints |
|---|---|---|---|
| **User** | `_id` | ObjectId | PK, auto |
| | `email` | String | required, unique index, lowercase, trimmed |
| | `username` | String | required, unique index, 3 to 20 chars, `/^[a-zA-Z0-9_]+$/`, trimmed |
| | `name` | String | required, trimmed, 1 to 80 chars (display name) |
| | `createdAt` | Date | auto (`timestamps: true`) |
| | `updatedAt` | Date | auto (`timestamps: true`) |
| **OtpChallenge** | `_id` | ObjectId | PK, auto |
| | `email` | String | required, indexed, lowercase |
| | `codeHash` | String | required (SHA-256 of `salt:code`) |
| | `salt` | String | required (random 16 byte hex) |
| | `expiresAt` | Date | required, TTL index (Mongo auto deletes) |
| | `attempts` | Number | default 0, max 5 |
| | `lastSentAt` | Date | required (used for 60 s cooldown) |
| | `consumedAt` | Date | null until verified |
| | `pendingName` | String | optional (register flow only) |
| | `pendingUsername` | String | optional (register flow only) |
| | `createdAt` | Date | auto |

Relationships:
- User to OtpChallenge: linked by `email` (1:N but only one active challenge per email; old ones replaced or expired via TTL).
- User to Session membership: in memory only (Redux store presence map, keyed by `user:${userId}` for signed in voters, by anonymous token for anonymous voters).

**State transitions**:

OtpChallenge lifecycle:
```
CREATED → PENDING (waiting for verify)
  → CONSUMED (verified successfully, consumedAt set)
  → LOCKED (attempts >= 5, rejects further tries)
  → EXPIRED (TTL index auto-deletes)
```

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/auth/otp/request` | POST | `email` (req), `name` (opt, register), `username` (opt, register) | `{ success, message }` (always generic) | public | 429 cooldown, 400 invalid email, 400 username taken (register only) |
| `/api/auth/otp/verify` | POST | `email` (req), `code` (req, 6 digits) | `{ success, user, isNewUser }` + `Set-Cookie: vs_voter` | public | 401 invalid/expired code, 423 challenge locked (5 attempts), 400 invalid |
| `/api/auth/voter/me` | GET | — | `{ success, user: { email, name, username, createdAt } }` | `vs_voter` cookie | 401 no/invalid cookie |
| `/api/auth/profile` | POST | `name` (opt), `username` (opt) | `{ success, user }` (updated) | `vs_voter` cookie | 401 unauthorized, 400 validation, 409 username taken |
| `/api/auth/logout` | POST | — | `{ success }` + `Set-Cookie: vs_voter=; Max-Age=0` | `vs_voter` cookie | 401 unauthorized |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| OTP request (register) | `pendingName`, `pendingUsername` | input params on `/api/auth/otp/request` |
| OTP request | `codeHash`, `salt` | derived: `crypto.randomInt(0, 1_000_000)` zero padded, then `crypto.createHash('sha256')` of `salt:code` |
| OTP request | `expiresAt` | derived: `Date.now() + OTP_TTL_MINUTES * 60_000` from env var |
| OTP request | cooldown check | `lastSentAt` on the existing challenge doc for this email |
| OTP verify (register) | `name`, `username` for new User | `pendingName`, `pendingUsername` from the OtpChallenge doc (stored at request time) |
| OTP verify | `userId` for the JWT | `User._id` from lookup by email, or new `User._id` after creation |
| OTP verify | `isNewUser` flag | derived: whether the User doc was just created (`!existingUser`) |
| OTP verify | `vs_voter` JWT payload | `{ userId: User._id, email: User.email, role: 'voter' }`, signed with `VOTER_JWT_SECRET` |
| OTP verify | cookie flags | `httpOnly`, `SameSite=Lax`, `Secure` from `COOKIE_SECURE` env var, `Max-Age` from `VOTER_SESSION_DAYS * 86400` |
| Voter /me | profile data | `User` doc fields: `email`, `name`, `username`, `createdAt` |
| Session join (signed in) | voter identity key | `user:${userId}` derived from the `vs_voter` JWT's `userId` claim |
| Session join (signed in) | display name pre fill | `User.name` from DB lookup by `userId` from the cookie |
| Duplicate vote key (signed in) | composite key | `${sessionId}:::${roundId}:::${sortedPair}:::user:${userId}` |
| Navbar display | "Hi, {name}" or "Sign in" | `GET /api/auth/voter/me` on app load; cached in client state |

**Key invariants**:
- One active OtpChallenge per email at a time: a new request replaces the existing unconsumed challenge.
- `User.email` is globally unique (unique index).
- `User.username` is globally unique (unique index, validated at OTP request time before sending).
- The OTP is never in any HTTP response body, only the hashed form in the DB and the raw digits in the email (or console log).
- A consumed challenge (`consumedAt !== null`) rejects all further verify attempts.
- A locked challenge (`attempts >= 5`) rejects all further verify attempts until TTL expiry.
- Signed in voters and anonymous voters coexist in the same session. The `votersByToken` map accepts both `user:${userId}` keys and random UUID token keys.
- The `vs_voter` cookie domain, path, and flags are consistent across set and clear operations.

**Security model**:
- OTP endpoints are public but rate limited (Phase 9 adds IP/email rate limits; this phase enforces per challenge attempt and cooldown limits).
- The `vs_voter` JWT uses a separate secret (`VOTER_JWT_SECRET`) from the admin JWT (`JWT_SECRET`). The two auth domains are fully independent.
- No endpoint reveals whether an email is registered. OTP request always returns the same success message. Username uniqueness errors are acceptable (usernames are public handles, not PII).
- Profile read/write requires a valid `vs_voter` cookie (JWT verification). Expired or tampered tokens return 401.
- CORS `credentials: true` is restricted to the `CLIENT_ORIGIN` value, never `*`.
- `httpOnly` prevents client script access to the cookie. `SameSite=Lax` prevents CSRF on mutation endpoints (all POST).
- The admin system (`admin.js`, `config.js`) is not modified. Admin and voter auth are separate JWT domains with separate secrets and separate cookies.

**Configuration required**:
- `VOTER_JWT_SECRET`: Secret for signing `vs_voter` JWTs (already in `.env.example`)
- `VOTER_SESSION_DAYS`: Cookie/JWT TTL in days, default 7 (already in `.env.example`)
- `SMTP_HOST`: SMTP server hostname; empty means console fallback (already in `.env.example`)
- `SMTP_PORT`: SMTP port, default 587 (already in `.env.example`)
- `SMTP_USER`: SMTP auth username (already in `.env.example`)
- `SMTP_PASS`: SMTP auth password (already in `.env.example`)
- `MAIL_FROM`: Sender address for OTP emails (already in `.env.example`)
- `OTP_TTL_MINUTES`: OTP validity in minutes, default 10 (already in `.env.example`)
- `CLIENT_ORIGIN`: Browser origin for CORS `credentials: true` (already in `.env.example`)
- `COOKIE_SECURE`: Set `Secure` flag on cookies, default false (already in `.env.example`)

All env vars are already declared in `.env.example` from Phase 0. No new vars needed.

**Critical test scenarios**:
- Happy path: Register with email, name, username, receive OTP (console), verify, cookie set, `/me` returns profile, join session with pre filled name, vote, verifies **AC-1**, **AC-2**, **AC-7**, **AC-8**, **AC-12**
- Failure case: Submit wrong OTP 5 times, challenge locks, sixth attempt rejected with 423, new OTP request after TTL works, verifies **AC-3**, **AC-4**
- Failure case: Request OTP within 60 s cooldown, rejected, verifies **AC-4**
- Failure case: Register with taken username, error returned before OTP is sent, verifies **AC-14**
- Security: Register with already registered email, same generic response, OTP sent, verify logs in existing user (pending fields discarded), verifies **AC-5**
- Security: OTP never in any response body (only in console log or email), verifies **AC-6**
- Auth/permission: Access `/me` without cookie, receive 401; access `/profile` without cookie, receive 401, verifies **AC-8**, **AC-9**
- Integration: Signed in voter joins session, `user:${userId}` key in votersByToken, no per session cookie set, verifies **AC-12**, **AC-13**
- Coexistence: Anonymous voter joins same session, gets per session cookie, both can vote, verifies **AC-12**, **AC-17**

## Build plan

Ordered by Tracer Bullet: each task adds one thin end to end strand through the full stack.

1. **Mongoose models (`User`, `OtpChallenge`) and OTP service module**, satisfies **AC-1**, **AC-3**, **AC-14**
   - `User` schema with unique email and username indexes, validation
   - `OtpChallenge` schema with TTL index on `expiresAt`, `pendingName`, `pendingUsername` fields
   - `src/auth/otp.js` module: `generateOtp()` (crypto.randomInt, SHA-256 + salt), `createChallenge()`, `verifyChallenge()`, `isChallengeLocked()`, `isCooldownActive()`

2. **Nodemailer transport and SMTP fallback**, satisfies **AC-6**
   - `src/email/transport.js`: create Nodemailer transporter from env vars, console fallback when `SMTP_HOST` is empty
   - `sendOtpEmail(email, code)` function: renders the OTP email, sends via transport or logs `[OTP-DEV]` to console
   - Nodemailer added to `voting-server/package.json`

3. **REST endpoints: OTP request and verify with cookie issuance**, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-7**, **AC-14**
   - `POST /api/auth/otp/request`: email validation, username uniqueness check (register path), cooldown enforcement, challenge creation/replacement, send email
   - `POST /api/auth/otp/verify`: challenge lookup, hash comparison, attempt increment, lock check, User lookup or creation (from pending fields), `vs_voter` JWT signing and cookie setting, `isNewUser` flag
   - Cookie helper: `setVoterCookie(res, token)`, `clearVoterCookie(res)` in `src/auth/voterCookie.js`

4. **REST endpoints: voter /me, profile update, logout**, satisfies **AC-8**, **AC-9**, **AC-10**
   - `GET /api/auth/voter/me`: parse `vs_voter` cookie, verify JWT, return User doc
   - `POST /api/auth/profile`: parse cookie, validate inputs, update User, return updated profile
   - `POST /api/auth/logout`: clear cookie via `Set-Cookie: vs_voter=; Max-Age=0; ...`
   - `verifyVoterToken(cookieString)` utility in `src/auth/voterCookie.js`
   - Manual cookie parsing from `req.headers.cookie` (split by `;`, find `vs_voter=`, URL decode) since the project uses raw `http.createServer` with no cookie parser middleware

5. **CORS credentials support**, satisfies **AC-11**
   - Update `setCorsHeaders()` in `server.js`: when origin matches `CLIENT_ORIGIN`, set `Access-Control-Allow-Credentials: true` and `Access-Control-Allow-Origin` to the specific origin (not `*`)
   - Add `Access-Control-Allow-Headers: Content-Type` for preflight

6. **Session join integration for signed in voters**, satisfies **AC-12**, **AC-13**
   - Modify `POST /api/sessions/:sessionId/join`: check `vs_voter` cookie first; if valid, use `user:${userId}` as the voter identity key instead of generating a random token; skip per session cookie; pre fill display name from User profile
   - Modify `voter.js` to accept `user:${userId}` as a valid key in `votersByToken` and `tokensBySession`
   - Update `buildVoteKey()` to work with `user:${userId}` composite keys
   - Socket.io handshake: read `vs_voter` from handshake headers, verify JWT, store `userId` on socket

7. **Client: Register and Login pages**, satisfies **AC-15**, **AC-16**
   - Rework `Register.jsx`: email + display name + username form, OTP request call, OTP entry form, verify call, redirect to home on success
   - New or reworked `Login.jsx`: email only form, OTP request call, OTP entry form, verify call, redirect to home
   - Route wiring in `AppRoutes.jsx`: `/register`, `/login`
   - Auth service additions in `services/auth.js`: `requestOtp()`, `verifyOtp()`, `getVoterProfile()`, `updateVoterProfile()`, `logoutVoter()`
   - Navbar/header: "Hi, {name}" + "Log out" when signed in, "Sign in" when not
   - Join page: pre fill display name from voter profile, "Sign in for a better experience" prompt for anonymous voters

8. **Client: voter auth state and Redux integration**, satisfies **AC-8**, **AC-16**
   - Add voter auth state to the client (a `voterAuthSlice` or context): `{ isLoggedIn, user: { email, name, username } }`
   - On app load, call `GET /api/auth/voter/me` to hydrate state from cookie
   - Register `VOTER_AUTH` actions in `LOCAL_ACTION_TYPES` to prevent echo

## Consequences

**Positive**:
- Voters gain a persistent, cross session identity without needing a password
- Account names pre fill on session join, reducing friction for returning voters
- The httpOnly cookie is more secure than the per session token in browser storage (safe from XSS)
- Console OTP fallback means local development works without SMTP setup
- Foundation for Phase 7 (Secured Sessions) and Phase 8 (Visibility and Privacy)

**Negative / tradeoffs**:
- Rolling OTP auth in house means owning the security surface: hashing, timing, cooldowns, and email deliverability are all on the team
- The `vs_voter` JWT is not invalidated server side on logout; a stolen cookie remains valid until it expires (7 days). The team accepts this tradeoff; a server side token denylist is deferred
- Adding CORS `credentials: true` tightens the origin to a single value; multi origin setups (staging, preview deploys) need `CLIENT_ORIGIN` updated or the CORS logic extended
- The `user:${userId}` synthetic key changes the voter identity model; any code that assumes all voter keys are UUIDs must be updated

**Neutral**:
- Nodemailer is a new server dependency (well maintained, widely used, no vendor lock in)
- Two new Mongoose models (`User`, `OtpChallenge`) added to the DB
- The admin auth system is completely untouched; the two auth domains run independently
- All env vars already declared in `.env.example` from Phase 0; no new config to add

## Follow-up

- [ ] Phase 9 adds rate limits on `POST /api/auth/otp/request` (5 req/hour/email, 20/hour/IP) and timing parity on OTP responses. This phase relies on per challenge attempt limits and cooldowns only.
- [ ] Consider server side token invalidation (a denylist or short lived JWTs + refresh tokens) if the 7 day window is too wide. Deferred for now as the scope accepted cookie only logout.
- [ ] Phase 7 (Secured Sessions) builds on the `vs_voter` cookie for socket identity and session eligibility. The `SessionParticipant` model is deferred to that phase.
