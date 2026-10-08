# Review, develop1, 2026-10-03 (re-review of secured sessions)

**Reviewed by**: haiku, run inline (author reported as haiku). This client has no subagent support, so the cross model guarantee is degraded: the reviewer ran in the same session on the same model as the author. Treat this as a same-model review, not the fresh model guarantee the skill promises.
**Scope**: 25 files, branch vs main, limited to the secured sessions feature (spec 0007 and its implementation, the same area the 2026-10-03 review covered) plus this round's fixes: `voting-server/src/server.js`, `voting-server/src/auth/voter.js`, `voting-server/src/reducer.js`, three Mongoose models, `voting-client/src/services/socket.js`, `auth.js`, `pages/Admin.jsx`, `pages/Lobby.jsx`, `redux/voteSlice.js`, the regression and component suites, `vitest.config.js`, `test-preferences.json`, spec `index.md` / `verify.md`, `AGENTS.md`, `docs/scope/scope.md`.
**Verdict**: Blocked

**Status of the previous six findings**: all six verified fixed by direct reading. `join_session` and REST share `resolveSessionAccess` + `evaluateSecuredEligibility` (`server.js:662`, `server.js:703`); `filterSessionsForCaller` covers the socket summary, the broadcast, and `GET /api/sessions` (`server.js:437`, `server.js:1363`); `subscribe_session` resolves identity before joining the room (`server.js:1943`); an unusable `whoCanJoin` lands in a deny branch (`server.js:803`); secured joins after Start return 409 before any request row is written (`server.js:726`); the admin roster re-subscribes on `connect` (`voting-client/src/pages/Admin.jsx:184`) with a red checked component test. None of the six reopened.

This re review found one new blocker the previous review missed, in the same family as its findings: the eligibility gate closes at join time, but removal never revokes the token that join issued.

## Summary

The six earlier findings are genuinely fixed and each has coverage. The remaining hole is that participant removal, which is half of what "secured" means for the admin, does not invalidate anything the server already issued. `REMOVE_PARTICIPANT` deletes the allowlist entry or request row and removes the token from the headcount index, but the token itself stays valid in `votersByToken`, and `validateVoterToken` accepts it through the `voter.sessionId === normSession` shortcut. There is no eligibility re check at VOTE time to catch it. A voter the admin removed can still cast a counted vote, and a voter whose email is dropped by an allowlist paste is never disconnected at all. The one test that claims to pin removal passes for an unrelated reason.

## Blockers

### 🔴 Removal never revokes the voter token, so a removed participant can still vote, `voting-server/src/auth/voter.js:135`

**Problem**: Removal performs three invalidations and misses the one that matters.

- `REMOVE_PARTICIPANT` while pending (`server.js:2817` to `server.js:2845`) deletes the allowlist or request row, dispatches `RECORD_PRESENCE_DISCONNECT`, makes the socket leave the room, and calls `tokensBySession.get(sessionId).delete(targetToken)`. It never calls `votersByToken.delete`.
- The deferred path at `NEXT` (`server.js:2990` to `server.js:3021`) does the same: `sessionTokens.delete(targetToken)` only.
- `validateVoterToken` (`voter.js:135`) accepts a token when `voter.sessionId === normSession` OR the token is in `tokensBySession`. The removal deletes the second, the first still passes, because `registerVoter` set `voter.sessionId` at join and nothing ever clears it. The only code that deletes from `votersByToken` is `releaseSessionVoters` on session completion (`server.js:1712`) and the test helper `clearVoterTokens`.
- VOTE (`server.js:3035`) derives `voterToken = 'user:' + socket.data.userId` from the handshake cookie (`server.js:3066`), never from client input, then calls `validateVoterToken` and `canCastVote`. There is no allowlist, request status, presence, or snapshot check anywhere in the VOTE path.

Confirmed by experiment against the unmodified module: register a voter for `S1`, run the exact invalidation removal performs (`tokensBySession.get('S1').delete('user:U1')`), then `canCastVote({ sessionToken: 'user:U1', sessionId: 'S1', ... })` returns `allowed: true`. `validateVoterToken` returns `valid: true`.

