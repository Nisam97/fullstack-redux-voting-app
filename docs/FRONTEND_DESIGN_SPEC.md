# Frontend Design Specification — VoteSphere Multi-Election Redesign

**Project:** fullstack-redux-voting-app / voting-client
**Prepared for:** Google Antigravity (agentic implementation)
**Status:** Design spec — ready for implementation planning
**Depends on:** `BACKEND_MULTI_ELECTION_PROMPT.md` (companion doc — backend must ship the multi-election state shape described there before several pages in this spec can go live end-to-end)

---

## 1. How to use this document

This is an instruction set for redesigning and extending `voting-client`. Read it fully before writing code. It assumes you have access to the existing repo, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, and `docs/API_CONTRACT.md`, which describe the **already-built, tested, working** single-tournament MVP (Phases 0–6). This spec does not replace that architecture — it extends it. Section 3 tells you exactly what you must not break.

Where this doc says "TBD" or "assumption," treat it as a flag, not a blocker: make the most reasonable choice, note it in your implementation notes, and move on.

---

## 2. Product summary

VoteSphere is a real-time, server-authoritative pairwise voting platform. Historically it ran exactly one tournament at a time: a pool of candidates faces off in head-to-head rounds (`pair[0]` vs `pair[1]`) until a single winner remains. Voting is anonymous — the server tracks tallies, not who voted.

This redesign extends that into a platform that hosts **multiple concurrent elections**, each an independent pairwise tournament, browsable by voters and manageable by admins — while keeping the proven server-authoritative Socket.io/Redux pattern and keeping voting anonymous.

---

## 3. Locked constraints — do not change

These are working, tested, and out of scope for this redesign:

- **Server authoritativeness.** The client never computes tallies, percentages, or winners locally beyond simple presentation math (and even that must handle `totalVotes === 0` safely, no `NaN`/`Infinity`). All state changes flow through the server.
- **Socket.io + Redux bridge pattern.** `socket.js` → remote-action middleware → server → broadcast `state` → `SET_STATE`. Reuse this pattern for the new per-election flow; don't introduce a parallel REST-polling mechanism for live data.
- **Anonymous voting.** No per-voter vote identity, no "did I already vote" enforcement beyond a **client-side, per-session, per-active-pair lock** (exactly like the existing `Voting.jsx` does today). This is a deliberate product decision, not a gap.
- **Existing tested files as a reference implementation for pattern, not layout.** `VoteCard.jsx`, `ResultCard.jsx`, the `voteSlice.js` shape, and the loading/empty/winner state-machine approach in `Voting.jsx`/`Results.jsx` are the correct *pattern* to replicate per-election. Their visual styling is not — see Section 6, visual design is a full reset.
- **`App.jsx` is legacy.** It's the original monolithic UI mock, already bypassed by `main.jsx`. Do not extend it. It can be deleted once every page it covers has a real replacement; until then leave it alone.

---

## 4. Data contract this frontend codes against

The multi-election backend does not exist yet (see companion prompt doc). Build the frontend against this assumed contract so work isn't blocked on backend delivery, but treat every shape below as provisional until the backend prompt is implemented and contract-tested against it.

### Election summary (list/browse views — lightweight, no full tally)
```json
{
  "id": "elec_8f2a",
  "title": "Best Horror Film of the 90s",
  "status": "live",        // "live" | "upcoming" | "completed"
  "round": 2,
  "entryCount": 8,
  "totalVotesCast": 214,
  "winner": null,
  "createdAt": "2026-09-10T12:00:00Z"
}
```

### Election detail (Vote / Results pages — subscribed via socket room)
```json
{
  "id": "elec_8f2a",
  "title": "Best Horror Film of the 90s",
  "status": "live",
  "vote": {
    "round": 2,
    "pair": ["Trainspotting", "28 Days Later"],
    "tally": { "Trainspotting": 4, "28 Days Later": 2 }
  },
  "entries": ["Sunshine", "Slumdog Millionaire", "127 Hours"],
  "winner": null
}
```

### Client-only, session-scoped "my activity" record
Not a backend concept. Kept in Redux (or `sessionStorage`-equivalent in-memory state, not real browser storage per artifact constraints if this ever becomes an artifact — for the real app, normal browser storage is fine): a list of `electionId`s the current browser session has cast a vote in, purely so the UI can show "You voted" state and avoid double-vote confusion. This resets on refresh/logout. It is explicitly **not** an authoritative history — see Section 11.

---

## 5. Information architecture

```
/                       Home (public landing)
/login                  Login
/register               Register
/dashboard              Dashboard (auth'd home)
/elections              Elections — browse all
/elections/:id/vote     Vote (pairwise arena for one election)
/elections/:id/results  Results (live tally + winner for one election)
/profile                Profile
/settings               Settings
/notifications          Notifications
/admin                  Admin — election list + status
/admin/new              Admin — create election
/admin/:id/manage       Admin — manage one election (advance round, monitor)
*                       404
```

