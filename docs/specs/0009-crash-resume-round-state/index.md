# 0009. Crash resume: round and lifecycle state on a session

**Date**: 2026-10-05
**Status**: Accepted (spec first, build not started)
**Supersedes**: the "open sessions are reset to pending" recovery rule in `docs/specs/0003-round-history-and-results.md` build step 7 and in `recoverSessionsFromDb`

## Summary

Today a server restart loses the live round. `recoverSessionsFromDb` calls `repository.resetOpenSessionsToPending()` and then reconstructs every session with `CREATE_SESSION`, so an interrupted tournament comes back as `pending` with no matchup, no lifecycle, no clock and no memory of who had voted. The admin has to start it over and the voters who already voted can vote again. This spec persists enough round state on the session document that a restart resumes the interrupted round in place: same round, same matchup, same round index, the countdown it had left, and duplicate vote protection that still holds.

## Context

This is not hypothetical. During spec 0003 verification a seven candidate tournament was interrupted mid flight by killing the process. The session recovered as `pending`, `GET /rounds` returned an empty list even though two rounds were persisted, and the socket carried no round at all. Three distinct pieces of state are lost today, and each one has a consequence beyond cosmetics:

- **Round identity.** `roundManager.initRound` derives the index from an in memory `roundIndexBySession` map that starts empty, so after a restart the next round is initialised as `r1` again. `APPEND_ROUND_RESULT` is idempotent on `roundIndex`, so a post restart round two would be silently discarded as a duplicate of a round that already closed. The history would simply stop growing with no error anywhere.
- **The clock.** `timerManager.startTimer` computes `expiresAt = now + duration` and arms a single `setTimeout`. Neither the deadline nor the handle survives the process, so a round that was nine seconds from closing comes back with no time at all.
- **The ballot.** Duplicate vote protection is an in memory set (`submissionsByRound`, plus the `recordVote` key set keyed `${sessionId}:::${roundId}:::${sortedPair}:::${voterToken}`). `VoteParticipation` covers cross restart dedup for signed in voters through its unique `{sessionId, roundId, userId}` index, but an anonymous voter has no `userId`, so an anonymous voter who already voted can vote a second time in the resumed round.

There is also a coupling to spec 0003. A recovered session currently serves its settled `rounds[]` history while `pending`, because the shared guard withholds history unless the session concluded or a reveal is running. Once a resumed session is `open` with a live round, the guard withholds again during `VOTING`, which is correct: the history returns at the reveal. That existing behaviour is deliberately not changed here.

## Decisions taken before writing this

These were settled with the owner of the change rather than assumed:

1. **Duplicate votes across a restart**: persist a salted hash of each voter token for the live round, never the raw token. An aggregate tally alone cannot reconstruct who voted, and letting a second vote through would break the one invariant a ballot depends on.
2. **The resumed clock**: resume the remaining time from a persisted deadline. A round whose deadline passed while the process was down is closed on recovery rather than reopened as a vote nobody can finish.
3. **Sequencing**: spec first, then build. This changes a persisted data model and a privacy posture, so the contract is written down before code moves.

## Requirements

**User stories**
- As an admin, I want an interrupted tournament to come back exactly where it stopped after a server restart, so a crash does not cost the room a vote or a round.
- As a voter, I want my vote from before the crash to still count and to still stop me voting twice.
- As a voter, I want the round to reopen with the time it had left, not with a fresh full timer or with no clock at all.

**Acceptance criteria** (each independently checkable):

- **AC-1**: The `Session` document holds a `liveRound` subdocument while a round is open, and that subdocument is removed when the round closes. A session with no `liveRound` is a session with no round in flight.
- **AC-2**: `liveRound` carries `roundIndex`, `roundId`, `kind`, `candidates`, `lifecycle`, `expiresAt`, the live `tally`, and the round's submissions as salted digests. No raw voter token is ever written to the database.
- **AC-3**: Recovery restores an interrupted session with status `open` and its recorded `lifecycle`, matchup and round index, and the next round continues from that index. A session interrupted at round three must not produce a later round numbered one, two or three again.
- **AC-4**: A resumed round carries the time it had left, computed from `expiresAt`. When `expiresAt` is already in the past, recovery closes the round through the ordinary close path, which appends its snapshot, persists it, and either advances or settles the tournament.
- **AC-5**: A voter who already voted in the interrupted round is refused a second vote in the resumed round, for an anonymous voter as well as a signed in one. The refusal is the existing `DUPLICATE_VOTE` error, not a new code path for the client.
- **AC-6**: Restoring the tally into the store does not expose it. While the resumed round is open the shared guard still strips `rounds`, `finalVote` and the live tally, so nothing about the in flight ballot reaches a client.
- **AC-7**: A session with no `liveRound` recovers exactly as it does today: `completed` restores its status and winner, `archived` is still never loaded, and a `pending` session with no round still serves its settled history.
- **AC-8**: The server suite covers persistence, rehydration, round index continuation, the expired round close, duplicate vote refusal across a restart, and the guard; the client suite stays green.

## Design

### Persisted shape

On `Session`:

