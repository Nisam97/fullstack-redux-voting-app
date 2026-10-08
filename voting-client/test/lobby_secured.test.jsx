import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'

import voteReducer, { setSessionState, setSessions, lobbyUpdate } from '../src/redux/voteSlice.js'
import voterAuthReducer, { setVoterAuth, clearVoterAuth } from '../src/redux/voterAuthSlice.js'
import historyReducer from '../src/redux/historySlice.js'
import { joinVoterSession } from '../src/services/auth.js'

// The lobby opens a real Socket.io singleton at import time and imports CSS.
// Both are irrelevant to the rendered states under test, so they are stubbed.
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
    connectSocket: vi.fn(),
    connectSocketToStore: vi.fn(),
    subscribedSessions: new Set(),
    readStoredAdminToken: () => null,
    applyAdminTokenToSocket: vi.fn(),
    ADMIN_TOKEN_KEY: 'votesphere_admin_jwt',
    // Lets a spec deliver a server broadcast into the mounted component.
    __emit: (evt, payload) => handlers.get(evt)?.(payload)
  }
})

vi.mock('../src/services/auth.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, joinVoterSession: vi.fn() }
})

vi.mock('../src/components/layout/Navbar.jsx', () => ({
  default: () => <nav data-testid="navbar-stub" />
}))

const Lobby = (await import('../src/pages/Lobby.jsx')).default
const { __emit: deliver } = await import('../src/services/socket.js')

// A server broadcast is a real React state update, so it has to run inside
// act(...) like any other event, or React logs a warning that will later hide
// a genuine act problem.
const __emit = (evt, payload) => act(() => deliver(evt, payload))

// A secured session in approval mode, as the registry broadcast would deliver.
const SECURED_SESSION = {
  id: 'sec_lobby_1',
  sessionId: 'sec_lobby_1',
  title: 'Board Election',
  status: 'pending',
  sessionType: 'secured',
  type: 'secured',
  whoCanJoin: 'approval',
  voterCount: 4,
  entryCount: 3
}

function makeStore({ session = SECURED_SESSION, loggedInAs = null } = {}) {
  const store = configureStore({
    reducer: { sessions: voteReducer, voterAuth: voterAuthReducer, history: historyReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false })
  })

  if (session) {
    store.dispatch(setSessions([session]))
    store.dispatch(setSessionState(session))
  }
  if (loggedInAs) {
    store.dispatch(setVoterAuth({ user: loggedInAs, isLoggedIn: true }))
  } else {
    store.dispatch(clearVoterAuth())
  }
  return store
}

