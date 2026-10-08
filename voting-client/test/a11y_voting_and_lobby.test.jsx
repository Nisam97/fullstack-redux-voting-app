import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'
import axe from 'axe-core'
import { computeAccessibleName } from 'dom-accessibility-api'

import voteReducer, { setSessionState, setSessions } from '../src/redux/voteSlice.js'
import voterAuthReducer from '../src/redux/voterAuthSlice.js'
import historyReducer from '../src/redux/historySlice.js'
import VoteCard from '../src/components/voting/VoteCard.jsx'

// The two screens open a real Socket.io singleton at import time and import
// CSS. Neither is relevant to the rendered structure the audit inspects, so
// both are stubbed the same way the other component specs stub them.
vi.mock('../src/services/socket.js', () => {
  const socket = {
    on: vi.fn(),
    off: vi.fn(),
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
    ADMIN_USER_KEY: 'votesphere_admin_user'
  }
})

// Only the membership helpers are replaced. Everything else (the admin token
// reader) stays real so the audit sees the same tree a browser would.
vi.mock('../src/services/auth.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    hasJoinedSession: vi.fn(() => false),
    getVoterDisplayName: vi.fn(() => ''),
    joinVoterSession: vi.fn(),
    getAdminToken: vi.fn(() => null)
  }
})

const Lobby = (await import('../src/pages/Lobby.jsx')).default
const Voting = (await import('../src/pages/Voting.jsx')).default
const auth = await import('../src/services/auth.js')

const SESSION_ID = 'sess_a11y'

const OPEN_SESSION = {
  id: SESSION_ID,
  sessionId: SESSION_ID,
  title: 'Neighbourhood Budget Vote',
  status: 'open',
  sessionType: 'public',
  type: 'public',
  whoCanJoin: 'public',
  roundLifecycle: 'VOTING',
  votingMode: 'tournament',
  roundId: `${SESSION_ID}:::r0`,
  roundIndex: 0,
  vote: { pair: ['Ada Lovelace', 'Grace Hopper'], tally: {} },
  voterCount: 2,
  connectedCount: 2,
  entryCount: 2
}

// A joined voter on an open session is redirected to the arena by the lobby's
// own auto transition, so the joined lobby state is reached on a pending
// session, which is exactly when a participant sits and waits.
const PENDING_SESSION = {
  ...OPEN_SESSION,
  status: 'pending',
  roundLifecycle: null,
  roundId: null,
  vote: { pair: [], tally: {} }
}

const SECURED_SESSION = {
  id: SESSION_ID,
  sessionId: SESSION_ID,
  title: 'Board Election',
  status: 'pending',
  sessionType: 'secured',
  type: 'secured',
  whoCanJoin: 'allowlist',
  voterCount: 4,
  entryCount: 3
}

function makeStore(session) {
  const store = configureStore({
    reducer: { sessions: voteReducer, voterAuth: voterAuthReducer, history: historyReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false })
  })
  if (session) {
    store.dispatch(setSessions([session]))
    store.dispatch(setSessionState(session))
  }
  return store
}

function renderScreen(store, path) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/sessions/:id/lobby" element={<Lobby />} />
          <Route path="/sessions/:id/vote" element={<Voting />} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/sessions" element={<div>sessions page</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  )
}

/**
 * The gate the Phase 9 pass is held to is no critical or serious violation,
 * because a serious structural fault (a control nested inside another control,
 * an unlabelled input) is a real barrier for a keyboard or screen reader user
 * and none of these screens should ship one.
 *
 * What jsdom can and cannot decide is asserted too, rather than assumed. jsdom
 * performs no layout, so a few rules match an element and then decline to judge
 * it; axe files those under `incomplete`, never under `violations`. A
 * violations-only gate therefore skips them without a trace. Requiring
 * `incomplete` to stay inside a named allowlist turns that blind spot into a
 * check: if a later axe version moves another rule into "cannot decide here",
 * this suite fails and says so instead of quietly widening the gap.
 *
 * `color-contrast` is not covered by this file at all; the Phase 9 browser pass
 * over the live screens is what records contrast. `label-content-name-mismatch`
 * is covered, but by the direct check below rather than by axe.
 */
const UNDECIDABLE_UNDER_JSDOM = ['color-contrast', 'label-content-name-mismatch']

const INTERACTIVE_WITH_TEXT = [
  'button',
  'a[href]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]'
].join(', ')

