# voting-client

## Overview

The React 19 single page application for VoteSphere. It renders the admin panel, waiting room lobby, pairwise voting arena, live results, and history archive, and it stays deliberately thin: it holds a normalized Redux Toolkit store, emits intent over Socket.io, and renders whatever authoritative state the server broadcasts back.

## Key files

| File | Owns |
|---|---|
| `src/main.jsx` | React root, mounts the route tree inside the Redux `Provider` |
| `src/routes/AppRoutes.jsx` | Route table for `/admin`, `/sessions/:id/lobby\|vote\|results`, `/history` |
| `src/routes/AdminGuard.jsx` | Blocks `/admin` unless a valid admin JWT is present |
| `src/routes/LegacyRedirects.jsx` | Backward compatible `/dashboard`, `/elections`, `/vote`, `/results` redirects |
| `src/redux/store.js` | `configureStore`, remote action middleware, echo loop prevention |
| `src/redux/voteSlice.js` | Normalized session state, `normalizeSession`, all selectors |
| `src/redux/historySlice.js` | Completed tournament archive state |
| `src/services/socket.js` | Singleton socket, room subscriptions, socket to store bridge |
| `src/services/auth.js` | Admin JWT and session scoped voter token storage |
| `src/pages/Voting.jsx` | Pairwise voting arena, timer guard, vote dispatch |
| `src/components/results/ResultsChart.jsx` | Recharts pairwise distribution chart |

## Conventions

- Session state is normalized under `bySessionId`, with `list` holding registry summaries and `activeSessionId` naming the focused session.
- Internal sync actions (`SET_SESSIONS`, `SET_SESSION_STATE`, `LOBBY_UPDATE`, `TIMER_STATE`, and their aliases) must never be echoed back to the server. `LOCAL_ACTION_TYPES` in `redux/store.js` is what enforces this, so register any new local action there.
- Only domain actions (`VOTE`, `NEXT`, `SET_ENTRIES`, `CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`) are transmitted. The middleware attaches the session voter token to `VOTE` and the admin JWT to lifecycle actions.
- A new server event is wired in `services/socket.js` (incoming, socket to store) and its action type added to the right Set in `redux/store.js`.
- Selectors live in `voteSlice.js`, take `(state, sessionId?)`, fall back to the active session, and tolerate being handed either the root store state or the slice state.
- Round scoped rendering is keyed by `getSessionPairLockKey(sessionId, pair)` so stale round data cannot leak into the next round.
- Styling is plain CSS files sitting beside each component. There is no CSS framework or Tailwind.
- Tests are colocated in `test/*_spec.js` and run with `node --test` and `node:assert/strict`, importing the source modules directly. There is no jsdom, component tests exercise reducers, selectors, and store middleware.

## Gotchas

- The countdown on screen is visual only. A client that reaches `00:00` does nothing; the server closes the round and broadcasts the next state.
- Tokens live in browser storage and are attached at dispatch time. They must never be written into Redux, and `normalizeSession` strips them if a payload carries one.
- Results are deliberately hidden during an active round. Do not read tallies or percentages from `vote` while `roundLifecycle` is `VOTING`.
- Two components are named `CountdownTimer` (`src/components/CountdownTimer.jsx` and `src/components/voting/CountdownTimer.jsx`). Check which one you are editing.

## Agent skills

- [vercel-react-best-practices](.agents/skills/vercel-react-best-practices/): `vercel-labs/agent-skills`, React component and performance patterns. Its Next.js guidance does not apply here, this is a Vite app.
- [model-redux-state/build-slices-and-selectors](.agents/skills/model-redux-state-build-slices-and-selectors/): `reduxjs/redux-toolkit`, `createSlice`, selectors, `create.asyncThunk`, and lazy reducer injection patterns.
- [vite](.agents/skills/vite/): `antfu/skills`, Vite config, the plugin API, and the Vite 8 Rolldown migration.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
