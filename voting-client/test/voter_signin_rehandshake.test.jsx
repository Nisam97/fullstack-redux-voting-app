import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'

import voterAuthReducer from '../src/redux/voterAuthSlice.js'
import voteReducer from '../src/redux/voteSlice.js'
import { requestOtp, verifyOtp } from '../src/services/auth.js'
import { reattachVoterIdentityToSocket } from '../src/services/socket.js'

// The socket singleton opens a real connection at import time. Only the
// re-handshake helper is under test here, so the rest is stubbed.
vi.mock('../src/services/socket.js', () => {
  const socket = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: true
  }
  return {
    socket,
    default: socket,
    SERVER_URL: 'http://localhost:8090',
    getSocket: () => socket,
    connectSocket: vi.fn(),
    disconnectSocket: vi.fn(),
    applyAdminTokenToSocket: vi.fn(),
    reattachVoterIdentityToSocket: vi.fn()
  }
})

vi.mock('../src/services/auth.js', () => ({
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  loginAdmin: vi.fn()
}))

vi.mock('../src/components/layout/Navbar.jsx', () => ({
  default: () => <nav data-testid="navbar-stub" />
}))
vi.mock('../src/components/layout/Footer.jsx', () => ({
  default: () => <footer data-testid="footer-stub" />
}))

const Login = (await import('../src/pages/Login.jsx')).default
const Register = (await import('../src/pages/Register.jsx')).default

function makeStore() {
  return configureStore({
    reducer: { sessions: voteReducer, voterAuth: voterAuthReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false })
  })
}

function renderAt(element, path) {
  return render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="/" element={<div data-testid="home-probe">home</div>} />
          <Route path="/admin" element={<div data-testid="admin-probe">admin</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Voter sign in re-handshakes the socket for the vs_voter cookie', () => {
  it('1. Login re-handshakes after a successful OTP verify', async () => {
    // The bug: the socket connected at app load, before the server set the
    // vs_voter cookie, so the server kept treating the voter as anonymous until
    // a page reload. Sign in must force a fresh handshake.
    const user = userEvent.setup()
    requestOtp.mockResolvedValue({ success: true })
    verifyOtp.mockResolvedValue({ success: true, user: { id: 'u-1', name: 'Ada', username: 'ada' } })

    renderAt(<Login />, '/login')

    await user.type(screen.getByLabelText(/email address/i), 'ada@example.com')
    await user.click(screen.getByRole('button', { name: /send login code/i }))

    await user.type(await screen.findByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify & sign in/i }))

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(reattachVoterIdentityToSocket).toHaveBeenCalledTimes(1))
  })

  it('2. Login does not re-handshake when verification fails', async () => {
    const user = userEvent.setup()
    requestOtp.mockResolvedValue({ success: true })
    verifyOtp.mockResolvedValue({ success: false, error: 'INVALID_CODE', remainingAttempts: 2 })

    renderAt(<Login />, '/login')

    await user.type(screen.getByLabelText(/email address/i), 'ada@example.com')
    await user.click(screen.getByRole('button', { name: /send login code/i }))
    await user.type(await screen.findByLabelText(/6-digit code/i), '000000')
    await user.click(screen.getByRole('button', { name: /verify & sign in/i }))

    await screen.findByText(/incorrect code/i)
    expect(reattachVoterIdentityToSocket).not.toHaveBeenCalled()
  })

  it('3. Register re-handshakes after a successful OTP verify', async () => {
    const user = userEvent.setup()
    requestOtp.mockResolvedValue({ success: true })
    verifyOtp.mockResolvedValue({ success: true, user: { id: 'u-2', name: 'Grace Hopper', username: 'grace' } })

    renderAt(<Register />, '/register')

    await user.type(screen.getByLabelText(/email address/i), 'grace@example.com')
    await user.type(screen.getByLabelText(/display name/i), 'Grace Hopper')
    await user.type(screen.getByLabelText(/username/i), 'grace')
    await user.click(screen.getByRole('button', { name: /send verification code/i }))

    await user.type(await screen.findByLabelText(/6-digit code/i), '654321')
    await user.click(screen.getByRole('button', { name: /verify & create account/i }))

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(reattachVoterIdentityToSocket).toHaveBeenCalledTimes(1))
  })
})
