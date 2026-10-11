# Verification Report — External Security/Election-Integrity Review
# Branch: develop1
# Prepared by: /check review (READ-ONLY, no code changed)

## How to read this report

Each issue below answers ten questions:

1. Severity in the incoming report
2. Where the relevant behavior lives now
3. Which module owns the logic
4. What the external report claims
5. What the code actually does on develop1
6. Whether the report matches the current code
7. Security or election-data impact
8. Recommended fix if a real gap exists
9. Tests that should exist
10. Whether it should block release

The short verdicts are in the summary sections near the end.

---

## H1 — One person can vote multiple times in a public session

- Severity: HIGH
- Code location: `voting-server/src/auth/voter.js`, `voting-server/src/reducer.js` (case `VOTE`), and the socket `VOTE` handler path in `voting-server/src/server.js`
- Relevant module: duplicate-vote enforcement and voter identity
- What the report claims: a single person can submit more than one counted vote in a public session.
- What the code actually does: duplicate vote prevention is implemented on the composite key `${sessionId}:::${roundId}:::${sortedPair}:::${voterToken}` in `canCastVote`/`buildVoteKey` and recorded in `recordedVotes`. The reducer also rejects non-`open` statuses and non-`VOTING`/`ROUND_CLOSED`/`RESULTS_REVEALED`/`TIE_PENDING` lifecycle states before applying a vote. Public and secured sessions both go through the same `VOTE` ingress path; public sessions still require a registered voter token.
- Whether the report is correct: NOT REPRODUCIBLE against the current code for the specific claim of multiple *counted* votes. One voter token cannot record the same round/pair twice.
- Security/data-integrity impact: low for counted-ballot duplication; there is a real, separate issue around *cross-round re-vote* and *same-person-many-tokens*, which is more nuanced than the literal wording of H1.
- Recommended fix: do not implement based on this exact wording. If the intent was "one human, one ballot per session", that is a requirements/API-design question, not a proven code defect here.
- Tests that should exist: `test/review_majors_regression_spec.js` covers round-scoped duplicate key behavior for `buildVoteKey`/`canCastVote`/`recordVote`. A test should also cover a second vote in a later round by the same token is allowed (by design), and that a token cannot re-vote in the same round.
- Release blocker: no, as worded.

Verdict: **PARTIALLY CONFIRMED / NOT REPRODUCIBLE for the literal claim**. The implementation prevents duplicate counted votes on the same round/pair/token. The report appears to be describing a concern that the current engine already scopes per round and per token. The underlying intent may map to one-voter/one-token assumptions, which are implemented through `vs_voter` cookies and `user:<userId>` tokens for signed-in voters, not through any global one-person-one-vote identity across devices/accounts.

---

## H2 — A completed session can be reopened

- Severity: HIGH
- Code location: `voting-server/src/reducer.js` in `START_SESSION` and `ARCHIVE_SESSION`, and the socket lifecycle ingress in `voting-server/src/server.js`
- Relevant module: session state machine
- What the report claims: once a session is completed, it can be moved back into voting.
- What the code actually does:
  - `START_SESSION` in the reducer only refuses an `archived` session. It does not explicitly refuse `completed`.
  - For `single_ballot`, `START_SESSION` has a fast path that completes a session with one entry, and otherwise starts voting from entries if there is no active vote.
  - For `tournament`, `START_SESSION` calls `next(session)` if there is no active vote; if that produces a winner, the session becomes `completed` again.
  - The server ingress for `START_SESSION` does add some pre-checks (session existence, secured-roster constraints), but the lifecycle gating is not "completed is terminal" in the reducer itself.
