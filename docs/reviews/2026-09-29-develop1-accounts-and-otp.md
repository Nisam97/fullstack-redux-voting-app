# Review, develop1, 2026-09-29

**Reviewed by**: Buffy on a different model family than the author (author on Gemini 3.8 Flash; run inline because this client has no subagent support, so the reviewer is a different family, which keeps the cross model guarantee)
**Scope**: 14 feature files on branch develop1 vs main, accounts and OTP surfaces only (server: auth/otp.js, auth/voterCookie.js, auth/voter.js, email/transport.js, db/models/User.js, db/models/OtpChallenge.js, server.js auth and join and vote paths; client: services/auth.js, services/socket.js, redux/voterAuthSlice.js, pages/Login.jsx, pages/Register.jsx, components/layout/Navbar.jsx, routes/AppRoutes.jsx)
**Verdict**: Blocked

## Summary

Spec 0006 ships a complete passwordless account system: hashed single use OTP challenges with a lock and cooldown, a signed httpOnly cookie on a separate JWT domain, profile endpoints, CORS credentials, client register and login pages, and a solid REST contract suite. The headline problems are both at the trust boundaries the new identity model creates. First, two socket paths accept a client supplied `userId` as the voter identity, so anyone can claim or hijack another voter's identity key. Second, the OTP request endpoint answers success even when email delivery failed on a configured SMTP transport, which silently breaks the login contract in production. Everything else is solid, with a few cooldown and resilience gaps worth fixing soon.

## Blockers

### 🔴 Socket paths trust a client supplied userId as the voter identity, `voting-server/src/server.js:1422`

**Problem**: The socket `join_session` handler resolves `const userId = socket.data?.userId || payload?.userId`, and `payload` comes straight from the client. A voter can emit `join_session` with any `userId` they like and get the synthetic key `user:<that id>` as their voter token. The same shape returns in the vote path at server.js:2058, where `action.voterToken` (client controlled) is accepted first, so a client can also pass `user:<victim id>` directly as its voter token. The REST join route (server.js:874) gets this right: it only derives `userId` from the verified `vs_voter` cookie and ignores any client supplied value. The verify function only checks that the JWT carries `role: 'voter'` and a `userId` claim, so possession of the account, not of the cookie, becomes the credential.

**Why it matters**: Anyone who knows or guesses another voter's `userId` can join as them, cast votes that consume the victim's per round duplicate vote slot (the composite key ends in `user:<victim id>`), and appear as them in presence counts. This defeats AC-12 and AC-13 for real users and breaks the server authority rule that identity comes from verified credentials. It gets worse in Phase 7, where the `vs_voter` identity becomes the eligibility check for secured sessions.

**Suggested fix**: Make `user:` prefixed tokens server derived only. In `join_session` use `socket.data?.userId` alone (cookie verified at handshake) and delete the `payload?.userId` fallback. In the vote path, reject any client supplied token starting with `user:` and resolve signed in identity only from `socket.data.userId` (or the handshake cookie). Add a regression test that emits `join_session` with a forged `userId` and expects a random anonymous token or an error.

### 🔴 OTP request answers success even when email delivery failed, `voting-server/src/server.js:651`

**Problem**: After `createChallenge` succeeds, the route awaits `sendOtpEmail(...)` and throws its result away, then always sends the generic 200. When SMTP is unconfigured the console fallback makes that correct. But when `SMTP_HOST` is set and the send fails, `sendOtpEmail` returns `{ success: false }` and the client still gets "If an account exists or can be created, a code was sent." The challenge doc is already created, so its 60 second cooldown is running and every retry during an outage burns the cooldown again while the code never arrives. The route has no way to distinguish "code sent" from "code silently dropped".

**Why it matters**: The login contract (AC-2) and the dev fallback contract (AC-6) only hold when delivery succeeds. A production SMTP misconfiguration or outage turns the feature into a silent brick, and the cooldown makes it worse: the user waits 60 seconds, retries, and fails again. AC-17's "existing flows keep working" is also strained because the failure is invisible in the API surface.

