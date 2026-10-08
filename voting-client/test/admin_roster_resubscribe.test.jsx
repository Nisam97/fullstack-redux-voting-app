import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'

import voteReducer, { setSessions } from '../src/redux/voteSlice.js'
import historyReducer from '../src/redux/historySlice.js'
import { createRemoteActionMiddleware } from '../src/redux/store.js'

// Admin.jsx opens the socket singleton and imports CSS. Both are irrelevant to
// the subscription behaviour under test, so they are stubbed. The handler map
// keeps one handler per event, which matches how the component registers.
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
    // Lets a spec fire a server event into the mounted component.
    __emit: (evt, payload) => handlers.get(evt)?.(payload)
  }
})

vi.mock('../src/components/layout/Navbar.jsx', () => ({
  default: () => <nav data-testid="navbar-stub" />
}))

const Admin = (await import('../src/pages/Admin.jsx')).default
const { socket, __emit } = await import('../src/services/socket.js')

const SECURED_SESSION = {
  id: 'sec_roster_1',
  sessionId: 'sec_roster_1',
  title: 'Board Election',
  status: 'pending',
  sessionType: 'secured',
  type: 'secured',
  whoCanJoin: 'allowlist',
  voterCount: 2,
  entryCount: 3
}

// The remote action middleware is wired in, matching createAppStore. Without
// it a dispatch never reaches the socket, so an admin action dispatched from a
// component would look like a no op in this spec while working in the app.
function makeStore() {
  const store = configureStore({
    reducer: { sessions: voteReducer, history: historyReducer },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false })
        .concat(createRemoteActionMiddleware(socket))
  })
  store.dispatch(setSessions([SECURED_SESSION]))
  return store
}

function renderAdmin() {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/admin']}>
        <Admin />
      </MemoryRouter>
    </Provider>
  )
}

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

describe('Admin roster subscription survives reconnect (review minor 2026-10-03)', () => {
  it('subscribes to the roster when Manage is opened', async () => {
    renderAdmin()

    const manageBtn = await screen.findByTestId('manage-session-sec_roster_1')
    fireEvent.click(manageBtn)

    expect(await screen.findByTestId('manage-session-modal')).toBeInTheDocument()
    expect(socket.emit).toHaveBeenCalledWith('subscribe_participants', {
      sessionId: 'sec_roster_1'
    })
  })

  it('re-emits subscribe_participants when the socket reconnects while a session is managed', async () => {
    renderAdmin()

    const manageBtn = await screen.findByTestId('manage-session-sec_roster_1')
    fireEvent.click(manageBtn)

    expect(await screen.findByTestId('manage-session-modal')).toBeInTheDocument()

    // Room membership died with the old connection, so the reconnect must
    // re-join it or the pending queue and counts freeze silently.
    socket.emit.mockClear()
    act(() => {
      __emit('connect')
    })

    expect(socket.emit).toHaveBeenCalledWith('subscribe_participants', {
      sessionId: 'sec_roster_1'
    })
  })

  it('stops re-subscribing after Manage is closed', async () => {
    renderAdmin()

    const manageBtn = await screen.findByTestId('manage-session-sec_roster_1')
    fireEvent.click(manageBtn)

    const closeBtn = await screen.findByTestId('manage-modal-close-btn')
    fireEvent.click(closeBtn)

    expect(screen.queryByTestId('manage-session-modal')).not.toBeInTheDocument()

    socket.emit.mockClear()
    act(() => {
      __emit('connect')
    })

    expect(socket.emit).not.toHaveBeenCalledWith('subscribe_participants', {
      sessionId: 'sec_roster_1'
    })
  })
})

// AC-11 requires a Remove action on every allowlist row. Before this the panel
// rendered an email and a status badge and nothing else, so an admin could not
// cut a voter off at all, which is the whole point of the removal work.
describe('Admin allowlist rows expose Remove (AC-11)', () => {
  const ALLOWLIST_ENTRIES = [
    { email: 'keep@example.com', status: 'joined', addedAt: '2026-10-01T00:00:00.000Z' },
    { email: 'gone@example.com', status: 'allowlisted', addedAt: '2026-10-01T00:00:00.000Z' }
  ]

  async function openRoster() {
    renderAdmin()
    fireEvent.click(await screen.findByTestId('manage-session-sec_roster_1'))
    expect(await screen.findByTestId('manage-session-modal')).toBeInTheDocument()
    act(() => {
      __emit('session_participants', {
        sessionId: 'sec_roster_1',
        mode: 'allowlist',
        entries: ALLOWLIST_ENTRIES,
        counts: { allowlistedCount: 2, joinedCount: 1 }
      })
    })
  }

  it('renders a Remove button on every allowlist row, joined or not', async () => {
    await openRoster()

    expect(await screen.findByTestId('remove-participant-keep@example.com')).toBeInTheDocument()
    expect(screen.getByTestId('remove-participant-gone@example.com')).toBeInTheDocument()
  })

  it('emits REMOVE_PARTICIPANT for the clicked email', async () => {
    await openRoster()

    const removeBtn = await screen.findByTestId('remove-participant-gone@example.com')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    socket.emit.mockClear()
    fireEvent.click(removeBtn)

    expect(socket.emit).toHaveBeenCalledWith('action', expect.objectContaining({
      type: 'REMOVE_PARTICIPANT',
      sessionId: 'sec_roster_1',
      email: 'gone@example.com'
    }))
  })

  it('removes nothing when the admin cancels the confirmation', async () => {
    await openRoster()

    const removeBtn = await screen.findByTestId('remove-participant-gone@example.com')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    socket.emit.mockClear()
    fireEvent.click(removeBtn)

    expect(socket.emit).not.toHaveBeenCalledWith('action', expect.objectContaining({
      type: 'REMOVE_PARTICIPANT'
    }))
  })
})

