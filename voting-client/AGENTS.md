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
| `src/services/history.js` | History, result, and rounds REST reads, with the admin Bearer header and the `vs_voter` cookie |
| `src/pages/Home.jsx` | Home page, entry point for browsing active sessions |
| `src/pages/Join.jsx` | Session join code entry and auto resolution at `/join` |
| `src/pages/Register.jsx` | Static registration form, no real backend wiring, slated for rework |
| `src/pages/Voting.jsx` | Pairwise voting arena, timer guard, vote dispatch |
| `src/pages/Admin.jsx` | Admin dashboard, session lifecycle controls, and tie resolution panel |
| `src/pages/Lobby.jsx` | Voter waiting room, join QR code, and real time headcount |
| `src/pages/Results.jsx` | Post round results display, candidate tallies, winner announcements, the admin publish toggle, and the admin per round turnout panel |
| `src/pages/History.jsx` | Completed result archive, one card per completed session with its type badge |
| `src/components/results/ResultsChart.jsx` | Recharts pairwise distribution chart |
| `src/components/results/resultsUtils.js` | Pure result presentation transforms, plus `buildTurnoutCsv` and its filename helper |
| `src/components/results/RoundTimeline.jsx` | Accordion timeline of completed rounds with per-round matchups and vote counts |
| `src/components/results/TotalsPanel.jsx` | Cumulative candidate stats (total votes, rounds played) |

## Conventions

- Session state is normalized under `bySessionId`, with `list` holding registry summaries and `activeSessionId` naming the focused session.
- Single ballot sessions display candidates on a multi candidate grid, while tournament sessions render a pairwise matchup.
- Internal sync actions (`SET_SESSIONS`, `SET_SESSION_STATE`, `LOBBY_UPDATE`, `TIMER_STATE`, and their aliases) must never be echoed back to the server. `LOCAL_ACTION_TYPES` in `redux/store.js` is what enforces this, so register any new local action there.
- Live presence and headcount updates (`PRESENCE_UPDATE`, `LOBBY_UPDATE`) track `connectedCount` and `voterCount` in `bySessionId[sessionId]`. They are registered in `LOCAL_ACTION_TYPES` to avoid echo loops.
- Only domain actions (`VOTE`, `NEXT`, `SET_ENTRIES`, `CREATE_SESSION`, `START_SESSION`, `ARCHIVE_SESSION`, `REFRESH_JOIN_CODE`) are transmitted. The middleware attaches the session voter token to `VOTE` and the admin JWT to lifecycle actions.
- A new server event is wired in `services/socket.js` (incoming, socket to store) and its action type added to the right Set in `redux/store.js`.
- Selectors live in `voteSlice.js`, take `(state, sessionId?)`, fall back to the active session, and tolerate being handed either the root store state or the slice state.
- Round scoped rendering is keyed by `getSessionPairLockKey(sessionId, pair)` so stale round data cannot leak into the next round.
- Styling is plain CSS files sitting beside each component. There is no CSS framework or Tailwind.
- Unit tests are colocated in `test/*_spec.js` and run with `node --test` and `node:assert/strict`, importing the source modules directly. They exercise reducers, selectors, and store middleware, with no DOM needed.
- Component tests are colocated in `test/*.test.jsx` and run under Vitest with jsdom (configured in `vitest.config.js`, shared setup in `test/vitest.setup.js`). They mount real components and assert on rendered output, so use them when the thing under test is what the user sees.
- `npm test` runs both suites. The unit script globs `test/*_spec.js`, so a new spec file is picked up with no script edit; Vitest globs its own `.test.jsx` files.
- The admin JWT must ride the Socket.io handshake. `socket.js` reads it from storage at construction, and `applyAdminTokenToSocket` reconnects on every change, because assigning `socket.auth` on a live socket sends nothing. Without this the admin panel filters secured sessions out of its own registry.
- Anything that joins a server side room must re-subscribe on `connect`. Room membership dies with the connection, so a listener that only fires on mount leaves the view frozen after any reconnect.
- `handleLobbyUpdate` preserves `sessionType`, `type`, and `whoCanJoin`. Rebuilding a session entry from a fixed field list drops them, and headcount only broadcasts arrive constantly during a live session, so the lobby would compute a secured session as open.
- Admin participant actions address people by email, never by voter token. The panel only ever holds the email, and the server resolves it to a user and a token itself.
- An action may carry `meta.onAck`, a callback receiving the server's Socket.io acknowledgement. The middleware strips it from the payload (a function does not serialise) and passes it as the emit callback. Use it whenever the UI must not show a state the server has not applied, as the results publish toggle does. Nothing is ever applied optimistically; the server's answer moves the control.
- Every REST read of a result goes through `services/history.js` with `credentials: 'include'` plus the admin Bearer header when a token is in storage. A bare `fetch` with no credentials cannot see a gated secured result, so the admin and the approved participant both get a 404 and the page renders its unavailable state.
- A `404` on a result read is an expected answer, not an error. The gated path is a normal state, and the results page renders a neutral unavailable panel instead of an empty or broken view.
- The lobby read is gated the same way, but it is issued from `pages/Lobby.jsx` rather than from `services/history.js`, so it needs its own `credentials: 'include'` plus the admin Bearer header from `getAdminToken`. Without them the server answers 404 to the admin and to an approved participant for a session they may read, and they see the neutral state with no way to tell it from a missing session.
- Every lobby `404` renders one identical neutral state, because the client cannot tell a missing session from a gated one and must never claim the session does not exist. The copy says only that the session is not available, never `not found`, `does not exist`, `removed`, `private` or `secured`, and there is no discovery link, since one would only make sense if nonexistence were known. A transport failure keeps its own message, because a network error is not an existence signal.
- The archive is keyed off completion, not off a winner. A session that ended with no official champion (`winner: null`) is still listed, so the history card must render a neutral outcome label instead of an empty champion banner, and it renders a `Public` or `Secured` badge from the row's `type`.
- The turnout export is assembled in the browser from the turnout payload already sent to the admin. There is no export endpoint, and the CSV has no vote choice column because the payload cannot supply one. Voter display names are attacker controlled, so `escapeCsvCell` prefixes a leading `=`, `+`, `-`, or `@` with an apostrophe.

