# Verify: session model extension · spec 0001 · updated 2026-09-21
_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Open the admin create modal and type 4 entries → live mode note displays "2 to 6 candidates: Single Ballot" → AC-5
- [x] Add entries until there are 7 distinct candidates → live mode note updates dynamically to "7 or more candidates: Tournament" → AC-5
- [x] Reduce entries back to 6 candidates → live mode note reverts to "2 to 6 candidates: Single Ballot" → AC-5
- [x] Submit create session form with 4 candidates → session is created and broadcast includes type "public", votingMode "single_ballot", unique 6-character joinCode, whoCanJoin "public", publishResultsPublicly true, candidateInfo [], and pendingExpiresAt → AC-1, AC-2, AC-4, AC-6, AC-7

## Commands
- [x] `cd voting-server && npm test` → all 386 tests pass including voting mode derivation, join code format, validation errors, and broadcast fields → AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-8
- [x] `cd voting-client && npm test` → all 287 tests pass including admin mode note derivation and SINGLE_BALLOT_MAX → AC-5, AC-8
- [x] `cd voting-client && npm run lint` → 0 errors and 0 warnings → AC-8
- [x] `cd voting-client && npm run build` → production bundle builds cleanly → AC-8

## Acceptance-criteria coverage
- AC-1 (votingMode single_ballot for 2 to 6, tournament for 7+) covered by server tests in `session_model_extension_spec.js` and UI manual verification
- AC-2 (unique 6-character joinCode from allowed charset) covered by server tests in `session_model_extension_spec.js`
- AC-3 (timer out of range and description > 80 chars rejected with VALIDATION_ERROR) covered by server tests in `session_model_extension_spec.js` and `create_session_spec.js`
- AC-4 (pendingExpiresAt set to 7 days, TTL index configured) covered by server tests in `session_model_extension_spec.js` and `db_models_spec.js`
- AC-5 (live mode note updates dynamically) covered by UI manual verification and client tests in `admin_mode_note_spec.js`
- AC-6 (all 7 new fields included in sessions broadcast) covered by server tests in `session_model_extension_spec.js`
- AC-7 (omitted candidateInfo defaults to []) covered by server tests in `session_model_extension_spec.js`
- AC-8 (existing suites pass without modification) covered by `npm test` across both server and client packages
