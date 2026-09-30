# 0001. Session Model Extension: Rationale

**Date**: 2026-09-21
**Status**: In Progress

## Context

The existing schema stores sessions as plain title-plus-entries records with a flat status string. Phase 2 needs a `joinCode` on every session so voters can find it without a public listing. Phase 4 needs a `votingMode` to route a session to the right engine (`ballot.js` vs `core.js`). Phase 7 needs `type` and `whoCanJoin` to enforce secured-session eligibility. Phase 8 needs `publishResultsPublicly`. All of these are cheap to add now in one migration; adding them piecemeal later means four separate migration tasks and four rounds of startup-recovery changes. The `SINGLE_BALLOT_MAX` constant (defined in Phase 0) gives a single source of truth for the 2-to-6 / 7+ boundary, so mode derivation is deterministic and never needs a manual override. The `entries` field (plain strings) already drives the tournament engine; replacing it would break every existing test and the seed bootstrap. A parallel `candidateInfo` array keeps backward compat while giving Phase 4 the richer data it needs.

## Options considered

### Option 1: Extend `entries` to hold objects `{ name, description }`

Replace the plain-string `entries` array with objects containing `name` and `description`.

**Pros**:
- One unified candidates array; no data duplication.

**Cons**:
- Breaks every existing test, seed, and tournament engine call that reads `entries` as strings. The tournament engine (`core.js`) is protected and cannot be edited, so callers would need shim layers anyway. The migration cost is high with no Phase 1 benefit.

### Option 2: Parallel `candidateInfo` array (chosen)

Add a `candidateInfo: [{ name, description }]` array alongside the untouched `entries` array.

**Pros**:
- Zero risk to existing code; all entry-reading paths keep working.
- `candidateInfo` can be empty (backward compat) or populated (Phase 4+).

**Cons**:
- Two parallel arrays that can drift if entries and candidateInfo are not updated together. A future cleanup (Phase 4 or 5) can enforce alignment.

## Rationale

Adding all seven fields in one migration is less risky than four separate ones. Each later phase that needs a field can trust it exists without running a migration of its own. Deriving `votingMode` server-side from candidate count prevents the client from lying about the mode, which would be a security concern once `ballot.js` (Phase 4) routes to a different engine based on it. The `candidateInfo` parallel array protects the protected `core.js` from any interface change; that module must stay byte identical per `AGENTS.md`. The TTL index on `pendingExpiresAt` with a partial filter on `status === 'pending'` is the minimal operational approach: it adds no server-side job, no cron, and no new error path to monitor.
