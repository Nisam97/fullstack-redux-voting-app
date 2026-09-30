# 0007. Secured Sessions

**Date**: 2026-09-29
**Status**: Implemented

## Summary

VoteSphere sessions can now require voters to sign in and pass an eligibility gate before joining. Two modes exist: allowlist (the admin pastes a list of emails; only those emails may join) and approval (any signed in voter requests access; the admin approves or rejects one by one). The admin can manage participants in real time, and a new `VoteParticipation` model records who voted in each round (never what they voted for) as an audit trail for the admin turnout view coming in Phase 8.

## Requirements

**User stories**:
- As an admin, I want to create a secured session with an allowlist of voter emails so that only invited people can participate.
- As an admin, I want to create a secured session with approval mode so that I can review and approve each join request individually.
- As an admin, I want to manage participants in real time (add, remove, approve, reject) so that I have full control over who is in my session.
- As a voter, I want to join a secured session using a join code and my signed in account so that I do not need a separate invitation link.
- As a voter, I want to see my join request status (pending, approved, rejected) so that I know whether I can participate.
- As an admin, I want to see participant counts (allowlisted, joined, pending, approved, rejected) in the lobby so that I know how many voters are ready.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: A secured session (`type: 'secured'`) must have `whoCanJoin` set to either `allowlist` or `approval`. The server rejects `CREATE_SESSION` with `type: 'secured'` and `whoCanJoin: 'public'` with a `VALIDATION_ERROR`.
- **AC-2**: The admin can switch `whoCanJoin` between `allowlist` and `approval` while the session is `pending` using the admin socket action `SET_WHO_CAN_JOIN` (`{ sessionId, whoCanJoin }`). Switching clears all existing participant data (allowlist entries or join requests) for that session. The admin sees a confirmation dialog before the switch.
- **AC-3**: In allowlist mode, the admin uses `SET_ALLOWLIST` (Socket.io, admin JWT) to upload a raw text list of emails (one per line or comma separated). The server parses with `csv-parse/sync`, validates email format, deduplicates, and performs a diff based replacement (adds new, removes missing, keeps existing). Invalid lines are returned with line numbers. If all lines are invalid, the allowlist is not modified.
- **AC-4**: In allowlist mode, a signed in voter whose email matches an `SessionAllowlistEntry` for the session can join via `POST /api/sessions/:sessionId/join`. A voter whose email is not on the list receives 403. A voter without a valid `vs_voter` cookie receives 401 with a "sign in to join" message.
- **AC-5**: In approval mode, a signed in voter who calls the join endpoint triggers a `SessionJoinRequest` creation with status `pending` and receives 202. If the voter already has a pending request, the response is 202 (already pending). If approved, the join proceeds normally. If rejected, the response is 403 (no re request after rejection).
- **AC-6**: The admin approves or rejects individual join requests using `APPROVE_PARTICIPANT` (`{ sessionId, requestId }`) and `REJECT_PARTICIPANT` (`{ sessionId, requestId }`). On approval, the voter's socket receives `participant_status: { sessionId, status: 'approved', message }`. On rejection, the voter receives `participant_status: { sessionId, status: 'rejected', message }`.
- **AC-7**: The admin removes a participant using `REMOVE_PARTICIPANT` (`{ sessionId, email }`). In the lobby (session `pending`), removal immediately disconnects the voter's socket and emits `participant_status: { status: 'removed' }`. During voting (session `open`), removal takes effect at the end of the current round (the voter can finish their current vote but is excluded from the next round's eligibility snapshot).
- **AC-8**: When `START_SESSION` is dispatched for a secured session, all still pending join requests (approval mode) are automatically rejected and their sockets receive `participant_status: { status: 'rejected' }`. No new join requests are accepted after Start. At least one eligible voter must have joined; otherwise the start is rejected with `NO_ELIGIBLE_VOTERS`.
- **AC-9**: The join code resolver (`GET /api/join/:code`) returns session metadata (title, type, votingMode, status) for secured sessions instead of the current 404. It never returns allowlist or participant details.
- **AC-10**: The admin subscribes to `session_participants` to receive real time participant data (emails, statuses, timestamps) for a session. This event is admin only (requires admin JWT on the socket). It fires on initial subscription and after any participant change.
- **AC-11**: The admin lobby view shows participant counts: for allowlist mode `"12 allowlisted · 8 joined"`, for approval mode `"5 approved · 3 pending · 2 rejected"`. The admin also sees a participant management panel with individual entries showing email/name, status badge, and action buttons (Remove for allowlist; Approve/Reject for approval).
- **AC-12**: A `VoteParticipation` document is created for each signed in voter who casts a vote in a secured session round. It stores `{ sessionId, roundId, userId }` only, never the vote choice. The compound unique index `{ sessionId, roundId, userId }` prevents duplicates.
- **AC-13**: After a server restart, a signed in voter who rejoins a secured session gets the same `user:userId` identity from their `vs_voter` cookie. The `VoteParticipation` record (persisted in MongoDB) prevents duplicate votes for rounds that occurred before the restart.
- **AC-14**: Voter facing payloads (socket broadcasts, REST responses to non admin callers) never contain emails, allowlists, or participant details. Only the admin receives participant data through the `session_participants` admin only event. Voter broadcasts contain counts only.
- **AC-15**: Socket identity for secured session lobby and vote sockets comes from the `vs_voter` handshake cookie only. The server never trusts a client sent email or userId; it derives identity from the verified JWT in `socket.data.userId`.
- **AC-16**: Existing test suites pass. The admin auth system, public session join flow, and anonymous voter flow are unchanged.