## Gotchas

- The countdown on screen is visual only. A client that reaches `00:00` does nothing; the server closes the round and broadcasts the next state.
- Tokens live in browser storage and are attached at dispatch time. They must never be written into Redux, and `normalizeSession` strips them if a payload carries one.
- Results are deliberately hidden during an active round. Do not read tallies or percentages from `vote` while `roundLifecycle` is `VOTING`.
- Two components are named `CountdownTimer` (`src/components/CountdownTimer.jsx` and `src/components/voting/CountdownTimer.jsx`). Check which one you are editing.

## Agent skills

- [vercel-react-best-practices](.agents/skills/vercel-react-best-practices/): `vercel-labs/agent-skills`, React component and performance patterns. Its Next.js guidance does not apply here, this is a Vite app.
- [model-redux-state/build-slices-and-selectors](.agents/skills/model-redux-state-build-slices-and-selectors/): `reduxjs/redux-toolkit`, `createSlice`, selectors, `create.asyncThunk`, and lazy reducer injection patterns.
- [vite](.agents/skills/vite/): `antfu/skills`, Vite config, the plugin API, and the Vite 8 Rolldown migration.
- [vitest](../.agents/skills/vitest/): `antfu/skills`, Vitest config, mocking, coverage, and test filtering for the component suite.
- [react-testing-library](../.agents/skills/react-testing-library/): `pproenca/dot-skills`, queries, `userEvent`, and `waitFor` for the `test/*.test.jsx` component suite. Upstream marks it experimental, so treat its advice as a second opinion and keep the conventions in this file when they disagree.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
