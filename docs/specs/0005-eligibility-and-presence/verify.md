# Verify: eligibility and presence (spec 0005)

Steps derived from spec 0005 acceptance criteria. Verified via live socket driver and test suites.

## Runtime and Socket Verification
- [x] Two voters connect and register, server broadcasts sanitized presence update with connectedCount 2 and totalVoters 2 -> AC-8
- [x] Backend Redux store records presence map with socket identifiers, epoch lastSeenAt, and null disconnectedAt -> AC-2
- [x] Serialized session state and socket broadcast payloads contain zero voter tokens and zero presence internals -> AC-10
- [x] Round start dispatches snapshot action and freezes immutable connected voter tokens in Redux store -> AC-1
- [x] Repeated SNAPSHOT_ROUND_ELIGIBILITY dispatch for the same roundId is idempotent and does not overwrite snapshot -> AC-9
- [x] Voter disconnects and remains in active round denominator during 10 second grace window, inhibiting early close -> AC-3
- [x] Monotonic clock passes 10 second grace window, excluded ghost voter allows remaining active voter to trigger early close -> AC-6
- [x] Disconnected voter reconnects before round close, socket presence is restored, and vote tallies exactly once -> AC-4
- [x] Late joiner joins mid round, late joiner is excluded from round snapshot denominator, and original voter closes early -> AC-5
- [x] All voters disconnect without voting, zero active voters inhibits early close, letting round timer run to expiry -> AC-7
- [x] REST endpoint GET /api/sessions/:id/lobby returns HTTP 200 with sanitized metadata -> AC-8

## Automated Commands
- [x] `node verify-presence-runner.cjs` -> all 6 live socket scenarios pass with cited runtime evidence -> AC-1 through AC-10
- [x] `cd voting-server && npm test` -> all 501 tests pass including grace window and tie ladder specifications -> AC-1 through AC-10
- [x] `cd voting-client && npm test` -> all 336 tests pass including client presence spec and active voter indicators -> AC-8, AC-10
- [x] `cd voting-client && npm run lint` -> 0 errors and 0 warnings across all files -> AC-8
- [x] `cd voting-client && npm run build` -> production client bundle compiles cleanly -> AC-8

## Acceptance Criteria Coverage
- AC-1 (immutable round snapshot recorded at round start) verified by live socket driver and eligibility integration tests
- AC-2 (presence map with socket IDs, last seen timestamp, and disconnected timestamp) verified by live socket driver and presence tests
- AC-3 (ten second grace window keeps disconnected voter in active denominator) verified by live socket driver and grace window tests
- AC-4 (reconnecting voter restored and vote tallies once with duplicate keys preserved) verified by live socket driver and integration tests
- AC-5 (mid round late joiner excluded from current snapshot denominator) verified by live socket driver and integration tests
- AC-6 (snapshot relative quorum triggers early close when all active snapshot voters have voted) verified by live driver and tests
- AC-7 (zero active snapshot voters inhibits early close, timer runs to expiry) verified by live driver and tests
- AC-8 (sanitized presence update and lobby update broadcasts, client badge displays live count) verified by live driver and client tests
- AC-9 (snapshot dispatched once per roundId from round manager path, tie ladder steps snapshot fresh) verified by live driver and tests
- AC-10 (sanitized broadcast guarantee, zero token leakage or internal structure leakage) verified by live driver and serializer negative tests