**Suggested fix**: Check the result of `sendOtpEmail`. On failure, delete or mark the just created challenge unconsumable (so the cooldown is not burned on a code nobody received) and return a 502 style error with a stable machine readable code such as `EMAIL_DELIVERY_FAILED`. Keep the generic message shape for the success path only. Add a test with a failing transport asserting the request does not report success.

## Major

### 🟠 A taken username on resend burns the 60 second cooldown, `voting-server/src/auth/otp.js:106`

**Problem**: In `createChallenge` the username uniqueness check runs before the cooldown check. A register request with a taken username fails with `USERNAME_TAKEN` without creating a challenge, but if the user first requested a code and then resends with a taken username, the rejection lands before the cooldown guard and after... the actual order is: username check (line 106), then cooldown lookup (line 119). So any rejected username attempt is free, but the reverse ordering problem is real for the register page flow: the first successful request starts the cooldown, and the resend handler in `Register.jsx:105` resends with the same `username`, so a user who fixes their username in the form and resends within 60 seconds gets `COOLDOWN_ACTIVE` even though their first attempt failed validation. Because there is also no rate limit on this public endpoint in this phase (the spec defers that to Phase 9), each rejected or successful request is cheap but the cooldown state can only be observed by trial.

**Why it matters**: The register flow's most common correction path, fix the username, resend, is punished with a 60 second wait, and the UI cannot show a countdown (see Minor 3), so it reads as broken.

**Suggested fix**: Run the cooldown check before the username uniqueness check so every rejected request leaves the cooldown state untouched, or make rejected validation requests exempt from starting the cooldown clock. At minimum, have the client only resend with the exact fields that succeeded the first time.

### 🟠 Voter JWT secret falls back silently to a hardcoded default, `voting-server/src/auth/voterCookie.js:5`

**Problem**: `getVoterJwtSecret()` returns `'votesphere_voter_jwt_secret_fallback'` when `VOTER_JWT_SECRET` is unset, with no warning. The admin side shares this pattern (auth/config.js:10), so it is consistent with the codebase, but the voter cookie is new, long lived (7 days), and authorizes profile writes and, from Phase 7, session eligibility. A deployment that forgets the env var issues cookies any third party can forge, and nothing in the logs says so.

**Why it matters**: A missing secret is invisible until someone exploits it. The spec's security model leans on the voter and admin domains being independent; a shared silent default undermines that.

**Suggested fix**: Fail fast at server start when the secret is missing in production, or at minimum log a loud one time warning. The test suite can keep injecting a test secret explicitly.

### 🟠 OTP routes have no outer error handling, `voting-server/src/server.js:606`

**Problem**: The whole HTTP handler has one try/catch, but these auth routes run inside it with awaits on Mongo (`createChallenge`, `verifyChallenge`, `User.findById`, `user.save()`). When Mongo blips, the error propagates to the socket level catch at server.js:2193 which logs for socket actions, but for HTTP requests the outer catch around the router is not present on every path, and an unhandled rejection in the async `http.createServer` callback takes down the Node process (there is no `uncaughtException` handler in index.js). Every other REST route shares this fragility, but the OTP routes add a second failure source, the SMTP send, on the hot path.

**Why it matters**: One transient Mongo hiccup during an OTP verify becomes a server crash mid tournament, dropping every socket and presence state. That is disproportionate to the trigger.

**Suggested fix**: Wrap the HTTP routing in one try/catch that answers 500 with a generic body, or add a process level `unhandledRejection` guard in index.js. Keep the generic error message so nothing internal leaks.

## Minor

### 🟡 Generated fallback usernames can collide, `voting-server/src/auth/otp.js:241`

**Problem**: When a login verify creates an account with no pending registration fields, the username is the email handle plus `crypto.randomBytes(3).toString('hex')`, about 16.7 million combinations. Collision with an existing username throws `E11000` from the unique index and surfaces as a 500 (or a crash, see Major 3). Rare, but this is the default path for every login-only user.

