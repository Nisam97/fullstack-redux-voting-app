import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'
import axe from 'axe-core'
import { computeAccessibleName } from 'dom-accessibility-api'

import voteReducer from '../src/redux/voteSlice.js'
import voterAuthReducer, { setVoterAuth, clearVoterAuth } from '../src/redux/voterAuthSlice.js'
import historyReducer from '../src/redux/historySlice.js'

// Only the membership helpers are replaced. The Navbar reads the admin state
// from localStorage and the voter state from Redux, so driving those helpers
// is what moves it between its three states.
vi.mock('../src/services/auth.js', () => ({
  getAdminToken: vi.fn(() => null),
  isAdminLoggedIn: vi.fn(() => false),
  getAdminUser: vi.fn(() => null),
  logoutAdmin: vi.fn(),
  logoutVoter: vi.fn(),
  hasJoinedSession: vi.fn(() => false),
  getVoterDisplayName: vi.fn(() => ''),
  joinVoterSession: vi.fn(),
  ADMIN_TOKEN_KEY: 'votesphere_admin_jwt',
  ADMIN_USER_KEY: 'votesphere_admin_user'
}))

const Navbar = (await import('../src/components/layout/Navbar.jsx')).default
const auth = await import('../src/services/auth.js')

function makeStore({ voter = null } = {}) {
  const store = configureStore({
    reducer: { sessions: voteReducer, voterAuth: voterAuthReducer, history: historyReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false })
  })
  if (voter) {
    store.dispatch(setVoterAuth({ user: voter, isLoggedIn: true }))
  } else {
    store.dispatch(clearVoterAuth())
  }
  return store
}

function renderNavbar({ store, initialPath = '/' } = {}) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Navbar />
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/" element={<div>home page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  )
}

