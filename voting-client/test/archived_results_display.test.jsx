import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'

import voteReducer, { setSessions, setSessionState, setTurnout } from '../src/redux/voteSlice.js'
import voterAuthReducer from '../src/redux/voterAuthSlice.js'
import historyReducer from '../src/redux/historySlice.js'
import { createRemoteActionMiddleware } from '../src/redux/store.js'

// Same stubs as results_visibility.test.jsx: the page opens the socket
// singleton on import and imports CSS, both irrelevant to these states.
vi.mock('../src/services/socket.js', () => {
  const handlers = new Map()
  const socket = {
    on: vi.fn((evt, fn) => { handlers.set(evt, fn) }),
    off: vi.fn((evt) => handlers.delete(evt)),
    emit: vi.fn(),
    connected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    close: vi.fn()
  }
  return {
    socket,
    default: socket,
    SERVER_URL: 'http://localhost:8090',
    getSocket: () => socket,
    subscribeSession: vi.fn(),
    unsubscribeSession: vi.fn(),
    subscribeTurnout: vi.fn(),
    unsubscribeTurnout: vi.fn(),
    connectSocket: vi.fn(),
    connectSocketToStore: vi.fn(),
    subscribedSessions: new Set(),
    readStoredAdminToken: () => null,
    applyAdminTokenToSocket: vi.fn(),
    ADMIN_TOKEN_KEY: 'votesphere_admin_jwt',
    __emit: (evt, payload) => handlers.get(evt)?.(payload)
  }
})

vi.mock('../src/services/history.js', () => ({
  fetchSessionResult: vi.fn(),
  fetchSessionRounds: vi.fn(),
  fetchSessionHistory: vi.fn()
}))

vi.mock('../src/components/layout/Navbar.jsx', () => ({
  default: () => <nav data-testid="navbar-stub" />
}))

const Results = (await import('../src/pages/Results.jsx')).default
const { fetchSessionResult, fetchSessionRounds } = await import('../src/services/history.js')

const ADMIN_TOKEN_KEY = 'votesphere_admin_jwt'
const ADMIN_TOKEN = 'admin-opaque-token'
const PUBLIC_ID = 'pub_arch_results'

const EXECUTED_ROUND = {
  roundIndex: 1,
  kind: 'single_ballot',
  candidates: ['Alpha', 'Beta', 'Gamma'],
  tally: { Alpha: 2, Beta: 1, Gamma: 0 },
  totalVotes: 3,
  closedAt: '2026-10-10T09:00:00.000Z',
  resolution: 'majority_win',
  advanced: null
}

// The shape the fixed server sends for a completed then archived public
// session: status archived, winner set, settled rounds in the payload.
const ARCHIVED_SESSION = {
  id: PUBLIC_ID,
  sessionId: PUBLIC_ID,
  title: 'Neighborhood Budget Vote',
  status: 'archived',
  sessionType: 'public',
  type: 'public',
  whoCanJoin: 'public',
  publishResultsPublicly: true,
  winner: 'Alpha',
  votingMode: 'single_ballot',
  voterCount: 2,
  entryCount: 3,
  roundIndex: 1,
  roundId: `${PUBLIC_ID}:::r1`,
  rounds: [EXECUTED_ROUND]
}

// Turnout with only rounds that actually ran (the fixed server never sends
// the re-armed, never executed round).
const TURNOUT = [
  {
    roundIndex: 1,
    roundId: `${PUBLIC_ID}:::r1`,
    voters: [{ name: 'Voter One', email: 'voter1@example.com' }]
  }
]

const RESULT = {
  sessionId: PUBLIC_ID,
  title: 'Neighborhood Budget Vote',
  winner: 'Alpha',
  entries: ['Alpha', 'Beta', 'Gamma'],
  completedAt: '2026-10-10T09:00:00.000Z',
  type: 'public',
  publishResultsPublicly: true,
  rounds: [EXECUTED_ROUND]
}

function makeStore({ session = null, turnout = null } = {}) {
  const store = configureStore({
    reducer: { sessions: voteReducer, voterAuth: voterAuthReducer, history: historyReducer },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false })
        .concat(createRemoteActionMiddleware({ emit: vi.fn() }))
  })
  if (session) {
    store.dispatch(setSessions([session]))
    store.dispatch(setSessionState(session))
  }
  if (turnout) {
    store.dispatch(setTurnout(session ? session.sessionId : PUBLIC_ID, turnout))
  }
  return store
}

