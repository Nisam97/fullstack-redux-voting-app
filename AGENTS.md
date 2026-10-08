# VoteSphere

## Stack

- **Language / Runtime**: JavaScript (ES modules), Node.js 18+
- **Frontend**: React 19, Vite 8, Redux Toolkit 2, React Router 7, Recharts, Socket.io client
- **Backend**: Node `http`, Socket.io 4, Redux 5 over Immutable.js 3, Mongoose 9 on MongoDB
- **Key dependencies**: @reduxjs/toolkit, immutable, mongoose, socket.io, jsonwebtoken, bcrypt, nodemailer (OTP email), csv-parse (allowlist upload); client extras: qrcode (lobby QR codes), lucide-react, react-icons
- **Package manager**: npm, two separate packages (`voting-client`, `voting-server`), no workspace tooling

## Build approach

Tracer Bullet (each phase adds one real, thin end-to-end strand through the full stack; nothing faked).

## Commands

```bash
# Environment (server reads .env at the repo root; Mongo defaults to mongodb://localhost:27017/votesphere_dev).
# .env.example also documents VOTER_JWT_SECRET, OTP_TTL_MINUTES, and the SMTP_* block; an empty SMTP_HOST logs OTPs to the console.
cp .env.example .env
# Install (run inside each package)
cd voting-client && npm install
cd voting-server && npm install
# Dev servers (client 5173, server 8090)
cd voting-client && npm run dev
cd voting-server && npm start
# Build, lint, test
cd voting-client && npm run build
cd voting-client && npm run lint
cd voting-client && npm test   # node --test unit specs, then Vitest component tests
cd voting-server && npm test   # Mocha via test/runner.cjs
```

## Specs

Stored in `docs/specs/`. Older specs are a single file, `docs/specs/NNNN-title.md`; newer ones are a directory, `docs/specs/NNNN-title/`, holding `index.md`, often `rationale.md`, and a `verify.md` written by `/check verify` that carries the runtime record per acceptance criterion. Long form design notes live in `docs/`.

## Rules

