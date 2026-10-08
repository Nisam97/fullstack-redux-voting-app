# 0008. Enforce the results visibility matrix

**Date**: 2026-10-04
**Status**: Accepted
**Amended**: 2026-10-04, AC-14 and AC-15 added after acceptance. Build plan step 7 landed with them on 2026-10-05.

## Summary

Secured sessions already hide their roster, but their results are not hidden. Once a secured session completes, its tallies are readable by anyone who knows the session id, and the history archive lists every completed result with no regard for session type. This spec adds the missing visibility matrix: public results stay public, a secured result is visible only to its approved participants and the admin until the admin publishes it, and after publishing anyone with the session id can view it (the session must have ended first). It also adds an admin per round turnout view (who voted in each round, never what they chose) and a standing test that fails if an email ever reaches a voter facing payload.

## Requirements

**User stories**:
- As an admin, I want a completed secured session's result hidden from outsiders until I publish it, so that the tallies stay private to the people I invited.
- As an admin, I want to publish or unpublish a completed secured result, so that I control when it becomes part of the public archive.
- As an approved participant, I want to open my secured session's result after it ends, so that I can see how it resolved.
- As an admin, I want to see who voted in each round (never what they chose), so that I can gauge turnout.
- As a voter, I want a clear state when a result is not available to me, so that I am not left with a broken page.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: A public session's completed result is visible to everyone (anonymous callers included) on `GET /api/sessions/history`, `GET /api/sessions/:id/result`, `GET /api/sessions/:id/rounds`, and the lobby `winner` field, exactly as today. The publish flag never affects a public session.
- **AC-2**: An unpublished secured session's result and round tallies are visible only to its approved participants (an allowlist email match, or a `SessionJoinRequest` with status `approved`, both resolved from the verified `vs_voter` cookie) and to the admin. Every other caller receives the same `404` a missing result returns from the history, result, and rounds reads, and the lobby metadata omits the `winner` field instead. The existence of the session is not revealed.
- **AC-3**: The admin publishes or unpublishes with the admin socket action `SET_PUBLISH_RESULTS ({ sessionId, publishResultsPublicly: boolean })`. It is admin only (registered in `ADMIN_ACTION_TYPES`), rejects a session whose status is neither `completed` nor `archived` with `SESSION_NOT_COMPLETED`, and writes `publishResultsPublicly` to both the `Session` and its `Result` row in one step so they never drift. An archived session is publishable, since archiving is a post completion action and must not strand a result.
- **AC-4**: While a secured result is published, anyone (anonymous included) can view it by session id on the result and rounds endpoints, and it appears in `GET /api/sessions/history`, but only after the session has completed. Once it is unpublished, it disappears from history and non participants receive `404` again.
- **AC-5**: `GET /api/sessions/history` returns every completed public result plus every completed secured result whose `publishResultsPublicly` is true. An unpublished secured result is absent, and a result whose session has not completed is absent.
- **AC-6**: A secured session still in progress is readable (rounds and live result state) only by its approved participants and the admin, before any publish. Outsiders receive `404`. This aligns the REST reads with the already gated socket room; the socket gate itself is unchanged.
- **AC-7**: The admin views per round turnout for any session, at any time, through `GET /api/sessions/:id/turnout` (admin Bearer token) and the admin only `session_turnout` socket event. Turnout lists every round of the session in ascending `roundIndex` order (taken from the persisted round snapshots when the session is completed, and from the live round manager otherwise), showing the signed in voters who voted in that round (display name and email), with an empty `voters` list when nobody voted. It never shows the vote choice. Anonymous voters are absent by design.
- **AC-8**: Turnout is visible only to the admin. A non admin caller to the turnout endpoint receives `404`, and a non admin socket subscribing to `session_turnout` receives `UNAUTHORIZED`. No voter facing payload ever contains turnout data.
- **AC-9**: `Result` gains `type` (`'public'` or `'secured'`) and `publishResultsPublicly` (boolean, default false). New results are written with the session's `type`. Existing results that carry no `type` are backfilled from their `Session.type`, treating a missing session type as `'public'`.
- **AC-10**: No voter facing REST response or socket payload ever contains an email address or allowlist data at any point in a session's lifecycle, and an automated leak guard test fails if one ever does.
- **AC-11**: The create session form no longer offers a Publish results publicly checkbox. A secured session is created unpublished (`publishResultsPublicly` false); a public session is unaffected.
- **AC-12**: The client results page shows the publish toggle and the per round turnout panel when the viewer is the admin, and a neutral unavailable state (with a sign in prompt) when a secured result is gated. It never renders gated data.
- **AC-13**: Existing test suites pass. Public visibility, the socket room gating for secured sessions, quorum, timers, and the secured join flows are unchanged.
- **AC-14**: `GET /api/sessions/:id/lobby` answers `404` with a body byte identical to the body an unknown session id returns when the session is secured and the caller is neither an approved participant nor the admin and the result is not published. The gated read does not return `200` with a reduced body, so holding a session id cannot confirm that a gated secured session exists, and the title, status, `whoCanJoin`, entry count, and voter count are never served to such a caller. A public session is never gated this way, and a signed in outsider receives the same `404` as an anonymous caller.
- **AC-15**: The client sends the `vs_voter` cookie (`credentials: 'include'`) and the admin Bearer header on the lobby read, exactly as it already does on the result and rounds reads, so an approved participant and the admin still receive `200`. Every lobby `404`, whether the session is missing, gated, or the id is a typo, renders one identical neutral state. The rendered text is exactly "This session is not available." plus, when the visitor is not signed in, "Sign in if you were invited." linking to `/login?redirect=<current path>`. It must not contain the words "not found", "does not exist", "removed", "private", or "secured", and it must not claim anything about the session beyond unavailability. The existing "Session Not Found" panel and its "Browse Available Sessions" call to action are replaced, not restyled. This does not replace the secured sign in wall in spec 0007, which renders for a visitor who already holds session metadata and is a separate state.