- Whether the report is correct: PARTIALLY CONFIRMED. The engine does not globally prevent `START_SESSION` on a `completed` session in the reducer; it does, however, have strong guards that make reopening non-trivial in normal tournament flow because `entries` is consumed and the winner is already set. The concern is most plausible for the `single_ballot` path and for direct reducer dispatch in tests or internal calls.
- Security/data-integrity impact: medium, because "completed" is supposed to be terminal for results integrity. If an admin path or internal code can re-enter voting after completion, that undermines the "completed = final" contract, even if practical exploitation depends on reachable admin action semantics.
- Recommended fix: add an explicit terminal-state guard so `START_SESSION` is rejected when `status === 'completed'` (and consider whether `ARCHIVE_SESSION` should also be terminal for restart/hydration purposes per the spec intent). Make completion terminal at the same layer where archival is terminal.
- Tests that should exist: a lifecycle test where `START_SESSION` on an already-`completed` session is rejected; a tournament case where the winner is already set and `START_SESSION` cannot restart the bracket.
- Release blocker: yes if the intended lifecycle is strictly `pending -> open -> completed -> archived` with completed terminal. This is a design decision, but if the project wants completed to be final, the current reducer does not fully enforce it.

Verdict: **PARTIALLY CONFIRMED**; the engine permits lifecycle re-entry from `completed` in some paths, so the claim is directionally correct even if the exploitability depends on the exact admin/action surface.

---

## H3 — Admin access can be forged when secrets are not configured

- Severity: HIGH
- Code location: `voting-server/src/auth/config.js`, `voting-server/src/auth/admin.js`, `voting-server/src/auth/voterCookie.js`, `.env.example`, `voting-server/index.js`
- Relevant module: JWT issuance/verification and startup validation
- What the report claims: production can start with known/default secrets, allowing forged admin access.
- What the code actually does:
  - `JWT_SECRET` defaults to `'votesphere_jwt_evaluation_secret_fallback'` when `process.env.JWT_SECRET` is empty, via `getAuthConfig()` in `config.js`.
  - `ADMIN_PASSWORD` defaults to `'adminPassword123!'` when unset.
  - `VOTER_JWT_SECRET` has a fallback in `voterCookie.js` and emits a warning in non-production; in production, `validateVoterJwtSecret()` throws.
  - `verifyAdminToken` verifies against `getAuthConfig().jwtSecret`.
  - `index.js` calls `validateVoterJwtSecret()` and connects to MongoDB before starting.
- Whether the report is correct: CONFIRMED, with an important nuance. The admin JWT secret and admin password have safe defaults that are predictable and shared by every deployment that does not set them. That means a default-configured instance is not "forged admin access" in the sense of breaking JWT cryptography; it is that the signing key and admin credential are effectively well-known defaults. If a deployment ever runs with those defaults in a real network, an attacker with that knowledge can authenticate as admin. The voter JWT path is stricter in production.
- Security/data-integrity impact: high in the sense that default configuration weakens the admin authentication assumption. This is the kind of issue that is often benign in local development but dangerous if defaults ship into a reachable deployment.
- Recommended fix: make `JWT_SECRET` and `ADMIN_PASSWORD` required in production the same way `VOTER_JWT_SECRET` already is, or at least fail startup when they still equal the documented fallback values. Do not rely on "documentation says change it".
- Tests that should exist: a startup/validation test that admin credentials and admin JWT secret are rejected or warned when left at defaults in production-mode configuration.
- Release blocker: yes for any real deployment path; no for a strictly local-demo release that documents the same caveats.

Verdict: **CONFIRMED** as a configuration hardening issue. The code does not currently prevent a deployment from starting with predictable admin JWT and admin password defaults.

---

## M1 — Tournament tie resolution may replay the same pair instead of making the admin decision final

- Severity: MEDIUM
- Code location: `voting-server/src/reducer.js` (`RESOLVE_TIE`, `SET_TIE_PENDING`), `voting-server/src/roundManager.js` (tie ladder and `closeRoundOnce`), `voting-server/src/reducer.js` `NEXT`
- Relevant module: tie ladder
- What the report claims: after an admin resolves a tie, the same pair can replay instead of the resolution taking effect.
- What the code actually does:
  - `RESOLVE_TIE` in tournament mode sets the pair to `[winner, loser]` with an empty tally and moves lifecycle back to `VOTING`. The reducer also clears `tiePending`, `finalVote`, `revealTimer`, and resets `tieCount` and `zeroVoteCount`.
  - In tournament mode, the tie ladder is designed so the rematch round is a fresh round identity with a fresh tally, so the resolved winner is not automatically eliminated from the bracket; the admin decision is applied by putting the winner first and eliminating the loser from that matchup, after which the bracket continues.
  - The round closure and `NEXT` path include tie detection and ladder initiation, including `TIE_PENDING` for a second consecutive tie.
