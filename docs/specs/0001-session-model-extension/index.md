# 0001. Session Model Extension

**Date**: 2026-09-21
**Status**: Accepted

## Summary

VoteSphere sessions currently hold no information about voting mode or how voters discover them. This spec extends the `Session` Mongoose schema and the `CREATE_SESSION` Socket.io handler with seven new fields: a session type (`public` or `secured`), an auto-derived voting mode (`single_ballot` for 2 to 6 candidates, `tournament` for 7 or more), a unique 6-character join code, a `whoCanJoin` policy stored for Phase 7, per-candidate rich info (name and description), a results visibility flag, and a 7-day pending expiry. The admin create-session form gains a live mode note. No other behavior changes; existing suites must stay green.

## Requirements

**User stories**:
- As the admin, I want sessions I create to record their type, mode, and join code automatically so later phases can use them without a schema change.
- As the admin, I want the create form to show me which voting mode will run before I submit, so I do not accidentally create a tournament session when I wanted a single ballot.
- As a developer, I want expired pending sessions to be cleaned up without any server-side code so the database does not grow unboundedly.

**Acceptance criteria**:
- **AC-1**: A session created with 2 to 6 entries is stored with `votingMode: 'single_ballot'`; a session with 7 or more entries is stored with `votingMode: 'tournament'`. The mode is derived server-side from the candidate count; the client never sends `votingMode`.
- **AC-2**: Every new session document carries a unique `joinCode` of exactly 6 characters drawn from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. No two active (non-archived) sessions share a join code.
- **AC-3**: A `CREATE_SESSION` payload whose `timerDuration` is outside the range 5 to 300 is rejected before dispatch with a `VALIDATION_ERROR` `action_error` event; no session is created.
  - **Error contract note (2026-09-22)**: the concrete machine readable contract is `error: 'INVALID_TIMER_DURATION'` for out of range values and `error: 'INVALID_TIMER_DURATION_TYPE'` for non integers, each carrying `code: 'VALIDATION_ERROR'`. This matches `docs/API_CONTRACT.md` and the existing suites; clients should match on the `error` value, with `code` as the shared validation category.
- **AC-4**: A newly created session carries `pendingExpiresAt` set to 7 days after creation. MongoDB's TTL index deletes the document automatically if it is still in `pending` status when that date passes.
- **AC-5**: The admin create form shows a live text note that updates as the candidate count changes: `"2 to 6 candidates: Single Ballot"` for counts in that range, `"7 or more candidates: Tournament"` for larger counts.
- **AC-6**: All new fields (`type`, `votingMode`, `joinCode`, `whoCanJoin`, `candidateInfo`, `publishResultsPublicly`, `pendingExpiresAt`) are included in the `sessions` socket broadcast so the client renders them without a separate fetch.
- **AC-7**: A `CREATE_SESSION` action that omits `candidateInfo` succeeds and stores `candidateInfo: []`, keeping backward compat with the existing bootstrap seed sessions.
- **AC-8**: Existing server and client test suites pass without modification.

## Decision

**Chosen option**: Option 2: Parallel `candidateInfo` array (see `rationale.md`).

Extend the `Session` Mongoose schema with seven new fields (see Feature design); derive `votingMode` and `joinCode` server-side at creation; validate `timerDuration` and `candidateInfo` at ingress before dispatch; add a TTL index on `pendingExpiresAt` with a partial filter for `pending` status; add the live mode note to the admin create-session form.

**Implementation skills**: `model-redux-state/build-slices-and-selectors` (`reduxjs/redux-toolkit`, `.agents/skills/model-redux-state-build-slices-and-selectors/`)

## Feature design

**Data model sketch** (additions to the existing `Session` Mongoose schema):

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `type` | `String` | yes | `'public'` | enum `['public', 'secured']` |
| `votingMode` | `String` | yes | derived | enum `['single_ballot', 'tournament']`; set server-side at creation |
| `joinCode` | `String` | yes | generated | 6 chars; unique sparse index; charset `ABCDEFGHJKMNPQRSTUVWXYZ23456789` |
| `whoCanJoin` | `String` | no | `'public'` | enum `['public', 'allowlist', 'approval']`; stored, not enforced until Phase 7 |
| `candidateInfo` | `[{ name: String, description: String }]` | no | `[]` | `name` max 80 chars; `description` max 80 chars; validated at ingress |
| `publishResultsPublicly` | `Boolean` | yes | `type === 'public'` | `true` for public sessions, `false` for secured at creation |
| `pendingExpiresAt` | `Date` | no | `createdAt + 7 days` | TTL index with partial filter `{ status: 'pending' }` |