Auth gating: `/dashboard`, `/elections/*`, `/profile`, `/settings`, `/notifications` require a logged-in voter. `/admin/*` requires an admin role. `/` , `/login`, `/register` are public. (Actual auth enforcement depends on the auth mechanism the backend ships — treat route guards as a thin wrapper you can point at whatever auth state exists; don't block the rest of this spec on auth being fully real.)

---

## 6. Visual design direction

App.jsx's current look (generic SaaS card kit — uniform rounded cards, soft grey shadows, a single primary-blue accent) is explicitly not the baseline. Below is a proposed design language grounded in what this product actually is: **live head-to-head competition**, not a generic dashboard.

**Concept — "Match Night."** Borrow the visual vocabulary of a live results broadcast or a scoreboard: two things facing off, a number that updates in front of you, a clear moment when a winner is declared. This gives the Vote and Results pages — the actual product — a reason to look different from a template, while keeping Dashboard/Settings/Profile calm and legible.

**Color** (propose, adjust freely):
- `--ink: #14171F` — near-black, but blue-shifted, not flat #000/#111 (avoids the generic "tinted near-black" default)
- `--paper: #F7F5F0` — warm off-white for light surfaces, used sparingly, not as the default cliché cream background
- `--side-a: #E2572B` — burnt amber-red, "left" competitor color
- `--side-b: #2B7DE2` — cobalt blue, "right" competitor color
- `--live: #29C77A` — reserved only for live/active indicators, not decoration
- `--muted: #7A7F8C` — secondary text/borders

The A/B pair color assignment is randomized per matchup (not tied to any real-world political meaning) and is the one bold, memorable device in the system — everything else stays quiet around it.

**Type:**
- Display/headline: a condensed, high-contrast grotesque (e.g. a scoreboard-flavored sans like Barlow Condensed or Archivo Condensed) — big vote numbers and matchup titles should feel like they're being called out loud.
- Body/UI: a plain, humanist sans (e.g. Inter or IBM Plex Sans) for everything else — forms, settings, admin tables.
- Tabular numerals for all vote counts and percentages so they don't jitter as they update live.

**Layout:**
- Vote page: full-bleed, centered "arena" — two candidate cards facing each other with a divider, not a card-in-a-grid treatment. This is the one place to spend the visual boldness.
- Results page: same two-up layout at rest, collapsing to a ranked list once more than 2 entries are visible (e.g., a bracket history view) — asymmetric, not a symmetric card grid.
- Dashboard/Elections/Admin: left-aligned, calm, information-dense — this is where people scan and decide, not where they should be visually excited.
- Avoid: numbered eyebrow labels unless content is truly sequential (round numbers legitimately are — round badges "Round 2" are fine); ALL-CAPS labels; a `→` appended to every button.

**Motion:** one deliberate moment — when a vote lands, the tally number ticks and the bar animates to its new width. When a round advances, the old pair slides out and the new pair slides in. No hover-lift on every card; keep hover states to a simple border/elevation change.

Treat this as a starting proposal Antigravity should build, screenshot, and self-critique against Section 6 of `frontend-design` principles (restraint, one bold element, accessible contrast) before finalizing.

---

## 7. Page specifications

Each spec: purpose, key states, real-time behavior, primary actions, notes.

### 7.1 Home (`/`) — public
- **Purpose:** Explain what VoteSphere is, drive to Login/Register. Marketing, not functional.
- **Content:** Hero (what it is, one CTA), how pairwise voting works (only if genuinely sequential — 3 real steps: browse → vote → watch results live), a live snapshot strip showing 2–3 currently-live elections (title + round + live pulse) pulled from the elections-summary feed, pulling real data rather than fabricated testimonials/stats.
- **Real-time:** the live-elections strip updates as election statuses change (lightweight, registry-level subscription — see Section 9).
- **Drop:** fake testimonials, fake "stats" counters unless backed by real aggregate data from the backend.

### 7.2 Login (`/login`) / Register (`/register`)
- **Purpose:** Standard auth forms. Functional depth depends entirely on what the auth backend ships (out of scope of this doc — see backend prompt's auth note).
- **States:** idle, submitting, error (invalid credentials / validation), success → redirect to `/dashboard`.
- **Notes:** Current `Login.jsx` has a `Link` wrapping a `button` that navigates without validating or calling any auth — replace with a real submit handler once auth exists; don't ship a fake "always succeeds" login in the redesigned version.

### 7.3 Dashboard (`/dashboard`) — auth'd home
- **Purpose:** At-a-glance view for a returning voter: live elections needing attention, elections you've participated in this session, quick links.
- **Content:** stat row (active elections count, total candidates across live elections, elections you've voted in this session — client-side count, not authoritative history), a short list of live elections with a "Vote now" CTA, upcoming elections teaser.
- **Real-time:** stat row and live-elections list update from the registry-level feed (Section 9) — this is one of the two places live data must show per your earlier requirement.
- **Empty state:** no live elections → clear message + link to browse all elections, not a blank dashboard.

### 7.4 Elections (`/elections`) — browse
- **Purpose:** Full list of elections with filter by status (Live / Upcoming / Completed) and simple search by title.
- **Content:** election cards (title, status badge, round, candidate count, total votes, CTA — "Vote Now" if live, "View Results" if completed, disabled "Not Open" if upcoming).
- **Real-time:** status badges and vote counts update live from the registry feed.

### 7.5 Vote (`/elections/:id/vote`)
- **Purpose:** The core interaction — cast a vote in the active pairwise round for one election.
- **States (mirror the existing, tested `Voting.jsx` pattern, generalized per `:id`):**
  1. Loading — election data not yet synced.
  2. Winner already declared — redirect/prompt to Results.
  3. No active pair (election not started / between rounds) — informative wait state.
  4. Active pairwise arena — two candidate cards, click to vote, instant local feedback banner, button locks for this pair once voted (client-side, per Section 3).
- **Real-time:** subscribes to this specific election's room; tally updates as others vote (even if the client doesn't display live tallies during active voting — decide based on whether seeing the count could bias voting; recommend hiding tally numbers on the Vote page itself, showing only "voted" confirmation, and reserving visible tallies for the Results page — flag this as a product decision to confirm, not a default to assume silently).
- **Navigation:** on vote, offer a link to Results rather than forcing a redirect.

### 7.6 Results (`/elections/:id/results`)
- **Purpose:** Live tally and eventual winner for one election. Generalize the existing tested `Results.jsx` five-state pattern per `:id`: loading, winner, empty, active-round-zero-votes, active-round-with-votes.
- **Real-time:** this is the other required live-update surface — tallies and percentage bars update as votes land, division-by-zero-safe.
- **Content:** ranked candidate cards with progress bars, round indicator, live pulse dot while active, celebratory winner state when `winner` is set.

### 7.7 Profile (`/profile`)
- **Purpose:** Account info — name, email, join date, role (voter/admin badge).
- **Explicitly not included:** a real vote-history list. See Section 11.
- **Content:** editable basic fields (whatever the auth backend actually stores), read-only join date/role.

### 7.8 Settings (`/settings`)
- **Purpose:** Preferences. Reuse the existing `SettingsPage` pattern from `App.jsx` (Appearance/dark mode, Notifications toggles, Security placeholder for 2FA) but rebuilt as a standalone page under the new visual system.
- **Persistence:** flag as client-only (localStorage-equivalent / account-linked preference) — TBD depending on whether the backend persists user prefs; note as an assumption if not.

### 7.9 Notifications (`/notifications`)
- **Purpose:** Feed of relevant events — an election you're watching went live, a round advanced, a winner was declared in an election you voted in this session.
- **Real-time:** derived client-side from socket events for elections currently subscribed-to/participated-in this session, not a persisted server-side notification system (no backend support for that exists — flag as v1 scope: session-derived only, not historical/cross-device).

### 7.10 Admin — Elections (`/admin`)
- **Purpose:** Admin's list view of all elections with status, quick actions.
- **Content:** same election list as `/elections` but with admin actions inline (Manage, Advance Round if live, Archive if completed).

### 7.11 Admin — Create Election (`/admin/new`)
- **Purpose:** Form to create a new election: title + ordered list of entries (candidates). Matches the backend prompt's `CREATE_ELECTION` action.
- **Validation:** title required, minimum 2 entries, no duplicate entry names within the same election.

### 7.12 Admin — Manage Election (`/admin/:id/manage`)
- **Purpose:** Live operational view for one election — current pair, tally, entries queue, a clearly-labeled "Advance Round" action (dispatches `NEXT` for this election), and a read-only mirror of what voters currently see.
- **Real-time:** same election-room subscription as Vote/Results.
- **Caution:** "Advance Round" is a destructive, irreversible action mid-tournament (ends current pair's voting) — require a confirm step, same pattern as the existing `LogoutModal`.

### 7.13 404 (`*`)
- Keep simple: clear message, link back to `/` or `/dashboard` depending on auth state.

---

## 8. Component inventory

Reuse/extend where noted; build new otherwise.

| Component | Status | Notes |
|---|---|---|
| `Navbar` | Redesign | Add auth-aware nav items, admin link only for admins |
| `Footer` | Redesign | Cosmetic only |
| `VoteCard` | Extend pattern | Same accessible-button/aria pattern as today, new visual skin, now takes `electionId` context |
| `ResultCard` | Extend pattern | Same ARIA progressbar pattern, new visual skin |
| `ElectionCard` / `ElectionCardLarge` | New (from `App.jsx` reference, rebuilt) | Used on Elections, Dashboard, Admin list |
| `StatCard` | New (from `App.jsx` reference, rebuilt) | Dashboard stat row |
| `LiveBadge` | New | Small pulsing dot + "Live" label, reused across Elections/Dashboard/Results |
| `WinnerBanner` | New | Celebration state, reused Results + Admin manage view |
| `EmptyState` | New | Generic "nothing here yet" with contextual message + action, reused across Dashboard/Elections/Notifications |
| `ConfirmModal` | Generalize from `LogoutModal` | Reused for Logout and Admin "Advance Round" |
| `Toggle` | Reuse pattern | Settings page |
| `AdminEntryListEditor` | New | Ordered add/remove list of candidate names, used in Create Election |
| `Toast` | New | Vote confirmation, form errors, admin action confirmations |

---

## 9. State management plan

Extend the existing pattern (`voteSlice.js` → `store.js` remote-action middleware → `socket.js`), don't replace it.

**Redux slices:**
- `authSlice` — current user, role (voter/admin), auth status. Shape depends on the actual auth mechanism the backend ships.
- `electionsSlice` — the registry: `{ byId: { [id]: ElectionSummary }, allIds: [], status: 'idle'|'loading'|'ready' }`. Populated by a lightweight registry subscription (see below), used by Dashboard, Elections, Admin list.
- `electionDetailSlice` (or reuse a generalized `voteSlice` keyed by id) — full detail for whichever election(s) are currently subscribed (typically just the one open in Vote/Results/Admin-manage): `{ byId: { [id]: { vote, entries, winner } } }`.
- `sessionActivitySlice` — client-only: list of `electionId`s voted in this session (Section 11).
- `uiSlice` — dark mode, toasts, modal state.

**Socket strategy:**
- Join a room per election when entering Vote/Results/Admin-manage for that `:id`; leave on unmount.
- Subscribe to a lightweight global "elections registry" channel for status/count changes, used by Dashboard/Elections/Home/Admin-list, so those views don't pull full tally payloads for every election.
- Exact event names/payloads for this are defined in the companion backend prompt — don't invent a divergent protocol; if the backend ships something different, adapt to it rather than this doc's exact naming.

---

## 10. Real-time behavior matrix

| Page | Updates live? | Source |
|---|---|---|
| Home (live strip) | Yes, summary only | registry channel |
| Dashboard | Yes, summary only | registry channel |
| Elections (browse) | Yes, summary only | registry channel |
| Vote | Yes — pair/round changes (tally visibility TBD, see 7.5) | election room |
| Results | Yes — full tally, winner | election room |
| Admin manage | Yes — full tally, entries queue | election room |
| Profile / Settings / Notifications | No (Notifications is event-driven push, not a live poll) | — |

---

## 11. Non-goals / explicitly out of scope

- **Authoritative per-voter history.** "My Votes" as a persisted, cross-device, backend-verified history is **not** built here — it directly conflicts with the anonymous-tally design (confirmed decision: no identity-linked votes). What ships instead is a session-scoped, client-only "elections you've participated in" list, clearly labeled as such in the UI (e.g. "Voted this session," not "Your vote history") so it doesn't imply guarantees it can't keep.
- **Enforcing one-vote-per-person server-side.** Remains a client-side UI lock only, same as today.
- **Persisted admin audit log / historical archive of completed elections** beyond whatever the backend prompt's storage layer provides.
- **Payment, identity verification, or election integrity/security features** beyond what's explicitly listed above.

---

## 12. Handoff notes for Antigravity

- Don't touch `voting-server/src/{core,reducer,store,server}.js` as part of frontend work — those changes belong to the companion backend prompt, implemented and tested independently, with its own passing Mocha suite before the frontend integrates against it.
- Match existing code conventions: functional React components, one CSS file per component/page (no CSS-in-JS), `lucide-react` for icons, no TypeScript, React 19.
- Suggested build order: (1) design system tokens + Navbar/Footer shell, (2) Elections/Dashboard against the registry feed (can be built against mock data if backend isn't ready yet), (3) generalize Vote/Results to take `:id` (highest risk — this is where the existing tested logic must be preserved, not rewritten from scratch), (4) Admin flows, (5) Auth pages + Profile/Settings/Notifications.
- Before marking any page "done," verify against this spec's state list for that page (loading/empty/error/winner etc.) — the existing Voting/Results pages set the bar: every lifecycle state handled, not just the happy path.
