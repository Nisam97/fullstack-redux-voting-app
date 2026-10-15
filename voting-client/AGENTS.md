# voting-client

## Overview

The React 19 single page application for VoteSphere. It renders the admin panel, waiting room lobby, pairwise voting arena, live results, and history archive, and it stays deliberately thin: it holds a normalized Redux Toolkit store, emits intent over Socket.io, and renders whatever authoritative state the server broadcasts back.

## Key files

| File | Owns |
|---|---|
| `src/main.jsx` | React root: applies the stored theme, imports the one global stylesheet, then mounts the route tree inside the Redux `Provider` |
| `src/routes/AppRoutes.jsx` | Route table for `/admin`, `/sessions/:id/lobby\|vote\|results`, `/history` |
| `src/routes/AdminGuard.jsx` | Blocks `/admin` unless a valid admin JWT is present |
| `src/routes/LegacyRedirects.jsx` | Backward compatible `/dashboard`, `/elections`, `/vote`, `/results` redirects |
| `src/redux/store.js` | `configureStore`, remote action middleware, echo loop prevention |
| `src/redux/voteSlice.js` | Normalized session state, `normalizeSession`, all selectors |
| `src/redux/historySlice.js` | Completed tournament archive state |
| `src/services/socket.js` | Singleton socket, room subscriptions, socket to store bridge |
| `src/services/auth.js` | Admin JWT and session scoped voter token storage |
| `src/services/history.js` | History, result, and rounds REST reads, all through `src/services/api.js` |
| `src/services/api.js` | The one `fetch` for this app's own server: the `vs_voter` cookie, the admin Bearer header, the request timeout, and the error envelope every caller reads |
| `src/services/theme.js` | The dual theme controller: `data-theme` on `<html>`, the `aura_theme` storage key, the system preference fallback, and the subscriber list |
| `src/styles/theme.css` | The only global stylesheet: Aura tokens for both themes, plus the shared component classes every page reuses |
| `src/pages/Home.jsx` | Home page, entry point for browsing active sessions |
| `src/pages/Join.jsx` | Session join code entry and auto resolution at `/join` |
| `src/pages/Register.jsx` | Voter registration flow: details form, OTP request and verification via `services/auth.js` |
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
- Styling is plain CSS files sitting beside each component. There is no CSS framework or Tailwind. Component CSS reads the shared tokens instead of hardcoded colours, and every light value is a token override under `[data-theme="light"]`. Icons come from `lucide-react`.
- The theme is one attribute on `<html>`, never a second stylesheet, and it has to be resolved before the first paint: `index.html` sets it inline, then `main.jsx` calls `initTheme()` to match. `src/services/theme.js` is the only writer, so a component never reads storage itself.
- Design system (that file is the design.md the skill system looks for): build all UI to `docs/design_system_guidelines.md` (the Aura art direction and the product bar); token values live in `src/styles/theme.css`.
- Unit tests are colocated in `test/**/*_spec.js` and run with `node --test` and `node:assert/strict`, importing the source modules directly. They exercise reducers, selectors, and store middleware, with no DOM needed.
- Component tests are colocated in `test/*.test.jsx` and run under Vitest with jsdom (configured in `vitest.config.js`, shared setup in `test/vitest.setup.js`). They mount real components and assert on rendered output, so use them when the thing under test is what the user sees.
- `npm test` runs both suites. The unit script globs `test/**/*_spec.js`, so a new spec file is picked up with no script edit; Vitest globs its own `.test.jsx` files.
- The admin JWT must ride the Socket.io handshake. `socket.js` reads it from storage at construction, and `applyAdminTokenToSocket` reconnects on every change, because assigning `socket.auth` on a live socket sends nothing. Without this the admin panel filters secured sessions out of its own registry.
- Voter identity rides the handshake cookie, and that cookie is HttpOnly: `socket.js` connects with `withCredentials: true` so the browser attaches `vs_voter`, and `reattachVoterIdentityToSocket()` forces a fresh handshake after sign in and after logout. A socket that connected before sign in keeps the old anonymous identity until it reconnects, and the server refuses an anonymous socket any secured session handshake, so a missed rehandshake reads as a locked door. Room subscriptions survive because `connectSocketToStore` restores them on every `connect`.
- Anything that joins a server side room must re-subscribe on `connect`. Room membership dies with the connection, so a listener that only fires on mount leaves the view frozen after any reconnect.
- `handleLobbyUpdate` preserves `sessionType`, `type`, and `whoCanJoin`. Rebuilding a session entry from a fixed field list drops them, and headcount only broadcasts arrive constantly during a live session, so the lobby would compute a secured session as open.
- Admin participant actions address people by email, never by voter token. The panel only ever holds the email, and the server resolves it to a user and a token itself.
- An action may carry `meta.onAck`, a callback receiving the server's Socket.io acknowledgement. The middleware strips it from the payload (a function does not serialise) and passes it as the emit callback. Use it whenever the UI must not show a state the server has not applied, as the results publish toggle does. Nothing is ever applied optimistically; the server's answer moves the control.
- Every request to this app's own server goes through `apiRequest` in `src/services/api.js`, which owns the only `fetch` in `src/` and is where transport behavior lives. It sets `credentials: 'include'` and the admin Bearer header, and it returns one envelope instead of throwing when the transport fails, the status is not 2xx, the body is empty, or the body is not JSON. A hung server is cut off with an `AbortController` after `REQUEST_TIMEOUT_MS` (20 seconds), and a caller that passes its own `signal` only adds a cancel, it never replaces that timeout. Add an endpoint? Call this helper: `voting-client/test/credentials_audit_spec.js` fails if a second `fetch` appears anywhere in `src/`.
- Every REST read of a result goes through `services/history.js`, which reaches the server through `src/services/api.js`. A bare `fetch` with no credentials cannot see a gated secured result, so the admin and the approved participant both get a 404 and the page renders its unavailable state.
- A `404` on a result read is an expected answer, not an error. The gated path is a normal state, and the results page renders a neutral unavailable panel instead of an empty or broken view.
- The lobby read is gated the same way, but it is issued from `pages/Lobby.jsx` rather than from `services/history.js`, so it calls `apiRequest` directly. Without the cookie and the admin Bearer header the server answers 404 to the admin and to an approved participant for a session they may read, and they see the neutral state with no way to tell it from a missing session.
- Every lobby `404` renders one identical neutral state, because the client cannot tell a missing session from a gated one and must never claim the session does not exist. The copy says only that the session is not available, never `not found`, `does not exist`, `removed`, `private` or `secured`, and there is no discovery link, since one would only make sense if nonexistence were known. A transport failure keeps its own message, because a network error is not an existence signal.
- The archive is keyed off completion, not off a winner. A session that ended with no official champion (`winner: null`) is still listed, so the history card must render a neutral outcome label instead of an empty champion banner, and it renders a `Public` or `Secured` badge from the row's `type`.
- The turnout export is assembled in the browser from the turnout payload already sent to the admin. There is no export endpoint, and the CSV has no vote choice column because the payload cannot supply one. Voter display names are attacker controlled, so `escapeCsvCell` prefixes a leading `=`, `+`, `-`, or `@` with an apostrophe.

