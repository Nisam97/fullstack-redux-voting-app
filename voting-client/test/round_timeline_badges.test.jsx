import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// AC-6 at the UI level. The label map in resultsUtils.js is already pinned by
// unit tests, but a unit test on the map cannot catch a component that renders
// something else, passes the wrong argument, or drops the badge entirely. These
// tests assert the exact string that lands in the DOM for every value the
// persisted resolution enum can hold, including the two literals AC-6 names
// verbatim.

vi.mock('../src/components/results/ResultsChart.jsx', () => ({
  default: () => <div data-testid="chart-stub" />
}))

const RoundTimeline = (await import('../src/components/results/RoundTimeline.jsx')).default

function round(roundIndex, resolution, overrides = {}) {
  return {
    roundIndex,
    kind: 'pairwise',
    candidates: ['Alpha', 'Bravo'],
    tally: { Alpha: 2, Bravo: 1 },
    totalVotes: 3,
    closedAt: '2026-10-05T13:11:15.373Z',
    resolution,
    advanced: ['Alpha'],
    ...overrides
  }
}

// The seven values the Result schema enum accepts, paired with the exact badge
// text the timeline must render for each.
const PERSISTED_ENUM_LABELS = [
  ['majority_win', 'Majority Win'],
  ['tie_advance', 'Tie, Both Advanced'],
  ['runoff', 'Runoff Rematch'],
  ['admin_pick', 'Admin Decision'],
  ['coin_flip', 'Coin Flip'],
  ['no_result', 'No Result'],
  ['zero_vote_replay', 'Zero-Vote Replay']
]

// The accordion button is `#trigger-round-accordion-<roundIndex>`, and the row
// wraps it, so the badge is read off the row rather than off the button.
function badgeFor(container, roundIndex) {
  const rows = container.querySelectorAll('.round-accordion-item')
  return rows[roundIndex - 1]?.querySelector('.resolution-badge') || null
}

function badgeTexts(container) {
  return Array.from(container.querySelectorAll('.resolution-badge')).map((node) => node.textContent)
}

describe('RoundTimeline resolution badges (AC-6)', () => {
  it('renders the exact AC-6 label for a majority win round', () => {
    const { container } = render(<RoundTimeline rounds={[round(1, 'majority_win')]} />)

    // AC-6 names this string verbatim.
    expect(badgeFor(container, 1).textContent).toBe('Majority Win')
  })

  it('renders the exact AC-6 label for a tie that advanced both', () => {
    const { container } = render(<RoundTimeline rounds={[round(1, 'tie_advance', { advanced: ['Alpha', 'Bravo'] })]} />)

    // AC-6 names this string verbatim.
    expect(badgeFor(container, 1).textContent).toBe('Tie, Both Advanced')
  })

  it('shows the settlement label, not a winner name, when advanced is set', () => {
    // formatResolution() can refine majority_win to "Winner: Alpha" when it is
    // given the advanced list. The timeline calls it without that argument, so
    // an admin auditing "how was this settled" sees the method. If someone
    // starts passing `advanced`, this fails and the label stops being an audit
    // record of the settlement.
    const { container } = render(<RoundTimeline rounds={[round(1, 'majority_win', { advanced: ['Alpha'] })]} />)

    expect(badgeFor(container, 1).textContent).toBe('Majority Win')
  })

  it.each(PERSISTED_ENUM_LABELS)('renders "%s" as "%s"', (resolution, label) => {
    const { container } = render(<RoundTimeline rounds={[round(1, resolution)]} />)

    expect(badgeFor(container, 1).textContent).toBe(label)
  })

  it('renders every persisted enum value in one timeline, each with its own label', () => {
    const rounds = PERSISTED_ENUM_LABELS.map(([resolution], index) =>
      round(index + 1, resolution, { advanced: resolution === 'no_result' ? null : ['Alpha'] })
    )

    const { container } = render(<RoundTimeline rounds={rounds} />)

    const badges = badgeTexts(container)
    expect(badges).toHaveLength(PERSISTED_ENUM_LABELS.length)
    expect(badges).toEqual(PERSISTED_ENUM_LABELS.map(([, label]) => label))
  })

  it('keeps a badge per row so no round is left unaudited', () => {
    const rounds = PERSISTED_ENUM_LABELS.map(([resolution], index) => round(index + 1, resolution))

    const { container } = render(<RoundTimeline rounds={rounds} />)

    expect(container.querySelectorAll('.round-accordion-item')).toHaveLength(rounds.length)
    expect(container.querySelectorAll('.resolution-badge')).toHaveLength(rounds.length)
  })

  it('falls back to "Round complete" for a value outside the enum', () => {
    // The schema rejects an unknown resolution, so this only guards a value
    // arriving from a client that skipped validation.
    const { container } = render(<RoundTimeline rounds={[round(1, 'a_resolution_from_the_future')]} />)

    expect(badgeFor(container, 1).textContent).toBe('Round complete')
  })

  it('renders an empty badge for a round with no resolution at all', () => {
    const { container } = render(<RoundTimeline rounds={[round(1, undefined)]} />)

    // The pill still exists so the row keeps its shape, but the text is empty
    // rather than pretending the round was settled somehow.
    expect(badgeFor(container, 1).textContent).toBe('')
  })

  it('pairs each badge with the round number and matchup it belongs to', () => {
    const { container } = render(
      <RoundTimeline
        rounds={[
          round(1, 'majority_win'),
          round(2, 'tie_advance', { kind: 'single_ballot', candidates: ['Ash', 'Bee', 'Cedar'] })
        ]}
      />
    )

    const rows = container.querySelectorAll('.round-accordion-item')

    // A label is only auditable when it sits on the round it describes, so the
    // round number, the matchup and the badge are asserted together per row.
    expect(rows[0].querySelector('.round-number-badge').textContent).toBe('Round 1')
    expect(rows[0].querySelector('.round-matchup-title').textContent).toBe('Alpha vs Bravo')
    expect(rows[0].querySelector('.resolution-badge').textContent).toBe('Majority Win')

    expect(rows[1].querySelector('.round-number-badge').textContent).toBe('Round 2')
    expect(rows[1].querySelector('.round-matchup-title').textContent).toBe('Ash, Bee, Cedar')
    expect(rows[1].querySelector('.resolution-badge').textContent).toBe('Tie, Both Advanced')
  })
})

