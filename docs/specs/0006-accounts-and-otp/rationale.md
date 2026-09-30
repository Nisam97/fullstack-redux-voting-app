# 0006. Accounts and OTP: Rationale

## Context

VoteSphere today has two identity systems that do not serve the same purpose. The admin is a single seeded account with bcrypt and JWT, gated by Socket.io. Voters are anonymous: they enter a display name, receive a random session scoped token, and use that token to vote. The token lives in browser storage and a per session httpOnly cookie. There is no persistent voter identity.

Phase 6 introduces voter accounts so that returning voters do not re enter their name every time, so the server can tie a voter to a durable identity (needed for Phase 7 secured sessions and Phase 8 visibility), and so the platform can eventually distinguish "who voted" from "what they voted for" without revealing choices.

The scope requires passwordless login (no password at any step), an OTP sent to email, a signed httpOnly cookie, and a console fallback when SMTP is not configured. The response to any OTP request must never reveal whether the email is registered (generic responses only). The admin auth system must remain untouched.

The project's stack is Node `http` (no Express), Socket.io 4, Mongoose 9 on MongoDB, and `jsonwebtoken` for the admin JWT. The build approach is Tracer Bullet: each task adds one thin end to end strand through the full stack.

## Options considered

### Option 1: Roll your own passwordless OTP with Nodemailer, Mongoose, and jsonwebtoken

Build OTP auth entirely on the existing stack. Mongoose stores `User` and `OtpChallenge` models. `crypto.randomInt` generates the 6 digit code, SHA-256 with a per challenge salt hashes it at rest. Nodemailer sends the email (or the server logs the code when SMTP is unconfigured). `jsonwebtoken` signs the `vs_voter` cookie with `VOTER_JWT_SECRET`. No new auth library, no external auth service.

**Pros**:
- Zero new infrastructure. Reuses Mongoose, jsonwebtoken, and Node crypto, all already in the project.
- Full control over the OTP lifecycle: cooldowns, attempt limits, hashing, and generic responses are straightforward to implement exactly as specified.
- Console fallback for local development is trivial (an `if` around the transport).
- No vendor dependency, no external API calls, no billing.

**Cons**:
- The team owns the entire security surface: OTP generation randomness, hash correctness, timing attacks, cooldown enforcement, and email deliverability.
- No built in protection against advanced attacks (credential stuffing via distributed IPs, email bounce handling). Phase 9 rate limits mitigate the first.
- JWT is not invalidated server side on logout; a stolen cookie is valid until expiry (7 days).

### Option 2: Use a hosted auth provider (Auth0, Clerk, or Supabase Auth)

Delegate passwordless OTP to a hosted service. The provider handles OTP generation, email delivery, rate limiting, and session management. The server verifies the provider's token.

**Pros**:
- The provider owns the security surface: OTP generation, delivery, rate limiting, and session management are their responsibility.
- Built in protection against brute force, credential stuffing, and email abuse.
- Dashboard for monitoring auth events.

**Cons**:
- Adds a hard external dependency to a self hosted project. The scope explicitly says "Wire Nodemailer with Gmail SMTP", not "use an auth provider".
- The project uses raw Node `http`, not Express or a framework with provider SDKs. Integration is non trivial.
- Free tiers have limits (Auth0: 7,500 MAU; Clerk: 10,000 MAU). Exceeding them incurs cost.
- The generic response requirement and console fallback are harder to control through a provider's API.
- Over engineering for a single admin + anonymous/OTP voter platform.

### Option 3: Use an auth library (Passport.js with passport-otp or Lucia)

Use an established Node auth library to handle session management and OTP verification, keeping email delivery via Nodemailer.

**Pros**:
- Session management (cookie signing, verification, expiry) is handled by the library.
- Community tested patterns for common auth flows.

**Cons**:
- Passport.js assumes Express middleware (`req`, `res`, `next`). The project uses raw Node `http.createServer`. Integrating Passport without Express requires shimming the middleware chain or adding Express as a dependency, which changes the server architecture.
- Lucia is being deprecated (maintenance mode as of 2024). Not a stable choice.
- The OTP flow is simple enough (request, store hash, verify, issue JWT) that a library adds indirection without reducing complexity.
- The project already has `jsonwebtoken` for JWT operations; adding a second session/token library creates two patterns.

## Rationale

Option 1 (roll your own) is the right choice because the project already has every building block: Mongoose for storage, `jsonwebtoken` for signed tokens, Node `crypto` for secure random generation and hashing, and a raw `http.createServer` that makes Express middleware based libraries (Passport) a poor fit. The OTP flow is a well understood pattern with a small surface (6 endpoints, 2 models, one email transport), not a complex auth system with OAuth, MFA, or social login.

The main risk, owning the security surface, is bounded by the simplicity of the flow and the scope's explicit per challenge limits (5 attempts, 60 s cooldown, 10 minute TTL, hashed at rest). Phase 9 adds IP and email rate limits. The team accepts the tradeoff of no server side JWT invalidation; the 7 day window is acceptable for a voting platform where the worst case is someone voting under another voter's identity (mitigated by the fact that votes are anonymous and the OTP itself is the primary auth barrier).

A hosted provider (Option 2) would be the right call for a product with complex auth needs (OAuth, SSO, MFA), but it is over engineering for a self hosted platform with one admin and passwordless voters. The scope explicitly names Nodemailer and Gmail SMTP, signaling that the team wants to own the email pipeline. An auth library (Option 3) is blocked by the raw `http` server architecture; adding Express to accommodate Passport changes the server's fundamental shape for no proportional benefit.
