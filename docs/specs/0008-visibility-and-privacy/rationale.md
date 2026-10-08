# 0008. Visibility and privacy, decision record

## Context

The secured sessions feature closed the roster but left the results open. The socket room for a secured session is gated at `subscribe_session`, so an outsider cannot subscribe to live state, but the REST reads were never brought under the same rule. `GET /api/sessions/history` lists every completed result regardless of session type, `GET /api/sessions/:id/result` and `GET /api/sessions/:id/rounds` serve a secured result to anyone who knows the session id, and the lobby metadata endpoint exposes the `winner`. Both October 3, 2026 reviews named this hole: securing the roster while leaving the results room open gives the feature a privacy problem on the exact sessions it exists to protect.

The groundwork is already present. The `Session` schema has a `publishResultsPublicly` field and the create form collects it (defaulting off for secured sessions), but nothing reads it for gating and there is no way to change it after creation. The `VoteParticipation` model already records, per secured round, that a signed in voter cast a vote, and it deliberately stores no choice. The scope's Phase 8 calls for the visibility matrix, the publish toggle, the admin turnout view, and a guarantee that emails never reach a voter facing payload.

The forces: the server is authoritative and already centralises cross cutting guards (`applyTallyVisibilityGuard` is shared by the socket serializer and the REST rounds endpoint), so a new gate should follow that pattern rather than spread per endpoint. Results are persisted separately from sessions, so the history query has to decide session type and publish state without a second look at every session unless we denormalise. Turnout must never expose a choice. Email is PII and must stay admin only. Not deciding leaves a shipped feature with a privacy hole and no way to publish a secured result.

## Options considered

### Option 1: Extend `Result` with `type` and `publishResultsPublicly`, gate reads behind one resolver

Add the two fields to `Result`, write them at completion, and put the visibility decision in one shared helper every result surface calls. The publish action writes both the `Session` and the `Result`.

**Pros**:
- The history query filters on one collection, no join.
- One resolver means the socket gate and the REST gates cannot drift apart.
- The publish state is queryable and indexable where it is read.

**Cons**:
- The publish flag exists in two places and the publish action must keep them in step.
- A backfill is needed for results created before the field existed.

### Option 2: Store `type` on `Result`, read publish state from `Session`

`Result` gains only `type`; the publish flag stays on `Session` alone, and the history query joins by session id.

**Pros**:
- One source of truth for the publish flag, no drift possible.
- Smaller schema change.

**Cons**:
- Every history read needs a second query over sessions.
- The admin facing flag and the gating flag are the same row but read from a different place than the rest of the result, which invites a future reader to bypass it.

### Option 3: Join `Result` to `Session` at query time, no schema change

Leave both tables alone and resolve type and publish state by joining at read time.

**Pros**:
- No migration and no backfill.
- Nothing new to keep in step.

**Cons**:
- Every result surface pays a join, including the socket path.
- The visibility rule stays implicit in each query rather than in one named helper, which is how the hole appeared in the first place.

## Rationale

Option 1 wins because the read that must be gated is the archive, and the archive reads `Result`. Putting the two decision fields where they are read keeps the history filter a single indexed query and keeps the gate in one helper both transports call, which is the pattern this codebase already uses for tally hiding. Option 2 is defensible and avoids drift, but it moves the gate to a different collection than the data and needs a join on every history read; given that `SET_PUBLISH_RESULTS` is the only writer, the drift risk in Option 1 is small and the single writer is an easy invariant to pin with a test. Option 3 was rejected on the same reasoning that the socket room hole came from: a rule not held in one place gets applied to some doors and missed on others.

The remaining calls follow from the same instinct. Publishing is post completion only, so `SET_PUBLISH_RESULTS` refuses any session that is not `completed` and there is no window where a publish flag is set but the session is live. A denied caller receives `404` rather than `403`, because the point of the feature is that an unpublished secured session should not be discoverable. Turnout is admin only and reads `VoteParticipation` unchanged, its round index derived from the pinned `roundId` format rather than a new column. Emails stay admin only, and a standing leak guard test keeps that true as the code grows.