Two details make this worse:

1. The removed voter's socket is only told to leave the room (`server.js:2837`, `s.leave`), never disconnected, even though AC-7 (`docs/specs/0007-secured-sessions/index.md:27`) says removal "immediately disconnects the voter's socket". The `vs_voter` cookie stays valid, so `socket.data.userId` survives, and VOTE derives the token from it without any client cooperation.
2. `subscribe_session` (`server.js:1943`) accepts the same surviving token, so a removed voter who reconnects (Socket.io auto reconnect, or admin login cycling the socket) re-joins the `session:<id>` room and `RECORD_PRESENCE_CONNECT` puts them back in presence, which puts them back in the next round's eligibility snapshot. The client's own reconnect logic re emits `subscribe_session` automatically.

**Why it matters**: This is the eligibility guarantee the whole feature exists to deliver. The scope Done when says "removing an email in lobby drops that person immediately". As written, an admin who removes a voter gets the UI feedback (roster row gone, voter sees the removal toast) while that voter's vote still lands in the tally if the session opens or continues. Removal is an administrative security action; a security action that only changes what the admin sees, not what the removed party can do, fails closed on the wrong side. The same hole covers the deferred mid round removal path the previous review did not examine.

**Suggested fix**: Revoke at the source, not at the count. On removal in both branches, delete the token from `votersByToken` (respecting the same cross session guard `releaseSessionVoters` uses, since `user:<id>` tokens are shared across sessions, see `voter.js:270`), and disconnect the removed voter's socket as AC 7 already promises. As defense in depth, add a vote time eligibility re check for secured sessions: the VOTE handler already knows the session and the voter, so resolve `type` and reject when the voter holds no active allowlist entry or approved request. Cover both with a test that votes from a socket carrying the removed voter's `vs_voter` handshake cookie, which is the real path, not a bare payload token.

## Major

### 🟠 The removal test passes for the wrong reason and pins nothing, `voting-server/test/secured_sessions_spec.js:545`

**Problem**: `it('invalidates voterToken immediately on REMOVE_PARTICIPANT and blocks subsequent votes')` sends VOTE with `action.voterToken` from a socket created by `createSocketClient()` with no handshake cookie (`secured_sessions_spec.js:53`), so `socket.data.userId` is undefined. The VOTE handler hits the client claim guard first (`server.js:3056`): a `user:` token supplied by a socket with no verified identity is rejected as `FORBIDDEN_VOTER_TOKEN` regardless of whether removal invalidated anything. The assertion at line 606 expects exactly `FORBIDDEN_VOTER_TOKEN`.

**Why it matters**: The test would pass if `REMOVE_PARTICIPANT` were an empty no op. It gives false confidence in exactly the control the blocker above shows is missing, and it was read as evidence that removal works during the previous verify run.

**Suggested fix**: Make the test vote from a socket whose handshake carries the removed voter's real `vs_voter` cookie, so the token is server derived rather than client claimed, and assert the vote is rejected because the voter was removed, not because the token looks forged. Once the blocker is fixed, that test goes red before the fix and green after it.

### 🟠 An allowlist paste that drops a joined voter does not disconnect them, `voting-server/src/server.js:2626`

**Problem**: `SET_ALLOWLIST` performs the diff based replacement (delete `SessionAllowlistEntry` rows missing from the new set, `server.js:2629`) and then only refreshes the admin roster (`emitSessionParticipants`, `server.js:2639`). It never touches `tokensBySession`, `votersByToken`, presence, or the voter's socket. A voter who already joined and then has their email removed by a pasted list stays fully registered, stays connected, and keeps voting rights. The scope Done when for this feature reads "removing an email in lobby drops that person immediately", and AC 3 (`docs/specs/0007-secured-sessions/index.md:23`) defines the paste as the primary way to manage the list.

