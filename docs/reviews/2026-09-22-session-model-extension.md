# Review, session model extension (spec 0001), 2026-09-22

**Reviewed by**: inline review in this client, so the fresh model guarantee is degraded the same way the 2026-09-21 review notes it; the reviewer may share the author model's blind spots
**Scope**: the uncommitted diff on `develop1` as it relates to spec 0001: the Session schema, `CREATE_SESSION` ingress, reducer, broadcast summary, persistence and recovery, bootstrap, join code generator, and the admin form mode note. The diff also carries the earlier security hardening work; that was reviewed separately on 2026-09-21 and is not re-reviewed here except where the two changes touch.
**Verdict**: Pass with fixes requested. No blocker. Two majors should be fixed before this ships, four minors are worth fixing in the same pass, five nits are optional.
**Update (2026-09-22)**: both majors and all four minors are fixed and verified (resolutions noted inline below); the five nits remain open.

## Summary

The change delivers spec 0001 cleanly. The seven new fields land on the schema with the right types and enums, `votingMode` is derived on the server from the entry count so the client cannot lie about it, the join code generator uses the exact charset and length the spec pins, and the TTL index carries the correct partial filter on `pending` status. Ingress validation rejects a bad session type, a bad `candidateInfo` item, and an out of range timer before any dispatch, and the reducer plus broadcast plus persistence all carry the new fields end to end. The admin form note derives its count from the same parse the submit path uses, so the note and the created session cannot disagree. Existing suites pass: 392 server tests and 289 client tests, and the build succeeds. The problems found below are edge cases at the database guard and validation gaps on two of the new fields, plus one broken verify claim.

## What checks out against the acceptance criteria

