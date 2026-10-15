# 0010. Adopt a JavaScript, Node and React stack for VoteSphere

**Date**: 2026-10-15
**Status**: Accepted (records the stack the shipped v2 build already runs on)

## Summary

VoteSphere runs one language on both sides. A React 19 client built by Vite talks to a Node server over Socket.io, the server holds all session and tournament state in Redux over Immutable.js, and finished results are written to MongoDB through Mongoose. The server decides everything and the client renders what it broadcasts.

This spec records that stack as the architecture decision for the project. It is the source the Stack field in the root `AGENTS.md` is reconciled against, so that field stops drifting on its own.

## Context

The long form architecture document was retired on 2026 October 07. `docs/ARCHITECTURE.md` is now a seven line stub that points at `Architecture.md` in the repo root, and the README carries a technology table of its own. Nothing under `docs/specs/` ever recorded the stack, so the root Stack field, which `/audit` wrote from the two package manifests, had no source of truth behind it. Two documents describing the same layers by different names is how the field drifts.

The stack itself was not chosen in a bake off. It arrived with the recovered engine. Before the v2 build this repository had a working pure tournament core, a Redux store, a Mocha suite and a Socket.io server on the `origin/backend` branch, while `develop1` held an empty `voting-server` README and a client that was an in memory React mock with no backend and no Redux. Every later decision layered auth, persistence, sessions, secured sessions and visibility around that engine rather than replacing it, and the protected 39 line core keeps a pinned SHA-256 so an accidental edit is visible.

The forces that constrain any future change are worth naming, because they are what the stack has to keep satisfying. The server is the only authority for tallies, quorum, timers and round advancement. Voter identity is passwordless. Two npm packages ship from one repository with no workspace tooling. There is no chosen deployment target yet, and no observability beyond console logging and the rate limit and timing helpers.

## Options considered

### Option 1: Recover the existing engine and build a real client against it

Take the tournament core, Redux store, Mocha suite and Socket.io server that `origin/backend` preserved, and build the auth, persistence and client layers around them. This is what the project did.

**Pros**:
- The pinned pure core and its tests survive untouched, so the tournament mathematics stays proven.
- The published action vocabulary and reducer shape were already settled, which kept the client honest about emitting intent only.
- Roughly a third of the system existed before the workflow started.

**Cons**:
- Every later requirement had to be layered around a module that cannot be edited, which is why single ballot voting needed a separate `ballot.js`.
- The inherited code carried no auth, no persistence and no session model, so those arrived as features 2 through 9 in the scope rather than as foundation work.

### Option 2: Rebuild both packages from scratch on a fresh stack

Start clean, choose the frameworks freely, and write the tournament math again.

**Pros**:
- No legacy to carry, and free choice of language, type system and data store.
- The data model could be designed once around sessions, results and participation instead of grown around an in memory bracket.

**Cons**:
- It throws away the only proven part of the system, the pure core, and the tests that pin it.
- Every working behaviour would need re verification, and the pinned hash guarantee would be lost.

## Decision

**Chosen option**: Option 1: Recover the existing engine and build a real client against it.

One language across both packages, JavaScript, with the server as the only authority, Redux over Immutable.js for server state, React and Redux Toolkit on the client, Socket.io for transport, and Mongoose on MongoDB for persistence.

## Rationale

The deciding force was the protected core. It is the one part of the system with mathematics worth trusting, it already had a hash pinned in the README and a suite of tests, and both would be lost by a rewrite. The second force was that the requirements that followed, accounts, secured sessions, visibility and the lobby existence gate, are all about who may see or do something. Those are transport and persistence concerns that layer cleanly around an engine, which is what happened, and they do not argue for a different engine.

