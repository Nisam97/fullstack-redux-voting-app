# VoteSphere

## Stack

- **Language / Runtime**: JavaScript (ES modules), Node.js 18+
- **Frontend**: React 19, Vite 8, Redux Toolkit 2, React Router 7, Recharts, Socket.io client
- **Backend**: Node `http`, Socket.io 4, Redux 5 over Immutable.js 3, Mongoose 9 on MongoDB
- **Key dependencies**: @reduxjs/toolkit, immutable, mongoose, socket.io, jsonwebtoken, bcrypt
- **Package manager**: npm, two separate packages (`voting-client`, `voting-server`), no workspace tooling

## Build approach

<TBD, set by /scope>

## Commands

```bash
# Install (run inside each package)
cd voting-client && npm install
cd voting-server && npm install
# Dev servers (client 5173, server 8090)
cd voting-client && npm run dev
cd voting-server && npm start
# Build, lint, test
cd voting-client && npm run build
cd voting-client && npm run lint
cd voting-client && npm test   # node --test over test/*_spec.js
cd voting-server && npm test   # Mocha via test/runner.cjs
```

## Specs

Stored in `docs/specs/`, format `docs/specs/NNNN-title.md`. Long form design notes live in `docs/`.

## Rules

- The server is authoritative. Voting math, tallies, timers, and round advancement run only on the backend; the client renders state and emits intent, never computing quorum or dispatching `NEXT` on its own.
- `voting-server/src/core.js` is a protected 39 line pure module with a pinned SHA-256. Do not edit it, wrap new behavior around it.
- Backend state is an Immutable.js Map keyed `sessions.<sessionId>`. Reducers return new state, never mutate, and every session scoped action carries `sessionId`.
- Lifecycle mutations (`CREATE_SESSION`, `START_SESSION`, `NEXT`, `ARCHIVE_SESSION`, `SET_ENTRIES`) travel over Socket.io behind an admin JWT. There are no REST lifecycle mutation endpoints.
- Duplicate votes are blocked on the composite key `${sessionId}:::${pair}:::${voterToken}`. Round identity is monotonic `${sessionId}:::r${roundIndex}`, and a callback for an older round is stale and ignored.
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

## Context files

- [voting-client/AGENTS.md](voting-client/AGENTS.md): React 19 and Redux Toolkit client conventions.
- [voting-server/AGENTS.md](voting-server/AGENTS.md): authoritative engine, auth, timers, persistence.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