// The legacy aliases predate the persisted enum and take their own path through
// formatResolution before the map is consulted. Their strings are the ones that
// actually drifted once already, so they are pinned here at the UI level too,
// not only in the server side unit spec.
describe('RoundTimeline legacy resolution aliases (AC-6)', () => {
  it('renders the declared wording for a legacy WINNER round', () => {
    // The timeline calls formatResolution without the advanced list, so the
    // "Winner: <name>" refinement is unreachable here. Pinning the reachable
    // string means a future change that starts passing `advanced` fails loudly
    // instead of quietly swapping an audit label for a name.
    const { container } = render(<RoundTimeline rounds={[round(1, 'WINNER', { advanced: ['Alpha'] })]} />)

    expect(badgeFor(container, 1).textContent).toBe('Winner declared')
  })

  it('never renders a winner name in a badge', () => {
    const { container } = render(<RoundTimeline rounds={[round(1, 'WINNER', { advanced: ['Alpha'] })]} />)

    expect(container.textContent).not.toContain('Winner: Alpha')
  })

  it('pins the legacy requeue wording', () => {
    const { container } = render(<RoundTimeline rounds={[round(1, 'TIE_REQUEUED')]} />)

    expect(badgeFor(container, 1).textContent).toBe('Tie — Re-queued')
  })

  it('pins the legacy coin toss wording', () => {
    const { container } = render(<RoundTimeline rounds={[round(1, 'TIE_COIN_TOSS')]} />)

    expect(badgeFor(container, 1).textContent).toBe('Tie — Decided by coin toss')
  })

  it('keeps the legacy aliases distinct from the current enum wording', () => {
    // "Tie — Re-queued" and "Tie, Both Advanced" are easy to confuse and were
    // once the same label for two different settlements.
    const { container } = render(
      <RoundTimeline
        rounds={[
          round(1, 'TIE_REQUEUED'),
          round(2, 'tie_advance', { advanced: ['Alpha', 'Bravo'] }),
          round(3, 'TIE_COIN_TOSS')
        ]}
      />
    )

    const badges = badgeTexts(container)
    expect(badges).toEqual([
      'Tie — Re-queued',
      'Tie, Both Advanced',
      'Tie — Decided by coin toss'
    ])
    expect(new Set(badges).size).toBe(3)
  })
})