The remaining choices follow from keeping the server authoritative. Immutable.js makes "reducers never mutate" enforceable rather than aspirational, and the same Redux vocabulary on both sides keeps the client thin, since it renders broadcast state instead of deriving it. Mongoose earns its place by doubling as the persistence contract: the `Session` and `Result` schemas are read by the backfill, the visibility resolver and the archive query, so a schema change is a visible change to three call sites.

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Language | JavaScript, ES module syntax in both packages | One language end to end. No type system is in use anywhere. |
| Runtime | Node.js 18 or newer, per the README. CI pins 24. No `engines` field enforces the floor. | Node runs the server, the test runners and the build tooling. |
| Framework | React 19 with Vite 8 on the client. The server uses Node `http` and Socket.io directly, with no web framework. | The client is a single page app with a small route table; the server needed sockets far more than it needed routing or middleware. |
| Primary DB | MongoDB through Mongoose 9 | Session and result documents are read and rewritten whole, and the OTP challenge leans on a TTL index. |
| Auth | Passwordless 6 digit email OTP for voters, in an HttpOnly `vs_voter` cookie signed with `VOTER_JWT_SECRET`. One seeded admin with a bcrypt hash and a JWT over the socket handshake. | No voter password is stored at all, and the admin secret is separate from the voter secret. |
| Hosting | Not decided. Deployment and CI/CD sit in the scope's deferred list. | Nothing here has been proven outside local development. |
| Observability | Not decided. Server console logging, plus the rate limit and timing utilities. No tracing or metrics. | Enough to debug local runs and the hardening pass, not enough for production. |
| Client state | Redux Toolkit 2, one normalized store, with React Router 7 for routing and Recharts 3 for the results chart | The client holds `list`, `activeSessionId` and `bySessionId`, and never promotes session data or tokens out of the slice. |
| Server state | Redux 5 over Immutable.js 3, one store keyed `sessions.<sessionId>` | The immutability is what makes the never mutate rule checkable, and it makes a session snapshot cheap to take. |
| Realtime | Socket.io 4 on both sides, with the admin JWT and the voter cookie riding the handshake | Lifecycle mutations are socket actions behind an admin token, and there is no REST route that mutates a session. |
| Email | Nodemailer 10 with an SMTP transport, and a console fallback when `SMTP_HOST` is empty | OTP delivery without a mail provider in local development. |
| Testing | Mocha 10, chai, chai-immutable and `mongodb-memory-server` for the server. `node --test` plus Vitest 5 and Testing Library for the client, with Playwright and axe-core for the browser passes. | Two runners match two packages: the server suite needs a real Mongo, the client suite needs a DOM. |
| Access control data | Mongoose models for `User`, `OtpChallenge`, `Session`, `Result`, `SessionAllowlistEntry`, `SessionJoinRequest` and `VoteParticipation` | Eligibility and turnout are records rather than flags, so a removal or a vote survives a restart. |
| Package manager | npm, two separate packages, no workspace tooling | The two packages install and test independently, which is also why the CI backend job installs client dependencies for one cross package spec. |

## Consequences

**Positive**:
- One language across both packages, so a reader moves between client and server without a context switch.
- The server authority rule is structural rather than conventional: the client has no tally code to misuse.
- The pinned pure core keeps the tournament mathematics auditable, and its hash makes an accidental edit visible.
- Voter identity stores no password, so there is no password hash to leak or to reset.

**Negative / tradeoffs**:
- No type system, so a shape error between the socket payload and the reducer surfaces only at runtime. The manifests carry `@types/react`, which type checks nothing.
- Every state change costs a socket round trip, and results are deliberately invisible during a live round.
- Immutable.js is pinned to major 3, so the familiar Immutable 4 API does not apply.
- Two packages with no workspace tooling means duplicated installs, two lockfiles, and no way for one package to import from the other.
- No `engines` field and no lockstep runtime: CI runs 24 while the README advertises 18, and nothing enforces either.
- Hosting and observability are undecided, so the deployment story and the production debugging story are both unproven.
- Styling is plain CSS with one shared token sheet. Nothing prevents a component from hardcoding a colour instead of reading a token.

**Neutral**:
- The same Redux ideas wear two APIs, Toolkit on the client and plain Redux over Immutable on the server.
- `.env` lives at the repo root and serves both packages: the server reads it directly, and Vite reads the same file (`envDir: '..'`) for the `VITE_*` variables the client needs, so there is one env file rather than two.
- The protected 39 line core stays byte identical, which is why later voting modes live in `ballot.js`.

## Follow-up

- [ ] Declare `engines` in both packages, or write the real Node floor here once it is decided.
- [ ] Record a hosting and an observability choice when deployment leaves the deferred list.
- [ ] Decide whether the README technology table stays, or defers to this spec, so the project has one place that names the stack.