## Decision

**Chosen option**: Option 1: In house eligibility gating with two Mongoose models and Socket.io admin actions

Build the allowlist and approval flows using the existing stack: two new Mongoose models (`SessionAllowlistEntry`, `SessionJoinRequest`) for persistence, `csv-parse/sync` for allowlist parsing, Socket.io admin actions for real time management, and the `vs_voter` cookie for identity. A third model (`VoteParticipation`) records the audit trail.

**Implementation skills**: `model-redux-state-build-slices-and-selectors` (`reduxjs/redux-toolkit`, `.agents/skills/model-redux-state-build-slices-and-selectors/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

| Entity | Field | Type | Constraints |
|---|---|---|---|
| **SessionAllowlistEntry** | `_id` | ObjectId | PK, auto |
| | `sessionId` | String | required, indexed |
| | `email` | String | required, lowercase, trimmed |
| | `addedAt` | Date | default now |
| | | | compound unique index `{ sessionId, email }` |
| **SessionJoinRequest** | `_id` | ObjectId | PK, auto |
| | `sessionId` | String | required, indexed |
| | `userId` | ObjectId | required, ref User |
| | `email` | String | required, lowercase |
| | `displayName` | String | denormalized from User |
| | `status` | String | required, enum `['pending', 'approved', 'rejected']`, default `'pending'` |
| | `requestedAt` | Date | default now |
| | `decidedAt` | Date | null until approved/rejected |
| | | | compound unique index `{ sessionId, userId }` |
| **VoteParticipation** | `_id` | ObjectId | PK, auto |
| | `sessionId` | String | required, indexed |
| | `roundId` | String | required |
| | `userId` | ObjectId | required, ref User |
| | `createdAt` | Date | auto |
| | | | compound unique index `{ sessionId, roundId, userId }` |

Relationships:
- SessionAllowlistEntry to Session: many to one via `sessionId`
- SessionJoinRequest to Session: many to one via `sessionId`
- SessionJoinRequest to User: many to one via `userId`
- VoteParticipation to Session: many to one via `sessionId`
- VoteParticipation to User: many to one via `userId`

No changes to the existing `Session` schema (uses existing `type` and `whoCanJoin` fields).

**State transitions**:

SessionJoinRequest lifecycle:
```
PENDING → APPROVED (admin approves, decidedAt set)
PENDING → REJECTED (admin rejects, decidedAt set; OR auto rejected at Start)
```

SessionAllowlistEntry has no state machine (entries exist or are removed).

Secured session eligibility lifecycle:
```
Session PENDING:
  whoCanJoin changeable (allowlist ↔ approval), switching clears participants
  Allowlist: admin uploads/edits email list
  Approval: voters request access, admin approves/rejects

Session START (transition to OPEN):
  Approval mode: auto reject all still pending requests
  Eligibility locked: no new joins accepted
  Pre check: at least 1 eligible voter must have joined

Session OPEN:
  Removal takes effect at next round (current round finishes)
  VoteParticipation recorded per voter per round
```

**API surface**:

| Endpoint / Action | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `SET_WHO_CAN_JOIN` | Socket.io action | `sessionId` (req), `whoCanJoin` (req: `'allowlist' \| 'approval'`) | `{ success, whoCanJoin, clearedCount }` | admin JWT | `SESSION_NOT_FOUND`, `INVALID_SESSION_TYPE`, `INVALID_STATUS` (must be pending), `INVALID_MODE` |
| `SET_ALLOWLIST` | Socket.io action | `sessionId` (req), `emails: string` (req, raw CSV/text) | `{ success, added, removed, invalid: [{line, email, reason}] }` | admin JWT | `SESSION_NOT_FOUND`, `INVALID_SESSION_TYPE` (not secured), `SESSION_STARTED` (not pending), `ALL_INVALID` |
| `APPROVE_PARTICIPANT` | Socket.io action | `sessionId` (req), `requestId` (req) | `{ success, participant }` | admin JWT | `REQUEST_NOT_FOUND`, `ALREADY_DECIDED` |
| `REJECT_PARTICIPANT` | Socket.io action | `sessionId` (req), `requestId` (req) | `{ success, participant }` | admin JWT | `REQUEST_NOT_FOUND`, `ALREADY_DECIDED` |
| `REMOVE_PARTICIPANT` | Socket.io action | `sessionId` (req), `email` (opt), `requestId` (opt) | `{ success }` | admin JWT | `PARTICIPANT_NOT_FOUND`, `SESSION_NOT_FOUND`, `MISSING_IDENTIFIER` |
| `session_participants` | Socket.io event (subscribe) | `sessionId` (req) | `{ sessionId, mode, entries: [{email, displayName, status, timestamp}], counts }` | admin JWT | `UNAUTHORIZED` |
| `participant_status` | Socket.io event (server to voter) | n/a | `{ sessionId, status: 'approved'\|'rejected'\|'removed', message }` | sent to voter's socket | n/a |
| `POST /api/sessions/:id/join` | REST (modified) | `displayName` (opt), `vs_voter` cookie | 200: `{ success: true, voter: { sessionId, displayName, sessionToken } }`<br>202: `{ success: true, status: 'pending', message: 'Join request awaiting admin approval' }` | `vs_voter` cookie (secured sessions) | 401: `{ success: false, error: 'AUTH_REQUIRED', message: 'Sign in to join this secured session.' }`<br>403: `{ success: false, error: 'NOT_ELIGIBLE', message: 'You are not on the allowlist for this session.' }` or `{ success: false, error: 'REQUEST_REJECTED', message: 'Your join request was rejected.' }` |
| `GET /api/join/:code` | REST (modified) | join code | `{ sessionId, name, status, sessionType, votingMode }` | public | 404 (invalid/expired) |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `SET_WHO_CAN_JOIN` | updated session `whoCanJoin` | `Session.updateOne({ _id: sessionId }, { whoCanJoin })` + Redux store session update |
| `SET_WHO_CAN_JOIN` | `clearedCount` | `SessionAllowlistEntry.deleteMany({ sessionId })` or `SessionJoinRequest.deleteMany({ sessionId })` deleted count |
| `SET_ALLOWLIST` | parsed email list | `csv-parse/sync` parsing of the raw `emails` text input |
| `SET_ALLOWLIST` | `added` count | derived: emails in new set but not in existing `SessionAllowlistEntry` docs |
| `SET_ALLOWLIST` | `removed` count | derived: emails in existing docs but not in new set |
| `SET_ALLOWLIST` | `invalid` entries | derived: lines that fail `isValidEmail()` check, with 1 based line numbers |
| `APPROVE_PARTICIPANT` | `decidedAt` | derived: `new Date()` at approval time |
| `APPROVE_PARTICIPANT` | voter socket to notify | found in `socketToVoter` where `entry.sessionId === sessionId && entry.voterToken === 'user:' + userId` |
| `REJECT_PARTICIPANT` | voter socket to notify | same lookup in `socketToVoter` |
| `REMOVE_PARTICIPANT` | participant to remove | `SessionAllowlistEntry.findOne({ sessionId, email })` (allowlist mode) or `SessionJoinRequest.findOne({ sessionId, _id: requestId })` (approval mode) |
| `REMOVE_PARTICIPANT` | voter socket to disconnect | found in `socketToVoter` where `entry.sessionId === sessionId && entry.voterToken === 'user:' + userId` |
| Join endpoint (secured, allowlist) | eligibility check | `SessionAllowlistEntry.findOne({ sessionId, email })` where email comes from verified `vs_voter` JWT |
| Join endpoint (secured, approval) | existing request status | `SessionJoinRequest.findOne({ sessionId, userId })` where userId comes from verified `vs_voter` JWT |
| Join endpoint (secured, approval) | new request creation | `SessionJoinRequest.create({ sessionId, userId, email, displayName, status: 'pending' })` |
| `session_participants` | participant list | `SessionAllowlistEntry.find({ sessionId })` or `SessionJoinRequest.find({ sessionId })` depending on `whoCanJoin` |
| `session_participants` | counts | derived: `countDocuments()` grouped by status |
| `START_SESSION` (secured) | eligible voter check | count of joined voters from `getVoterCount(sessionId)` |
| `START_SESSION` (approval mode) | auto reject pending | `SessionJoinRequest.updateMany({ sessionId, status: 'pending' }, { status: 'rejected', decidedAt: new Date() })` |
| `VoteParticipation` creation | audit record | `VoteParticipation.create({ sessionId, roundId, userId })` after a successful vote by a signed in voter |
| `GET /api/join/:code` (secured) | session metadata | `Session.findOne({ joinCode })` fields: `sessionId`, `title`, `status`, `type`, `votingMode` |
| Admin lobby counts (allowlist) | `"12 allowlisted · 8 joined"` | `allowlistedCount`: `SessionAllowlistEntry.countDocuments({ sessionId })`; `joinedCount`: intersection of allowlisted emails and joined voter identities |
| Admin lobby counts (approval) | `"5 approved · 3 pending · 2 rejected"` | `SessionJoinRequest.aggregate` grouped by `status` |

**Key invariants**:
- A secured session always has `whoCanJoin` set to `allowlist` or `approval`, never `public`. Enforced at `CREATE_SESSION` ingress.
- `SessionAllowlistEntry` has a compound unique index on `{ sessionId, email }`. No duplicate emails per session.
- `SessionJoinRequest` has a compound unique index on `{ sessionId, userId }`. One request per voter per session. No re request after rejection.
- `VoteParticipation` has a compound unique index on `{ sessionId, roundId, userId }`. One participation record per voter per round.
- `VoteParticipation` never stores the vote choice. Only `sessionId`, `roundId`, and `userId`.
- Switching `whoCanJoin` while `pending` clears all participant data for that session (deletes `SessionAllowlistEntry` or `SessionJoinRequest` documents).
- After `START_SESSION`, no new joins or approval changes are accepted. The eligibility roster is locked.
- Voter facing payloads never contain emails, allowlists, or participant details. Only the admin receives this data.
- Socket identity for secured sessions comes exclusively from the `vs_voter` handshake cookie JWT. The server never trusts client sent email or userId.
- Voter removal during an active round takes effect at the next round's eligibility snapshot, not mid round.

**Security model**:
- All four new actions (`SET_ALLOWLIST`, `APPROVE_PARTICIPANT`, `REJECT_PARTICIPANT`, `REMOVE_PARTICIPANT`) are admin only, registered in `ADMIN_ACTION_TYPES` and `ALLOWED_ACTION_TYPES`. The existing ingress guard enforces admin JWT before dispatch.
- The `session_participants` event is admin only. The server checks `socket.data.isAdmin` before emitting participant data.
- Voter identity in secured sessions is server derived from the `vs_voter` handshake cookie (parsed at connection time in `socket.data.userId`). The client never sends identity claims.
- Emails are PII. They appear only in admin facing payloads (`session_participants`, allowlist management callbacks). Voter facing broadcasts contain counts only.
- The join code resolver for secured sessions returns session metadata but no participant data. An unauthenticated user sees session info and a "sign in to join" prompt.
- `VoteParticipation` records who voted (by userId) but never what they voted for. The vote choice is only in the in memory tally (and persisted as aggregate results, never per voter).

**Configuration required**:

No new environment variables. All required config (`VOTER_JWT_SECRET`, `COOKIE_SECURE`, `CLIENT_ORIGIN`) was declared in Phase 0 and wired in Phase 6.

New npm dependency: `csv-parse` (added to `voting-server/package.json`).

**Critical test scenarios**:
- Happy path (allowlist): Admin creates secured session with `whoCanJoin: 'allowlist'`, uploads an email list, a signed in voter whose email is on the list joins via join code, votes, VoteParticipation is recorded. Verifies **AC-1**, **AC-3**, **AC-4**, **AC-12**, **AC-15**
- Happy path (approval): Admin creates secured session with `whoCanJoin: 'approval'`, a signed in voter requests to join (receives 202), admin approves, voter joins and votes. Verifies **AC-5**, **AC-6**, **AC-12**
- Failure case (not on list): A signed in voter whose email is NOT on the allowlist tries to join, receives 403. Verifies **AC-4**, **AC-14**
- Failure case (no cookie): A voter without a `vs_voter` cookie tries to join a secured session, receives 401. Verifies **AC-4**, **AC-15**
- Failure case (rejected, no re request): A voter whose join request was rejected tries again, receives 403. Verifies **AC-5**
- Edge case (mode switch): Admin switches from `allowlist` to `approval`, confirmation dialog shown, all allowlist entries cleared. Verifies **AC-2**
- Edge case (auto reject at Start): Admin starts a secured session in approval mode with 2 pending requests. Both are auto rejected with `participant_status` events. Verifies **AC-8**
- Edge case (removal during voting): Admin removes a voter during an active round. The voter finishes their current vote. Next round, the voter is excluded from the eligibility snapshot. Verifies **AC-7**
- Edge case (restart resilience): Server restarts. Signed in voter rejoins with same `vs_voter` cookie. VoteParticipation prevents duplicate vote for the pre restart round. Verifies **AC-13**
- Security: Voter facing socket broadcast for a secured session contains no emails, no participant details, only counts. Verifies **AC-14**
- Security: A non admin socket trying to subscribe to `session_participants` receives nothing. Verifies **AC-10**, **AC-14**
- Integration: Join code resolver returns metadata for secured sessions (no 404). Verifies **AC-9**
- Integration: `CREATE_SESSION` with `type: 'secured'` and `whoCanJoin: 'public'` is rejected. Verifies **AC-1**
- Coexistence: Public sessions are completely unaffected. Anonymous join, no eligibility check, no VoteParticipation. Verifies **AC-16**

## Build plan

Ordered by Tracer Bullet: each task adds one thin end to end strand through the full stack.

1. **Mongoose models (`SessionAllowlistEntry`, `SessionJoinRequest`, `VoteParticipation`) and secured session validation**, satisfies **AC-1**, **AC-12**
   - `SessionAllowlistEntry` schema with compound unique index `{ sessionId, email }`
   - `SessionJoinRequest` schema with compound unique index `{ sessionId, userId }`, status enum, `decidedAt`
   - `VoteParticipation` schema with compound unique index `{ sessionId, roundId, userId }`
   - `CREATE_SESSION` ingress validation: reject `type: 'secured'` with `whoCanJoin: 'public'`
   - `csv-parse` added to `voting-server/package.json`

2. **`SET_ALLOWLIST` action handler and allowlist join gate**, satisfies **AC-3**, **AC-4**, **AC-14**, **AC-15**
   - Register `SET_ALLOWLIST` in `ADMIN_ACTION_TYPES` and `ALLOWED_ACTION_TYPES`
   - Handler: parse raw text with `csv-parse/sync`, validate emails with `isValidEmail()`, dedup, diff against existing `SessionAllowlistEntry` docs, add new / remove missing
   - Return `{ success, added, removed, invalid: [{line, email, reason}] }`
   - Modify `POST /api/sessions/:sessionId/join`: for secured sessions with `whoCanJoin: 'allowlist'`, check `vs_voter` cookie (401 if absent), look up voter email in `SessionAllowlistEntry` (403 if not found), then proceed to `registerVoter`

3. **Approval mode join flow and admin approve/reject actions**, satisfies **AC-5**, **AC-6**
   - Register `APPROVE_PARTICIPANT` and `REJECT_PARTICIPANT` in `ADMIN_ACTION_TYPES` and `ALLOWED_ACTION_TYPES`
   - Modify `POST /api/sessions/:sessionId/join`: for secured sessions with `whoCanJoin: 'approval'`, check `vs_voter` cookie (401), look up existing `SessionJoinRequest` (if none, create with `pending`, return 202; if `pending`, return 202; if `approved`, proceed to `registerVoter`; if `rejected`, return 403)
   - `APPROVE_PARTICIPANT` handler: set status to `approved`, set `decidedAt`, emit `participant_status: { status: 'approved' }` to voter's socket
   - `REJECT_PARTICIPANT` handler: set status to `rejected`, set `decidedAt`, emit `participant_status: { status: 'rejected' }` to voter's socket

4. **`REMOVE_PARTICIPANT` action and socket disconnect logic**, satisfies **AC-7**
   - Register `REMOVE_PARTICIPANT` in `ADMIN_ACTION_TYPES` and `ALLOWED_ACTION_TYPES`
   - Handler: find participant by email (from `SessionAllowlistEntry` or `SessionJoinRequest`), delete/reject the record
   - If session is `pending`: immediately disconnect voter's socket, emit `participant_status: { status: 'removed' }`
   - If session is `open`: mark voter for removal; on next `SNAPSHOT_ROUND_ELIGIBILITY`, exclude the removed voter; disconnect their socket after the current round closes

5. **`START_SESSION` pre checks and auto reject for approval mode**, satisfies **AC-8**
   - Before dispatching `START_SESSION` for a secured session: check that at least 1 eligible voter has joined (`getVoterCount`); if zero, return `NO_ELIGIBLE_VOTERS` error
   - For approval mode: `SessionJoinRequest.updateMany({ sessionId, status: 'pending' }, { status: 'rejected', decidedAt: new Date() })`; emit `participant_status: { status: 'rejected' }` to each pending voter's socket

6. **`whoCanJoin` mode switching (`SET_WHO_CAN_JOIN`) and participant clearing**, satisfies **AC-2**
   - Register `SET_WHO_CAN_JOIN` in `ADMIN_ACTION_TYPES` and `ALLOWED_ACTION_TYPES`
   - Handler: validate session is `pending` and secured; update session `whoCanJoin` in DB and Redux store; delete all `SessionAllowlistEntry` docs or `SessionJoinRequest` docs for that session; emit updated participants and lobby update
   - Client: confirmation dialog before switching ("Switching to [mode] will clear all [N] participants. Continue?")

7. **Join code resolver update for secured sessions**, satisfies **AC-9**
   - Remove the `if (sessionDoc.type === 'secured') { sendJson(res, 404, ...); return; }` filter in the `GET /api/join/:code` handler
   - Return session metadata (sessionId, title, status, sessionType, votingMode) for secured sessions, same as public

8. **Admin `session_participants` event and participant management panel**, satisfies **AC-10**, **AC-11**, **AC-14**
   - New socket event `subscribe_participants` (admin only): when received, add admin socket to a `participants:${sessionId}` room and emit current participant data
   - On any participant change (SET_ALLOWLIST, APPROVE, REJECT, REMOVE, new join request), emit updated `session_participants` to the admin room
   - Participant data includes emails, display names, statuses, and timestamps (admin only)
   - Admin lobby UI: participant counts (allowlist: "N allowlisted · N joined"; approval: "N approved · N pending · N rejected")
   - Admin participant management panel: scrollable list with email/name, status badge, Remove/Approve/Reject buttons

9. **`VoteParticipation` recording on vote and client secured session UI**, satisfies **AC-12**, **AC-13**, **AC-15**, **AC-16**
   - After a successful vote by a signed in voter in a secured session, create a `VoteParticipation` document `{ sessionId, roundId, userId }` (fire and forget, do not block the vote path)
   - Client join page for secured sessions: "Sign in to join" prompt when no `vs_voter` cookie; "Your request is pending" status for approval mode; "You are not on the allowlist" for rejected attempts
   - Client: `participant_status` event handler (toast/modal for approved, rejected, removed; redirect to home on removal)
   - Verify all existing test suites pass

## Consequences

**Positive**:
- Secured sessions enforce real identity (email based) for voters, preventing impersonation and ensuring accountability
- Two flexible eligibility modes (allowlist and approval) cover both pre planned and ad hoc secured voting scenarios
- `VoteParticipation` provides a durable audit trail of who voted per round without compromising vote secrecy
- Real time participant management gives the admin full control: add, remove, approve, reject at any point before (and partially during) voting
- The feature builds entirely on the existing stack (Mongoose, Socket.io, `vs_voter` cookie) with only one new dependency (`csv-parse`)

**Negative / tradeoffs**:
- Three new Mongoose models add persistence surface area and query load (mitigated by compound indexes)
- `csv-parse` is a new server dependency, though lightweight and well maintained
- Voter removal during an active round is delayed to the next round (by design, to avoid disrupting a frozen eligibility snapshot), which may confuse admins who expect immediate effect
- The `VoteParticipation` model creates one document per voter per round in secured sessions; for large sessions with many rounds this could grow, though the compound unique index keeps lookups fast
- No re request after rejection (by design) means a rejected voter must ask the admin to re approve them manually; there is no self service path back

**Neutral**:
- Public sessions are completely unaffected. The eligibility gate is bypassed for `type: 'public'` sessions
- The existing admin auth system, anonymous voter flow, and presence system are unchanged
- The `whoCanJoin` field on the `Session` schema already exists from Phase 1; no schema migration needed
- Voter identity for secured sessions relies on the `vs_voter` cookie infrastructure built in Phase 6

## Follow-up

- [ ] Phase 8 (Visibility and Privacy) builds on `VoteParticipation` for the admin per round turnout view. The turnout data is persisted here but not yet surfaced in the admin UI.
- [ ] Consider allowing admin to re approve a rejected voter (currently blocked by design; the admin would need to manually create a new join request or re add the email to the allowlist).
- [ ] Rate limiting on `SET_ALLOWLIST` (large email lists) is deferred to Phase 9 hardening.
- [ ] The `socketToVoter` reverse map is used to find voter sockets by userId for participant notifications. If the map grows to support multiple sessions per socket, verify it handles the secured session removal correctly.