Existing fields (`title`, `entries`, `status`, `createdAt`, `timerDuration`, `winner`, `currentPair`, `tally`) are unchanged.

**State transitions**: No new states. Existing `pending → open → completed → archived` lifecycle is unchanged. The TTL index deletes a document only while it is in `pending` status.

**API surface** (Socket.io actions; all existing REST endpoints are unchanged):

| Action | Direction | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `CREATE_SESSION` | client to server | `title: String (req)`, `entries: [String] (req)`, `candidateInfo: [{ name, description }] (opt)`, `type: String (opt, default 'public')`, `timerDuration: Number (opt)`, `whoCanJoin: String (opt)`, `publishResultsPublicly: Boolean (opt)` | `sessions` broadcast with all new fields | admin JWT | `VALIDATION_ERROR` (timer out of range, description > 80 chars, unknown `type`) |
| `sessions` socket event | server to client | n/a | existing fields plus `type`, `votingMode`, `joinCode`, `whoCanJoin`, `candidateInfo`, `publishResultsPublicly`, `pendingExpiresAt` | none | n/a |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `CREATE_SESSION` handler | `votingMode` | derived server-side: `entries.length <= SINGLE_BALLOT_MAX ? 'single_ballot' : 'tournament'`; `SINGLE_BALLOT_MAX` from `src/constants.js` |
| `CREATE_SESSION` handler | `joinCode` | generated server-side via `generateJoinCode()` in `src/utils/joinCode.js`; retried up to 5 times on DB collision |
| `CREATE_SESSION` handler | `pendingExpiresAt` | `new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)` at creation time |
| `CREATE_SESSION` handler | `publishResultsPublicly` | `payload.publishResultsPublicly ?? (payload.type !== 'secured')` |
| `CREATE_SESSION` handler | `type` | `payload.type` (client input); defaults to `'public'` if omitted |
| `CREATE_SESSION` handler | `whoCanJoin` | `payload.whoCanJoin` (client input); defaults to `'public'` if omitted |
| `CREATE_SESSION` handler | `candidateInfo` | `payload.candidateInfo` (client input); defaults to `[]` if omitted |
| `sessions` broadcast | all new fields | read from the `Session` document via `getSessionsSummary()` |
| Admin create form | live mode note text | derived client-side from `SINGLE_BALLOT_MAX` exported from `voting-client/src/constants.js` (mirrors the server constant; must not be a hardcoded literal) |

**Key invariants**:
- `votingMode` is always consistent with `entries.length` at creation time. If `entries` is later changed via `SET_ENTRIES`, `votingMode` is NOT re-derived (the mode is set at creation; re-routing the engine mid-session is out of scope for Phase 1 and would require a spec).
- `joinCode` is unique across all `pending` and `open` sessions. `completed` and `archived` sessions may reuse a code. The collision retry queries `status` in `['pending', 'open']` only; the unique sparse index is the hard guard.
- A `candidateInfo` item whose `description` exceeds 80 characters is rejected at ingress before any dispatch; the session is not created.
- `pendingExpiresAt` is set only at creation time. The TTL index partial filter ensures MongoDB only evaluates documents where `status === 'pending'`; open, completed, and archived sessions are never auto-deleted.

**Security model**:
- `CREATE_SESSION` remains behind the admin JWT guard (the `ADMIN_ACTION_TYPES` check in `server.js`). No voter-facing path creates or modifies sessions.
- `joinCode` is included in the public `sessions` broadcast. In Phase 2 it will be used for voter discovery; in Phase 7 secured sessions will be filtered from the broadcast. For Phase 1 this is acceptable: all sessions are public.
- No PII in Phase 1. `whoCanJoin`, `type`, and `publishResultsPublicly` are metadata only.

**Configuration required**: None. `SINGLE_BALLOT_MAX` is a code constant in `src/constants.js` (added in Phase 0), not an environment variable; it is intentionally not runtime-configurable to prevent accidental mode drift.

## Build plan

Tracer Bullet approach: stand up the full end-to-end thread (schema, ingress handler, reducer, broadcast, UI note) as one coherent slice. No sub-slicing needed; the migration is single and small.

