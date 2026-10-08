# Verify: Visibility and privacy · spec 0008 · runtime verified 2026-10-04 (re-verified 2026-10-04 after the AC-9 archive fix)

_Acceptance criteria are each marked from a run against a real server, a real MongoDB, and a real browser. `/test` holds the durable automated coverage._

## Runtime environment

- **Server**: `voting-server/index.js` on port 8091, started from `scripts/verify-run-server.sh`, which injects the repo `.env` secrets and overrides the port, database, CORS origin and timer lengths.
- **Database**: a real `mongod` 8.2 on `localhost:27017`, isolated database `votesphere_vp_20261004` so the shared dev data was untouched. Startup recovered 0 sessions, so nothing was inherited.
- **Client**: the Vite dev server on 5174 with `VITE_SERVER_URL=http://localhost:8091`, driven in a real Chromium.
- **Actors**: the admin in the primary browser, and the voter in a separate incognito context so the two cookie jars never mixed. A third incognito context was the anonymous outsider.
- **Note on credentials**: the server does not read `.env` itself, so the run script sources it. A run-local admin password was generated for this session rather than reading the stored credential, and the run-local database was discarded afterwards.
- **One deviation**: the round timer was left at the form default of 30 seconds because the create form was filled through the UI. Timers are not part of this spec, and the round still closed and completed correctly.

## Runtime UI pass (real browser, real server, real MongoDB)

- [x] Create a secured session with an allowlist through the admin panel, three entries → the card reads `Secured (allowlist)` and the create form shows **no publish checkbox** → AC-11
- [x] A voter signs in with a real emailed OTP: the server logged `[OTP-DEV] Code 287422 for verifier0008@example.com, expires in 10 min`, the code was entered in the browser and accepted → the passwordless path works end to end
- [x] The voter joins with the real join code `UDYDAN` → the lobby renders `SECURED (ALLOWLIST)`, the live headcount moves 0 → 1, and **no email address appears anywhere in the lobby** → AC-10
- [x] Admin starts the tournament → the voter is moved to the ballot, votes, and the session completes with `Alpha` at 100% → AC-13 (join flows and quorum untouched)
- [x] Open the results page as the **anonymous outsider** on the unpublished secured session → the neutral "Results are not available" panel with a sign in prompt; the DOM contains no winner, no candidate name, and no email → AC-2, AC-12
- [x] Open the same results page as the **approved participant** → `We Have a Winner! Alpha` renders normally → AC-2
- [x] As the admin → the `Admin result controls` region renders with `Private: only approved participants and you can view this result.`, a `Publish result` toggle, and the per round turnout panel → AC-3, AC-12
- [x] Turnout shows round 1 with one signed in voter (`verifier0008` / `verifier0008@example.com`) and round 2 with `No signed in voters in this round.` → AC-7
- [x] `Download CSV` produces `turnout-ver0008sec.csv` in the browser with the real payload:
  ```
  roundIndex,roundId,voterCount,voterName,email
  1,ver0008sec:::r1,1,verifier0008,verifier0008@example.com
  2,ver0008sec:::r2,0,,
  ```
  Round 2 survives as an empty row rather than disappearing, and no vote choice appears → AC-7, AC-10
- [x] As the anonymous outsider and the participant, the admin region, the publish toggle, the turnout panel and the export button are all absent, even though turnout is already in the store → AC-8, AC-12

## Publish and unpublish round trip (real browser and real REST)

- [x] Admin clicks `Publish result` → the toggle does **not** flip optimistically; it becomes `Unpublish result` with `Published: anyone with the session id can view this result.` only after the server acknowledges → AC-3, AC-12
- [x] Anonymous `GET /api/sessions/ver0008sec/result` and `/rounds` move `404` → `200`, and the session appears in `GET /api/sessions/history` → AC-4, AC-5
- [x] The anonymous results page then renders `We Have a Winner! Alpha`, with no admin panel and no turnout → AC-4, AC-8
- [x] Admin clicks `Unpublish result` with a **deliberately invalid admin token** in `localStorage` → the toggle stays on `Unpublish result`, the hint stays `Published: ...`, the toggle re-enables, and a `role="alert"` line shows the server's own words, `Malformed or invalid authentication token.` → AC-3, AC-12
  - The server side flag stayed `publishResultsPublicly: true` and the anonymous read stayed `200`, so what the admin was shown matched what the server held. This is the case the 2026-10-04 review raised, now confirmed in a browser rather than only in a component test.