- Whether the report is correct: PARTIALLY CONFIRMED as a wording risk. The implementation is intentional about "resolve tie, then run the rematch round", so a naive reader can interpret that as "the same pair replays". That is the expected behavior: tie resolution does not end the session in tournament mode; it resolves the tied *matchup*. If the report expected the admin decision to immediately finalize the session, that is a spec/behavior mismatch rather than a clear code defect.
- Security/data-integrity impact: low to medium, mostly a product-behavior confusion risk.
- Recommended fix: document and, if desired, test that tournament tie resolution does not end the session but advances the rematch, and that the loser is eliminated from that matchup.
- Tests that should exist: the existing tie/ladder tests should already cover this; verify there is an explicit regression test where a resolved tie does not leave the same pair tied or does not re-enter `TIE_PENDING` immediately without new votes.
- Release blocker: not as stated, unless the intended behavior is that admin resolution ends the tournament immediately.

Verdict: **PARTIALLY CONFIRMED**, leaning toward a behavioral expectation mismatch rather than a broken tie outcome.

---

## M2 — Disconnect grace-period expiry may not trigger early completion

- Severity: MEDIUM
- Code location: `voting-server/src/roundManager.js` (`canCompleteEarly`, `computeEligibility`, `closeRoundOnce`), `voting-server/src/constants.js` (`GRACE_PERIOD_MS`)
- Relevant module: early completion and grace window
- What the report claims: the disconnect grace period may not cause early completion when it should.
- What the code actually does:
  - `GRACE_PERIOD_MS` is 10000 ms.
  - `computeEligibility` treats a disconnected voter as active if within grace, and `canCompleteEarly` requires quorum across active snapshot voters.
  - `closeRoundOnce` guards early close and defers to timer expiry in some zero-voter/grace situations.
  - Early completion is intentionally quorum-based and snapshot-based, not purely "everyone disconnected".
- Whether the report is correct: PARTIALLY CONFIRMED. The engine does not treat disconnect grace expiry as an automatic "complete now" trigger in the simplistic sense; it uses grace as part of quorum computation. That may be correct by design, but the report is plausibly flagging an expectation that grace expiry would be a more direct completion trigger.
- Security/data-integrity impact: low for correctness; potential reliability/behavior confusion.
- Recommended fix: clarify the spec and test behavior for the exact scenario the report has in mind; if the intended behavior is different, write a regression test that encodes the expected outcome.
- Tests that should exist: coverage in the early completion and grace window suites for disconnected voters inside vs outside grace.
- Release blocker: no, unless the intended early-completion contract is different from what is implemented.

Verdict: **PARTIALLY CONFIRMED / REQUIRES ENVIRONMENT OR SPEC CLARIFICATION**.

---

## M3 — SET_ENTRIES is not sufficiently state guarded

- Severity: MEDIUM
- Code location: `voting-server/src/reducer.js` (`SET_ENTRIES`), `voting-server/src/db/persistence.js` (entries change detection)
- Relevant module: session mutation guards
- What the report claims: `SET_ENTRIES` can be applied in unsafe states.
- What the code actually does:
  - The reducer `SET_ENTRIES` only requires a present session; it does not restrict by status.
  - The persistence layer has special logic to avoid treating normal tournament advancement as "entries changed".
  - Admin-only lifecycle actions are gated at ingress, but `SET_ENTRIES` itself does not appear to have a status/count safeguard in the reducer.