```
liveRound: {
  roundIndex:   Number,          // monotonic, matches APPEND_ROUND_RESULT idempotency
  roundId:       String,          // `${sessionId}:::r${roundIndex}`
  kind:          String,          // 'pairwise' | 'single_ballot'
  candidates:    [String],        // the live matchup or ballot
  lifecycle:     String,          // 'VOTING' | 'RESULTS_REVEALED' | 'TIE_PENDING' | 'ROUND_CLOSED'
  expiresAt:     Date,            // the countdown deadline, never a duration
  tally:         Map<String, Number>,
  submissions:   [{ digest: String, choice: String }],
  updatedAt:     Date
}
```

Default `null`, so every existing document is already in the AC-7 shape and needs no backfill. `roundIndex` is the load bearing field: without it the resumed session's next round would reuse an index the idempotency check has already seen.

### Submission digests

`digest = HMAC-SHA256(VOTER_JWT_SECRET, `${sessionId}:::${roundId}:::${voterToken}`)`, hex encoded. The same secret already signs voter cookies and is already required in production, so no new secret is introduced. A digest is stable across restarts, which is the whole point: it lets `submissionsByRound` be rebuilt on recovery and compared against the incoming token. Rotating `VOTER_JWT_SECRET` invalidates in flight digests exactly as it invalidates voter cookies, which is the consistent behaviour.

Only signed in voters are also covered by `VoteParticipation`; the digest set is what covers anonymous voters, whose `userId` is null and who therefore have no persisted dedup today.

### Write points

`liveRound` is written when a round opens (start, or advance after `NEXT`) and rewritten when a vote lands, since the tally and the submission set are both part of it. It is deleted inside `closeRoundOnce`, on the same path that appends the round snapshot, so the document can never claim a round is live while the store says it is closed. Writes are single document upserts keyed by `sessionId`; the document is small (a matchup, a tally, and one digest per voter per round), so this stays well inside the size limits the round history design already reasoned about.

### Recovery algorithm

For each non archived session with a `liveRound`:

1. Rehydrate the round in `roundManager`, seeding `roundIndexBySession` from the persisted index and rebuilding `submissionsByRound` from the digests. Restoring the round object alone is not enough; both maps must be seeded or the first vote after recovery would be accepted twice.
2. Restore the store to `open` with the recorded lifecycle and matchup. This needs a reducer action distinct from `RESTORE_SESSION_OUTCOME`, which is scoped to `pending` and `completed` and sets only status and winner.
3. Resume the clock: `remaining = expiresAt - now`. If `remaining > 0`, arm the timer for `remaining`. If `remaining <= 0`, close the round through `closeRoundOnce` and let the normal close path advance or settle it, which is what keeps a dead vote from reopening.
4. Re seed the presence snapshot. Early completion quorum is measured against the active snapshot voters, and presence is in memory only, so after recovery the snapshot is whoever is currently connected. The alternative, refusing early completion until a fresh snapshot exists, is the safe default for the first pass.

Recovery must be idempotent: running it twice against the same document has to produce the same store, the same round identity and the same digest set.

### Guard interaction

Nothing changes in `applyTallyVisibilityGuard`. A resumed session is `open` with `lifecycle: VOTING`, so the guard withholds history and the live tally for exactly as long as a normal round is open, and releases both at the reveal. The spec 0003 behaviour where a `pending` recovery serves its settled history is unaffected, because a session with no `liveRound` is still recovered as `pending`.

## Security model

The only new data at rest is the submission digest set and the live tally for one open round. Both are server only and neither is ever serialised into a client payload while the round is live, because the guard runs on both read paths. The tally for a closed round has always been persisted, in the `Result` document, so persisting a live tally does not widen the window during which a tally exists on disk; it widens the window during which it exists *unsettled*, which the guard keeps invisible to clients. `liveRound` carries no voter identity beyond the digest and the choice, and the digest is not reversible without `VOTER_JWT_SECRET`.

## Build plan

Tracer bullet slices, each one a thin strand through schema, write, recovery and test:

1. **Schema and write on open.** `liveRound` on `Session`, written when a round opens and deleted when it closes, with no recovery change yet. Proves the document can hold and release the round without any other behaviour moving.
2. **Vote write through.** The tally and the submission digests are persisted on each vote. Proves the ballot survives a crash before anything reads it back.
3. **Rehydrate on recovery.** A new reducer action restores `open` plus lifecycle and matchup, `roundManager` rehydrates the round and seeds both maps, and the guard behaviour is asserted. This is the slice that turns a restart into a resume.
4. **Clock resume.** `expiresAt` drives the timer on recovery, and an already expired round is closed on recovery through the ordinary path.
5. **Duplicate vote across the restart.** The rebuilt digest set refuses a second vote, and the existing integration test covers kill and restart between the two votes.
6. **Regression sweep.** The full server suite, the client suites and a real kill and restart on a driven tournament, with runtime evidence recorded in `verify.md`.

## Non goals

- Resuming an interrupted reveal animation or an interrupted tie ladder interaction. A `TIE_PENDING` round recovers as `pending` on its tie resolution, because the admin action that resolves it is the thing that was interrupted.
- Persisting presence, voter identity or the voter registry. They stay in memory and rebuild from reconnects.
- Changing anything about how a completed or archived session recovers.

## Follow-up

- `docs/specs/0003-round-history-and-results.md` build step 7 describes the reset to pending. It should be amended to point here once slice 3 lands, the same way AC-3 was amended when the recovered history rule changed.
- The `ROUND_CLOSED` half of spec 0003 AC-3 is still unimplemented, and a resumed lifecycle can now be `ROUND_CLOSED`. That interaction needs an architect pass rather than an inline decision.