- [x] With the good token restored, the same click unpublishes → the toggle returns to `Publish result`, the hint returns to `Private: ...`, the reason line clears, anonymous `result` and `rounds` return to `404`, and the session leaves the archive → AC-3, AC-4, AC-5
- [x] A raw socket client emitting `SET_PUBLISH_RESULTS` received `{"success":true,"sessionId":"ver0008sec","publishResultsPublicly":false}` as its acknowledgement, confirming the ack carries the value the server actually stored → AC-3

## Commands

- [x] `cd voting-server && npm test` → 694 passing, 0 failing → AC-11, AC-13
- [x] `cd voting-client && npm test` → 456 unit plus 68 component passing, 0 failing → AC-3, AC-12, AC-13
- [x] `cd voting-client && npm run lint` → clean → AC-13
- [x] `cd voting-client && npm run build` → builds with no errors → AC-12
- [x] The whole runtime pass produced **no errors in the server log** beyond the deliberate refusal → AC-13

## Value sourcing

- [x] Vary the caller: no cookie and no admin header gives `404` on result and rounds; the approved participant's `vs_voter` cookie gives `200`; the admin Bearer gives `200` → AC-2
- [x] Vary the session type: the public seed session `sess_horror` returns `200` on result, rounds and lobby for an anonymous caller and is listed in the archive, with `type: public` and `publishResultsPublicly: true` → AC-1
- [x] Vary the publish flag: the same secured session is `404` while unpublished and `200` while published, in both directions → AC-2, AC-4
- [x] Vary participation: round 1 lists the signed in voter by name and email, round 2 lists nobody, and no vote choice is shown or exported → AC-7, AC-10
- [x] Vary the admin token: a valid token is acknowledged and applied; an invalid one is refused with the server's message and changes nothing on the server → AC-3
- [x] Vary the payload source: the history row for the published secured session carries `sessionId`, `title`, `winner`, `entries`, `completedAt` and **no `type`** → see the open item below → AC-5, AC-9
- [x] Vary the gated lobby: the lobby of the gated secured session returns `200` with `winner: null` and carries no allowlist entry and no email → AC-2, AC-10

## Acceptance-criteria coverage

- AC-1 · public seed session served to an anonymous caller on result, rounds and lobby, and listed in the archive
- AC-2 · anonymous `404` on result and rounds, approved participant `200`, admin `200`, gated DOM free of winner, candidate and email
- AC-3 · `SET_PUBLISH_RESULTS` accepted and refused against the real socket, refusal carrying the server's own message and leaving the server flag untouched
- AC-4 · publish moves the anonymous reads `404` → `200` and back again, verified in the browser and over REST
- AC-5 · the archive excludes the unpublished secured session, includes it once published, and excludes it again on unpublish
- AC-6 · the gate held throughout; the live rounds read was `404` for an outsider while the participant saw the ballot. The socket room gate itself was not separately re-driven, since the outsider never reached the room. (Both halves were driven deliberately in the re-verification pass; see there.)
- AC-7 · per round turnout with the signed in voter's name and email, an empty round preserved, and the CSV export carrying the same data
- AC-8 · no admin region, toggle, turnout panel or export for the anonymous outsider or the participant
- AC-9 · `Result.type` written as `secured` and read back on the result endpoint. The history **listing** still carries no `type`; see the open item.
- AC-10 · no email in the lobby, the gated results DOM, or the anonymous archive, in any of the three browser contexts
- AC-11 · the create form has no publish control, and the admin panel shows the session as `Secured (allowlist)`
- AC-12 · the neutral gated panel, the sign in prompt, the ack driven toggle, the refusal line, the turnout panel and the export, all observed in a real browser
- AC-13 · both suites green, the join flows and the ballot unchanged, and no server errors during the run