function renderLobby(store, sessionId = 'sec_lobby_1') {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/sessions/${sessionId}/lobby`]}>
        <Routes>
          <Route path="/sessions/:id/lobby" element={<Lobby />} />
          <Route path="/sessions/:id/vote" element={<div>vote page</div>} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  )
}

// The lobby fetches lobby metadata on mount. Silence it and let the seeded
// Redux session drive the render, which is what happens on a page reload.
//
// Storage is cleared per test because the lobby reads the session scoped voter
// token from it. jsdom keeps sessionStorage for the whole file, so without this
// one test joining leaks a pass into every test after it.
beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: false })
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Secured session lobby sign in wall (AC-4, AC-14)', () => {
  it('shows the sign in wall instead of a join form to an anonymous visitor on a secured session', async () => {
    renderLobby(makeStore())

    expect(await screen.findByText('Authentication Required')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in with email/i })).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/display name/i),
      'no join form may be offered before the visitor signs in'
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /join session/i }),
      'an anonymous visitor must not be able to submit a join'
    ).not.toBeInTheDocument()
  })

  it('never renders an email anywhere on the secured lobby', async () => {
    // AC-14. The roster lives server side; leaking it here would expose every
    // allowlisted voter to anyone with the join code.
    renderLobby(makeStore())

    await screen.findByText('Authentication Required')
    expect(document.body.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
  })

  it('names the mode in the sign in wall copy so the visitor knows why', async () => {
    renderLobby(makeStore())

    expect(await screen.findByText(/organizer approval/i)).toBeInTheDocument()
  })

  it('describes an allowlist secured session as an allowlist, not as approval', async () => {
    renderLobby(
      makeStore({ session: { ...SECURED_SESSION, whoCanJoin: 'allowlist' } })
    )

    expect(await screen.findByText(/approved participant allowlist/i)).toBeInTheDocument()
  })

  it('gives the sign in link an accessible name and sends the visitor to sign in with a return path', async () => {
    renderLobby(makeStore())

    const link = await screen.findByRole('link', { name: /sign in with email/i })
    expect(link).toHaveAccessibleName()
    expect(link).toHaveAttribute('href', '/login?redirect=%2Fsessions%2Fsec_lobby_1%2Flobby')
  })

  it('shows a secured badge naming the eligibility mode', async () => {
    renderLobby(makeStore())

    expect(await screen.findByText('Secured (Approval)')).toBeInTheDocument()
  })

  it('offers a plain join form on a public session, with no sign in wall', async () => {
    const publicSession = {
      ...SECURED_SESSION,
      id: 'pub_1',
      sessionId: 'pub_1',
      sessionType: 'public',
      type: 'public',
      whoCanJoin: 'public'
    }
    renderLobby(makeStore({ session: publicSession }), 'pub_1')

    expect(await screen.findByRole('button', { name: /join session/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument()
    expect(screen.queryByText('Authentication Required')).not.toBeInTheDocument()
  })
})

// The tests above seed the store with setSessions and setSessionState, both of
// which carry type, so they pass even when the lobby's own hydration path is
// broken. The lobby hydrates itself with lobbyUpdate on mount, so that is the
// path under test here.
describe('handleLobbyUpdate preserves the secured access fields (AC-14)', () => {
  it('keeps sessionType, type and whoCanJoin from the payload', () => {
    let state = voteReducer(undefined, { type: '@@INIT' })
    state = voteReducer(
      state,
      lobbyUpdate({
        sessionId: 'sec_lobby_2',
        title: 'Board Election',
        status: 'pending',
        voterCount: 2,
        entryCount: 3,
        sessionType: 'secured',
        type: 'secured',
        whoCanJoin: 'allowlist'
      })
    )

    const entry = state.bySessionId.sec_lobby_2
    expect(entry.sessionType).toBe('secured')
    expect(entry.type).toBe('secured')
    expect(entry.whoCanJoin).toBe('allowlist')
  })

  it('survives a later headcount broadcast that omits the access fields', () => {
    // A voterCount only broadcast arrives constantly during a live session.
    // If it wiped these, the wall would appear and disappear as people joined.
    let state = voteReducer(undefined, { type: '@@INIT' })
    state = voteReducer(
      state,
      lobbyUpdate({ sessionId: 'sec_lobby_2', sessionType: 'secured', type: 'secured', whoCanJoin: 'approval' })
    )
    state = voteReducer(state, lobbyUpdate({ sessionId: 'sec_lobby_2', voterCount: 5 }))

    expect(state.bySessionId.sec_lobby_2.sessionType).toBe('secured')
    expect(state.bySessionId.sec_lobby_2.whoCanJoin).toBe('approval')
    expect(state.bySessionId.sec_lobby_2.voterCount).toBe(5)
  })

  it('lets an explicit mode switch override the stored value', () => {
    let state = voteReducer(undefined, { type: '@@INIT' })
    state = voteReducer(
      state,
      lobbyUpdate({ sessionId: 'sec_lobby_2', sessionType: 'secured', type: 'secured', whoCanJoin: 'approval' })
    )
    state = voteReducer(state, lobbyUpdate({ sessionId: 'sec_lobby_2', whoCanJoin: 'allowlist' }))

    expect(state.bySessionId.sec_lobby_2.whoCanJoin).toBe('allowlist')
  })

  it('leaves a public session public', () => {
    let state = voteReducer(undefined, { type: '@@INIT' })
    state = voteReducer(
      state,
      lobbyUpdate({ sessionId: 'pub_2', sessionType: 'public', type: 'public', whoCanJoin: 'public' })
    )

    expect(state.bySessionId.pub_2.sessionType).toBe('public')
    expect(state.bySessionId.pub_2.whoCanJoin).toBe('public')
  })

  it('renders the sign in wall when the lobby hydrates itself via lobbyUpdate', async () => {
    // The end to end symptom: no setSessions seeding, only the fetch response
    // the page really dispatches. Before the fix this rendered the plain join
    // form on a secured session.
    const store = configureStore({
      reducer: { sessions: voteReducer, voterAuth: voterAuthReducer, history: historyReducer },
      middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false })
    })
    store.dispatch(clearVoterAuth())
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        sessionId: 'sec_lobby_2',
        title: 'Board Election',
        status: 'pending',
        sessionType: 'secured',
        type: 'secured',
        whoCanJoin: 'allowlist',
        voterCount: 2,
        entryCount: 3
      })
    }))

    renderLobby(store, 'sec_lobby_2')

    expect(await screen.findByText('Authentication Required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /join session/i })).not.toBeInTheDocument()
  })
})

describe('Secured session lobby join form (AC-5, AC-15)', () => {
  it('prefills the display name from the signed in voter profile', async () => {
    // AC-15. A returning voter should not retype their name on every session.
    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada Lovelace', username: 'ada' } })
    )

    const input = await screen.findByLabelText(/display name/i)
    await waitFor(() => expect(input).toHaveValue('Ada Lovelace'))
  })

  it('shows the signed in identity to a logged in voter on a secured session', async () => {
    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada Lovelace', username: 'ada' } })
    )

    // The name and username sit in their own elements inside the paragraph,
    // so the paragraph is matched as a whole and the children are asserted
    // separately rather than matching a fragment of the text.
    const note = await screen.findByText(/signed in as/i)
    expect(note).toHaveTextContent('Ada Lovelace')
    expect(note).toHaveTextContent('@ada')
  })

  it('labels the display name input and ties the error to it', async () => {
    // Accessibility: a screen reader user must be able to find the field and
    // hear the validation message.
    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    const input = await screen.findByLabelText(/display name/i)
    expect(input).toHaveAttribute('id', 'displayName')
    expect(input.tagName).toBe('INPUT')
  })

  it('disables the join button until a display name is entered', async () => {
    const user = userEvent.setup()
    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: '', username: 'ada' } })
    )

    const input = await screen.findByLabelText(/display name/i)
    const button = screen.getByRole('button', { name: /join session/i })

    await waitFor(() => expect(button).toBeDisabled())
    await user.type(input, 'Grace')
    expect(button).toBeEnabled()
  })

  it('shows a pending approval notice when the join is queued for the organizer', async () => {
    // AC-5. A 202 must not read as a rejection or as a joined state.
    const user = userEvent.setup()
    vi.mocked(joinVoterSession).mockResolvedValue({
      success: true,
      status: 'pending_approval',
      requestId: 'req_9',
      sessionId: 'sec_lobby_1'
    })

    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    await user.click(await screen.findByRole('button', { name: /join session/i }))

    expect(await screen.findByText('Request Pending Approval')).toBeInTheDocument()
    expect(screen.getByText(/wait while the organizer reviews/i)).toBeInTheDocument()
    expect(
      screen.queryByText('Session-Scoped Pass Active'),
      'a pending voter has no pass yet'
    ).not.toBeInTheDocument()
  })

  it('reports a not on allowlist refusal in plain words', async () => {
    const user = userEvent.setup()
    vi.mocked(joinVoterSession).mockResolvedValue({
      success: false,
      error: 'NOT_ON_ALLOWLIST',
      message: 'You are not on the allowlist for this session.'
    })

    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    await user.click(await screen.findByRole('button', { name: /join session/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not on the approved allowlist/i)
  })

  it('reports a rejected request in plain words and does not offer a re request silently', async () => {
    const user = userEvent.setup()
    vi.mocked(joinVoterSession).mockResolvedValue({
      success: false,
      error: 'REQUEST_REJECTED',
      message: 'Your join request was rejected.'
    })

    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    await user.click(await screen.findByRole('button', { name: /join session/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/rejected by the organizer/i)
    expect(screen.queryByText('Request Pending Approval')).not.toBeInTheDocument()
  })
})

describe('Secured session lobby live participant status (AC-6, AC-7)', () => {
  it('switches a pending voter to the joined state when the admin approves, without a reload', async () => {
    // AC-6. The verify run saw exactly this transition happen live in one tab.
    vi.mocked(joinVoterSession).mockResolvedValue({
      success: true,
      status: 'pending_approval',
      requestId: 'req_1',
      sessionId: 'sec_lobby_1'
    })
    const user = userEvent.setup()
    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    await user.click(await screen.findByRole('button', { name: /join session/i }))
    await screen.findByText('Request Pending Approval')

    __emit('participant_status', {
      sessionId: 'sec_lobby_1',
      status: 'approved',
      voterToken: 'user:u-1',
      displayName: 'Ada'
    })

    expect(await screen.findByText('Session-Scoped Pass Active')).toBeInTheDocument()
    expect(await screen.findByText('Joined to this session')).toBeInTheDocument()
    expect(screen.queryByText('Request Pending Approval')).not.toBeInTheDocument()
  })

  it('stores the server issued voter token under the session scoped key on approval', async () => {
    // The token must be the one the server derived, never a client claim.
    const user = userEvent.setup()
    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    await user.click(await screen.findByRole('button', { name: /join session/i }))
    await screen.findByText('Request Pending Approval')

    __emit('participant_status', {
      sessionId: 'sec_lobby_1',
      status: 'approved',
      voterToken: 'user:server-issued-1',
      displayName: 'Ada'
    })

    await screen.findByText('Session-Scoped Pass Active')
    expect(window.sessionStorage.getItem('votesphere_voter_token_sec_lobby_1')).toBe('user:server-issued-1')
  })

  it('ignores a participant status broadcast addressed to a different session', async () => {
    // Multi session isolation. A stale broadcast from another room must not
    // grant a pass on this one.
    const user = userEvent.setup()
    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    await user.click(await screen.findByRole('button', { name: /join session/i }))
    await screen.findByText('Request Pending Approval')

    __emit('participant_status', {
      sessionId: 'sec_some_other_session',
      status: 'approved',
      voterToken: 'user:leaked'
    })

    expect(screen.getByText('Request Pending Approval')).toBeInTheDocument()
    expect(screen.queryByText('Session-Scoped Pass Active')).not.toBeInTheDocument()
  })

  it('shows a removal notice when the organizer removes the voter', async () => {
    const user = userEvent.setup()
    vi.mocked(joinVoterSession).mockResolvedValue({
      success: true,
      voterToken: 'user:u-1',
      displayName: 'Ada',
      sessionId: 'sec_lobby_1'
    })
    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    await user.click(await screen.findByRole('button', { name: /join session/i }))
    await screen.findByText('Session-Scoped Pass Active')

    __emit('participant_status', {
      sessionId: 'sec_lobby_1',
      status: 'removed',
      message: 'You have been removed from this session by the organizer.'
    })

    expect(await screen.findByText(/removed from this session/i)).toBeInTheDocument()
    expect(screen.queryByText('Session-Scoped Pass Active')).not.toBeInTheDocument()
  })

  it('clears the stored voter token when the voter is removed', async () => {
    // The token is written by auth.js on a real join, which is mocked here, so
    // this seeds it directly. That is also the true removal scenario: a voter
    // who joined earlier and is already holding a pass.
    window.sessionStorage.setItem('votesphere_voter_token_sec_lobby_1', 'user:u-1')
    window.sessionStorage.setItem('votesphere_voter_name_sec_lobby_1', 'Ada')

    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    // The seeded token makes the lobby render as already joined.
    expect(await screen.findByText('Session-Scoped Pass Active')).toBeInTheDocument()

    __emit('participant_status', { sessionId: 'sec_lobby_1', status: 'removed' })

    await waitFor(() =>
      expect(window.sessionStorage.getItem('votesphere_voter_token_sec_lobby_1')).toBeNull()
    )
  })

  it('shows the rejection reason from a rejection broadcast', async () => {
    const user = userEvent.setup()
    vi.mocked(joinVoterSession).mockResolvedValue({
      success: true,
      status: 'pending_approval',
      requestId: 'req_2',
      sessionId: 'sec_lobby_1'
    })
    renderLobby(
      makeStore({ loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } })
    )

    await user.click(await screen.findByRole('button', { name: /join session/i }))
    await screen.findByText('Request Pending Approval')

    __emit('participant_status', {
      sessionId: 'sec_lobby_1',
      status: 'rejected',
      message: 'This session is full for now.'
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('This session is full for now.')
    expect(screen.queryByText('Request Pending Approval')).not.toBeInTheDocument()
  })
})

// Spec 0008 AC-14, AC-15. The server answers a gated secured lobby read with
// the same 404 an unknown session id returns, so the client can no longer tell
// "this session does not exist" from "you may not see this session". Every
// lobby 404 therefore renders one identical neutral state, and the copy must
// never claim the session does not exist, since it very well might.
describe('Lobby neutral state for every 404 (AC-15)', () => {
  // A 404 with no session in Redux, which is what a gated secured read looks
  // like to an outsider: the fetch fails before any metadata is ever stored.
  const notAvailableFetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({
      success: false,
      error: 'SESSION_NOT_FOUND',
      message: 'Session was not found.'
    })
  })

  it('renders the neutral copy for a session that does not exist', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ success: false, error: 'SESSION_NOT_FOUND' })
    }))

    // No seeded session: this is a missing id, the case the old panel was
    // written for.
    renderLobby(makeStore({ session: null }), 'does_not_exist_1')

    expect(await screen.findByText('This session is not available.')).toBeInTheDocument()
  })

  it('renders the identical copy for a gated secured session, since the client cannot tell them apart', async () => {
    globalThis.fetch = vi.fn(notAvailableFetch)

    // The gate fired: a 404 for an id that does exist and is merely secured.
    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    expect(await screen.findByText('This session is not available.')).toBeInTheDocument()
  })

  it('never claims the session does not exist, and drops the discovery call to action', async () => {
    globalThis.fetch = vi.fn(notAvailableFetch)

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    await screen.findByText('This session is not available.')

    const copy = document.body.textContent.toLowerCase()
    // AC-15 pins these words as forbidden. Each one would tell the visitor
    // that the server knows something about the session, which is exactly the
    // signal the 404 exists to withhold.
    for (const forbidden of ['not found', 'does not exist', 'removed', 'private', 'secured']) {
      expect(copy, `the neutral state must not say "${forbidden}"`).not.toContain(forbidden)
    }

    // The old panel linked to a discovery list, which only makes sense if the
    // session is known to be gone. /sessions is retired anyway (spec 0002).
    expect(
      screen.queryByRole('link', { name: /browse available sessions/i })
    ).not.toBeInTheDocument()
  })

  it('does not render the old Session Not Found heading any more', async () => {
    globalThis.fetch = vi.fn(notAvailableFetch)

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    await screen.findByText('This session is not available.')
    expect(screen.queryByText('Session Not Found')).not.toBeInTheDocument()
    expect(screen.queryByText(/has been removed/i)).not.toBeInTheDocument()
  })

  it('prompts a signed out visitor to sign in, with a return path', async () => {
    globalThis.fetch = vi.fn(notAvailableFetch)

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    const link = await screen.findByRole('link', { name: /sign in if you were invited/i })
    expect(link).toHaveAttribute('href', '/login?redirect=%2Fsessions%2Fsec_lobby_1%2Flobby')
  })

  it('omits the sign in prompt for a visitor who is already signed in', async () => {
    globalThis.fetch = vi.fn(notAvailableFetch)

    // Already signed in and still refused, so a sign in prompt would be
    // useless noise. The neutral state itself is unchanged.
    renderLobby(
      makeStore({ session: null, loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } }),
      'sec_lobby_1'
    )

    await screen.findByText('This session is not available.')
    expect(screen.queryByRole('link', { name: /sign in if you were invited/i })).not.toBeInTheDocument()
  })

  it('keeps the transport failure message distinct, since a failure is not an existence signal', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    })

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    expect(await screen.findByText('Unable to load session lobby.')).toBeInTheDocument()
    // Borrowing the neutral copy here would tell a visitor with a flaky
    // connection that the session is unavailable, which is a claim the client
    // cannot support.
    expect(screen.queryByText('This session is not available.')).not.toBeInTheDocument()
  })

  it('sends the voter cookie and the admin Bearer header on the lobby read (AC-15)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }))
    window.localStorage.setItem('votesphere_admin_jwt', 'admin.jwt.value')

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())

    const [url, options] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('/api/sessions/sec_lobby_1/lobby')
    // Without these, the server gate would 404 an approved participant and the
    // admin for a session they are allowed to read.
    expect(options.credentials).toBe('include')
    expect(options.headers.Authorization).toBe('Bearer admin.jwt.value')
  })

  it('omits the Authorization header when no admin token is stored', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }))

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })
})

// The neutral state is the page a locked out visitor lands on, so it has to be
// reachable and readable with a keyboard and a screen reader, not only visible.
// Spec 0008 AC-15.
describe('Lobby neutral state accessibility (AC-15)', () => {
  const notFound = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ success: false, error: 'SESSION_NOT_FOUND' })
  })

  it('exposes the neutral state as a heading inside the main landmark', async () => {
    globalThis.fetch = vi.fn(notFound)

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    // A screen reader user navigates by landmark then heading, so the state has
    // to be reachable as a heading rather than only as loose text.
    const main = await screen.findByRole('main')
    expect(within(main).getByRole('heading', { level: 1, name: 'This session is not available.' })).toBeInTheDocument()
  })

  it('gives the sign in link an accessible name and reaches it by keyboard', async () => {
    const user = userEvent.setup()
    globalThis.fetch = vi.fn(notFound)

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    const link = await screen.findByRole('link', { name: /sign in if you were invited/i })
    expect(link).toHaveAccessibleName()

    // The link is a real focusable control, so Tab must land on it rather than
    // the visitor being stranded with no way forward.
    await user.tab()
    await waitFor(() => expect(link).toHaveFocus())
  })

  it('carries its meaning in text, not only in the decorative warning icon', async () => {
    globalThis.fetch = vi.fn(notFound)

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    await screen.findByText('This session is not available.')
    // A visitor who cannot see the red icon still needs the panel announced.
    // The warning icon is decorative here, so the text carries the meaning.
    // This asserts the text is present and non empty; it deliberately does not
    // claim a live region role, because the panel does not declare one.
    const main = screen.getByRole('main')
    expect(main).toHaveTextContent('This session is not available.')
    const heading = within(main).getByRole('heading', { level: 1 })
    expect(heading.textContent.trim()).not.toBe('')
  })

  it('offers a way forward to a signed in visitor, who cannot use the sign in link', async () => {
    globalThis.fetch = vi.fn(notFound)

    renderLobby(
      makeStore({ session: null, loggedInAs: { id: 'u-1', name: 'Ada', username: 'ada' } }),
      'sec_lobby_1'
    )

    // No sign in link, but the copy still tells the visitor what to do next,
    // so the state is never a dead end.
    expect(await screen.findByText(/ask the organizer for an invitation/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign in if you were invited/i })).not.toBeInTheDocument()
  })

  it('keeps the transport failure message distinct for assistive technology too', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network down') })

    renderLobby(makeStore({ session: null }), 'sec_lobby_1')

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Unable to load session lobby.')
    expect(heading).not.toHaveTextContent('This session is not available.')
  })
})