async function expectAxeClean(container) {
  const results = await axe.run(container, { resultTypes: ['violations'] })
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious'
  )
  const describeViolations = results.violations
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}`)
    .join(' | ')
  expect(
    blocking,
    `the navbar should have no critical or serious axe violations, found: ${describeViolations}`
  ).toEqual([])
}

/**
 * The Phase 9 hardening pass fixed one navbar defect: the anonymous state was
 * a button nested inside a link, which exposes and focuses one control twice
 * for a keyboard or screen reader user. These are AC-3 of the hardening work:
 * no critical accessibility violation survives on the screens the pass touched,
 * and the navbar in any of its three states is one of them.
 */
describe('Navbar: anonymous state (covers: AC-3 hardening)', () => {
  beforeEach(() => {
    auth.isAdminLoggedIn.mockReturnValue(false)
    auth.getAdminUser.mockReturnValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders exactly one Sign in control, so no control is nested and announced twice', () => {
    // The defect this pins: a button inside a link gives the same name to two
    // interactive controls. One link means one Tab stop and one announcement.
    const { container } = renderNavbar({ store: makeStore() })

    const signInLinks = screen.getAllByRole('link', { name: /sign in/i })
    expect(signInLinks).toHaveLength(1)
    expect(
      screen.queryByRole('button', { name: /sign in/i }),
      'a Sign in button would nest inside the Sign in link, which is the defect AC-3 closed'
    ).not.toBeInTheDocument()

    // The single control must still carry the label in its accessible name,
    // SC 2.5.3 Label in Name: speech input users say what they see.
    const name = computeAccessibleName(signInLinks[0])
    expect(name.toLowerCase()).toContain('sign in')

    expect(container.querySelectorAll('nav button')).toHaveLength(0)
  })

  it('is free of critical and serious axe violations', async () => {
    const { container } = renderNavbar({ store: makeStore() })
    await expectAxeClean(container)
  })
})

describe('Navbar: admin state (covers: AC-3 hardening)', () => {
  beforeEach(() => {
    auth.isAdminLoggedIn.mockReturnValue(true)
    auth.getAdminUser.mockReturnValue({ username: 'regent' })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows the admin identity and exactly one logout control', () => {
    renderNavbar({ store: makeStore() })

    const header = screen.getByRole('banner')
    expect(header).toHaveTextContent(/admin:/i)
    expect(header).toHaveTextContent('regent')

    expect(screen.getAllByRole('button', { name: /logout/i })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('is free of critical and serious axe violations', async () => {
    const { container } = renderNavbar({ store: makeStore() })
    await expectAxeClean(container)
  })

  it('logs the admin out, sends them to /login, and returns to the anonymous branch', async () => {
    const user = userEvent.setup()
    renderNavbar({ store: makeStore() })

    await user.click(screen.getByRole('button', { name: /logout/i }))

    expect(auth.logoutAdmin).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('login page')).toBeInTheDocument()
    // State cleared, so the navbar shows the anonymous controls again.
    expect(screen.getAllByRole('link', { name: /sign in/i })).toHaveLength(1)
  })
})

describe('Navbar: signed in voter state (covers: AC-3 hardening)', () => {
  beforeEach(() => {
    // The admin mocks from the suite above keep their return values between
    // tests, so without this the voter tests render the admin branch.
    auth.isAdminLoggedIn.mockReturnValue(false)
    auth.getAdminUser.mockReturnValue(null)
    auth.logoutVoter.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function renderAsVoter() {
    return renderNavbar({
      store: makeStore({ voter: { id: 'u-1', name: 'Ada Lovelace', username: 'ada' } })
    })
  }

  it('shows the voter greeting and exactly one log out control', async () => {
    renderAsVoter()

    const header = screen.getByRole('banner')
    expect(await screen.findByText(/hi, /i)).toBeInTheDocument()
    expect(header).toHaveTextContent('Ada Lovelace')

    expect(screen.getAllByRole('button', { name: /log\s*out/i })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('is free of critical and serious axe violations', async () => {
    const { container } = renderAsVoter()
    await expectAxeClean(container)
  })

  it('logs the voter out, clears Redux auth, and lands on the home page', async () => {
    const user = userEvent.setup()
    // The server's confirmation is what clears the slice, not a bare resolved
    // promise, so the stub returns the shape a real successful logout returns.
    auth.logoutVoter.mockResolvedValue({ success: true, status: 200, error: null, message: null })
    const store = makeStore({ voter: { id: 'u-1', name: 'Ada Lovelace', username: 'ada' } })
    renderNavbar({ store, initialPath: '/sessions/sess_a/lobby' })

    await user.click(screen.getByRole('button', { name: /log\s*out/i }))

    await waitFor(() => expect(auth.logoutVoter).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(store.getState().voterAuth.isLoggedIn).toBe(false)
    expect(screen.getAllByRole('link', { name: /sign in/i })).toHaveLength(1)
  })

  it('keeps the voter signed in and reports the failure when the server refuses', async () => {
    const user = userEvent.setup()
    auth.logoutVoter.mockResolvedValue({
      success: false,
      status: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during logout.'
    })
    const store = makeStore({ voter: { id: 'u-1', name: 'Ada Lovelace', username: 'ada' } })
    const { container } = renderNavbar({ store, initialPath: '/sessions/sess_a/lobby' })

    await user.click(screen.getByRole('button', { name: /log\s*out/i }))

    // A refusal means the cookie is most likely still live, so the honest state
    // is the one the server holds: still signed in, with the reason shown.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('An unexpected error occurred during logout.')
    expect(store.getState().voterAuth.isLoggedIn).toBe(true)
    expect(screen.getByText(/hi, /i)).toBeInTheDocument()
    expect(screen.queryByText('home page')).not.toBeInTheDocument()
    // The pending state must release on failure too, otherwise the control would
    // stay disabled and the voter could not retry.
    expect(screen.getByRole('button', { name: /log\s*out/i })).toBeEnabled()
    await expectAxeClean(container)
  })

  it('clears the local state when the server answers that no session remains', async () => {
    const user = userEvent.setup()
    auth.logoutVoter.mockResolvedValue({
      success: false,
      status: 401,
      error: 'UNAUTHORIZED',
      message: 'Authentication required'
    })
    const store = makeStore({ voter: { id: 'u-1', name: 'Ada Lovelace', username: 'ada' } })
    renderNavbar({ store, initialPath: '/sessions/sess_a/lobby' })

    await user.click(screen.getByRole('button', { name: /log\s*out/i }))

    // A 401 is the server saying there is no voter session left, so matching it
    // locally is the honest state and there is nothing to report: the anonymous
    // navbar already tells the voter they are signed out. Keeping the local
    // greeting here would trap them in a session the server refuses.
    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(store.getState().voterAuth.isLoggedIn).toBe(false)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the control and shows a pending state while the logout is in flight', async () => {
    const user = userEvent.setup()
    // A deferred promise holds the request open, which is the only way to observe
    // the in-flight window: a fast stub resolves before the assertion can run.
    let settleLogout
    auth.logoutVoter.mockImplementation(
      () => new Promise((resolve) => { settleLogout = resolve })
    )
    renderAsVoter()

    await user.click(screen.getByRole('button', { name: /log\s*out/i }))

    // The control is disabled and says what it is doing, so a slow server cannot
    // be double clicked into two sign out requests.
    const pendingButton = await screen.findByRole('button', { name: /signing out/i })
    expect(pendingButton).toBeDisabled()
    expect(pendingButton).toHaveAttribute('aria-busy', 'true')

    settleLogout({ success: true, status: 200, error: null, message: null })
    // On success the voter lands anonymous, so the pending label is gone with it.
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
    )
  })

  it('cannot be double clicked into two logout requests', async () => {
    const user = userEvent.setup()
    let settleLogout
    auth.logoutVoter.mockImplementation(
      () => new Promise((resolve) => { settleLogout = resolve })
    )
    renderAsVoter()

    await user.click(screen.getByRole('button', { name: /log\s*out/i }))
    const pendingButton = await screen.findByRole('button', { name: /signing out/i })

    // A second activation during the in-flight window must reach the server
    // once: the disabled control swallows it and the handler's guard catches
    // anything that still gets through.
    await user.click(pendingButton)
    expect(auth.logoutVoter).toHaveBeenCalledTimes(1)

    settleLogout({ success: true, status: 200, error: null, message: null })
    await waitFor(() => expect(auth.logoutVoter).toHaveBeenCalledTimes(1))
  })
})

// Every navbar assertion above is an absence, so a broken audit setup would
// make the whole file pass while checking nothing. This pins the scanner.
describe('Navbar audit self check', () => {
  it('proves the axe scan catches a known violation in this tree', async () => {
    const { container } = render(<button type="button" />)
    const results = await axe.run(container, { resultTypes: ['violations'] })
    expect(
      results.violations.map((violation) => violation.id),
      'axe returned nothing for a deliberately unlabelled button, so the navbar audits above would be meaningless'
    ).toContain('button-name')
  })
})