**Suggested fix**: Retry with a fresh suffix on duplicate key error, or derive the suffix from the email plus a timestamp.

### 🟡 Case insensitive username lookup uses a regex built from user input, `voting-server/src/auth/otp.js:100`

**Problem**: `new RegExp('^' + trimmedUsername + '$', 'i')` is safe today only because `isValidUsername` has already restricted the alphabet to alphanumerics and underscore, and the profile route repeats the same shape. It reads like an injection seam one edit away from an ReDoS or injection bug.

**Suggested fix**: Compare with a case insensitive collation unique index on `username`, or escape the string before building the regex so safety does not depend on a check ordered earlier in the function.

### 🟡 Cooldown countdown never ticks in the UI, `voting-client/src/pages/Login.jsx:269`

**Problem**: Both login and register store `cooldownSeconds` from the 429 response and disable the resend button while it is above zero, but nothing ever decrements it. After one cooldown response the resend button stays disabled until the component remounts.

**Suggested fix**: Add a one second interval effect that counts down to zero and clears itself, and show the remaining seconds in the button.

### 🟡 Join over REST ignores a signed in voter's explicit display name silently, `voting-server/src/server.js:880`

**Problem**: For a signed in voter the route overwrites the submitted `displayName` with the profile name only when the submitted one is empty, which is correct, but the client Lobby pre fill (Lobby.jsx:76) can fill the input from a stale profile while the server has a newer one, and there is no signal back to the client about which name won. Cosmetic today, worth a `displayNameSource` field or a refresh when profiles can be edited mid session.

**Suggested fix**: Return the effective identity source in the join response and have the client reconcile its input from it.

## Nits

- ⚪ `voting-server/src/auth/voterCookie.js:16`, `String(user._id || user.id)` would stringify an object to `[object Object]`; verify then compares the raw claim without the same cast, so a non string `userId` claim fails validation only implicitly. Cast consistently.
- ⚪ `voting-server/src/auth/otp.js:130`, the cleanup `deleteMany` runs before `User.findOne`, so two rapid requests for the same email in the cooldown free window can both pass the check and race the replacement; harmless for the spec, worth an atomic `findOneAndReplace` later.
- ⚪ `docs/specs/0006-accounts-and-otp/index.md`, build plan item 5 says the preflight adds `Access-Control-Allow-Headers: Content-Type`; the implementation also allows `Authorization` and `X-Requested-With`, which is fine but the spec text has drifted.
- ⚪ `voting-client/src/pages/Register.jsx:174`, the username input lowercases as the user types, which silently changes what they see versus what validation allows (uppercase is legal per the regex). One or the other.

## Strengths

- OTP hygiene is genuinely good: `crypto.randomInt`, a per challenge random salt, SHA-256 at rest, `timingSafeEqual` comparison, consumption on first use, and a lock after 5 attempts, with a test that proves even the correct code is refused after lock.
- AC-5 is implemented exactly and tested from the hijack angle: registering against an existing email discards the pending fields and logs the real user in.
- The credentialed CORS reflect is allowlist gated, never `*`, and covered by a preflight test.
- The REST contract suite drives real HTTP against an in memory Mongo and asserts cookie flags on the wire, tampered and expired tokens, cooldown, lock, replay, and the SMTP fallback, 826 lines of honest coverage.
- The client slice stays small and normalized, the navbar handles both auth domains cleanly, and the join page pre fill plus the anonymous sign in nudge match the spec.

## Test coverage

`TESTS = configured` (Mocha, chai, mongodb-memory-server; node:test on the client). The new logic is well covered at the service and REST level. Gaps that mattered here: no test drives socket `join_session` with a forged `userId` (would have caught Blocker 1), no test asserts a failed SMTP send produces a non success HTTP outcome (would have caught Blocker 2), nothing exercises a missing `VOTER_JWT_SECRET` at boot, and the client tests do not cover the resend cooldown behavior. Suggested fixes for the two blockers should land with those two tests.