- Whether the report is correct: PARTIALLY CONFIRMED. `SET_ENTRIES` is more loosely guarded than lifecycle actions like `SET_WHO_CAN_JOIN`, which refuses non-pending/non-secured in the reducer. If the intent is that entries should only be settable in a narrow creation/pending window, the reducer does not enforce that.
- Security/data-integrity impact: medium if entries can be mutated after voting starts; low if the intended surface is limited by ingress admin authorization.
- Recommended fix: add explicit state/count guards to `SET_ENTRIES` in the reducer consistent with the intended lifecycle, and ensure the persistence layer does not misinterpret reducer entries changes.
- Tests that should exist: a reducer or integration test that `SET_ENTRIES` is rejected when the session is already open/active, if that is the intended rule.
- Release blocker: not necessarily, but depends on the intended session editing window.

Verdict: **PARTIALLY CONFIRMED**.

---

## M4 — Socket/action acknowledgements are inconsistent

- Severity: MEDIUM
- Code location: `voting-server/src/server.js` socket action dispatch and error ack paths
- Relevant module: Socket.io action handling
- What the report claims: some actions acknowledge, others do not, so clients cannot reliably know outcomes.
- What the code actually does:
  - Many admin actions emit `action_error` on failure, and some success paths emit explicit acknowledgments or rely on state broadcasts.
  - The VOTE path uses `action_error` for rejections and relies on broadcast state plus the local vote acceptance for success.
  - Some internal transitions are communicated via store broadcasts rather than direct acks.
- Whether the report is correct: PARTIALLY CONFIRMED. Acknowledgment shape is not globally uniform across all actions; some outcomes are inferred from broadcasts, which is common in Socket.io apps but can be seen as inconsistent from a client-contract standpoint.
- Security/data-integrity impact: low for security; medium for client robustness.
- Recommended fix: define ack semantics per action type and document which outcomes are acknowledged vs broadcast-only.
- Tests that should exist: contract tests for ack/error behavior on key actions.
- Release blocker: no.

Verdict: **PARTIALLY CONFIRMED**, mostly a client-contract/consistency point.

---

## M5 — HTTP error handling and MongoDB dependency issues

- Severity: MEDIUM
- Code location: `voting-server/src/server.js` HTTP handler, `voting-server/src/db/persistence.js`, `voting-server/index.js`
- Relevant module: HTTP server, persistence, startup
- What the report claims: HTTP error handling is incomplete and MongoDB dependency behavior is unsafe.
- What the code actually does:
  - The HTTP server wraps the handler in `try/catch` and sends JSON responses.
  - Persistence is largely fire-and-forget with logged errors.
  - Startup fails if MongoDB is unavailable (`connectMongo` awaited before server start).
  - Recovery and result persistence skip or log when not connected.
- Whether the report is correct: PARTIALLY CONFIRMED. Some persistence paths are intentionally "best effort", which is fine for non-critical bookkeeping but can be surprising if a consumer assumes durable guarantees. HTTP error handling appears present for the main flows but any generic "HTTP error handling issues" claim needs a concrete endpoint/case to be actionable.
- Security/data-integrity impact: medium for durability assumptions, low for immediate security.
- Recommended fix: document which writes are durable vs best-effort, and add explicit failure behavior where silent skips would surprise operators.
- Tests that should exist: tests for startup failure when MongoDB is down, and for behavior when persistence is unavailable.
- Release blocker: no.

Verdict: **PARTIALLY CONFIRMED**, mostly a durability/guarantee clarity issue.

---

## M6 — Weak input validation

- Severity: MEDIUM
- Code location: multiple, including `voting-server/src/auth/voter.js`, `voting-server/src/server.js`, session creation paths
- Relevant module: input validation
- What the report claims: some inputs are not validated strongly enough.
- What the code actually does:
  - Session creation validates session IDs and enforces type constraints.
  - Voter registration validates sessionId and displayName.
  - Admin login validates identifier/password shape.
  - Many handlers coerce or normalize inputs and fail closed on missing fields.
