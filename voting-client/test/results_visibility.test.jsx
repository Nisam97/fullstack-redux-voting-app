import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'

import voteReducer, { setSessions, setSessionState, setTurnout } from '../src/redux/voteSlice.js'
import voterAuthReducer from '../src/redux/voterAuthSlice.js'
import historyReducer from '../src/redux/historySlice.js'
import { createRemoteActionMiddleware } from '../src/redux/store.js'

// Results.jsx opens the socket singleton on import and imports CSS. Both are
// irrelevant to the rendered states under test, so they are stubbed.
vi.mock('../src/services/socket.js', () => {
  const handlers = new Map()
  const socket = {
    on: vi.fn((evt, fn) => {
      handlers.set(evt, fn)
    }),
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

// The result and rounds reads are the gate under test, so they are driven
// directly rather than through a mocked fetch.
vi.mock('../src/services/history.js', () => ({
  fetchSessionResult: vi.fn(),
  fetchSessionRounds: vi.fn(),
  fetchSessionHistory: vi.fn()
}))

vi.mock('../src/components/layout/Navbar.jsx', () => ({
  default: () => <nav data-testid="navbar-stub" />
}))

const Results = (await import('../src/pages/Results.jsx')).default
const History = (await import('../src/pages/History.jsx')).default
const { fetchSessionResult, fetchSessionRounds, fetchSessionHistory } = await import('../src/services/history.js')
const { socket, subscribeTurnout, __emit } = await import('../src/services/socket.js')

const ADMIN_TOKEN_KEY = 'votesphere_admin_jwt'
const SESSION_ID = 'sec_results_1'
const PUBLIC_ID = 'pub_results_1'

// A plain opaque token, not a JWT, so isAdminLoggedIn's expiry branch never
// runs and the spec is about the rendering, not about clock skew.
const ADMIN_TOKEN = 'admin-opaque-token'

const SECURED_RESULT = {
  sessionId: SESSION_ID,
  title: 'Board Election',
  winner: 'Beta',
  entries: ['Alpha', 'Beta'],
  completedAt: '2026-10-04T10:00:00.000Z',
  type: 'secured',
  publishResultsPublicly: false
}

const PUBLIC_RESULT = {
  ...SECURED_RESULT,
  sessionId: PUBLIC_ID,
  title: 'Open Town Hall',
  type: 'public',
  publishResultsPublicly: true
}

// The page reads the session's type and status off the store, so a spec that
// seeds turnout without also seeding the session manufactures a phantom entry
// that shadows the fetched result. Both halves are seeded together here.
function securedStoreSession(overrides = {}) {
  return {
    id: SESSION_ID,
    sessionId: SESSION_ID,
    title: 'Board Election',
    status: 'completed',
    sessionType: 'secured',
    type: 'secured',
    whoCanJoin: 'allowlist',
    publishResultsPublicly: false,
    voterCount: 2,
    entryCount: 2,
    ...overrides
  }
}

const PUBLIC_STORE_SESSION = {
  ...securedStoreSession(),
  id: PUBLIC_ID,
  sessionId: PUBLIC_ID,
  title: 'Open Town Hall',
  status: 'completed',
  sessionType: 'public',
  type: 'public',
  whoCanJoin: 'public',
  publishResultsPublicly: true
}

const TURNOUT = [
  {
    roundIndex: 1,
    roundId: `${SESSION_ID}:::r1`,
    voters: [
      { name: 'Voter One', email: 'voter1@example.com' },
      { name: 'Voter Two', email: 'voter2@example.com' }
    ]
  },
  { roundIndex: 2, roundId: `${SESSION_ID}:::r2`, voters: [] }
]

function makeStore({ session = null, turnout = null } = {}) {
  const store = configureStore({
    reducer: { sessions: voteReducer, voterAuth: voterAuthReducer, history: historyReducer },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false })
        .concat(createRemoteActionMiddleware(socket))
  })
  if (session) {
    store.dispatch(setSessions([session]))
    store.dispatch(setSessionState(session))
  }
  if (turnout) {
    store.dispatch(setTurnout(session ? session.sessionId : SESSION_ID, turnout))
  }
  return store
}

function renderResults(store, sessionId = SESSION_ID) {
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

// The publish toggle emits SET_PUBLISH_RESULTS with a Socket.io
// acknowledgement callback as the third emit argument, so these tests answer
// the server the way the real transport does rather than firing a synthetic
// event. Driving the callback is what makes "the server's answer is the source
// of truth" a tested claim instead of a comment.
function lastPublishEmit() {
  const calls = socket.emit.mock.calls.filter(
    (call) => call[0] === 'action' && call[1] && call[1].type === 'SET_PUBLISH_RESULTS'
  )
  return calls.length > 0 ? calls[calls.length - 1] : null
}

async function answerPublish(body) {
  const call = lastPublishEmit()
  expect(call, 'SET_PUBLISH_RESULTS must be emitted with an acknowledgement callback').not.toBeNull()
  const ack = call[2]
  expect(ack, 'the emit must carry an ack callback').toBeTypeOf('function')
  await act(async () => {
    ack(body)
  })
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.mocked(fetchSessionResult).mockReset()
  vi.mocked(fetchSessionRounds).mockReset().mockResolvedValue({ success: true, rounds: [] })
  vi.mocked(fetchSessionHistory).mockReset()
  vi.mocked(subscribeTurnout).mockReset()
})

// AC-12 is the client half of the spec: who sees the publish toggle, who sees
// turnout, and what a denied viewer is shown instead. None of it is reachable
// from the reducer and service specs that already exist.
describe('Results page gated state (AC-12)', () => {
  it('shows a neutral unavailable panel with a sign in prompt when the result read is refused', async () => {
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: false, error: 'RESULT_NOT_FOUND' })

    renderResults(makeStore())

    expect(await screen.findByText('Results are not available')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
    expect(screen.getByText(/approved participants/i)).toBeInTheDocument()
  })

  it('never renders any tally, winner, or candidate name when the read is refused', async () => {
    // covers: AC-12
    // The refusal must not leak through a sibling panel. The page has five
    // mutually exclusive panels, so a regression that dropped the `gated` guard
    // on the EMPTY branch would put a "No Results Available Yet" card with the
    // voting links next to the locked panel.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: false, error: 'RESULT_NOT_FOUND' })

    renderResults(makeStore())
    await screen.findByText('Results are not available')

    expect(screen.queryByText(/We Have a Winner/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No Results Available Yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Voting in Progress/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Round Results/i)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Beta|Alpha/)
  })

  it('renders no email anywhere for an outsider, because the admin panel is absent', async () => {
    // covers: AC-12
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: false, error: 'RESULT_NOT_FOUND' })

    renderResults(makeStore())
    await screen.findByText('Results are not available')

    expect(screen.queryByRole('region', { name: 'Admin result controls' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
  })

  it('subscribes to turnout only for an admin, never for an outsider', async () => {
    // covers: AC-7, AC-12
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: false, error: 'RESULT_NOT_FOUND' })

    renderResults(makeStore())
    await screen.findByText('Results are not available')

    expect(subscribeTurnout).not.toHaveBeenCalled()
  })
})