- The server is authoritative. Voting math, tallies, timers, and round advancement run only on the backend; the client renders state and emits intent, never computing quorum or dispatching `NEXT` on its own.
- `voting-server/src/core.js` is a protected 39 line pure module with a pinned SHA-256. Do not edit it, wrap new behavior around it.
- Backend state is an Immutable.js Map keyed `sessions.<sessionId>`. Reducers return new state, never mutate, and every session scoped action carries `sessionId`.
- Lifecycle mutations (`CREATE_SESSION`, `START_SESSION`, `NEXT`, `ARCHIVE_SESSION`, `SET_ENTRIES`) travel over Socket.io behind an admin JWT. There are no REST lifecycle mutation endpoints.
- Admin only socket actions also cover eligibility and visibility: `SET_ALLOWLIST`, `APPROVE_PARTICIPANT`, `REJECT_PARTICIPANT`, `REMOVE_PARTICIPANT`, `SET_WHO_CAN_JOIN`, `SET_PUBLISH_RESULTS`. Register every new admin action in `ADMIN_ACTION_TYPES` in `voting-server/src/server.js` or ingress rejects it.
- Voter identity is passwordless. A voter signs in with an emailed 6 digit OTP, and the server sets an HttpOnly `vs_voter` cookie signed with `VOTER_JWT_SECRET`, which is separate from the admin `JWT_SECRET`. OTP codes are stored salted and hashed, never in plain text.
- A server `action_error` with `UNAUTHORIZED` means the stored admin JWT is no longer verifiable. The client treats that as a dead credential: it drops both admin keys, clears the socket handshake, and sets `adminSessionExpired` so admin only surfaces say the session is gone instead of rendering as empty data. `isAdminLoggedIn()` checks only the token's own `exp`, so a token can look valid locally while the server rejects it. Admin only surfaces must never show a refusal as "no data".
- Sessions come in two types. `public` is open, `secured` requires `whoCanJoin` set to `allowlist` (admin pastes emails) or `approval` (voters request, admin decides). `public` is rejected for a secured session at `CREATE_SESSION`.
- Secured sessions are hidden from voter facing broadcasts and the join code resolver returns only summary metadata for them, never allowlist or participant detail.
- `VoteParticipation` records who voted in each round as an audit trail for the admin turnout view. It stores the voter and the round only, never the vote choice.
- Result visibility is one matrix, decided only on the backend by `resolveResultVisibility`. A public result is visible to everyone; a secured result is visible only to the admin and its approved participants until the admin publishes it. Reads fail closed: a result whose type cannot be resolved is gated as secured, never public. `Result.type` mirrors `Session.type`, and a startup backfill fills legacy rows.
- No read may confirm that a gated secured session exists. A caller who may not see it gets the same status and the same body an unknown id gets, on every path that serves session metadata, and the client renders one neutral not available state for every such 404 rather than copy that claims the session is gone.
- `VOTER_JWT_SECRET` is required in production. Startup calls `validateVoterJwtSecret()` and a missing value is a warning in development but a thrown error in production.
- Duplicate votes are blocked on the composite key `${sessionId}:::${roundId}:::${sortedPair}:::${voterToken}` (pair is sorted, `roundId` is the monotonic identity `${sessionId}:::r${roundIndex}`). Scoping the key per round means a pair that meets again after a tie accepts fresh votes. A callback for an older round is stale and ignored.
- Voter presence is tracked in the backend Redux store and snapshotted per round. Early completion requires quorum across active snapshot voters within a 10 second disconnect grace window; broadcasts only expose sanitized headcount counts, never tokens or socket IDs.
- `applyTallyVisibilityGuard` gates three carriers by two rules. `rounds[]` is the settled history of rounds that already closed, so it releases the moment a round closes (`ROUND_CLOSED`), at a reveal, at a conclusion, and for a `pending` recovery holding settled rounds with no live round; every entry was already broadcast when its round closed, so withholding it after a crash leaks nothing. `finalVote` and the live `vote.tally` carry the round that is still waiting for its reveal, so they release only at a conclusion or a reveal, and the tally is emptied to `{}` rather than deleted so the client keeps the vote shape. `TIE_PENDING` withholds all three, and nothing is released while `roundLifecycle` is `VOTING`.
- Client Redux state is normalized as `{ list, activeSessionId, bySessionId }`. Keep session data under `bySessionId`, never promote it to the top level, and never let a token reach it. `normalizeSession` strips `voterToken`, `token`, `jwt`, `password`, and `secret`.

## Agent skills

- [audit](.agents/skills/audit/): `jsmastery-pro/skills`, bootstraps these context files.
- [architect](.agents/skills/architect/): `jsmastery-pro/skills`, turns approved scope into specs.
- [scope](.agents/skills/scope/): `jsmastery-pro/skills`, defines what gets built.
- [develop](.agents/skills/develop/): `jsmastery-pro/skills`, builds one scope item.
- [test](.agents/skills/test/): `jsmastery-pro/skills`, writes and runs tests.
- [check](.agents/skills/check/): `jsmastery-pro/skills`, verifies work before handoff.
- [debug](.agents/skills/debug/): `jsmastery-pro/skills`, diagnoses failures.
- [document](.agents/skills/document/): `jsmastery-pro/skills`, writes docs and the PR.
- [sync](.agents/skills/sync/): `jsmastery-pro/skills`, keeps these context files current.

All Agent Skills install to the repo root `.agents/skills/`, whatever package they serve, so a nested `AGENTS.md` links one with `../.agents/skills/<skill>/`. `skills-lock.json` records the registry source and install scope for each one.

- Declined: Socket.io, Mongoose, Nodemailer, React Router, Recharts (tool discovery skipped by the engineer, nothing was searched or installed)

## Context files

- [voting-client/AGENTS.md](voting-client/AGENTS.md): React 19 and Redux Toolkit client conventions.
- [voting-server/AGENTS.md](voting-server/AGENTS.md): authoritative engine, auth, timers, persistence.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