- **AC-1**: `votingMode` is derived in the ingress handler from `entries.length` against `SINGLE_BALLOT_MAX`, spread over the client payload so a client supplied value is always overwritten, and the reducer re derives the same value only as a fallback. Server tests cover 2, 4, 6, and 7 plus.
- **AC-2**: `generateJoinCode()` produces exactly 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` using `crypto.randomInt`, with tests asserting the alphabet and the omission of 0, O, 1, I, and L. See the major below on the uniqueness guard.
- **AC-3**: out of range and non integer timers are rejected before dispatch and no session is created. See minor 4 on the error field naming.
- **AC-4**: `pendingExpiresAt` is set to creation time plus 7 days, and the TTL index uses `expireAfterSeconds: 0` with `partialFilterExpression: { status: 'pending' }`, so open, completed, and archived sessions are never deleted.
- **AC-5**: the mode note shows the exact spec strings and flips at the 6 to 7 boundary, counting distinct trimmed non empty entries, which matches what the submit handler sends.
- **AC-6**: all seven fields appear in `getSessionsSummary`, so the `sessions` broadcast carries them with no separate fetch.
- **AC-7**: omitted `candidateInfo` becomes an empty list in the reducer, and the bootstrap seeds dispatch without it and still pass.
- **AC-8**: both suites pass without modification, except that client lint fails on one new file. See major 2.

## Major

### 🟠 The joinCode unique index is stricter than the spec invariant and can silently drop a new session from persistence, `voting-server/src/db/models/Session.js` and `voting-server/src/server.js` (getUniqueJoinCode)

**Problem**: The spec says the invariant is uniqueness across `pending` and `open` sessions only, and that completed and archived sessions may reuse a code. The collision check in `getUniqueJoinCode` follows that, querying `status: { $in: ['pending', 'open'] }`. But the schema index is `unique: true, sparse: true` with no partial filter, so it enforces uniqueness across every document ever saved, including completed and archived ones. The hard guard contradicts the stated invariant.

**Why it matters**: Two ways this bites. First, the slow one: join codes are random over roughly 887 million combinations, so after a few thousand archived sessions a new code will eventually land on an archived session's code. The collision check passes, dispatch succeeds, the session exists in memory and is broadcast, and then `saveSession` rejects with a duplicate key error that `persistNewSession` only logs. The session never reaches the database, so it is lost on restart. Second, the fast one: two `CREATE_SESSION` actions that race between the check and the save can pick the same code, and one of them loses its persistence the same way. Nothing surfaces to the admin in either case.

**Suggested fix**: Make the guard match the invariant by giving the index the same partial filter the check uses, for example `partialFilterExpression: { status: { $in: ['pending', 'open'] } }`. Optionally, catch a duplicate key error from `saveSession` and retry creation with a fresh code instead of logging and moving on.

**Resolution (2026-09-22): Fixed.** The unique index moved out of the field definition into a schema level index with `partialFilterExpression: { joinCode: { $exists: true }, status: { $in: ['pending', 'open'] } }`. The `$exists` clause replaces the old `sparse` option, because MongoDB rejects mixing `sparse` with `partialFilterExpression` (caught by the suite on the first attempt). The index now matches the spec invariant: only pending and open sessions participate, so completed and archived sessions can reuse a code, and a code landing on an archived session no longer kills the new session's persistence. Both suites pass after the fix: 392 server, 289 client, and client lint is clean.

### 🟠 Client lint fails on the new admin mode note spec, contradicting verify.md, `voting-client/test/admin_mode_note_spec.js:1`

**Problem**: `npm run lint` reports one error: `'test' is defined but never used` on the first import line. `docs/specs/0001-session-model-extension/verify.md` records lint as `0 errors and 0 warnings`, and AC-8 requires the existing checks to pass.

**Why it matters**: The verify record is the proof the feature shipped clean, and right now it is wrong. If lint runs in any gate before merge, this blocks it.

**Suggested fix**: Drop `test` from the import in that spec file and rerun `npm run lint`. Update verify.md with the current counts while you are there (it records 386 server and 287 client tests; the suites now count 392 and 289).

**Resolution (2026-09-22): Fixed.** The unused `test` import is removed and `npm run lint` reports zero problems. The verify.md count update was not done in this pass (it belongs to the minor cleanup, since the counts will move again when the minors land).

## Minor

### 🟡 persistence.js hardcodes the literal 6 instead of importing SINGLE_BALLOT_MAX, `voting-server/src/db/persistence.js` (persistNewSession and persistSeedSessions)

**Problem**: Both functions fall back with `entriesArray.length <= 6 ? 'single_ballot' : 'tournament'`. The spec makes `SINGLE_BALLOT_MAX` the single source of truth for the mode boundary and the constants file itself says never hard code these values inline. `server.js` imports the constant correctly; persistence does not.

**Why it matters**: If the boundary ever moves, these two fallbacks silently disagree with the derivation and the broadcast. The fallback paths only run for legacy state with no stored mode, which is exactly the code nobody rechecks.

**Suggested fix**: Import `SINGLE_BALLOT_MAX` from `../constants.js` and use it in both places.

**Resolution (2026-09-22): Fixed.** Both fallbacks now use the imported `SINGLE_BALLOT_MAX` constant.

### 🟡 `whoCanJoin` is not validated at ingress, so a bad value creates a session that never persists, `voting-server/src/server.js` (CREATE_SESSION branch)

**Problem**: The handler resolves `whoCanJoin` as `action.whoCanJoin || 'public'` with no enum check, while the schema restricts it to `['public', 'allowlist', 'approval']`. A create with `whoCanJoin: 'banana'` passes ingress, dispatches, appears in the broadcast, and then fails Mongoose validation inside `saveSession`, which is only logged. The same applies to a non boolean `publishResultsPublicly`, which Mongoose will coerce unpredictably.

**Why it matters**: The admin sees a created session that vanishes on restart. The spec's API table lists `whoCanJoin` as an accepted input, so it deserves the same ingress validation the other inputs got.

**Suggested fix**: Validate `whoCanJoin` against the enum at ingress with a `VALIDATION_ERROR`, and accept only booleans for `publishResultsPublicly`.

**Resolution (2026-09-22): Fixed.** The `CREATE_SESSION` ingress branch rejects an unknown `whoCanJoin` value and a non boolean `publishResultsPublicly` with `VALIDATION_ERROR` before dispatch, so a bad value can no longer create a memory-only session that fails persistence. Regression tests in `review_minors_2_regression_spec.js` cover the rejection of both bad values (asserting nothing reaches the store or MongoDB) and the acceptance of all three valid enum values.

### 🟡 Bootstrap seeds bypass the uniqueness check and set no pendingExpiresAt, `voting-server/src/bootstrap.js`

**Problem**: The seed sessions call `generateJoinCode()` directly rather than `getUniqueJoinCode()`, and they dispatch without `pendingExpiresAt`, so the reducer stores null. They also bypass the ingress handler entirely, which is by design for seeding, but the joinCode difference means a seed can collide with an active session's code and fail its save with the same silent duplicate key error.

**Why it matters**: Low probability, but the failure mode is a seed session missing from the database with only a log line. The null `pendingExpiresAt` is actually correct, since TTL must never eat a seed, and it is worth a comment saying so.

**Suggested fix**: Reuse `getUniqueJoinCode()` in bootstrap when a database is connected, and add a comment noting that omitting `pendingExpiresAt` is deliberate.

**Resolution (2026-09-22): Fixed.** Bootstrap keeps its synchronous contract (tests and startup sequencing depend on it), so instead of going async it accepts an optional `options.joinCode`, and `index.js` passes `await getUniqueJoinCode()` for each seed so codes are checked against recovered pending and open sessions before the store exists. Comments in both bootstrap functions explain why `pendingExpiresAt` is deliberately omitted (seed sessions must never be TTL-deleted). Bootstrap without a DB falls back to a plain random code, which is safe before any sessions exist.

### 🟡 The AC-3 error contract drifted from the spec, `voting-server/src/server.js` (timer validation)

**Problem**: AC-3 names a `VALIDATION_ERROR` `action_error` event. The implementation sends `error: 'INVALID_TIMER_DURATION'` (or `INVALID_TIMER_DURATION_TYPE`) with an added `code: 'VALIDATION_ERROR'` field. The spec tests and the client will need to agree on which field is the contract.

**Why it matters**: Phase 2 and the future ballot mode will key error handling on these payloads. Two names for one thing invites someone to check the wrong one.

**Suggested fix**: Either update the spec to name `INVALID_TIMER_DURATION` with the `code` field as the contract, or make `error` carry `VALIDATION_ERROR` and move the specific code into the `code` field everywhere in this handler.

**Resolution (2026-09-22): Fixed.** Resolved in favor of the existing implementation: `docs/API_CONTRACT.md`, `ARCHITECTURE.md`, and the suites all name `INVALID_TIMER_DURATION` and `INVALID_TIMER_DURATION_TYPE` as the contract, so the spec gained an error contract note under AC-3 documenting the concrete `error` values plus the shared `code: 'VALIDATION_ERROR'` category. No code change needed.

## Nits

- ⚪ `voting-server/src/server.js` and `voting-server/src/reducer.js` both compute `action.sessionType || (action.type !== 'CREATE_SESSION' ? action.type : null) || 'public'`. Inside the `CREATE_SESSION` branch and case the middle clause is always false, so it is dead weight in two places. Simplify to `action.sessionType || 'public'`.
- ⚪ `voting-client/src/pages/Admin.jsx` puts the mode note styles inline in a style object while also giving the element a `className`. Move the styles into `Admin.css` under `admin-mode-note`.
- ⚪ The candidate count expression in the mode note duplicates the parse in `handleCreateSession`. Extract a small helper, for example `countDistinctEntries(text)`, and use it in both spots so they cannot drift.
- ⚪ `voting-client/src/constants.js` mirrors the server constant by hand, and nothing asserts the two agree. A tiny test importing both would pin it, or a shared note in both files pointing at the other.
- ⚪ The mode note shows `2 to 6 candidates: Single Ballot` even with an empty or one entry box. Harmless, but showing the tournament warning text only when the count is over the boundary and staying quiet otherwise would read better.

## Strengths

- The server side derivation of `votingMode` with the spread after `...action` is exactly right: a client cannot forge the mode no matter what it sends, and the reducer only re derives as a fallback for legacy callers.
- The mode note and the submit path derive their counts with the same dedupe, trim, and filter, so the note can never promise a mode the server will not deliver.
- `getSessionsSummary`, the reducer, `persistNewSession`, `persistSeedSessions`, and `recoverSessionsFromDb` all carry the new fields consistently, so a session survives a restart with its mode, code, and metadata intact.
- The TTL index partial filter is correctly scoped to `pending`, and `expireAfterSeconds: 0` against a date field gives the exact expiry semantics the spec asked for with zero server code.
- The join code charset omits every confusable character and uses `crypto.randomInt`, and the tests pin both properties.

## Test coverage

TESTS = both suites run locally for this review: 392 server tests pass (about 1 minute) and 289 client tests pass, plus the production build. The new `session_model_extension_spec.js` covers the generator, mode derivation at both boundaries, the broadcast fields, the validation rejections, and the omitted `candidateInfo` default. What the suites miss maps to the findings above: nothing creates a session whose code matches an archived session (would have caught major 1), and nothing sends an invalid `whoCanJoin` (would have caught minor 2). Both are cheap to add as regression specs alongside the fixes.

**Update (2026-09-22)**: the two named gaps are now covered by `review_minors_2_regression_spec.js`: a pending session persisting with the code of a completed session, the same for an archived session, a duplicate code between two pending sessions still rejected with error code 11000 at the index, and ingress validation of `whoCanJoin` and `publishResultsPublicly`. One extra finding surfaced while writing them: the ingress always overwrites a client supplied `joinCode` with a server derived one, which is correct server authority and is now pinned by a test. Counts after the minors: 399 server tests, 289 client tests, all passing; client lint clean, build clean.