describe('Results page admin controls (AC-7, AC-12)', () => {
  beforeEach(() => {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, ADMIN_TOKEN)
  })

  it('shows the publish toggle and the per round turnout panel to the admin on a secured result', async () => {
    // covers: AC-7, AC-12
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))

    expect(await screen.findByRole('region', { name: 'Admin result controls' })).toBeInTheDocument()
    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Publish result')
    expect(screen.getByText('Per round turnout')).toBeInTheDocument()
    expect(screen.getByText(/only approved participants and you/i)).toBeInTheDocument()
  })

  it('lists every round in order with its voters, and says so plainly when a round is empty', async () => {
    // covers: AC-7
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))

    await screen.findByText('Per round turnout')

    const rounds = screen.getAllByText(/^Round \d$/)
    expect(rounds.map((el) => el.textContent)).toEqual(['Round 1', 'Round 2'])

    expect(screen.getByText('Voter One')).toBeInTheDocument()
    expect(screen.getByText('voter1@example.com')).toBeInTheDocument()
    expect(screen.getByText('Voter Two')).toBeInTheDocument()
    expect(screen.getByText('voter2@example.com')).toBeInTheDocument()
    expect(screen.getByText('2 voters')).toBeInTheDocument()
    expect(screen.getByText('0 voters')).toBeInTheDocument()
    expect(screen.getByText(/no signed in voters in this round/i)).toBeInTheDocument()
  })

  it('subscribes to live turnout so a fresh round arrives as each round closes', async () => {
    // covers: AC-7
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession() }))

    await waitFor(() => expect(subscribeTurnout).toHaveBeenCalledWith(SESSION_ID))
  })

  it('does not flip the toggle until the server acknowledges the publish', async () => {
    // covers: AC-3, AC-12
    // The whole point of the acknowledgement: the control must not show the
    // requested state while the server has not agreed to it.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    const toggle = await screen.findByTestId('publish-results-toggle')
    expect(toggle).toHaveTextContent('Publish result')

    socket.emit.mockClear()
    await userEvent.setup().click(toggle)

    expect(socket.emit).toHaveBeenCalledWith('action', expect.objectContaining({
      type: 'SET_PUBLISH_RESULTS',
      sessionId: SESSION_ID,
      publishResultsPublicly: true
    }), expect.any(Function))

    // Still the server's value, and busy, because nothing has answered yet.
    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Publish result')
    expect(screen.getByTestId('publish-results-toggle')).toBeDisabled()
    expect(screen.queryByText(/anyone with the session id can view this result/i)).not.toBeInTheDocument()

    await answerPublish({ success: true, sessionId: SESSION_ID, publishResultsPublicly: true })

    expect(await screen.findByText(/anyone with the session id can view this result/i)).toBeInTheDocument()
    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Unpublish result')
    expect(screen.getByTestId('publish-results-toggle')).not.toBeDisabled()
  })

  it('keeps the acknowledgement callback off the wire payload', async () => {
    // covers: AC-3
    // A function cannot be serialised, and the server has no use for it, so it
    // travels as the Socket.io callback rather than in the action body.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    await userEvent.setup().click(await screen.findByTestId('publish-results-toggle'))

    const [, payload] = lastPublishEmit()
    expect(payload.meta).toBeDefined()
    expect(payload.meta.onAck).toBeUndefined()

    await answerPublish({ success: true, sessionId: SESSION_ID, publishResultsPublicly: true })
  })

  it('leaves the toggle alone and shows the server reason when the publish is refused', async () => {
    // covers: AC-3, AC-12
    // Nothing was applied optimistically, so a refusal simply leaves the stored
    // value in place and surfaces the server's own words.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    const toggle = await screen.findByTestId('publish-results-toggle')
    expect(toggle).toHaveTextContent('Publish result')

    socket.emit.mockClear()
    await userEvent.setup().click(toggle)

    await answerPublish({
      success: false,
      error: 'SESSION_NOT_COMPLETED',
      message: 'Results can only be published after the session has completed.'
    })

    const error = await screen.findByTestId('publish-results-error')
    expect(error).toHaveTextContent('Results can only be published after the session has completed.')
    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Publish result')
    expect(screen.getByTestId('publish-results-toggle')).not.toBeDisabled()
    // The local copy keeps the server's value; echoing anything back would ask
    // the server to undo a change it never took.
    expect(socket.emit).not.toHaveBeenCalledWith('action', expect.objectContaining({
      type: 'SET_PUBLISH_RESULTS_LOCAL'
    }), expect.anything())
  })

  it('renders the value the server stored rather than the one that was asked for', async () => {
    // covers: AC-3, AC-12
    // The server is authoritative, so its answer decides the control even when
    // it differs from the request.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    await userEvent.setup().click(await screen.findByTestId('publish-results-toggle'))

    await answerPublish({ success: true, sessionId: SESSION_ID, publishResultsPublicly: false })

    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Publish result')
    expect(screen.queryByText(/anyone with the session id can view this result/i)).not.toBeInTheDocument()
  })

  it('falls back to neutral copy when a refusal carries no message', async () => {
    // covers: AC-3, AC-12
    // The server always sends a message today, but the page must not depend on
    // it.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    await userEvent.setup().click(await screen.findByTestId('publish-results-toggle'))

    await answerPublish({ success: false, error: 'UNAUTHORIZED' })

    const error = await screen.findByTestId('publish-results-error')
    expect(error).toHaveTextContent(/did not accept this change/i)
    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Publish result')
  })

  it('announces the refusal so assistive technology reads it out', async () => {
    // covers: AC-12
    // An error the admin cannot hear is an error the admin does not have.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    await userEvent.setup().click(await screen.findByTestId('publish-results-toggle'))

    await answerPublish({ success: false, error: 'UNAUTHORIZED', message: 'Admin authorization required.' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Admin authorization required.')
  })

  it('leaves the toggle alone when an error belongs to a different admin action', async () => {
    // covers: AC-3, AC-12
    // The acknowledgement is bound to its own emit, so a failure elsewhere
    // cannot reach this control at all.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    const toggle = await screen.findByTestId('publish-results-toggle')

    await userEvent.setup().click(toggle)
    await answerPublish({ success: true, sessionId: SESSION_ID, publishResultsPublicly: true })
    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Unpublish result')

    __emit('action_error', {
      action: 'SET_ALLOWLIST',
      error: 'VALIDATION_ERROR',
      message: 'Allowlist is empty.'
    })

    expect(screen.queryByTestId('publish-results-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Unpublish result')
  })

  it('shows nothing when no publish was ever sent', async () => {
    // covers: AC-3, AC-12
    // Nothing was clicked, so there is no answer to receive and no reason to
    // alarm the admin about a control they never touched.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    await screen.findByTestId('publish-results-toggle')

    __emit('action_error', {
      action: 'SET_PUBLISH_RESULTS',
      error: 'SESSION_NOT_COMPLETED',
      message: 'Results can only be published after the session has completed.'
    })

    expect(screen.queryByTestId('publish-results-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Publish result')
  })

  it('clears the previous refusal as soon as the admin tries again', async () => {
    // covers: AC-3, AC-12
    // A stale reason next to a fresh click would describe an attempt that is
    // no longer the one in flight.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    await userEvent.setup().click(await screen.findByTestId('publish-results-toggle'))

    await answerPublish({ success: false, error: 'UNAUTHORIZED', message: 'Admin authorization required.' })
    expect(await screen.findByTestId('publish-results-error')).toBeInTheDocument()

    await userEvent.setup().click(screen.getByTestId('publish-results-toggle'))
    expect(screen.queryByTestId('publish-results-error')).not.toBeInTheDocument()

    await answerPublish({ success: true, sessionId: SESSION_ID, publishResultsPublicly: true })
    expect(screen.getByTestId('publish-results-toggle')).toHaveTextContent('Unpublish result')
  })

  it('tells the admin a public result is always visible and offers no toggle', async () => {
    // covers: AC-1, AC-12
    // A public session has nothing to publish, so the control must be absent
    // rather than present and inert.
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: PUBLIC_RESULT })

    renderResults(makeStore({ session: PUBLIC_STORE_SESSION }), PUBLIC_ID)

    expect(await screen.findByText(/public session: results are always visible/i)).toBeInTheDocument()
    expect(screen.queryByTestId('publish-results-toggle')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Admin result controls' })).toBeInTheDocument()
  })

  it('still shows turnout for a public session, because turnout is about rounds, not visibility', async () => {
    // covers: AC-7
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: PUBLIC_RESULT })

    renderResults(makeStore({ session: PUBLIC_STORE_SESSION }), PUBLIC_ID)

    expect(await screen.findByText('Per round turnout')).toBeInTheDocument()
  })

  it('withholds the toggle until the session has ended', async () => {
    // covers: AC-3
    // Publishing is post completion only, so an in progress secured session
    // must not offer the control at all rather than offer a failing one.
    vi.mocked(fetchSessionResult).mockResolvedValue({
      success: true,
      result: { ...SECURED_RESULT, winner: null, completedAt: null }
    })

    renderResults(makeStore({
      session: securedStoreSession({ status: 'open', publishResultsPublicly: false }),
      turnout: TURNOUT
    }))

    expect(await screen.findByText(/becomes available once the session has ended/i)).toBeInTheDocument()
    expect(screen.queryByTestId('publish-results-toggle')).not.toBeInTheDocument()
  })
})

