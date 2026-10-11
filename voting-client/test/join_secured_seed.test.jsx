import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider, useSelector } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'

import voteReducer from '../src/redux/voteSlice.js'
import { selectSessionById } from '../src/redux/voteSlice.js'

// Join imports SERVER_URL from socket.js, which opens a real Socket.io singleton
// at import time. That is irrelevant here, so it is stubbed.
vi.mock('../src/services/socket.js', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false },
  default: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false },
  SERVER_URL: 'http://localhost:8090',
  // services/api.js sources the admin header from this reader, so the stub
  // must provide it or the request throws before it is ever sent.
  readStoredAdminToken: () => null,
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false })
}))

vi.mock('../src/components/layout/Navbar.jsx', () => ({
  default: () => <nav data-testid="navbar-stub" />
}))
vi.mock('../src/components/layout/Footer.jsx', () => ({
  default: () => <footer data-testid="footer-stub" />
}))

const Join = (await import('../src/pages/Join.jsx')).default

// A probe that renders what the lobby selector would see once the Join page has
// navigated to it. The lobby itself seeds nothing on mount; it relies on the
// metadata the Join page carries over.
function LobbyProbe({ sessionId }) {
  const session = useSelector((state) => selectSessionById(state, sessionId))
  return (
    <div data-testid="lobby-probe">
      <span data-testid="probe-session-type">{session?.sessionType || 'none'}</span>
      <span data-testid="probe-who-can-join">{session?.whoCanJoin || 'none'}</span>
      <span data-testid="probe-status">{session?.status || 'none'}</span>
    </div>
  )
}

function makeStore() {
  return configureStore({
    reducer: { sessions: voteReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false })
  })
}

function renderJoin(store, code = 'SEC123') {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/join/${code}`]}>
        <Routes>
          <Route path="/join/:code" element={<Join />} />
          <Route path="/sessions/:id/lobby" element={<LobbyProbe sessionId="sec_join_1" />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  )
}

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Join carries secured metadata into the lobby (spec 0008 AC-14)', () => {
  it('seeds a secured approval session so the gated lobby can render its join form', async () => {
    // The end to end symptom: the lobby read is gated, so a signed in voter who
    // is not yet approved gets a 404 from it. Unless the Join page carries the
    // resolver metadata over, the lobby renders its neutral state and no join
    // request can ever be filed for the admin to approve.
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        sessionId: 'sec_join_1',
        name: 'Board Election',
        status: 'pending',
        sessionType: 'secured',
        votingMode: 'tournament',
        whoCanJoin: 'approval'
      })
    }))

    const store = makeStore()
    renderJoin(store)

    expect(await screen.findByTestId('lobby-probe')).toBeInTheDocument()
    expect(screen.getByTestId('probe-session-type')).toHaveTextContent('secured')
    expect(screen.getByTestId('probe-who-can-join')).toHaveTextContent('approval')
    expect(screen.getByTestId('probe-status')).toHaveTextContent('pending')

    const seeded = selectSessionById(store.getState(), 'sec_join_1')
    expect(seeded).toBeTruthy()
    expect(seeded.sessionType).toBe('secured')
    expect(seeded.whoCanJoin).toBe('approval')
  })

  it('seeds a secured allowlist session with its mode intact', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        sessionId: 'sec_join_1',
        name: 'Committee Vote',
        status: 'pending',
        sessionType: 'secured',
        votingMode: 'tournament',
        whoCanJoin: 'allowlist'
      })
    }))

    const store = makeStore()
    renderJoin(store)

    await screen.findByTestId('lobby-probe')
    expect(screen.getByTestId('probe-session-type')).toHaveTextContent('secured')
    expect(screen.getByTestId('probe-who-can-join')).toHaveTextContent('allowlist')
  })

  it('defaults a secured session with no mode on the resolver to the allowlist, not public', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        sessionId: 'sec_join_1',
        name: 'Legacy Secured',
        status: 'pending',
        sessionType: 'secured',
        votingMode: 'tournament'
      })
    }))

    const store = makeStore()
    renderJoin(store)

    await screen.findByTestId('lobby-probe')
    expect(screen.getByTestId('probe-session-type')).toHaveTextContent('secured')
    expect(screen.getByTestId('probe-who-can-join')).toHaveTextContent('allowlist')
  })
})
