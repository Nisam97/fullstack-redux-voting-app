import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'

import voteReducer, { setSessions, setSessionState } from '../src/redux/voteSlice.js'
import voterAuthReducer from '../src/redux/voterAuthSlice.js'
import historyReducer from '../src/redux/historySlice.js'
import { createRemoteActionMiddleware } from '../src/redux/store.js'

// Results.jsx opens the socket singleton on import and imports CSS. Both are
// irrelevant to the rendered states under test, so they are stubbed the same
// way results_visibility.test.jsx stubs them.
vi.mock('../src/services/socket.js', () => {
  const handlers = new Map()
  const socket = {
    on: vi.fn((evt, fn) => handlers.set(evt, fn)),
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
    ADMIN_TOKEN_KEY: 'votesphere_admin_jwt'
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
const { socket } = await import('../src/services/socket.js')

const SESSION_ID = 'vs_nores_1'

// A single ballot session where nobody voted. The server closes round 1 as a
// zero vote replay and round 2 as no_result, then completes with winner null.
// The rounds are real: they are what the server persisted and what the rounds
// endpoint returns.
const ROUNDS = [
  {
    roundIndex: 1,
    kind: 'single_ballot',
    candidates: ['Ash', 'Bee', 'Cedar'],
    tally: {},
    totalVotes: 0,
    closedAt: '2026-10-05T06:56:04.885Z',
    resolution: 'zero_vote_replay',
    advanced: null
  },
  {
    roundIndex: 2,
    kind: 'single_ballot',
    candidates: ['Ash', 'Bee', 'Cedar'],
    tally: {},
    totalVotes: 0,
    closedAt: '2026-10-05T06:56:14.923Z',
    resolution: 'no_result',
    advanced: null
  }
]

function makeStore(session) {
  const store = configureStore({
    reducer: { sessions: voteReducer, voterAuth: voterAuthReducer, history: historyReducer },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false })
        .concat(createRemoteActionMiddleware(socket))
  })
  store.dispatch(setSessions([session]))
  store.dispatch(setSessionState(session))
  return store
}

function renderResults(store) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}/results`]}>
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

function completedNoWinnerSession(overrides = {}) {
  return {
    id: SESSION_ID,
    sessionId: SESSION_ID,
    title: 'No result label check',
    status: 'completed',
    sessionType: 'public',
    type: 'public',
    whoCanJoin: 'public',
    publishResultsPublicly: true,
    entries: ['Ash', 'Bee', 'Cedar'],
    ...overrides
  }
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.mocked(fetchSessionResult).mockReset().mockResolvedValue({
    success: true,
    result: {
      sessionId: SESSION_ID,
      title: 'No result label check',
      winner: null,
      type: 'public',
      entries: ['Ash', 'Bee', 'Cedar'],
      rounds: ROUNDS,
      completedAt: '2026-10-05T06:56:14.923Z'
    }
  })
  vi.mocked(fetchSessionRounds).mockReset().mockResolvedValue({ success: true, rounds: ROUNDS })
})

// A `no_result` completion has rounds but no winner, so it reaches none of the
// winner or reveal panels the page used to nest the history inside. Spec 0003
// AC-4 and AC-5 only require that the rounds render.
describe('Results page round history for a completion with no winner', () => {
  it('renders the accordion timeline with a resolution badge for every round', async () => {
    // covers: AC-4, AC-6
    renderResults(makeStore(completedNoWinnerSession()))

    const items = await screen.findAllByRole('button', { name: /round \d/i })
    expect(items).toHaveLength(2)
    expect(screen.getByText('Zero-Vote Replay')).toBeInTheDocument()
    expect(screen.getByText('No Result')).toBeInTheDocument()
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.getByText('Round 2')).toBeInTheDocument()
  })

  it('renders the totals panel with the rounds played and every candidate', async () => {
    // covers: AC-5
    renderResults(makeStore(completedNoWinnerSession()))

    const panel = await screen.findByRole('region', { name: 'Tournament Cumulative Totals' })
    expect(panel).toHaveTextContent('Rounds Played: 2')
    expect(panel).toHaveTextContent('Total Votes: 0')
    // A round that closed with no votes still had a roster. Without it the
    // totals panel had no candidates to rank and rendered nothing at all.
    expect(panel).toHaveTextContent('Ash')
    expect(panel).toHaveTextContent('Bee')
    expect(panel).toHaveTextContent('Cedar')
  })

  it('says the session finished without a winner rather than claiming no results exist', async () => {
    // covers: AC-4
    renderResults(makeStore(completedNoWinnerSession()))

    expect(await screen.findByText('No Winner Declared')).toBeInTheDocument()
    expect(screen.queryByText('No Results Available Yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /voting arena/i })).not.toBeInTheDocument()
  })

  it('does not claim a champion was crowned on a final round with no winner', async () => {
    // covers: AC-4
    renderResults(makeStore(completedNoWinnerSession()))

    expect(await screen.findByText('Final Round — No winner declared')).toBeInTheDocument()
    expect(screen.queryByText(/Winner crowned tournament champion/i)).not.toBeInTheDocument()
  })

  it('still announces the champion on a final round when a winner exists', async () => {
    // The sibling case: the notice must not lose its original wording just
    // because it learned to admit the absence of a winner.
    const winnerRounds = [
      {
        ...ROUNDS[0],
        roundIndex: 1,
        resolution: 'majority_win',
        tally: { Ash: 2, Bee: 1 },
        totalVotes: 3,
        advanced: ['Ash']
      },
      {
        ...ROUNDS[0],
        roundIndex: 2,
        resolution: 'majority_win',
        tally: { Ash: 2, Bee: 1 },
        totalVotes: 3,
        advanced: null
      }
    ]
    vi.mocked(fetchSessionRounds).mockResolvedValue({ success: true, rounds: winnerRounds })
    vi.mocked(fetchSessionResult).mockResolvedValue({
      success: true,
      result: {
        sessionId: SESSION_ID,
        title: 'No result label check',
        winner: 'Ash',
        type: 'public',
        rounds: winnerRounds
      }
    })

    renderResults(makeStore(completedNoWinnerSession({ winner: 'Ash' })))

    expect(await screen.findByText('We Have a Winner!')).toBeInTheDocument()
    expect(await screen.findByText('Championship Round — Winner crowned tournament champion')).toBeInTheDocument()
  })

  it('shows the history again once the round closes and the reveal starts (AC-5)', async () => {
    // The same session one state later. The reveal window is where the history
    // has always been shown, and moving the block must not have lost it.
    renderResults(makeStore({
      id: SESSION_ID,
      sessionId: SESSION_ID,
      title: 'Live guard',
      status: 'active',
      sessionType: 'public',
      type: 'public',
      whoCanJoin: 'public',
      entries: ['Ash', 'Bee', 'Cedar'],
      vote: { pair: ['Ash', 'Bee'], tally: { Ash: 1 } },
      timer: { status: 'expired', expiresAt: Date.now() - 1000 },
      roundLifecycle: 'RESULTS_REVEALED',
      finalVote: { pair: ['Ash', 'Bee'], tally: { Ash: 1, Bee: 0 } },
      rounds: [ROUNDS[0]]
    }))

    expect(await screen.findByText('Round Results')).toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Tournament Cumulative Totals' })
    expect(panel).toHaveTextContent('Rounds Played: 1')
    expect(screen.getAllByRole('button', { name: /round \d/i })).toHaveLength(1)
  })

  it('keeps the history hidden while a round is live (AC-9)', async () => {
    // A session mid round carries an earlier closed round in its store state.
    // The tally guard must win over the round history, even though rounds are
    // present, so nothing about the previous round leaks during the vote.
    const now = Date.now()
    renderResults(makeStore({
      id: SESSION_ID,
      sessionId: SESSION_ID,
      title: 'Live guard',
      status: 'active',
      sessionType: 'public',
      type: 'public',
      whoCanJoin: 'public',
      entries: ['Ash', 'Bee', 'Cedar'],
      vote: { pair: ['Ash', 'Bee'], tally: { Ash: 1 } },
      timer: { status: 'running', expiresAt: now + 60000 },
      roundLifecycle: 'VOTING',
      rounds: [ROUNDS[0]]
    }))

    expect(await screen.findByText('Voting in Progress')).toBeInTheDocument()
    expect(document.querySelector('.results-history-section')).toBeNull()
    expect(screen.queryByText('Zero-Vote Replay')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Tournament Cumulative Totals' })).not.toBeInTheDocument()
  })
})