- Whether the report is correct: PARTIALLY CONFIRMED, but vague. There are reasonable validation spots; whether any specific gap is real depends on the exact input in question. The report's wording is too general to confirm a concrete defect here.
- Security/data-integrity impact: depends on the exact input; currently unactionable without a specific case.
- Recommended fix: if the report has a specific input, evaluate it directly; otherwise do not treat this as confirmed.
- Tests that should exist: targeted validation tests for the specific input class.
- Release blocker: no, not as stated.

Verdict: **PARTIALLY CONFIRMED / NOT REPRODUCIBLE without a specific example**.

---

## M7 — Admin login lockout behavior

- Severity: MEDIUM
- Code location: `voting-server/src/auth/admin.js` (`verifyAdminCredentials`, throttle maps, `recordFailedLogin`, `resetAttempts`)
- Relevant module: admin auth throttling
- What the report claims: lockout behavior is wrong or too easy to trigger/evade.
- What the code actually does:
  - There is per-IP throttling and a shared unknown-identifier bucket.
  - The shared unknown bucket never gates the real admin identifier, only unknown identifiers.
  - Successful login resets throttle state for the IP.
- Whether the report is correct: PARTIALLY CONFIRMED as a design concern. The throttle model is reasonably hardened against naive brute force, but any throttle is policy-sensitive. If the report is about usability/lockout-of-legitimate-admin or bypass-by-rotating-identifiers, the current code addresses some of that explicitly.
- Security/data-integrity impact: medium at most.
- Recommended fix: confirm the exact complaint; if it is about lockout thresholds or cooldown behavior, tune or document the policy.
- Tests that should exist: throttle behavior tests already exist in `test/auth_spec.js` and `test/review_majors_regression_spec.js`.
- Release blocker: no.

Verdict: **PARTIALLY CONFIRMED**, mostly policy/usability.

---

## L1 — Missing security headers

- Severity: LOW
- Code location: `voting-server/src/server.js` (`setCorsHeaders`)
- Relevant module: HTTP response headers
- What the report claims: recommended security headers are missing.
- What the code actually does: sets CORS headers only for allowed origins, plus `Content-Type`, `Content-Length`, and `Vary` for CORS.
- Whether the report is correct: CONFIRMED as a general hardening gap. Common headers like `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Content-Security-Policy` are not set unconditionally here.
- Security/data-integrity impact: low in this backend's threat model, higher if the API is consumed by browsers in risky contexts.
- Recommended fix: add defensive headers appropriate to the deployment, especially if served to browsers.
- Tests that should exist: header-presence tests.
- Release blocker: no, but good hygiene for a public release.

Verdict: **CONFIRMED** as a hardening gap.

---

## L2 — Incorrect error after session completion

- Severity: LOW
- Code location: session lifecycle and REST/socket reads around completion
- Relevant module: session state and visibility
- What the report claims: after completion, some error or status is misleading.
- What the code actually does:
  - Completed sessions are surfaced via summaries, history, and result reads, each with visibility guards.
  - There are specific guards for withholding vs releasing round history.
- Whether the report is correct: NOT REPRODUCIBLE without a concrete endpoint/case. The claim is too vague to confirm.
- Security/data-integrity impact: low, pending specifics.
- Recommended fix: capture the exact failing case.
- Tests that should exist: the exact scenario.
- Release blocker: no.

Verdict: **NOT REPRODUCIBLE** as stated.

---

## L3 — Process-level exception handlers may hide fatal failures

- Severity: LOW
- Code location: `voting-server/index.js` and `voting-server/src/server.js` rejection/exception handlers
- Relevant module: process resilience
- What the report claims: global handlers may hide fatal errors.
- What the code actually does:
  - `index.js` logs unhandled rejections and uncaught exceptions, and the server module installs a guarded unhandled-rejection handler.
  - Startup failures exit non-zero in the main startup `catch`.