**Why it matters**: Two admin controls that look identical in the UI ("this email is no longer on the list") have different effects on the actual person: the Remove button revokes (partially, see blocker), the paste does nothing to them. An admin editing the list to cut someone off has no way to know the person is still in.

**Suggested fix**: After a diff that removes entries, revoke and disconnect every registered voter for the session whose email is no longer on the allowlist, through the same revocation helper the blocker fix introduces, so there is one removal path instead of two divergent ones.

## Minor

- 🟡 `voting-server/src/server.js:2837` and `server.js:3005` call `s.leave(session:<id>)` but never disconnect the socket, while AC 7 states removal "immediately disconnects the voter's socket" (`docs/specs/0007-secured-sessions/index.md:27`). Fixing the blocker's revocation makes this mostly moot, but the disconnect the spec promises should land with it.
- 🟡 `AGENTS.md:30` still documents the client test command as `node --test over test/*_spec.js`, but `npm test` now runs the node suite and the Vitest component suite (`voting-client/package.json:9`). `voting-client/AGENTS.md:42` still states "There is no jsdom" (jsdom and Vitest were added by this feature) and `voting-client/AGENTS.md:43` still says a new spec file will not run until added to the script, while the script now uses a glob that picks files up automatically. These are the canonical context files, so stale lines here will misdirect the next agent run. `/sync` owns promoting new conventions; flagging for it.

## Nits

- ⚪ `docs/specs/0007-secured-sessions/verify.md` now has two `## UI / manual` headings (lines 16 and 89) and two `## Commands` headings (lines 28 and 95) because the reconnect follow up section repeated the section names. A tool scanning by heading will see duplicates. Rename the follow up subsections or fold them into the originals.
- ⚪ `docs/specs/0007-secured-sessions/verify.md:105` still carries the "Defect found during verification, now fixed" narrative from the original run as a top level section below the new follow up section; the file reads as two appendices stacked. Worth a pass to order it as one checklist.
- ⚪ `server.js:437` `filterSessionsForCaller` takes `(summary, isAdmin)` but its JSDoc `@param` block still documents `(Object socket, Map state)`, copied from `getSocketSessionsSummary` above it. Harmless, the function is three lines.

## Strengths

- The previous round's fixes are real, not cosmetic: the shared gate is genuinely shared (both entry points call the same two functions), the deny branch logs before refusing, and `resolveSessionAccess` falls back to MongoDB so a store miss does not fail open. I checked each claim in the previous review's resolution notes against the code and all six hold.
- `voting-server/test/secured_sessions_regression_spec.js` now covers all four entry points with 16 focused tests, including the negative cases that matter (anonymous refused, allowlisted admitted, public unchanged), and section 8 pins the roster lock at Start for both transports.
- The new `admin_roster_resubscribe.test.jsx` red checks cleanly: I disabled the `connect` listener, the reconnect test failed, restoring it passed. The test asserts the emit, not the mock's existence.
- `evaluateSecuredEligibility` fails closed when the database is unreachable in allowlist mode, and identity is always derived from the verified `vs_voter` cookie or handshake, never from a client claim.
- The `act(...)` fix in `lobby_secured.test.jsx` routes the broadcast helper through `act` at one choke point instead of sprinkling wrappers at 26 call sites, so future broadcasts stay warning free.

## Test coverage

TESTS = configured (`node:test` for client unit, Vitest for components, Mocha on the server). Suites after this round: 634 server tests passing, 424 client unit tests plus 23 component tests passing (20 lobby, 3 new roster tests).

Coverage of the join, subscribe, discovery, and Start gates is strong and matches the previous findings line for line. The gap sits exactly where the new blocker is: no test attempts to vote after removal from a socket that carries a real `vs_voter` handshake (the existing test uses a socket with no identity, see Major), no test drops a joined voter through `SET_ALLOWLIST` and then checks their access, and no test exercises vote time eligibility for a secured session at all. The VOTE handler's eligibility surface is untested by design today, because it does not exist.