1. [x] Create `src/utils/joinCode.js` with `generateJoinCode()`: pure function, `crypto.randomInt`, charset `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, returns a 6-character string. Export only the generator; collision check logic lives in the handler. Satisfies **AC-2** (the primitive).
2. [x] Extend the `Session` Mongoose schema in `src/db/models/Session.js` with the seven new fields (types, defaults, enums as in Data model sketch). Add the unique sparse index on `joinCode` and the TTL index on `pendingExpiresAt` with `partialFilterExpression: { status: 'pending' }`. Satisfies **AC-4**.
3. [x] Update the `CREATE_SESSION` ingress handler in `src/server.js`: validate `type` against the enum `['public', 'secured']`; validate `timerDuration` range (5 to 300); validate `candidateInfo` item `name` max 80 chars and `description` max 80 chars; emit `VALIDATION_ERROR` on any failure before dispatch. Derive `votingMode`, call `generateJoinCode()` with up to 5 collision retries (query DB for `joinCode` where `status` is in `['pending', 'open']`), derive `pendingExpiresAt`, resolve `publishResultsPublicly` default. Pass all fields through to the Redux dispatch. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-7**.
4. [x] Extend the `CREATE_SESSION` case in `src/reducer.js` to store all seven new fields on the Immutable.js session Map. Satisfies **AC-1**, **AC-6** (state must carry the fields before broadcast).
5. [x] Update `getSessionsSummary()` in `src/server.js` (or the helper that builds the `sessions` broadcast payload) to include all seven new fields. Satisfies **AC-6**.
6. [x] Update `src/bootstrap.js` seed sessions to tolerate the new optional fields (they can omit `candidateInfo`; the handler defaults it). Confirm existing bootstrap sessions still seed correctly. Satisfies **AC-7**, **AC-8**.
7. [x] Create `voting-client/src/constants.js` exporting `SINGLE_BALLOT_MAX = 6` (a client-side mirror of the server constant; do not hardcode the literal in the component). Add the live mode note to the admin create-session form in `voting-client/src/pages/Admin.jsx` (or the create session modal component): a small text element beneath the candidates input that reads from the current candidate count and `SINGLE_BALLOT_MAX` and shows the mode string. Satisfies **AC-5**.
8. [x] Confirm existing server and client test suites pass with no modification. Fix any breakage caused by the schema extension (e.g. snapshot mismatches). Satisfies **AC-8**.

## Consequences

**Positive**:
- All later phases that need `votingMode`, `joinCode`, `type`, `whoCanJoin`, `publishResultsPublicly`, or `candidateInfo` find them already on the document with no migration work of their own.
- `SINGLE_BALLOT_MAX` is the single source of truth for the mode boundary, used by both the server handler and the client note.
- The TTL index keeps the database clean of abandoned pending sessions with zero server-side code.

**Negative / tradeoffs**:
- `votingMode` is frozen at creation time. If an admin later uses `SET_ENTRIES` to change the candidate count past the 6/7 boundary, the stored `votingMode` will be wrong. This is not handled in Phase 1; a follow-up spec is needed to decide whether `SET_ENTRIES` should re-derive the mode.
- The unique index on `joinCode` adds a write-time DB round-trip for the collision check. At expected session creation volume (tens per day) this is negligible, but it is a real latency cost.
- `candidateInfo` and `entries` can drift if a caller updates `entries` via `SET_ENTRIES` without also updating `candidateInfo`. Enforcement is deferred to Phase 4 or 5.

**Neutral**:
- No new environment variables. No new REST endpoints. No Socket.io action types beyond the existing `CREATE_SESSION`.
- The `whoCanJoin` field is stored and broadcast but has no enforcement logic until Phase 7. Client code may read it safely; it carries no security guarantee until Phase 7 enforces it.

## Follow-up

- [ ] Decide whether `SET_ENTRIES` should re-derive `votingMode` when the candidate count crosses the `SINGLE_BALLOT_MAX` boundary. If so, open a spec before Phase 4 ships (the ballot engine routes on `votingMode`).
- [ ] Phase 4: enforce alignment between `entries` and `candidateInfo` (same length, matching order) so the ballot engine can safely zip them.
- [ ] Phase 7: filter secured sessions from the `sessions` socket broadcast per the security model; add the enforcement logic for `whoCanJoin`.
