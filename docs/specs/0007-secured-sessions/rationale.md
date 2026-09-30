# 0007. Secured Sessions: Rationale

## Context

VoteSphere already supports two session types (`public` and `secured`) and stores a `whoCanJoin` policy (`public`, `allowlist`, `approval`) on each session, but until now the distinction is purely cosmetic. Secured sessions are hidden from the join code resolver and the voter broadcast, but no actual eligibility enforcement exists. Any voter who knows the session ID can join directly.

Phase 6 (Accounts and OTP) introduced the `vs_voter` cookie, a signed JWT carrying `{ userId, email, role: 'voter' }` that proves a voter's identity without a password. This gives the server a reliable identity signal for every signed in voter, which is the foundation for enforcing eligibility rules on secured sessions.

The forces at play:
- **Accountability**: some voting scenarios (board votes, team decisions, class elections) require that only specific people can participate, and the admin needs to know who voted (though not how).
- **Flexibility**: admins want two modes. Pre planned events (a board vote) suit an allowlist of emails. Ad hoc events (a classroom poll) suit an open request and approval queue.
- **Real time control**: the admin must be able to add, remove, approve, and reject participants while the session is still in the lobby, and see the results immediately.
- **Privacy**: voter emails are PII. They must never leak to other voters. Only the admin sees participant details.
- **Audit trail**: the scope requires a durable record of who voted per round (for the Phase 8 turnout view), but the record must never store the vote choice.

Without this phase, secured sessions are security theater: the `type: 'secured'` label exists but anyone can bypass it. The admin has no tooling to manage participants, and there is no audit trail.

## Options considered

### Option 1: In house eligibility gating with two Mongoose models (recommended)

Build the allowlist (`SessionAllowlistEntry`) and approval queue (`SessionJoinRequest`) as two separate Mongoose models, each with compound unique indexes. The admin manages participants via four new Socket.io actions (`SET_ALLOWLIST`, `APPROVE_PARTICIPANT`, `REJECT_PARTICIPANT`, `REMOVE_PARTICIPANT`). The join endpoint checks eligibility server side before calling `registerVoter`. A third model (`VoteParticipation`) stores the per round audit trail. `csv-parse/sync` handles allowlist parsing.

**Pros**:
- Uses the project's existing stack (Mongoose, Socket.io, JWT cookies) with no new infrastructure
- Two separate models keep the allowlist and approval queue cleanly separated, with distinct schemas and query patterns
- The join endpoint is the single enforcement point: all eligibility checks run before `registerVoter`, so the voter registry never contains ineligible voters
- `VoteParticipation` is a write once, append only audit trail that never stores the vote choice

**Cons**:
- Three new Mongoose models add persistence surface area (mitigated by compound indexes)
- The `socketToVoter` reverse map is the only way to find a voter's socket for `participant_status` notifications; if the map's structure changes, the notification path breaks
- `csv-parse` is a new dependency (lightweight, well maintained, but still a new dependency to audit)

### Option 2: Single unified `SessionParticipant` model

Use one model for both modes: `SessionParticipant` with a `source` field (`allowlist` or `request`) and a `status` enum covering both lifecycles (`allowed`, `pending`, `approved`, `rejected`, `removed`). Simpler schema, one fewer model.

**Pros**:
- One model means one query pattern, one index, one place to look for participant data
- Slightly simpler admin queries (one collection covers both modes)

**Cons**:
- The status enum conflates two different lifecycles: an allowlist entry has no "pending" or "approved" state, and a join request has no "allowed" state. Nullable fields and conditional logic accumulate
- The `source` field must be checked everywhere to determine which validation rules apply, increasing the risk of bypass bugs
- The data model does not match the domain: allowlist entries and join requests are conceptually different things with different schemas and different admin actions

### Option 3: In memory only (Redux store, no new Mongoose models)

Track participants in the Redux store's Immutable.js state, similar to how presence is tracked. No new database models. Participant data is lost on server restart and rebuilt from the session's `entries` or a stored JSON field on the Session document.

**Pros**:
- No new database models, no new persistence code
- Consistent with how presence and voter registry are already handled (in memory)

**Cons**:
- Participant data is lost on restart. For a secured session, losing the allowlist or approval queue mid vote is unacceptable
- No durable audit trail. The `VoteParticipation` requirement (who voted per round, persisted) cannot be met without a model
- The Session document would need to store participant arrays, bloating the schema and the socket broadcast payload
- The Redux store is already large; adding hundreds of email entries per session would increase memory pressure and slow broadcasts

## Rationale

Option 1 (two separate models) is the right choice because it matches the domain structure and keeps the two eligibility modes cleanly isolated.

The allowlist and approval queue have different schemas (an allowlist entry is just an email; a join request has userId, status, decidedAt), different lifecycles (an entry is present or absent; a request transitions through pending, approved, rejected), and different admin actions (SET_ALLOWLIST is a bulk diff replacement; APPROVE/REJECT are individual decisions). Forcing these into one model (Option 2) would require nullable fields, a `source` discriminator, and conditional validation on every query, exactly the kind of shared model that starts clean and accumulates special cases.

Option 3 (in memory) is disqualified by the durability requirement: `VoteParticipation` must persist to MongoDB, and the allowlist/approval data must survive a restart. The existing presence system is in memory by design (it's ephemeral connection state), but participant eligibility is a durable authorization decision.

The `csv-parse/sync` dependency is a pragmatic choice for allowlist parsing. Hand rolling CSV parsing sounds simple but breaks on edge cases (quoted fields, commas in display names pasted alongside emails). The `csv-parse` package is the standard Node.js CSV parser, well maintained, and its `sync` API keeps the parsing straightforward without adding streaming complexity.

The Socket.io action pattern (rather than REST endpoints) is consistent with the project convention: all lifecycle mutations travel over Socket.io behind an admin JWT. Adding REST mutation endpoints would create a second auth path and a second broadcast mechanism, violating the project rules documented in `AGENTS.md`.