- Whether the report is correct: PARTIALLY CONFIRMED. Broad process handlers can indeed mask failures if they only log, but here they appear intended to keep the process from crashing on stray async noise. If a handler suppresses a truly fatal condition, that would be a real issue; the code does not obviously do that, but the report is plausible as a caution.
- Security/data-integrity impact: low to medium.
- Recommended fix: ensure fatal conditions still cause appropriate exit/alerting.
- Tests that should exist: behavior under fatal async failures.
- Release blocker: no.

Verdict: **PARTIALLY CONFIRMED**.

---

## L4 — Demo seeds can run in production

- Severity: LOW
- Code location: `voting-server/src/bootstrap.js`, `voting-server/index.js`, `.env.example`
- Relevant module: bootstrap/seed behavior
- What the report claims: demo seed sessions run in production.
- What the code actually does:
  - Seed sessions are bootstrapped when no store is passed into `startServer`, and `index.js` does bootstrap seeds by default.
  - `.env.example` documents `SEED_AUTO_START`, implying presentation-mode control.
- Whether the report is correct: PARTIALLY CONFIRMED. Seed behavior is real and defaults-friendly; if production inherits dev bootstrap behavior without explicit control, that is a configuration concern.
- Security/data-integrity impact: low.
- Recommended fix: make seed behavior explicit and off by default for production, or document it clearly.
- Tests that should exist: tests for presentation-mode vs auto-start seeds.
- Release blocker: no.

Verdict: **PARTIALLY CONFIRMED**.

---

## L5 — ROUND_REVEAL_DURATION documentation/config mismatch

- Severity: LOW
- Code location: `.env.example`, `voting-server/src/roundManager.js` (`resolveRevealDuration`), `voting-server/src/timer.js` (`resolveDuration`)
- Relevant module: timing configuration
- What the report claims: the documented reveal duration and the code do not agree.
- What the code actually does:
  - `roundManager.js` defaults reveal duration to 1 second, with env override from `ROUND_REVEAL_DURATION`, clamped between 1 and 60.
  - `.env.example` sets `ROUND_REVEAL_DURATION=10`.
  - `.env.example` also documents `VOTE_TIMER_DURATION=30`.
- Whether the report is correct: PARTIALLY CONFIRMED. There is a real distinction between vote timer duration and reveal duration, and the code's default reveal duration and the example env may confuse readers expecting a single "reveal" setting. Whether that is a true mismatch depends on what the report thinks "the docs" say.
- Security/data-integrity impact: low.
- Recommended fix: clarify the docs to separate vote timer duration from results reveal duration.
- Tests that should exist: timing tests already exist.
- Release blocker: no.

Verdict: **PARTIALLY CONFIRMED**, mostly a docs clarity issue.

---

## L6 — Documentation/test-count drift

- Severity: LOW
- Code location: `docs/specs`, test suite, `AGENTS.md`
- Relevant module: documentation
- What the report claims: documentation or test counts are stale.
- What the code actually does:
  - The repo has a large and active Mocha suite.
  - Some docs point to spec artifacts that may not match the current state exactly.
- Whether the report is correct: PARTIALLY CONFIRMED as a generic risk. The phrase is not verifiable without the report's exact numbers. The code shows active testing; drift is always possible.
- Security/data-integrity impact: low.
- Recommended fix: reconcile docs with current tests before release if accuracy matters.
- Tests that should exist: this is a docs issue.
- Release blocker: no.

Verdict: **PARTIALLY CONFIRMED / requires the report's exact counts to judge**.

---

## L7 — Repository/CI hygiene

- Severity: LOW
- Code location: repo-level files, `package.json`, `.gitignore` if present
- Relevant module: repo hygiene
- What the report claims: repo or CI hygiene is poor.
- What the code actually does: the repo has two packages, a server test runner, and conventional scripts. Specific hygiene issues depend on what the report inspected.
- Whether the report is correct: NOT REPRODUCIBLE without specifics.
- Security/data-integrity impact: low.
- Recommended fix: address whatever exact hygiene items the report listed.
- Tests that should exist: n/a
- Release blocker: no.