- The client owns a generated API contract table for cookie-gated endpoints. `contracts/cookie-gated-endpoints.json` is the source of truth; `scripts/generate-api-contract-table.mjs` renders the table section in `docs/API_CONTRACT.md`, and `voting-client/test/api_contract_sync_spec.js` asserts the contract story matches that source. Do not edit the rendered table by hand; regenerate it after a contract change.

## Gotchas

- The countdown on screen is visual only. A client that reaches `00:00` does nothing; the server closes the round and broadcasts the next state.
- Tokens live in browser storage and are attached at dispatch time. They must never be written into Redux, and `normalizeSession` strips them if a payload carries one.
- Results are deliberately hidden during an active round. Do not read tallies or percentages from `vote` while `roundLifecycle` is `VOTING`.
- `CountdownTimer` lives at `src/components/CountdownTimer.jsx`; the old duplicate re-export under `src/components/voting/` was removed as dead code.

## Agent skills

- [vercel-react-best-practices](.agents/skills/vercel-react-best-practices/): `vercel-labs/agent-skills`, React component and performance patterns. Its Next.js guidance does not apply here, this is a Vite app.
- [model-redux-state/build-slices-and-selectors](.agents/skills/model-redux-state-build-slices-and-selectors/): `reduxjs/redux-toolkit`, `createSlice`, selectors, `create.asyncThunk`, and lazy reducer injection patterns.
- [vite](.agents/skills/vite/): `antfu/skills`, Vite config, the plugin API, and the Vite 8 Rolldown migration.
- [vitest](../.agents/skills/vitest/): `antfu/skills`, Vitest config, mocking, coverage, and test filtering for the component suite.
- [react-testing-library](../.agents/skills/react-testing-library/): `pproenca/dot-skills`, queries, `userEvent`, and `waitFor` for the `test/*.test.jsx` component suite. Upstream marks it experimental, so treat its advice as a second opinion and keep the conventions in this file when they disagree.

MCP servers: microsoft/playwright-mcp (recommended)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