## Decision

**Chosen option**: Option 1: Extend `Result` with `type` and `publishResultsPublicly`, and gate every result read behind one shared resolver

Add the two fields to the `Result` schema, write them at completion, and put the visibility decision in one shared helper that every result surface calls. The admin flips the publish flag through a new admin socket action that writes both the `Session` and the `Result`. Turnout reads the existing `VoteParticipation` audit trail. No new dependency and no new service.

**Amendment decision (2026-10-04, AC-14 and AC-15)**: The lobby must not confirm that a gated secured session exists. It answers the same `404`, with the same body, that an unknown session id answers, and the client shows one neutral state for every lobby `404`. See [rationale.md](rationale.md) for the options weighed.

**Implementation skills**: `model-redux-state/build-slices-and-selectors` (`reduxjs/redux-toolkit`, `.agents/skills/model-redux-state-build-slices-and-selectors/`) · `vitest` (`antfu/skills`, `.agents/skills/vitest/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

| Entity | Field | Type | Constraints |
|---|---|---|---|
| **Result** (extend) | `type` | String | enum `['public','secured']`, required, default `'public'`, indexed |
| | `publishResultsPublicly` | Boolean | required, default `false`, indexed |
| | `sessionId`, `title`, `entries`, `winner`, `completedAt`, `rounds[]` | unchanged | |
| **Session** (unchanged) | `publishResultsPublicly` | Boolean | the admin facing switch; mirrored onto the matching `Result` by `SET_PUBLISH_RESULTS` |
| **VoteParticipation** (unchanged) | `sessionId`, `roundId`, `userId`, `createdAt` | | turnout source; `roundId` is `${sessionId}:::r${roundIndex}` |
| **User** (unchanged) | `name`, `email` | | turnout identity, joined by `userId` |

Relationships: `Result` 1:1 `Session` via `sessionId`. `VoteParticipation` N:1 `Session` and N:1 `User`.

**State transitions**:

```
Secured Result visibility:
  completed + publishResultsPublicly=false  -> participants and admin only
  completed + publishResultsPublicly=true   -> everyone (anonymous included)
  not completed                             -> participants and admin only (in progress)

publishResultsPublicly (Session and Result, held in step):
  false <-> true   (SET_PUBLISH_RESULTS, session must be completed)
```

**API surface**:

| Endpoint / Action | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `GET /api/sessions/history` | REST (modified) | none | `{ results: [...] }` filtered to public plus published secured | public | none |
| `GET /api/sessions/:id/result` | REST (modified) | session id | `{ result }` including `type` and `publishResultsPublicly` when visible | public, `vs_voter` cookie or admin Bearer for gated secured reads | `404` when gated or missing |
| `GET /api/sessions/:id/rounds` | REST (modified) | session id | `{ rounds }` when visible | as above | `404` when gated or missing |
| `GET /api/sessions/:id/lobby` | REST (modified) | session id | lobby metadata for a public session, for a published secured session, and for a secured session read by an approved participant or the admin; `winner` omitted when the result itself is gated | public, `vs_voter` cookie or admin Bearer on a secured session | `404 SESSION_NOT_FOUND` when the session is unknown **or** secured and gated for this caller |
| `SET_PUBLISH_RESULTS` | Socket.io action | `sessionId` (req), `publishResultsPublicly` (req, boolean) | `{ success, sessionId, publishResultsPublicly }` | admin JWT | `SESSION_NOT_FOUND`, `SESSION_NOT_COMPLETED`, `VALIDATION_ERROR` |
| `GET /api/sessions/:id/turnout` | REST (new) | session id | `{ rounds: [{ roundIndex, roundId, voters: [{ name, email }] }] }`, every round ascending, `voters` possibly empty | admin Bearer | `404` when not admin, `SESSION_NOT_FOUND` |
| `session_turnout` | Socket.io event | `sessionId` via `subscribe_turnout` | `{ sessionId, rounds: [...] }` | admin JWT | `UNAUTHORIZED` |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Result creation at completion | `type` | `Session.type` read at completion (default `'public'`) |
| Result creation at completion | `publishResultsPublicly` | `Session.publishResultsPublicly` read at completion (default false) |
| History filter | which results are listed | derived: `type === 'public' OR publishResultsPublicly === true` |
| Result / rounds gate | caller is admin | derived: `verifyAdminToken` on the `Authorization: Bearer` header |
| Result / rounds gate | caller is a participant | derived: `vs_voter` cookie `userId` and `email`, then `SessionJoinRequest.findOne({ sessionId, userId, status: 'approved' })` or `SessionAllowlistEntry.findOne({ sessionId, email })` |
| `SET_PUBLISH_RESULTS` | new flag value | input `publishResultsPublicly` (validated boolean) |
| `SET_PUBLISH_RESULTS` | gate on status | `Session.status` (or the store's session status) must be `completed` or `archived` |
| `SET_PUBLISH_RESULTS` | live store update | a new reducer case writing `publishResultsPublicly` onto the store session, accepted even when the session is archived |
| Result endpoint payload | `type`, `publishResultsPublicly` | `Result` columns, so the admin toggle can render the current state |
| Client result and rounds fetch | cookie and admin token on the request | derived: `credentials: 'include'` carries the `vs_voter` cookie; the admin Bearer header is attached when an admin token is in storage |
| Turnout live update | when `session_turnout` re emits | derived: after `closeRoundOnce` completes a round |
| Turnout round list | rounds covered | derived: every round of the session, from `Result.rounds[]` when completed, else the live round manager, ascending `roundIndex` |
| Turnout round index | `roundIndex` | derived: parsed from the `roundId` string `\${sessionId}:::r\${roundIndex}` |
| Turnout voter identity | `name`, `email` | `User` joined by `VoteParticipation.userId` |
| Client gated state | which state to render | derived: the `404` versus `200` from the result or rounds read, plus the caller's own auth state |
| Lobby read gate | is this caller allowed lobby metadata for a secured session | derived: the same `resolveResultVisibility` call the result and rounds reads use, fed by `Session.type`, `Session.publishResultsPublicly`, the admin Bearer, and the `vs_voter` cookie |
| Lobby `404` body | the body a gated caller receives | derived: the exact same construction the unknown id branch already sends for that request, `{ success: false, error: 'SESSION_NOT_FOUND', message: `Session "${sessionId}" was not found.` }`, built once and reused. The message echoes the id the caller supplied, which it already knows, so the two responses stay byte for byte identical |
| Client lobby fetch credentials | cookie and admin token on the lobby request | derived: `credentials: 'include'` plus `getAdminToken()` from `voting-client/src/services/auth.js`, the same helper `buildResultHeaders` in `voting-client/src/services/history.js` uses |
| Client neutral lobby state | the copy shown on any lobby `404` | fixed strings stated in AC-15, identical for every `404` |
| Client sign in prompt visibility | whether the sign in prompt renders | derived: `selectIsVoterLoggedIn` in `voting-client/src/redux/voterAuthSlice.js` (`state.voterAuth.isLoggedIn`) |
| Client sign in prompt target | the `redirect` query value | derived: `` `/login?redirect=${encodeURIComponent(current path)}` ``, the pattern `Lobby.jsx` already uses for its secured sign in link |

**Key invariants**:
- A caller may read a secured result only when `Result.type !== 'secured'`, or `Result.publishResultsPublicly === true`, or the caller is an approved participant, or the caller is the admin.
- `Session.publishResultsPublicly` and its `Result.publishResultsPublicly` are written together by `SET_PUBLISH_RESULTS` and never diverge.
- `SET_PUBLISH_RESULTS` refuses unless the session status is `completed` or `archived`.
- Turnout lists every round of the session, so a zero turnout round still appears with an empty `voters` list.
- Turnout carries no vote choice and is admin only.
- Voter facing payloads never carry an email, an allowlist entry, or participant detail.
- A public result is never gated.
- A gated secured session is indistinguishable from a missing one on every voter facing read: the lobby returns the same `404` body, and the result, rounds, and history reads keep their existing `404`.
- The join code resolver `GET /api/join/:code` is deliberately not part of this matrix. The six character code is the capability the admin hands out, so holding it is the intended way to learn that a secured session exists. It returns summary metadata only, never allowlist or participant detail.

**Security model**:
- Result visibility, surface by surface:

| Viewer | Public result | Secured result, published | Secured result, unpublished |
|---|---|---|---|
| Anonymous | visible | visible | `404`, and the lobby also `404` |
| Signed in, not a participant | visible | visible | `404`, and the lobby also `404` |
| Approved participant | visible | visible | visible |
| Admin (Bearer) | visible | visible | visible |

- Admin REST reads authenticate with a Bearer admin JWT (the pattern `GET /api/sessions` and `GET /api/auth/me` already use). Voter REST reads authenticate with the `vs_voter` cookie. Both are resolved before the eligibility lookup, and eligibility is read from the same allowlist and request tables the join gate uses.
- A denied caller receives `404`, never `403`, so the existence of an unpublished secured session is not disclosed. The lobby follows the same rule, and the two `404` bodies are byte identical, so a `200` on the lobby is itself the signal that the session is readable by this caller.
- The lobby gate uses the shared resolver rather than a second rule, so a door cannot be added that forgets it.
- The turnout endpoint and the `session_turnout` event are admin only, matching `session_participants`.
- Emails remain PII and stay admin only. The leak guard test (AC-10) makes the invariant standing rather than incidental.

**Configuration required**: none. All config (`VOTER_JWT_SECRET`, admin `JWT_SECRET`, `COOKIE_SECURE`, `CLIENT_ORIGIN`) already exists.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: a public session completes, its result is visible to an anonymous caller, listed in history, and its winner appears in lobby metadata. Verifies **AC-1**.
- Happy path: a secured session completes unpublished, an approved participant (allowlist and approval modes) reads the result and rounds, the admin reads them too. Verifies **AC-2**.
- Auth/permission: an anonymous caller and a signed in non participant both receive `404` for an unpublished secured result on the result, rounds, and lobby endpoints, and the session id never appears in history. Verifies **AC-2**, **AC-5**.
- Happy path: the admin publishes a completed secured result, an anonymous caller then reads it and it appears in history; the admin unpublishes it and the anonymous caller receives `404` again. Verifies **AC-3**, **AC-4**, **AC-5**.
- Failure case: `SET_PUBLISH_RESULTS` on a session that is `pending` or `open` is refused with `SESSION_NOT_COMPLETED`, while an `archived` session can still be published or unpublished. Verifies **AC-3**.
- Auth/permission: a non admin socket sending `SET_PUBLISH_RESULTS` is rejected at ingress with `UNAUTHORIZED`, and a non admin calling the turnout endpoint receives `404`. Verifies **AC-3**, **AC-8**.
- Happy path: the admin subscribes to `session_turnout` and sees, per round, the signed in voters who voted with their name and email; a fresh round appears after it closes. Verifies **AC-7**.
- Failure case: an anonymous voter's vote in a public session never appears in turnout, because it carries no identity. Verifies **AC-7**.
- Security: a leak guard scans the voter facing socket payloads and REST responses for an email shaped value and fails on any match. Verifies **AC-10**.
- Migration: a completed result with no `type` field is backfilled from its `Session.type` and is gated correctly. Verifies **AC-9**.
- Coexistence: the socket room gate for secured sessions, quorum, timers, and the join flows are unchanged. Verifies **AC-6**, **AC-13**.
- Security: an anonymous caller and a signed in non participant both receive `404` from the lobby for an unpublished secured session, and the response body equals the body an unknown id returns, while the admin and an approved participant still receive `200` with full metadata. Verifies **AC-14**, **AC-15**.
- Security: the client renders one identical neutral state for a missing session and for a gated secured session, and the rendered text never mentions that a session exists or that it is secured. Verifies **AC-15**.
- Happy path: a public session's lobby read is unaffected, still `200` with title, counts, and status, for anonymous and signed in callers alike. Verifies **AC-14**, **AC-13**.

## Build plan

Ordered by Tracer Bullet: each task adds one thin end to end strand through the full stack, then the next thickens it.

- [x] 1. **`Result` schema fields, write at completion, and backfill**, satisfies **AC-9**, **AC-11**
   - Add `type` (enum, indexed) and `publishResultsPublicly` (boolean, indexed) to `voting-server/src/db/models/Result.js`
   - Write both at result creation in `saveResult` and `persistCompletedResult`, taken from the session
   - Backfill migration: for any `Result` missing `type`, copy `Session.type` (missing session type becomes `'public'`)
   - Remove the publish checkbox from the create form in `voting-client/src/pages/Admin.jsx` and stop sending `publishResultsPublicly` on `CREATE_SESSION`

- [x] 2. **Shared result visibility resolver and the read gates**, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-5**, **AC-6**
   - One helper `resolveResultVisibility({ result, session, adminToken, voterCookie })` returning `visible` plus the viewer kind
   - Gate `GET /api/sessions/:id/result`, `GET /api/sessions/:id/rounds` (the DB fallback path included), and the `winner` field of `GET /api/sessions/:id/lobby`
   - Filter `GET /api/sessions/history` to `type === 'public' OR publishResultsPublicly === true`

- [x] 3. **`SET_PUBLISH_RESULTS` admin action**, satisfies **AC-3**
   - Register in `ADMIN_ACTION_TYPES` and `ALLOWED_ACTION_TYPES` in `server.js`
   - Validate the session exists and is `completed` or `archived`, validate the boolean, then write `publishResultsPublicly` to the `Session` and its `Result` in one step
   - Add a reducer case that writes `publishResultsPublicly` onto the store session and is accepted even when the session is archived

- [x] 4. **Admin turnout view, REST and socket**, satisfies **AC-7**, **AC-8**
   - `GET /api/sessions/:id/turnout`: admin Bearer gate, build the full round list (from `Result.rounds[]` when completed, else the live round manager) in ascending `roundIndex`, attach voters grouped from `VoteParticipation.find({ sessionId })` by `roundId`, join `User` for name and email
   - `subscribe_turnout` subscription plus `session_turnout` emit on subscription and after `closeRoundOnce` completes a round, admin only

- [x] 5. **Client surfaces: publish, turnout, gated states**, satisfies **AC-12**, and exercises **AC-2**, **AC-4**
   - Results page admin view: publish toggle bound to `SET_PUBLISH_RESULTS`, and a per round turnout panel fed by the REST load plus `session_turnout`
   - Result and rounds fetches send `credentials: 'include'` and attach the admin Bearer header when an admin token is in storage, so a participant and the admin can read a gated result
   - Gated state: a neutral, non revealing panel with a sign in prompt when the result or rounds read returns `404`
   - Register the new socket event and any new local action types in `redux/store.js` and `services/socket.js`

- [x] 6. **Leak guard and regression**, satisfies **AC-10**, **AC-13**
   - A test that collects every voter facing socket payload and REST response in a live session and asserts no email shaped value appears
   - Run both suites, confirm existing visibility, quorum, timer, and join tests still pass

- [x] 7. **Lobby read gate and the neutral client state**, satisfies **AC-14**, **AC-15**
   - In `GET /api/sessions/:id/lobby`, when `type === 'secured'`, run the shared `resolveResultVisibility` before building the payload. Invisible means `sendJson(res, 404, ...)` with the exact body the unknown id branch sends. Apply it on the in memory path and the MongoDB fallback path. A public session short circuits before any resolver call.
   - Client: send `credentials: 'include'` and the admin Bearer header on the lobby fetch, reusing `getAdminToken` from `services/auth.js` the way `services/history.js` does, so participants and the admin keep their `200`.
   - Client: replace the "Session Not Found" panel in `voting-client/src/pages/Lobby.jsx` with the neutral state and copy fixed by AC-15, and delete the "Browse Available Sessions" call to action, which points at a discovery list and asserts nonexistence. Keep the non `404` failure message ("Unable to load session lobby.") as it is, since a transport failure is not an existence signal.
   - Tests: an anonymous and a signed in non participant lobby read on an unpublished secured session returns `404` with the unknown id body, the admin and an approved participant return `200`, a public session is unchanged, and the leak guard still finds no email in any lobby payload.
   - Intentional contract change to an existing test: the case "omits the lobby winner for an unpublished secured session" in `voting-server/test/visibility_and_privacy_spec.js` currently asserts `200` with a null `winner`. It must be rewritten to assert `404` with the unknown id body, and a separate published case must cover the `winner` gating that test was standing in for. This is a changed expectation, not a skipped or weakened test, and AC-13 holds for every other case in the suite.

## Migration plan

**Strategy**: no downtime, additive schema change with an on startup backfill.

**Phases**:
1. Deploy the schema fields with defaults (`type` default `'public'`, `publishResultsPublicly` default `false`). Existing rows keep working because a missing `type` is read as `'public'` until backfilled.
2. Run the backfill that copies `Session.type` onto every `Result` lacking a `type`. New results are written with `type` from the start, so the backfill only ever shrinks.

**Rollback**: reverting the deploy restores the previous behavior, where every result read is ungated. No data is destroyed, and the backfill is idempotent.

**Step 7 rollout (lobby gate, AC-14)**: no data change and no schema change, but it is a visible behaviour change, so ship the client before the server. An old client that meets the new `404` shows its existing "Session not found." copy for a session that does exist, which is misleading but harmless. A new client that meets the old server `200` renders normally. Rolling the server back restores the previous lobby behaviour on its own, and no client change is needed to undo it.

**Risks**: a `Result` whose `Session` document is missing cannot be backfilled and is treated as `'public'`. Secured sessions are recent, so this window is small. The build should log any such row.

## Consequences

**Positive**:
- Secured results gain the privacy the secured session feature promised for the roster, closing the hole both October 3 reviews named.
- One shared resolver keeps the socket gate and the REST gates from drifting apart.
- Turnout turns the existing `VoteParticipation` audit trail into a usable admin view without storing anything new.
- The leak guard makes the no emails invariant standing rather than incidental.

**Negative / tradeoffs**:
- Denormalising `publishResultsPublicly` onto `Result` adds a second copy that the publish action must keep in step. The one writer (`SET_PUBLISH_RESULTS`) is the mitigation.
- A denied caller receives `404`, so a legitimate participant who is not signed in sees a generic unavailable state rather than a sign in prompt on the first load. The client copy mitigates this.
- Turnout exposes voter emails to the admin. This is intended and already true of the participant roster, but it widens the surface where emails exist in memory.
- Publishing is post completion only, so an admin cannot pre announce that a result will be public.

**Neutral**:
- No new dependency. `Result` gains two fields; `Session`, `VoteParticipation`, and `User` are unchanged.
- The socket room gate for secured sessions already exists and is not touched.
- `SET_PUBLISH_RESULTS` joins the existing admin action family and must be registered in `ADMIN_ACTION_TYPES`, the same pattern as the four secured actions.

## Follow-up

- [ ] Phase 9 (Hardening and docs) adds rate limits and timing parity; the turnout endpoint should be included in the rate limit review.
- [x] Consider surfacing turnout as an export (CSV) for the admin once the view lands.
   - Done as a browser side export: `buildTurnoutCsv` in `voting-client/src/components/results/resultsUtils.js`, rendered by a Download CSV button inside the already admin gated turnout panel on `Results.jsx`. No new endpoint.
- [ ] Consider whether an archived secured session that was never published should keep its `Result` row at all, or whether publication is the only path that keeps it. Deferred.
- [ ] The `winner` field on the lobby endpoint is gated here for secured sessions; a full audit of every REST payload for other leaked result fields belongs to the payload leak guard test.
- [x] AC-14 and AC-15 are recorded but not built. Run `/develop visibility and privacy lobby gate` to close build plan step 7, then `/check verify visibility and privacy` to prove AC-14 and AC-15 at runtime alongside the AC-9 archive type fix. Built 2026-10-05; still needs `/check verify` for the runtime proof.
- [ ] The join code resolver was left confirming existence on purpose, because the six character code is the capability. If you would rather it also fail closed, that is a separate decision with its own cost: a voter holding a valid code for a secured session would get a `404` at `/join` and never learn the session name before signing in.