Verdict: **NOT REPRODUCIBLE** as stated.

---

## L8 — Client bundle size and development dependency advisories

- Severity: LOW
- Code location: `voting-client` and `voting-server/package.json`
- Relevant module: dependencies
- What the report claims: client bundle size or dev dependency advisories are a concern.
- What the code actually does:
  - `voting-server` has dev dependencies such as `mongodb-memory-server`, `mocha`, `chai`, and babel tooling.
  - `voting-client` is the likely location for bundle-size concerns.
- Whether the report is correct: PARTIALLY CONFIRMED as a general concern. Dependency advisories and bundle size are real review topics, but the current report wording is not specific enough to confirm a definite defect here.
- Security/data-integrity impact: low to medium depending on whether advisories affect runtime or only dev tooling.
- Recommended fix: run a dependency audit and act on reachable advisories; measure bundle size if that is a stated goal.
- Tests that should exist: n/a
- Release blocker: no.

Verdict: **PARTIALLY CONFIRMED / REQUIRES ENVIRONMENT OR TOOLING VERIFICATION**.

---

## Verification Summary

Confirmed high issues:
- H3: predictable admin JWT secret and admin password defaults can let an attacker authenticate as admin on a default-configured deployment.

Confirmed medium issues:
- None confirmed as unambiguous defects in the current code. Most are partially confirmed design/policy clarity concerns.

Confirmed low issues:
- L1: missing common defensive HTTP security headers.

Not reproducible:
- H1 as literally worded, and L2, L7, because the current code does not clearly match those specific claims without more precise scenarios.

Already fixed:
- No item in the list is clearly already fixed by the current code in a way that makes the report fully wrong; on the contrary, several are partially present today.

Environment-dependent:
- M2, M5, M6, L5, L8 all depend on exact runtime, docs, or tooling context.

Specification decisions required:
- H2 and M3 raise the clearest spec questions: should `completed` be terminal, and how tightly should `SET_ENTRIES` and other mutating actions be state-guarded?
- M1 raises whether tournament tie resolution should end the session or only resolve the matchup.
- M4 is partly a client-contract decision about acknowledgments.

---

## Recommended Fix Order

1. H3 — make admin JWT secret and admin password non-defaultable in production, or at least fail/warn loudly when left at documented defaults.
2. H2 — make the session state machine enforce terminal status the way the spec intends, especially if `completed` is meant to be final.
3. H1 clarification — decide whether one-voter-one-token is the real invariant and document it; the current duplicate-vote guard is round- and token-scoped and works as implemented.
4. M3 — add explicit state guards to `SET_ENTRIES` if entries editing is supposed to be limited to a creation window.
5. M5 — document and, where needed, strengthen durability expectations around persistence and HTTP failures.
6. M2 and M1 — turn the intended behavior into explicit acceptance criteria and regression tests.
7. L1 — add standard security headers appropriate to the deployment.
8. M7, L4, L5, L6, L8 — documentation, policy, and hygiene items after the security-critical items above.

---

## Release Blockers

Must fix before any public release or real election usage:
- H3 is the clearest blocker: predictable admin credentials and admin JWT secret are not acceptable for a deployment that expects real access control.
- H2 is a blocker if the product contract says a completed session cannot be restarted.

Should fix before real election usage:
- M3, if entries can be mutated after voting begins.
- Any confirmed vote/duplicate-vote or visibility regression found by a more precise follow-up of H1/L2 after concrete scenarios are supplied.

Nice to fix before presentation but not strict blockers:
- L1, L4, L5, L6, L8.

Not blockers based on current evidence:
- M6 and L2/L7 as worded, because they are too vague to confirm against the code.

---

## Final note

This verification is based on a closed-code read of `develop1`. Several reports in the incoming set are partially confirmed at best because they describe plausible concerns without enough precision to match one exact code path. The strongest, most actionable finding here is H3: default admin secrets make the admin authentication model weaker than the project's security posture should allow in production. H2 is the second most important because it touches whether completion is actually terminal.