## Re-verification pass (2026-10-04, after the AC-9 archive fix)

**Environment**: a real `mongod` on `localhost:27017` against a freshly dropped isolated database `votesphere_check_1005`, server on 8092, Vite on 5175, admin in one Chromium context and an anonymous outsider in a separate incognito context. Two socket driven sessions with seven entries (`vfy_pub` public, `vfy_sec` secured allowlist) plus a third pending secured session (`vfy_live`), both driven to completion through `START_SESSION`, `VOTE` and `NEXT`. The admin credential came from the repo `.env`; the participant identity was a `User` row plus a `vs_voter` cookie minted with the same secret the server uses.

### UI / manual

- [x] Open the admin create form → the dialog has **no publish checkbox at all** (`input[type=checkbox]` count 0, no "publish" text anywhere in the dialog) → AC-11
- [x] Open `/history` as the admin with one published secured result and three public ones → the secured card reads `Completed` + an amber `Secured` badge with a lock (`rgba(245, 158, 11, 0.15)` on `rgb(251, 191, 36)`), every public card reads `Completed` + a slate `Public` badge (`rgba(148, 163, 184, 0.12)` on `rgb(203, 213, 225)`) → AC-9
- [x] Open `/sessions/vfy_sec/results` as the admin → the `RESULT VISIBILITY` region, the publish toggle, the hint line, the per round turnout panel with the participant's name and email on all six rounds, and `Download CSV` all render → AC-12, AC-7
- [x] Click `Unpublish result` in the browser → the button becomes `Publish result` and the hint flips to `Private: only approved participants and you can view this result.` **after the server answers**; the admin read stays `200`, an anonymous read of the same result goes `404`, and the secured row leaves the archive while every remaining row keeps its `type` → AC-3, AC-4, AC-5, AC-12
- [x] Open the same results page as the anonymous outsider → `Results are not available` with a sign in prompt, no winner, no candidate name, no email, and no admin region → AC-2, AC-12
- [x] Open `/sessions/vfy_sec/lobby` as the anonymous outsider → the page renders the secured session in full: `SECURED (ALLOWLIST)`, the title `Vfy Secured Session`, the session id, `COMPLETED`, the participant count and the sign in wall. The winner itself does **not** appear (`Golf` is absent from the DOM; the copy says "The community selected the final winner") → AC-14 **not met**, AC-2 met for the winner only
- [x] Open `/sessions/vfy_nope/lobby` (an id that does not exist) in the same context → `Session Not Found`, "The requested session vfy_nope does not exist or has been removed." and a `Browse Available Sessions` link, which is a **different** page from the gated one → AC-15 **not met**

### Commands

- [x] `curl /api/sessions/history` before publishing → rows `[["sess_horror","public"],["sess_default","public"],["vfy_pub","public"]]`, no secured row → AC-5, AC-9
- [x] `curl /api/sessions/history` after publishing `vfy_sec` → the row appears with `type: "secured"`, and after unpublishing it disappears while the public rows keep their type → AC-5, AC-9
- [x] `node` + `mongoose` read of the live `results` collection → `vfy_sec` row `type: secured`, `vfy_pub` row `type: public`, both with a boolean `publishResultsPublicly` → AC-9
- [x] `SET_PUBLISH_RESULTS` refusal matrix against the real socket, one action at a time → non admin `UNAUTHORIZED` in 202ms, pending session `SESSION_NOT_COMPLETED` in 202ms, string value `VALIDATION_ERROR` in 204ms, unknown id `SESSION_NOT_FOUND` in 203ms, valid publish acknowledged `{"success":true,"sessionId":"vfy_sec","publishResultsPublicly":true}` and the stored row read back `true` → AC-3
- [x] `cd voting-server && npm test` → 694 passing, exit 0 → AC-13
- [x] `cd voting-client && npm test` → 456 unit passing, 0 failing, plus 68 component tests passing, exit 0 → AC-13
- [x] Server log for the whole pass → zero error lines; Vite log → zero error lines → AC-13

### Value sourcing