function normalize(text) {
  return String(text).replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The text a sighted user reads on the control: every text node that is not
 * inside an `aria-hidden` or `hidden` subtree, the same exclusion axe makes
 * when it derives visible text.
 */
function visibleText(el) {
  let out = ''
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += child.nodeValue
      } else if (
        child.nodeType === 1 &&
        child.getAttribute('aria-hidden') !== 'true' &&
        !child.hasAttribute('hidden')
      ) {
        walk(child)
      }
    }
  }
  walk(el)
  return normalize(out)
}

/**
 * WCAG 2.1 SC 2.5.3 Label in Name (Level A): the accessible name of a control
 * that shows a text label has to contain that text. Speech-input users say what
 * they see, so a name that drifts from the visible label makes the control
 * unreachable by voice.
 *
 * This is the rule the Phase 9 pass was failed on: `VoteCard` set
 * `aria-label="Vote for Ada Lovelace"` next to the visible `Vote for this`.
 * `computeAccessibleName` derives the name from the rendered tree, so this
 * check decides in jsdom what axe cannot.
 */
function labelInNameProblems(container) {
  const controls = Array.from(container.querySelectorAll(INTERACTIVE_WITH_TEXT)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true' && !el.hasAttribute('hidden')
  )

  const problems = []
  for (const el of controls) {
    const visible = visibleText(el)
    // SC 2.5.3 only constrains controls that present a text label. An icon-only
    // control is judged by a different rule (accessible name present at all),
    // which axe decides from the tree and this audit already gates on.
    if (!visible) continue
    const name = normalize(computeAccessibleName(el))
    if (!name.includes(visible)) {
      problems.push(
        `<${el.tagName.toLowerCase()}> is named "${name}", which does not contain its visible label "${visible}"`
      )
    }
  }
  return { controls: controls.length, problems }
}