describe('Results page for a non admin viewer (AC-12)', () => {
  it('shows the winner to an approved participant on a published secured result', async () => {
    // covers: AC-2, AC-4, AC-12
    // The store is left unseeded so the page renders purely from the fetch
    // response, which is the path a real reload takes.
    vi.mocked(fetchSessionResult).mockResolvedValue({
      success: true,
      result: { ...SECURED_RESULT, publishResultsPublicly: true }
    })

    renderResults(makeStore())

    expect(await screen.findByText('We Have a Winner!')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Beta', level: 2 })).toBeInTheDocument()
    expect(screen.queryByText('Results are not available')).not.toBeInTheDocument()
  })

  it('shows a non admin neither the publish toggle nor the turnout panel', async () => {
    // covers: AC-7, AC-8, AC-12
    vi.mocked(fetchSessionResult).mockResolvedValue({
      success: true,
      result: { ...SECURED_RESULT, publishResultsPublicly: true }
    })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))

    await screen.findByText('We Have a Winner!')

    expect(screen.queryByRole('region', { name: 'Admin result controls' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('publish-results-toggle')).not.toBeInTheDocument()
    expect(screen.queryByText('Per round turnout')).not.toBeInTheDocument()
    expect(screen.queryByTestId('turnout-export')).not.toBeInTheDocument()
    expect(subscribeTurnout).not.toHaveBeenCalled()
  })

  it('never leaks a voter email to a non admin, even when turnout is already in the store', async () => {
    // covers: AC-7, AC-8, AC-10
    // The strongest form of this: the emails are already sitting in Redux, and
    // the gate is purely on rendering. If the admin panel were ever keyed off
    // the session rather than the admin token, this is what would leak.
    vi.mocked(fetchSessionResult).mockResolvedValue({
      success: true,
      result: { ...SECURED_RESULT, publishResultsPublicly: true }
    })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))

    await screen.findByText('We Have a Winner!')

    expect(document.body.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(screen.queryByText('Voter One')).not.toBeInTheDocument()
  })
})

