import { describe, it, expect, vi, beforeEach } from 'vitest'

// The socket singleton calls `io()` at module load, so the only way to inspect
// the handshake options is to intercept the factory. The fake socket is enough
// for socket.js to finish evaluating; no transport is opened.
const { ioMock } = vi.hoisted(() => {
  const makeFakeSocket = () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    close: vi.fn(),
    connected: false,
    auth: {},
    io: { close: vi.fn() }
  })
  return { ioMock: vi.fn(() => makeFakeSocket()) }
})

vi.mock('socket.io-client', () => ({ io: ioMock }))

/**
 * The voter identity for a secured session comes only from the `vs_voter`
 * cookie on the Socket.io handshake (spec 0007 AC-15). The server parses it from
 * `socket.handshake.headers.cookie`, so the client must ask the browser to
 * attach cookies. A WebSocket handshake tends to carry cookies on its own, but
 * the polling transport sends cross origin cookies only when credentials are
 * requested, which is why the option has to be explicit and stay on.
 */
describe('Socket.io handshake carries the vs_voter cookie', () => {
  beforeEach(() => {
    // Each case re-evaluates socket.js so it calls the mocked `io` again.
    vi.resetModules()
    ioMock.mockClear()
    window.localStorage.clear()
  })

  it('1. requests credentials so cookies ride every transport, not only WebSocket', async () => {
    await import('../src/services/socket.js')

    expect(ioMock).toHaveBeenCalledTimes(1)
    const [url, options] = ioMock.mock.calls[0]
    expect(typeof url).toBe('string')
    expect(options.withCredentials).toBe(true)
    // Polling is the transport that only sends cross origin cookies when
    // credentials are requested, so it must stay in the fallback list.
    expect(options.transports).toContain('polling')
    expect(options.transports).toContain('websocket')
  })

  it('2. keeps credentials on when an admin token is preloaded, alongside the admin auth', async () => {
    window.localStorage.setItem('votesphere_admin_jwt', 'admin.jwt.value')

    const mod = await import('../src/services/socket.js')

    const [, options] = ioMock.mock.calls[0]
    expect(options.withCredentials).toBe(true)
    expect(options.auth).toEqual({ token: 'admin.jwt.value' })
    expect(mod.socket).toBeTruthy()
  })

  it('3. still requests credentials when no admin token is stored, so voters are covered too', async () => {
    await import('../src/services/socket.js')

    const [, options] = ioMock.mock.calls[0]
    expect(options.withCredentials).toBe(true)
    expect(options.auth).toBeUndefined()
  })
})