function renderResults(store, sessionId = PUBLIC_ID) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/sessions/${sessionId}/results`]}>
        <Routes>
          <Route path="/sessions/:id/results" element={<Results />} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/sessions" element={<div>sessions page</div>} />
          <Route path="/history" element={<div>history page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(ADMIN_TOKEN_KEY, ADMIN_TOKEN)
  vi.mocked(fetchSessionResult).mockReset().mockResolvedValue({ success: true, result: RESULT })
  vi.mocked(fetchSessionRounds).mockReset().mockResolvedValue({ success: true, rounds: [EXECUTED_ROUND] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Symptom regression: after a public session was completed and archived, the
// admin saw the rounds listed without their result breakdown, and extra rounds
// that never took place appeared in the panel and in the CSV export.
describe('Archived public session results (admin)', () => {
  it('shows the per round breakdown with candidates and vote counts', async () => {
    renderResults(makeStore({ session: ARCHIVED_SESSION, turnout: TURNOUT }))

    // Winner card and the round history section both render for an archived
    // session: the timeline must carry the executed round, not a shell.
    await screen.findByText('We Have a Winner!')
    await screen.findByText('Tournament Round Breakdown')
    expect(screen.getByText('1 Round')).toBeInTheDocument()

    // Expanding (open by default for the last round) shows the matchup and
    // the per candidate vote counts.
    expect(screen.getByText('Alpha, Beta, Gamma')).toBeInTheDocument()
    expect(screen.getByText('2 votes')).toBeInTheDocument()
    expect(screen.getByText('1 votes')).toBeInTheDocument()
    expect(screen.getByText('Majority Win')).toBeInTheDocument()
  })

  it('lists only rounds that actually ran in the turnout panel', async () => {
    renderResults(makeStore({ session: ARCHIVED_SESSION, turnout: TURNOUT }))

    await screen.findByText('Per round turnout')
    // "Round 1" appears on both surfaces: the breakdown timeline and the
    // turnout list. "Round 2" (the re-armed, never executed round) must
    // appear on neither.
    expect(screen.getAllByText('Round 1').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('Round 2')).not.toBeInTheDocument()
    expect(screen.getByText('Voter One')).toBeInTheDocument()
  })

  it('exports only executed rounds in the CSV', async () => {
    const created = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob) => {
        created.push(blob)
        return 'blob:turnout'
      }),
      revokeObjectURL: vi.fn()
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderResults(makeStore({ session: ARCHIVED_SESSION, turnout: TURNOUT }))
    await userEvent.setup().click(await screen.findByTestId('turnout-export'))

    expect(created).toHaveLength(1)
    const csv = await created[0].text()
    const rows = csv.split('\r\n')
    expect(rows[0]).toBe('roundIndex,roundId,voterCount,voterName,email')
    expect(rows).toHaveLength(2)
    expect(rows[1].startsWith('1,')).toBe(true)
    for (const row of rows.slice(1)) {
      expect(row.startsWith('2,')).toBe(false)
    }

    clickSpy.mockRestore()
  })

  it('keeps the round history when the archived session_state broadcast lands after mount', async () => {
    const store = makeStore({ session: ARCHIVED_SESSION, turnout: TURNOUT })
    renderResults(store)
    await screen.findByText('Tournament Round Breakdown')

    // The archive action re broadcasts session state while the admin is on
    // the page. The payload carries roundIndex and the settled rounds; the
    // local round history must survive it instead of being cleared.
    act(() => {
      store.dispatch(setSessionState({
        ...ARCHIVED_SESSION,
        roundIndex: 1,
        roundId: `${PUBLIC_ID}:::r1`,
        rounds: [EXECUTED_ROUND]
      }))
    })

    await screen.findByText('Tournament Round Breakdown')
    expect(screen.getByText('Alpha, Beta, Gamma')).toBeInTheDocument()
    expect(screen.getByText('2 votes')).toBeInTheDocument()
  })
})
