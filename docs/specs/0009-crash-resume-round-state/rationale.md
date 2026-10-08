# Rationale: crash resume round state

Why the shape in [index.md](index.md) and not the alternatives.

## Why persist the deadline instead of the duration

A round does not know how much time it has left; it knows when it ends. `timerManager` already computes `expiresAt` and stores it on the timer entry, so persisting it is a copy rather than a derivation. Persisting `duration` instead would force recovery to guess when the round started, and the wrong guess is silent: a round that reopens with more time than it had lets voters vote after they should be locked out, and one that reopens with less truncates a vote in progress.

## Why resume rather than restart the round

The alternatives were to reset an interrupted session to `pending` (today's behaviour) or to close the interrupted round and advance on recovery. Closing it would need a tally that is only meaningful if it is the real one, and the real one is the thing that was not persisted, so the round would have to close as abandoned. That turns a five second outage into a lost round for every voter who had already voted. Resuming is the only option that preserves the ballot the room already cast, which is the thing a voting system exists to do.

## Why a hash and not the token

The submission set is keyed by voter token, and the token is a bearer credential: anything holding it can vote as that voter. Writing tokens to the database would mean a database read is enough to impersonate every participant of an open round, which is a strictly larger blast radius than the in memory set has today. `HMAC-SHA256` keyed with `VOTER_JWT_SECRET` gives a value that is stable across restarts (which is the requirement) and useless to anyone without that secret (which is the reason to hash at all). It also reuses a secret the project already requires in production, so no new configuration surface appears.

A per submission random salt would resist nothing extra here, because the attacker we care about has the database and not the secret, and a random salt would break the one property the digest needs: that the same voter produces the same digest on the next boot.

## Why the round index is the load bearing field

`APPEND_ROUND_RESULT` skips an append whose `roundIndex` is already present. That idempotency is load bearing for the round history, and it becomes a hazard the moment an index can repeat: a session interrupted at round three would, without an explicitly restored index, initialise its next round as `r1`, hit the idempotency check, and silently drop a real round from the history. No error, no failed broadcast, just a tournament that stops growing. Persisting `roundIndex` and seeding `roundIndexBySession` on rehydration is what prevents that, which is why it is called out in the design rather than left implicit.

## Why recovery stays idempotent

Startup recovery runs on every boot and can run again against documents it has already processed, including in tests that build a store against the same database. Rehydration that is not idempotent would double arm a timer or double count a submission set. Each step in the recovery algorithm is therefore written to be safe to repeat: seeding a map with the same value, and re hydrating a round whose index already matches.

## Why the guard is left alone

It is tempting to relax the guard so a resumed round shows its history while open. That would be a regression against AC-9 of spec 0003, which withholds tallies during an active round, and the history is already available the moment the reveal starts. Leaving `applyTallyVisibilityGuard` untouched keeps this slice about durability rather than about visibility, which is what makes it safe to ship on its own.