## Amendment (2026-10-04): may the lobby confirm a gated secured session exists?

**Context**. A runtime verification pass on 2026-10-04 found the one surface that breaks AC-2. `GET /api/sessions/:id/lobby` returned `200` with `title`, `status`, `type`, `whoCanJoin`, `entryCount`, and `voterCount` for any caller holding the session id, and only an unknown id returned `404`. AC-2 promises that a denied caller gets the same `404` a missing result gets and that the existence of the session is not revealed, so the contract and the code disagreed.

The exposure is larger than a bare existence oracle. Session ids arrive on `CREATE_SESSION` as `action.sessionId`, so an admin chooses them and they can be a readable phrase rather than a random string. Anyone who guesses or is handed one learns the title, whether it is allowlist or approval mode, how many entries it has, and how many voters are in it. The join code resolver at `GET /api/join/:code` also confirms existence, but only to a holder of the six character code, which is the capability the admin hands out deliberately. The lobby asks for nothing.

**Option 1: Answer `404` for a gated secured session, with the unknown id body, and render one neutral client state for every lobby `404` (chosen)**

Gate the lobby read with the same `resolveResultVisibility` the result and rounds reads use. Invisible means the exact body the unknown id branch already sends. The client collapses its `404` handling to one neutral state with a sign in prompt.

Pros: existence becomes unconfirmable on every voter facing read, so AC-2 reads true as written. One resolver behind every door, so the rule cannot be forgotten on the next surface. Byte identical bodies mean no timing or shape tells the two apart.

Cons: a signed out invitee who scans the QR for a secured session no longer sees the session title or the sign in wall before signing in. Every lobby `404` must share one neutral copy, including a genuine typo, and that copy can never mention that a session exists. The admin and participant lobby reads depend on the client attaching the cookie and Bearer header, which it does not do for this fetch today.

**Option 2: Answer `200` with a reduced shell, carrying only `sessionId` and `type`**

Keep the `200` so the client keeps a real session to render against, and strip the title, status, counts, and `whoCanJoin`.

Pros: the client keeps a session context and needs no copy change. Content leak closed.

Cons: `200` against `404` is itself the existence signal, so the leak this amendment exists to close stays open. It also forces a two shape contract on every client of this endpoint forever, and the neutral body still tells an outsider the session is secured.

**Option 3: Keep today's full metadata and carve the lobby out of AC-2**

Write into the spec that the non disclosure promise covers the result, rounds, and history reads, and that the lobby deliberately confirms.

Pros: no code change, no UX cost, and the contract becomes an accurate description of the system.

Cons: it makes the one weak door an intentional, documented hole. It contradicts the project's standing rule that a denied read fails closed, and it leaves title and voter counts readable by anyone holding a guessable id.

### Rationale

Option 1 wins on the force that shaped the rest of this spec: a rule not held in one place gets applied to some doors and missed on others. The lobby was missed precisely because it reimplemented visibility for the `winner` field instead of asking the shared resolver, and the fix that does not reintroduce the class of bug is the one that routes the lobby through the same call. The cost is real, a signed out invitee sees a neutral panel instead of the session name, but that is the same tradeoff AC-2 already accepted on the result and rounds reads, where the spec noted that a denied caller gets a generic unavailable state and lets the client copy mitigate it. Here the mitigation is the sign in prompt, which is the one thing a legitimate invitee actually needs. Option 2 keeps the status code that carries the leak, so it solves the smaller half of the problem. Option 3 documents the hole instead of closing it, and the project's own rule, that reads fail closed and an unresolvable type is gated as secured, points the other way.

The join code resolver stays as it is. A `404` there would mean a voter holding a valid code for a secured session is told the code is bad, which trades a small existence leak for a broken entry point. That boundary is now written into the invariants so a later reader does not mistake it for an oversight.