- [x] Vary the caller on the gated secured session: anonymous `404` on result, rounds and (expected) lobby; approved participant cookie `200`; admin Bearer `200` → AC-2
- [x] Vary the session type in one archive: the rows differ only in `type`, `public` versus `secured`, and the badge follows it → AC-9
- [x] Vary the publish flag on one secured session: publish then unpublish moves the anonymous read `404 → 200 → 404` and the row in and out of the archive → AC-4, AC-5
- [x] Vary participation in the socket room, the half earlier runs never drove: an outsider `subscribe_session` on the secured room is refused `NOT_ELIGIBLE` and receives **no** `session_state`, while the approved participant's socket is admitted and receives `session_state` → AC-6
- [x] Vary the viewer on a live secured session: anonymous `/rounds` `404`, approved participant `200`, admin `200` → AC-6
- [x] Vary turnout authority: admin `200` with six ascending rounds and the participant's email, anonymous `404`, signed in non participant `404`, and the socket subscribe refused `UNAUTHORIZED` → AC-7, AC-8
- [x] Vary the payload source across every anonymous surface (history, secured result, secured rounds, discovery, secured lobby, turnout, join resolver) → no email shaped value in any of them → AC-10

### Acceptance-criteria coverage

- AC-1 · public result, rounds and lobby all `200` for an anonymous caller with `winner: "Golf"`, and the public flag being true never gates it
- AC-2 · anonymous `404` on result and rounds, participant and admin `200`, and the gated results DOM free of winner, candidate and email in the browser
- AC-3 · all four refusals plus the acknowledgement, and the archived session still publishable (`ack {"success":true,"sessionId":"vfy_pub","publishResultsPublicly":true}`)
- AC-4 · publish and unpublish move the anonymous reads and the archive membership in both directions, observed in the browser and over REST
- AC-5 · the archive omits the unpublished secured result, includes it once published, drops it again, and every row is typed throughout
- AC-6 · **both halves this time.** The socket room gate: outsider refused `NOT_ELIGIBLE` with no state, participant admitted with state. The REST gate: `404` outsider, `200` participant, `200` admin on a live secured session
- AC-7 · six ascending rounds, the signed in voter named in each, empty rounds preserved, no vote choice in the payload, CSV button present
- AC-8 · turnout `404` for anonymous and for a signed in non participant, `UNAUTHORIZED` on the socket, and no admin region, toggle or turnout panel in either browser context
- AC-9 · **now fully met.** `Result.type` written from the session, returned by the result endpoint, present on every archive row, and rendered as a badge in the browser
- AC-10 · no email in any anonymous payload, and the discovery list still hides secured sessions
- AC-11 · the create form carries no publish control and a secured session is created with the flag false
- AC-12 · the admin visibility region, the ack driven toggle, the turnout panel and the export for the admin; the neutral gated panel with a sign in prompt for the outsider
- AC-13 · both suites green, the join flows and the ballot unchanged, and zero server or client errors during the pass
- AC-14 · **not met.** The gated secured lobby answers `200` with `title`, `type`, `whoCanJoin`, `entryCount`, `voterCount` and `status`, while an unknown id answers `404 SESSION_NOT_FOUND`, so holding a session id still confirms existence. The full body was captured this run
  - Superseded on 2026-10-05. `/develop` build plan step 7 landed the gate and the pass at the end of this file verifies AC-14 at runtime. Kept as the record of what this run measured, not as the current verdict.
- AC-15 · **not met.** The client has no neutral state: a missing session renders `Session Not Found` with "does not exist or has been removed" and a discovery link, while a gated secured session renders a full lobby page, so the two are plainly distinguishable to the reader as well as to the network
  - Superseded on 2026-10-05, same as AC-14 above. The pass at the end of this file verifies AC-15 in a real browser for all four caller kinds.

## Still open after this run