// Spec 0008 AC-11. The publish switch moved off the create form onto the
// results page, because a secured result must be born unpublished and the
// session cannot be published before it completes anyway.
describe('Create session form has no publish control (AC-11)', () => {
  async function openCreateModal() {
    renderAdmin()
    const opener = await screen.findByTestId('admin-section-create-btn')
    fireEvent.click(opener)
    return await screen.findByTestId('create-session-modal')
  }

  it('offers no checkbox anywhere in the create form', async () => {
    // The old form had exactly one checkbox, "Publish results publicly".
    // Asserting on the element type rather than the label keeps this honest
    // even if the wording changes.
    const modal = await openCreateModal()

    expect(modal.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(screen.getByTestId('create-session-title-input')).toBeInTheDocument()
    expect(screen.getByTestId('create-session-entries-input')).toBeInTheDocument()
  })

  it('never mentions publishing in the create form copy', async () => {
    const modal = await openCreateModal()
    expect(modal.textContent).not.toMatch(/publish/i)
  })

  it('sends no publish flag on CREATE_SESSION, whatever the form is set to', async () => {
    const modal = await openCreateModal()

    fireEvent.change(screen.getByTestId('create-session-title-input'), {
      target: { value: 'Unpublished By Default' }
    })
    fireEvent.change(screen.getByTestId('create-session-entries-input'), {
      target: { value: 'Alpha\nBeta' }
    })
    fireEvent.change(screen.getByTestId('create-session-type-select'), {
      target: { value: 'secured' }
    })

    socket.emit.mockClear()
    fireEvent.click(screen.getByTestId('create-session-submit-btn'))

    const createCall = socket.emit.mock.calls.find(
      (call) => call[1] && call[1].type === 'CREATE_SESSION'
    )
    expect(createCall, 'the form must still create a session').toBeTruthy()
    expect(
      Object.keys(createCall[1]),
      'the create payload must carry no visibility field at all'
    ).to.not.include('publishResultsPublicly')
    expect(modal).toBeInTheDocument()
  })
})

// Regression: createSession used to drop sessionType and whoCanJoin, so every
// session the Admin form made arrived at the server as public. A secured
// session could not be created from the UI at all, and the allowlist that
// followed the create was silently discarded because the session was not
// secured.
describe('Create session form actually creates a secured session (spec 0007)', () => {
  async function submitCreateForm({ type = 'secured', whoCanJoin = 'allowlist', emails = 'a@example.com' }) {
    renderAdmin()
    fireEvent.click(await screen.findByTestId('admin-section-create-btn'))
    await screen.findByTestId('create-session-modal')

    fireEvent.change(screen.getByTestId('create-session-title-input'), {
      target: { value: 'Board Election' }
    })
    fireEvent.change(screen.getByTestId('create-session-entries-input'), {
      target: { value: 'Alpha\nBeta' }
    })
    fireEvent.change(screen.getByTestId('create-session-type-select'), { target: { value: type } })
    if (type === 'secured') {
      fireEvent.change(screen.getByTestId('create-who-can-join-select'), { target: { value: whoCanJoin } })
      if (whoCanJoin === 'allowlist') {
        fireEvent.change(screen.getByTestId('create-session-allowlist-input'), { target: { value: emails } })
      }
    }

    socket.emit.mockClear()
    fireEvent.click(screen.getByTestId('create-session-submit-btn'))

    return socket.emit.mock.calls.find((call) => call[1] && call[1].type === 'CREATE_SESSION')?.[1]
  }

  it('sends sessionType secured and whoCanJoin allowlist on CREATE_SESSION', async () => {
    const payload = await submitCreateForm({ type: 'secured', whoCanJoin: 'allowlist' })

    expect(payload).toBeTruthy()
    expect(payload.sessionType).toBe('secured')
    expect(payload.whoCanJoin).toBe('allowlist')
  })

  it('sends the approval mode when the admin picks it', async () => {
    const payload = await submitCreateForm({ type: 'secured', whoCanJoin: 'approval' })

    expect(payload.sessionType).toBe('secured')
    expect(payload.whoCanJoin).toBe('approval')
  })

  it('normalises the form\'s "open" to the "public" the server validates', async () => {
    // The server rejects anything that is not 'public' or 'secured' with
    // VALIDATION_ERROR, and "open" is a status in this codebase, not a type.
    // Forwarding the form's raw value verbatim would break every public session.
    const payload = await submitCreateForm({ type: 'open' })

    expect(payload.sessionType).toBe('public')
    expect(payload.whoCanJoin).toBe('public')
  })

  it('still follows the create with a SET_ALLOWLIST the server will accept', async () => {
    // The allowlist is a separate action, but it is refused unless the session
    // is already secured, so it only works now that CREATE_SESSION carries the
    // type.
    await submitCreateForm({ type: 'secured', whoCanJoin: 'allowlist', emails: 'a@example.com' })

    const allowlistCall = socket.emit.mock.calls.find(
      (call) => call[1] && call[1].type === 'SET_ALLOWLIST'
    )
    expect(allowlistCall).toBeTruthy()
    expect(allowlistCall[1].emails).toEqual(['a@example.com'])
  })
})