// AC-5 lists a completed session with no official winner like any other
// completed result, so the archive row has to read as a real outcome rather
// than an empty champion banner.
describe('History archive row for a completed session with no winner (AC-5)', () => {
  function renderHistory(rows) {
    vi.mocked(fetchSessionHistory).mockResolvedValue({ success: true, results: rows })
    return render(
      <Provider store={makeStore()}>
        <MemoryRouter initialEntries={['/history']}>
          <Routes>
            <Route path="/history" element={<History />} />
            <Route path="/sessions/:id/results" element={<div>results page</div>} />
            <Route path="/sessions" element={<div>sessions page</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    )
  }

  it('names the outcome instead of rendering an empty champion banner', async () => {
    // covers: AC-5
    renderHistory([
      {
        sessionId: 'pub_no_winner',
        title: 'Deadlocked Council Vote',
        winner: null,
        entries: ['Alpha', 'Beta'],
        completedAt: '2026-10-04T10:00:00.000Z',
        type: 'public'
      }
    ])

    expect(await screen.findByText('Deadlocked Council Vote')).toBeInTheDocument()
    expect(screen.getAllByTestId('history-winner-text')[0]).toHaveTextContent(
      'No official champion was declared.'
    )
    expect(screen.queryByText('Official Champion')).not.toBeInTheDocument()
  })

  it('still names the champion for a completed result that has one', async () => {
    // covers: AC-5
    renderHistory([
      {
        sessionId: 'pub_with_winner',
        title: 'Ordinary Public Vote',
        winner: 'Alpha',
        entries: ['Alpha', 'Beta'],
        completedAt: '2026-10-04T10:00:00.000Z',
        type: 'public'
      }
    ])

    expect(await screen.findByText('Ordinary Public Vote')).toBeInTheDocument()
    expect(screen.getAllByTestId('history-winner-text')[0]).toHaveTextContent('Alpha')
    expect(screen.getByText('Official Champion')).toBeInTheDocument()
    expect(screen.queryByText('No official champion was declared.')).not.toBeInTheDocument()
  })

  it('treats a blank winner as no champion rather than rendering whitespace', async () => {
    // covers: AC-5
    // An empty string or a stray space is not a name. Rendering it would put
    // the old empty banner back for exactly the rows this label exists for.
    renderHistory([
      {
        sessionId: 'pub_blank_winner',
        title: 'Blank Winner Vote',
        winner: '   ',
        entries: ['Alpha', 'Beta'],
        completedAt: '2026-10-04T10:00:00.000Z',
        type: 'public'
      }
    ])

    expect(await screen.findByText('Blank Winner Vote')).toBeInTheDocument()
    expect(screen.getAllByTestId('history-winner-text')[0]).toHaveTextContent(
      'No official champion was declared.'
    )
  })
})

// The archive type badge (spec 0008 AC-9, AC-10). The listing is not voter
// scoped, so the badge must describe the session and never the reader. These
// cases pin that, and they are the automated half of the "vary the viewer" step
// the /check verify record left open.
describe('History archive type badge (AC-9, AC-10)', () => {
  const SECURED_ROW = {
    sessionId: 'sec_archive_1',
    title: 'Closed Board Election',
    winner: 'Beta',
    entries: ['Alpha', 'Beta'],
    completedAt: '2026-10-04T10:00:00.000Z',
    type: 'secured'
  }

  const PUBLIC_ROW = {
    sessionId: 'pub_archive_1',
    title: 'Open Town Hall',
    winner: 'Alpha',
    entries: ['Alpha', 'Beta'],
    completedAt: '2026-10-04T10:00:00.000Z',
    type: 'public'
  }

  function renderArchive(rows, store = makeStore()) {
    vi.mocked(fetchSessionHistory).mockResolvedValue({ success: true, results: rows })
    return render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/history']}>
          <Routes>
            <Route path="/history" element={<History />} />
            <Route path="/sessions/:id/results" element={<div>results page</div>} />
            <Route path="/sessions" element={<div>sessions page</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    )
  }

  it('marks a published secured row as Secured and a public row as Public', async () => {
    // covers: AC-9
    renderArchive([SECURED_ROW, PUBLIC_ROW])

    await screen.findByText('Closed Board Election')
    await screen.findByText('Open Town Hall')

    const badges = screen.getAllByTestId('history-type-badge')
    expect(badges.map((b) => b.textContent)).toEqual(['Secured', 'Public'])
  })

  it('keeps the Completed badge beside the type badge', async () => {
    // covers: AC-9
    renderArchive([SECURED_ROW])

    await screen.findByText('Closed Board Election')

    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByTestId('history-type-badge')).toHaveTextContent('Secured')
  })

  it('carries the securedness in text, not only in the icon or its colour', async () => {
    // covers: AC-9
    // The lock glyph is decorative and hidden from assistive technology, so the
    // word "Secured" is the whole message. Without it the badge would be colour
    // only and unreadable to a screen reader.
    renderArchive([SECURED_ROW])

    await screen.findByText('Closed Board Election')

    const badge = screen.getByTestId('history-type-badge')
    expect(badge).toHaveTextContent('Secured')
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('treats a row the server did not mark as Public, the same default the server applies', async () => {
    // covers: AC-9
    const untypedRow = { ...PUBLIC_ROW, sessionId: 'untyped_1', title: 'Legacy Row', type: undefined }

    renderArchive([untypedRow])

    await screen.findByText('Legacy Row')

    expect(screen.getByTestId('history-type-badge')).toHaveTextContent('Public')
  })

  it('reads the same for the admin, an anonymous caller and a signed in participant', async () => {
    // covers: AC-9, AC-10
    // The archive row is not voter scoped, so the three viewers must see the
    // same badge on the same row. If a viewer ever gains a say in it, a signed
    // in outsider could be told which sessions exist, which is the leak the
    // whole visibility matrix exists to prevent.
    const badgeFor = async (setup) => {
      window.localStorage.clear()
      window.sessionStorage.clear()
      const store = makeStore()
      setup(store)
      const view = renderArchive([SECURED_ROW, PUBLIC_ROW], store)
      await screen.findByText('Closed Board Election')
      const text = screen.getAllByTestId('history-type-badge').map((b) => b.textContent).join('|')
      view.unmount()
      return text
    }

    const anonymous = await badgeFor(() => {})
    const admin = await badgeFor(() => {
      window.localStorage.setItem(ADMIN_TOKEN_KEY, ADMIN_TOKEN)
    })
    const participant = await badgeFor((store) => {
      store.dispatch({
        type: 'voterAuth/setVoterAuth',
        payload: { _id: 'u1', email: 'member@example.com', name: 'Member' }
      })
    })

    expect(admin).toBe('Secured|Public')
    expect(anonymous).toBe(admin)
    expect(participant).toBe(admin)
  })

  it('never renders an email on any card, whatever the viewer (AC-10)', async () => {
    // covers: AC-10
    window.localStorage.setItem(ADMIN_TOKEN_KEY, ADMIN_TOKEN)

    renderArchive([
      { ...SECURED_ROW, participants: [{ email: 'member@example.com' }], turnout: [{ roundIndex: 1, voters: [{ email: 'member@example.com' }] }] }
    ])

    await screen.findByText('Closed Board Election')

    expect(document.body.textContent).not.toContain('@')
  })
})

// The turnout CSV export (spec 0008 follow up). It is built in the browser from
// the payload the admin already has, so the tests here are about what reaches
// the file and who can trigger it at all.
describe('Turnout CSV export (AC-7, AC-10, AC-12)', () => {
  beforeEach(() => {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, ADMIN_TOKEN)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers the export to the admin alongside the turnout panel', async () => {
    // covers: AC-7, AC-12
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))

    const button = await screen.findByTestId('turnout-export')
    expect(button).toHaveTextContent('Download CSV')
    expect(button).not.toBeDisabled()
  })

  it('disables the export while there are no rounds to export', async () => {
    // covers: AC-7
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    renderResults(makeStore({ session: securedStoreSession() }))

    expect(await screen.findByText(/No rounds recorded yet/i)).toBeInTheDocument()
    expect(screen.getByTestId('turnout-export')).toBeDisabled()
  })

  it('downloads a CSV holding every round, with no vote choice column', async () => {
    // covers: AC-7, AC-10
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    const created = []
    const revoked = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob) => {
        created.push(blob)
        return 'blob:turnout'
      }),
      revokeObjectURL: vi.fn((url) => revoked.push(url))
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    await userEvent.setup().click(await screen.findByTestId('turnout-export'))

    expect(created).toHaveLength(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revoked).toEqual(['blob:turnout'])

    const csv = await created[0].text()
    const rows = csv.split('\r\n')
    expect(rows[0]).toBe('roundIndex,roundId,voterCount,voterName,email')
    expect(csv).toContain('1,sec_results_1:::r1,2,Voter One,voter1@example.com')
    expect(csv).toContain('2,sec_results_1:::r2,0,,')

    // No choice, tally, or winner may appear anywhere in the file.
    for (const banned of ['winner', 'tally', 'choice', 'selected']) {
      expect(csv.toLowerCase()).not.toContain(banned)
    }

    clickSpy.mockRestore()
  })

  it('names the file after the session', async () => {
    // covers: AC-7
    vi.mocked(fetchSessionResult).mockResolvedValue({ success: true, result: SECURED_RESULT })

    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:turnout'),
      revokeObjectURL: vi.fn()
    })
    let downloadName = null
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      downloadName = this.download
    })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))
    await userEvent.setup().click(await screen.findByTestId('turnout-export'))

    expect(downloadName).toBe(`turnout-${SESSION_ID}.csv`)
    clickSpy.mockRestore()
  })

  it('never exposes the export to a non admin', async () => {
    // covers: AC-8, AC-10, AC-12
    // The whole admin region is gated on the token, so this holds even though
    // the turnout payload is sitting in the store.
    window.localStorage.clear()
    vi.mocked(fetchSessionResult).mockResolvedValue({
      success: true,
      result: { ...SECURED_RESULT, publishResultsPublicly: true }
    })

    renderResults(makeStore({ session: securedStoreSession(), turnout: TURNOUT }))

    await screen.findByText('We Have a Winner!')
    expect(screen.queryByTestId('turnout-export')).not.toBeInTheDocument()
  })
})