function describeViolations(violations) {
  return violations
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes.map((n) => n.html).join('\n  ')}`)
    .join('\n')
}

/**
 * Runs both gates over one rendered screen and asserts both. Every screen the
 * Phase 9 pass touched goes through this, so a screen cannot be audited for one
 * rule and silently skipped for the other.
 */
async function expectAccessible(container) {
  const results = await axe.run(container, { resultTypes: ['violations', 'incomplete'] })

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious'
  )
  expect(blocking, describeViolations(blocking)).toEqual([])

  const undecidable = [...new Set(results.incomplete.map((violation) => violation.id))].sort()
  const unexpected = undecidable.filter((id) => !UNDECIDABLE_UNDER_JSDOM.includes(id))
  expect(
    unexpected,
    `axe matched ${unexpected.join(', ')} but cannot decide it without layout. Cover it in a real browser, or add it to UNDECIDABLE_UNDER_JSDOM with a reason.`
  ).toEqual([])

  const { controls, problems } = labelInNameProblems(container)
  expect(
    controls,
    'the audit inspected no interactive control, so its label in name check proved nothing'
  ).toBeGreaterThan(0)
  expect(problems, problems.join('\n')).toEqual([])
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  auth.hasJoinedSession.mockReturnValue(false)
  auth.getVoterDisplayName.mockReturnValue('')
  globalThis.fetch = vi.fn(async () => ({
    ok: false,
    status: 404,
    json: async () => ({ success: false })
  }))
})

afterEach(() => {
  vi.clearAllMocks()
})

// Every assertion below is an absence (axe found nothing, no label drifted), so
// a regression that stops the audit from evaluating the tree at all would make
// the whole file pass while checking nothing. These pin the machinery itself.
describe('Accessibility audit self checks', () => {
  it('proves the axe scan evaluates the rendered tree', async () => {
    const { container } = render(<img src="/logo.png" />)
    const results = await axe.run(container, { resultTypes: ['violations'] })
    expect(
      results.violations.map((violation) => violation.id),
      'axe returned nothing for a known unlabelled image, so every empty result in this file would be meaningless'
    ).toContain('image-alt')
  })

  it('proves the label in name check catches a name that drifts from the visible label', () => {
    const { container } = render(
      <button type="button" aria-label="Vote for Ada Lovelace">
        Vote for this
      </button>
    )
    const { controls, problems } = labelInNameProblems(container)
    expect(controls).toBe(1)
    expect(
      problems,
      'the label in name check missed the exact defect the Phase 9 pass found, so it cannot guard against it coming back'
    ).toHaveLength(1)
  })

  it('accepts a name that contains the visible label', () => {
    const { container } = render(
      <button type="button" aria-label="Vote for this: Ada Lovelace">
        Vote for this
      </button>
    )
    expect(labelInNameProblems(container).problems).toEqual([])
  })
})

describe('Accessibility: voting screens (WCAG 2.1 AA structural rules)', () => {
  it('reports no critical violations on the active voting arena', async () => {
    auth.hasJoinedSession.mockReturnValue(true)
    auth.getVoterDisplayName.mockReturnValue('Alex')

    const { container } = renderScreen(makeStore(OPEN_SESSION), `/sessions/${SESSION_ID}/vote`)

    // Prove the arena actually rendered before auditing, so a broken seed can
    // never turn this into a vacuous pass over an empty tree.
    expect(await screen.findByRole('heading', { name: /choose your favorite/i })).toBeInTheDocument()

    // Each vote button names the candidate it belongs to in the text it shows,
    // which is what keeps the visible label and the accessible name identical.
    const voteButtons = screen.getAllByRole('button', { name: /vote for/i })
    expect(voteButtons.map((button) => normalize(button.textContent)).sort()).toEqual([
      'vote for ada lovelace',
      'vote for grace hopper'
    ])

    await expectAccessible(container)
  })

  it('reports no critical violations on the join prompt', async () => {
    const { container } = renderScreen(makeStore(OPEN_SESSION), `/sessions/${SESSION_ID}/vote`)

    expect(await screen.findByRole('heading', { name: /join voting session/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument()

    await expectAccessible(container)
  })

  it('announces a rejected join through an alert role', async () => {
    const { container } = renderScreen(makeStore(OPEN_SESSION), `/sessions/${SESSION_ID}/vote`)
    await screen.findByRole('heading', { name: /join voting session/i })

    // The input is `required`, so jsdom will not fire a submit on an empty
    // form. Fill it and let the server refuse instead, which is the path a
    // voter actually hits when a join is turned down.
    auth.joinVoterSession.mockResolvedValue({
      success: false,
      message: 'Failed to join session. Please try again.'
    })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/display name/i), 'Alex')
    await user.click(screen.getByRole('button', { name: /join and start voting/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/failed to join session/i)

    await expectAccessible(container)
  })

  // The arena only renders the idle vote button, and the two other states are
  // the ones a round passes through on its own. The voted button is the one a
  // later reviewer would restyle without realising the label is its name.
  it('reports no critical violations on the voted vote button', async () => {
    const { container } = render(<VoteCard entry="Ada Lovelace" onVote={() => {}} hasVoted />)

    const button = screen.getByRole('button')
    // The confirmation names the candidate too, so the name a screen reader or
    // speech user gets is still this card's candidate.
    expect(normalize(button.textContent)).toBe('voted for ada lovelace')
    expect(normalize(computeAccessibleName(button))).toBe(normalize(button.textContent))

    await expectAccessible(container)
  })

  it('reports no critical violations on the closed vote button', async () => {
    const { container } = render(<VoteCard entry="Ada Lovelace" onVote={() => {}} disabled />)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    // The closed state says only that voting is shut; whatever it says, the
    // accessible name is the same text.
    expect(normalize(computeAccessibleName(button))).toBe(normalize(button.textContent))

    await expectAccessible(container)
  })
})

describe('Accessibility: lobby screens (WCAG 2.1 AA structural rules)', () => {
  it('reports no critical violations on an open lobby with a join form', async () => {
    const { container } = renderScreen(makeStore(OPEN_SESSION), `/sessions/${SESSION_ID}/lobby`)

    expect(await screen.findByRole('heading', { name: /neighbourhood budget vote/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument()

    await expectAccessible(container)
  })

  it('reports no critical violations on a joined lobby', async () => {
    auth.hasJoinedSession.mockReturnValue(true)
    auth.getVoterDisplayName.mockReturnValue('Alex')

    const { container } = renderScreen(makeStore(PENDING_SESSION), `/sessions/${SESSION_ID}/lobby`)

    expect(await screen.findByRole('heading', { name: 'Alex' })).toBeInTheDocument()

    await expectAccessible(container)
  })

  it('reports no critical violations on a secured lobby sign in wall', async () => {
    const { container } = renderScreen(makeStore(SECURED_SESSION), `/sessions/${SESSION_ID}/lobby`)

    expect(await screen.findByText('Authentication Required')).toBeInTheDocument()

    await expectAccessible(container)
  })

  it('reports no critical violations on the neutral not available state', async () => {
    const { container } = renderScreen(makeStore(null), `/sessions/${SESSION_ID}/lobby`)

    expect(await screen.findByRole('heading', { name: /this session is not available/i })).toBeInTheDocument()

    await expectAccessible(container)
  })
})