- [ ] **A published secured session is listed in the archive without its type.** `GET /api/sessions/history` returns `sessionId`, `title`, `winner`, `entries`, `completedAt` for the published secured session `ver0008sec`, with no `type`, and the History page renders no badge. In the browser the archived secured session is visually identical to the public ones, so an admin cannot tell which archive entries are secured. AC-5 (membership) is met; the AC-9 half that expects the type in the listing is not. This is unchanged from the earlier `/check verify` note and is still the one criterion this feature does not satisfy.
  - Resolved later the same day by `/develop`: `GET /api/sessions/history` now returns `type` on every row, and the History page renders a `Secured` or `Public` badge beside `Completed`. Confirmed at runtime in the re-verification pass above, so AC-9 is fully met. The lobby item below stays open.
- [x] The lobby answers `200` for a gated secured session while an unknown id answers `404`, so a caller holding a session id can still tell that it exists. **Decided, not built.** `/architect` amended spec 0008 on 2026-10-04 with AC-14 and AC-15: the lobby must answer `404` with the unknown id body, and the client must render one neutral state for every lobby `404`. Build plan step 7 in [index.md](index.md) carries the work and scope feature 11 (`Lobby existence gate`) tracks it. This run measured the gap precisely rather than closing it.
  - **Resolved 2026-10-05 by `/develop` build plan step 7, and verified at runtime in the pass below.** The gap is closed.

## Follow-up items closed in this run

The publish toggle and the turnout CSV export were both verified in a real browser for the first time. The export produced a real file with the correct name and content, and the toggle was observed in both the accepted and the refused state, with the busy state clearing on the server's answer rather than on a timer.
## Archive type steps (added 2026-10-04, after the AC-9 archive fix)

_These steps cover the one acceptance criterion the earlier run left open. Everything above them was already ticked._

### UI / manual

- [x] Publish a completed secured session, then open `/history` → the card for that session carries an amber `Secured` badge beside `Completed`, and every public card carries a neutral `Public` badge → AC-9
- [x] Open `/history` as an anonymous caller → no card shows an email address and the badges read the same for the admin and an outsider, since the archive row is not voter scoped → AC-9, AC-10
  - Observed side by side with `vfy_sec` published: the outsider's secured badge computed colour is `rgb(251, 191, 36)`, identical to the admin's, and no card in either view contains an `@`.

### Commands

- [x] `curl /api/sessions/history` after publishing a secured result → every row carries `type`, `secured` for that session and `public` for the public ones → AC-9
- [x] `curl /api/sessions/history` after unpublishing → the secured row disappears, the public rows stay, and no row has lost its `type` → AC-5, AC-9
- [x] `cd voting-server && npm test` → 694 passing, and the history leak guard test still holds with `type` on the row → AC-10, AC-13
- [x] `cd voting-client && npm test` → 456 unit plus 68 component passing, no snapshot or card assertion broken by the second badge → AC-13

### Value sourcing

- [x] Vary the session type: a public completed session and a published secured one in the same archive → the rows differ only in `type`, and the badges differ with them → AC-9
- [x] Vary the publish flag on one secured session: publish then unpublish → the row appears and leaves the archive whole, never appearing with a default type it was not given → AC-5, AC-9
- [ ] Vary the viewer: anonymous, signed in participant, and admin → the same `type` value and the same badge on all three, so the badge describes the session rather than the reader → AC-9
  - Partially done. The admin and the anonymous outsider were compared in the browser and match exactly. The signed in participant was not opened in a browser this run, because that needs an OTP sign in; the participant's view of the same archive was exercised over REST with the same `vs_voter` cookie and returns the identical rows. Tick it after a browser OTP sign in.

## Lobby existence gate pass (2026-10-05, spec 0008 AC-14 and AC-15)

_Driven against a real server on port 8091 with a real Vite client on port 5174, both started from the current working tree. The already running servers on 8090 and 5173 belong to another thread and were left untouched. Sessions were created through the real admin socket API and real voter cookies came from the real OTP flow._

### UI / manual

- [x] Open `/sessions/<a secured session that exists but is unpublished>/lobby` as an anonymous visitor → the page shows `This session is not available.` and `Sign in if you were invited.` linking to `/login?redirect=%2Fsessions%2F<id>%2Flobby`. No title, no session id, no `SECURED (ALLOWLIST)` badge, no counts → AC-14, AC-15
  - Observed in an incognito profile with `document.cookie` empty and no admin token in storage. Screenshot taken.
- [x] Open `/sessions/<an id that does not exist>/lobby` in the same context → the identical `This session is not available.` page, so a missing session and a gated one are indistinguishable to the reader → AC-15
- [x] Read the DOM of both 404 pages → neither contains the words `not found`, `does not exist`, `removed`, `private` or `secured`, neither shows the session title or id, and no `Browse Available Sessions` link exists → AC-15
- [x] Sign in through the real OTP flow as an allowlisted participant, then reopen the same gated lobby → the full lobby renders: title `Fresh Secured Session`, `SECURED (ALLOWLIST)`, `2 entries`, `0 Participants Registered`, and the join form. The gate is a real gate, not a blanket refusal → AC-14, AC-15
- [x] Sign in as a signed in non participant and reopen the same lobby → the same neutral state, but with `Check the link you were given, or ask the organizer for an invitation.` in place of the sign in prompt, since signing in would not help → AC-15
- [x] Sign in as the admin with a live token and open the same lobby → the full secured lobby renders, so the admin is not blocked by their own gate → AC-14
- [x] Open `/sessions/sess_default/lobby` (a public session) anonymously → the lobby renders normally with its title, session id, entry count and participant count, and no neutral state → AC-14, AC-13

### Commands

- [x] `GET /api/sessions/<gated secured id>/lobby` anonymously → `404` with `{"success":false,"error":"SESSION_NOT_FOUND","message":"Session was not found."}`, byte identical to the body an unknown id returns → AC-14
  - Observed equality: `gated === unknown` is `true` when both bodies are compared as JSON, and the gated body does not contain the session id.
- [x] `GET /api/sessions/<gated secured id>/lobby` with a signed in non participant's `vs_voter` cookie → the same `404` body as an anonymous caller → AC-14
- [x] `GET /api/sessions/<gated secured id>/lobby` with the admin `Authorization: Bearer` header → `200` with `title`, `type: secured`, `whoCanJoin: allowlist`, `entryCount: 2` → AC-14
- [x] `GET /api/sessions/<gated secured id>/lobby` with the approved participant's `vs_voter` cookie → `200` with the full metadata → AC-14
- [x] Vary the publish flag on one completed secured session → anonymous read is `404` unpublished, `200` with the title after `SET_PUBLISH_RESULTS true`, and `404` again after unpublishing, with the closing body identical to the first closing body → AC-14
  - The action also correctly refused to publish a session that had not completed (`SESSION_NOT_COMPLETED`), so the flip had to be exercised on a completed session.
- [x] `cd voting-server && npm test` → 698 passing, exit 0 → AC-13
- [x] `cd voting-client && npm run test:unit` → 456 passing, 0 failing, exit 0; `npm run test:component` → 77 passing across 3 files, exit 0; `npm run lint` → clean, exit 0; `npm run build` → exit 0 → AC-13
- [x] Server and client logs for the whole pass → zero error lines on either side → AC-13

### Value sourcing

- [x] Vary the caller on one secured unpublished session: anonymous, signed in outsider, approved participant, admin → the first two are byte identical `404`s, the second pair are `200`s with full metadata, so the read follows the caller's eligibility and nothing else → AC-14
- [x] Vary the publish flag on one completed secured session: publish then unpublish → the read opens and closes again, ending on the exact body it started with, so the gate never leaves the session in a half published state → AC-14
- [x] Vary the session type: a public session and a secured one read as an anonymous caller in the same run → the public one is served in full and the secured one is refused, so the gate keys on type rather than on the caller alone → AC-14, AC-13
- [x] Vary the browser context: incognito (no cookie, no admin token) and signed in → the same neutral heading renders in both, and only the signed out one carries the sign in prompt, so the state depends on sign in status and never on what the server told the client about the session → AC-15

### Acceptance-criteria coverage

- AC-14 · met, verified at runtime over REST and in the browser across four caller kinds and the publish flag
- AC-15 · met, verified in the browser for anonymous, approved participant, signed in outsider and admin, with the DOM checked for the five forbidden words
- AC-13 · met, both suites green, lint and build green, the public lobby unchanged, zero server or client errors
