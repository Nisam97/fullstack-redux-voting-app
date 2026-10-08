/**
 * VoteSphere — Results Chart Data Transformation Utilities
 *
 * Pure functions for transforming authoritative server tallies and round pairs
 * into presentation-ready chart structures with safe percentage arithmetic.
 */

import { isTimerExpired } from '../../utils/timerUtils.js';

/**
 * Standard palette for pairwise contenders in charts.
 * Contender 1: Indigo/Cyan
 * Contender 2: Violet/Rose
 */
export const CONTENDER_COLORS = ['#6366f1', '#ec4899'];

/**
 * Escapes one CSV cell (RFC 4180).
 *
 * A cell containing a comma, a quote, or a line break is wrapped in quotes and
 * its quotes are doubled. A cell that begins with `=`, `+`, `-`, or `@` is
 * prefixed with a single quote, because a spreadsheet treats that leading
 * character as the start of a formula. Voter display names are attacker
 * controlled, and this file is opened in a spreadsheet by an admin, so without
 * that guard a name like `=1+1` would be evaluated on open.
 *
 * @param {*} value
 * @returns {string} The escaped cell.
 */
function escapeCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/**
 * Builds the admin per round turnout export as CSV text.
 *
 * Every round of the session appears, including a round nobody voted in, which
 * keeps a zero turnout round visible in a spreadsheet instead of vanishing.
 * The round order is the order the server sent (ascending `roundIndex`); this
 * does not re-sort it, because the server owns that ordering.
 *
 * There is no vote choice column, and there cannot be: the turnout payload
 * carries only who voted in a round (spec 0008 AC-7, AC-10).
 *
 * @param {Array<{ roundIndex: number, roundId: string, voters: Array<{ name: string, email: string }> }>} turnout
 * @returns {string} CSV text, lines separated by CRLF.
 */
export function buildTurnoutCsv(turnout = []) {
  const rows = [['roundIndex', 'roundId', 'voterCount', 'voterName', 'email']];
  const rounds = Array.isArray(turnout) ? turnout : [];

  for (const round of rounds) {
    if (!round || typeof round !== 'object') {
      continue;
    }
    const voters = Array.isArray(round.voters) ? round.voters : [];
    const roundId = round.roundId || '';
    const voterCount = voters.length;

    if (voterCount === 0) {
      rows.push([round.roundIndex, roundId, 0, '', '']);
      continue;
    }

    for (const voter of voters) {
      rows.push([
        round.roundIndex,
        roundId,
        voterCount,
        (voter && voter.name) || '',
        (voter && voter.email) || ''
      ]);
    }
  }

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

/**
 * Builds a safe download filename for a session's turnout export.
 *
 * The session id comes from the route, so it is reduced to characters that
 * cannot escape the downloads folder or confuse a file manager. Dots are not
 * allowed either: a `..` left in a download name is pointless here and reads
 * like a path traversal.
 *
 * @param {string} sessionId
 * @returns {string}
 */
export function turnoutCsvFilename(sessionId) {
  const safe = String(sessionId == null ? '' : sessionId)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `turnout-${safe || 'session'}.csv`;
}

/**
 * Calculates percentage of votes with safe zero-division handling.
 * Rounds to 1 decimal place. Never returns NaN or Infinity.
 *
 * @param {number} votes
 * @param {number} totalVotes
 * @returns {number} Clamped percentage between 0 and 100
 */
export function calculatePercentage(votes, totalVotes) {
  if (
    typeof votes !== 'number' ||
    typeof totalVotes !== 'number' ||
    totalVotes <= 0 ||
    votes <= 0 ||
    Number.isNaN(votes) ||
    Number.isNaN(totalVotes)
  ) {
    return 0;
  }
  const pct = (votes / totalVotes) * 100;
  return Number(pct.toFixed(1));
}

/**
 * Transforms an authoritative pairwise vote (pair array + tally map)
 * into a normalized array of chart data items.
 *
 * Preserves the exact server order (pair[0], pair[1]) and authoritative vote counts.
 *
 * @param {Array<string>} [pair=[]] - Array of 2 contender candidate names
 * @param {Object} [tally={}] - Authoritative vote counts map { [candidate]: count }
 * @returns {Array<{ candidate: string, name: string, votes: number, percentage: number, fill: string }>}
 */
export function transformTallyToChartData(pair = [], tally = {}) {
  if (!Array.isArray(pair) || pair.length === 0) {
    return [];
  }

  const safeTally = tally && typeof tally === 'object' ? tally : {};

  // Extract candidate votes safely
  const candidateVotes = pair.map((candidate) => {
    const rawCount = safeTally[candidate];
    return typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount >= 0
      ? Math.floor(rawCount)
      : 0;
  });

  const totalVotes = candidateVotes.reduce((sum, count) => sum + count, 0);

  return pair.map((candidate, index) => {
    const votes = candidateVotes[index];
    const percentage = calculatePercentage(votes, totalVotes);
    const color = CONTENDER_COLORS[index % CONTENDER_COLORS.length];

    return {
      candidate: String(candidate || ''),
      name: String(candidate || ''),
      votes,
      percentage,
      fill: color
    };
  });
}

/**
 * Computes pairwise summary metrics including total votes, leader, and tie status.
 * Pure presentation derivation from authoritative pair and tally.
 *
 * @param {Array<string>} [pair=[]]
 * @param {Object} [tally={}]
 * @returns {{
 *   totalVotes: number,
 *   chartData: Array<object>,
 *   isTie: boolean,
 *   leader: string|null,
 *   margin: number
 * }}
 */
export function getPairwiseSummary(pair = [], tally = {}) {
  const chartData = transformTallyToChartData(pair, tally);
  const totalVotes = chartData.reduce((sum, item) => sum + item.votes, 0);

  if (chartData.length < 2) {
    return {
      totalVotes,
      chartData,
      isTie: false,
      leader: chartData.length === 1 ? chartData[0].candidate : null,
      margin: 0
    };
  }

  const votes0 = chartData[0].votes;
  const votes1 = chartData[1].votes;
  const isTie = votes0 === votes1;
  const leader = votes0 > votes1 ? chartData[0].candidate : (votes1 > votes0 ? chartData[1].candidate : null);
  const margin = Math.abs(votes0 - votes1);

  return {
    totalVotes,
    chartData,
    isTie,
    leader,
    margin
  };
}

/**
 * Determines whether the server has authoritatively confirmed that the round has closed.
 *
 * Server-authoritative confirmation is indicated when:
 * 1. serverConfirmedClosure is explicitly true.
 * 2. timer is null (server cleared active timer via timer_state { status: null }).
 * 3. timer.status is explicitly 'closed', 'expired', or 'stopped'.
 *
 * A running timer (status === 'running') whose local countdown has reached zero
 * has reached visual expiry on the client, but is NOT an authoritative server confirmation.
 *
 * @param {object|null} [timer=null]
 * @param {boolean} [serverConfirmedClosure=false]
 * @returns {boolean}
 */
export function isServerRoundClosed(timer = null, serverConfirmedClosure = false) {
  if (serverConfirmedClosure) {
    return true;
  }
  if (!timer) {
    return true;
  }
  if (timer.status === 'closed' || timer.status === 'expired' || timer.status === 'stopped' || timer.status === null) {
    return true;
  }
  return false;
}

/**
 * Determines the Results page visibility presentation state:
 * - 'CONCLUDED': Tournament winner declared
 * - 'LOADING': Session not yet loaded from server
 * - 'EMPTY': Loaded but no active pair (< 2 candidates) and no winner
 * - 'VOTING_IN_PROGRESS': Round active and timer running / not expired
 * - 'RESULTS_REVEALED': Round closed / timer expired / stopped, authoritative tallies ready to view
 *
 * Server Authoritativeness:
 * Frontend evaluates state without modifying server state or dispatching round advancement actions.
 *
 * @param {object} params
 * @param {boolean} [params.hasLoaded=false]
 * @param {string|null} [params.winner=null]
 * @param {Array<string>} [params.pair=[]]
 * @param {object|null} [params.timer=null]
 * @param {number} [params.now=Date.now()]
 * @param {boolean} [params.serverConfirmedClosure=false]
 * @param {string|null} [params.roundLifecycle=null]
 * @param {object|null} [params.finalVote=null]
 * @returns {'LOADING'|'CONCLUDED'|'EMPTY'|'VOTING_IN_PROGRESS'|'RESULTS_REVEALED'}
 */
export function getResultsVisibilityState({
  hasLoaded = false,
  winner = null,
  pair = [],
  timer = null,
  now = Date.now(),
  serverConfirmedClosure = false,
  roundLifecycle = null,
  finalVote = null
} = {}) {
  if (winner) {
    return 'CONCLUDED';
  }

  if (!hasLoaded) {
    return 'LOADING';
  }

  // 1. Explicit server round lifecycle state
  if (roundLifecycle === 'RESULTS_REVEALED' || roundLifecycle === 'ROUND_CLOSED') {
    return 'RESULTS_REVEALED';
  }

  const effectivePair = (roundLifecycle === 'RESULTS_REVEALED' && finalVote && Array.isArray(finalVote.pair))
    ? finalVote.pair
    : pair;

  if (!Array.isArray(effectivePair) || effectivePair.length < 2) {
    return 'EMPTY';
  }

  // 2. Explicit server confirmation of round closure
  if (serverConfirmedClosure || timer === null || timer?.status === 'closed' || timer?.status === 'expired' || timer?.status === 'stopped') {
    return 'RESULTS_REVEALED';
  }

  // 3. Active round with running timer:
  // Check if voting is actively running
  const isTimerRunning = timer?.status === 'running' && typeof timer?.expiresAt === 'number' && timer?.expiresAt > 0;
  const isExpired = isTimerExpired(timer, now);

  if (isTimerRunning && !isExpired) {
    return 'VOTING_IN_PROGRESS';
  }

  // 4. Visual countdown reached zero on client while awaiting server advancement
  return 'RESULTS_REVEALED';
}

/**
 * Derives a guarded results presentation model ensuring premature tally exposure protection.
 *
 * When voting is actively running (VOTING_IN_PROGRESS):
 * - showChart: false
 * - showStats: false
 * - chartData: null
 * - totalVotes: null
 * - candidateResults: null
 * - Only contender names and guidance are exposed.
 *
 * When the round has closed (RESULTS_REVEALED):
 * - showChart: true
 * - showStats: true
 * - Authoritative chartData and candidate totals derived via transformTallyToChartData
 *   prioritizing frozen finalVote when available.
 *
 * @param {object} params
 * @param {boolean} [params.hasLoaded=false]
 * @param {string|null} [params.winner=null]
 * @param {Array<string>} [params.pair=[]]
 * @param {Object} [params.tally={}]
 * @param {object|null} [params.timer=null]
 * @param {number} [params.now=Date.now()]
 * @param {boolean} [params.serverConfirmedClosure=false]
 * @param {string|null} [params.roundLifecycle=null]
 * @param {object|null} [params.finalVote=null]
 * @param {object|null} [params.revealTimer=null]
 * @returns {object}
 */
export function getGuardedResultsPresentation({
  hasLoaded = false,
  winner = null,
  pair = [],
  tally = {},
  timer = null,
  now = Date.now(),
  serverConfirmedClosure = false,
  roundLifecycle = null,
  finalVote = null,
  revealTimer = null
} = {}) {
  const visibilityState = getResultsVisibilityState({
    hasLoaded,
    winner,
    pair,
    timer,
    now,
    serverConfirmedClosure,
    roundLifecycle,
    finalVote
  });

  // During RESULTS_REVEALED, prioritize server-provided finalVote (pair & tally) for absolute stability
  const effectivePair = (visibilityState === 'RESULTS_REVEALED' && finalVote?.pair && Array.isArray(finalVote.pair))
    ? finalVote.pair
    : (Array.isArray(pair) ? pair : []);

  const effectiveTally = (visibilityState === 'RESULTS_REVEALED' && finalVote?.tally && typeof finalVote.tally === 'object')
    ? finalVote.tally
    : (tally && typeof tally === 'object' ? tally : {});

  const contenders = effectivePair.slice(0, 2);
  const roundKey = effectivePair.length >= 2 ? effectivePair.join(':::') : null;

  if (visibilityState === 'VOTING_IN_PROGRESS') {
    return {
      visibilityState,
      isVotingActive: true,
      showChart: false,
      showStats: false,
      contenders,
      roundKey,
      // Premature exposure protection: tallies and chartData are strictly null in this state
      chartData: null,
      totalVotes: null,
      candidateResults: null,
      message: 'Voting in Progress',
      subMessage: 'Results will be revealed when this round ends.'
    };
  }

  if (visibilityState === 'RESULTS_REVEALED') {
    const chartData = transformTallyToChartData(effectivePair, effectiveTally);
    const totalVotes = chartData.reduce((sum, item) => sum + item.votes, 0);

    return {
      visibilityState,
      isVotingActive: false,
      showChart: true,
      showStats: true,
      contenders,
      roundKey,
      effectivePair,
      effectiveTally,
      chartData,
      totalVotes,
      revealTimer: revealTimer || null,
      candidateResults: chartData.map((item, index) => ({
        candidate: item.candidate,
        votes: item.votes,
        percentage: item.percentage,
        position: index + 1,
        totalVotes
      })),
      message: 'Round Results',
      subMessage: 'Authoritative vote distribution for the round.'
    };
  }

  return {
    visibilityState,
    isVotingActive: false,
    showChart: false,
    showStats: false,
    contenders: [],
    roundKey: null,
    chartData: null,
    totalVotes: null,
    candidateResults: null,
    winner: winner || null
  };
}

/**
 * Human-readable labels for round settlement resolution types (AC-6).
 */
export const RESOLUTION_LABELS = {
  majority_win: 'Majority Win',
  tie_advance: 'Tie, Both Advanced',
  runoff: 'Runoff Rematch',
  admin_pick: 'Admin Decision',
  coin_flip: 'Coin Flip',
  no_result: 'No Result',
  zero_vote_replay: 'Zero-Vote Replay',
  WINNER: 'Winner',
  TIE_REQUEUED: 'Tie — Re-queued',
  TIE_COIN_TOSS: 'Tie — Decided by coin toss'
};

/**
 * Formats a settlement resolution enum into human-readable text (AC-6).
 *
 * @param {string} resolution
 * @param {Array<string>} [advanced=[]]
 * @returns {string}
 */
export function formatResolution(resolution, advanced = []) {
  if (!resolution || typeof resolution !== 'string') return '';
  // Legacy aliases predate the persisted enum and keep their own wording.
  if (resolution === 'WINNER') {
    if (Array.isArray(advanced) && advanced.length > 0) {
      return `Winner: ${advanced[0]}`;
    }
    return 'Winner declared';
  }
  // A named winner is more informative than the settlement method alone.
  if (resolution === 'majority_win' && Array.isArray(advanced) && advanced.length > 0) {
    return `Winner: ${advanced[0]}`;
  }
  return RESOLUTION_LABELS[resolution] || 'Round complete';
}

/**
 * Aggregates votes across all closed rounds into summary totals (AC-5).
 *
 * @param {Array<object>} [rounds=[]] - Array of round snapshots
 * @returns {{
 *   totals: Object<string, number>,
 *   totalVotesAllRounds: number,
 *   roundsPlayed: number,
 *   totalRounds: number,
 *   totalVotes: number,
 *   sortedCandidates: Array<{ candidate: string, name: string, votes: number, totalVotes: number, percentage: number, fill: string, wins: number, losses: number }>,
 *   candidates: Array<{ candidate: string, name: string, votes: number, totalVotes: number, percentage: number, fill: string, wins: number, losses: number }>
 * }}
 */
export function deriveTotals(rounds = []) {
  if (!Array.isArray(rounds)) {
    return {
      totals: {},
      totalVotesAllRounds: 0,
      roundsPlayed: 0,
      totalRounds: 0,
      totalVotes: 0,
      sortedCandidates: [],
      candidates: []
    };
  }

  const totals = {};
  const winLoss = {};
  let totalVotesAllRounds = 0;

  for (const round of rounds) {
    if (!round || !round.tally || typeof round.tally !== 'object') {
      continue;
    }

    const advancedList = Array.isArray(round.advanced) ? round.advanced : [];
    const candidatesInRound = Array.isArray(round.candidates)
      ? round.candidates
      : Object.keys(round.tally);

    // A round that closed with no votes still has a known roster, so seed every
    // candidate in it at zero. Building totals from the tally alone dropped them,
    // which left the totals panel with nothing to render for a zero-vote
    // tournament such as a `no_result` completion (AC-5).
    for (const cand of candidatesInRound) {
      if (typeof cand !== 'string' || !cand) continue;
      if (totals[cand] === undefined) totals[cand] = 0;
    }

    for (const [candidate, count] of Object.entries(round.tally)) {
      const votes = typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
      totals[candidate] = (totals[candidate] || 0) + votes;
      totalVotesAllRounds += votes;
    }

    if (round.resolution === 'WINNER' || round.resolution === 'majority_win') {
      for (const cand of candidatesInRound) {
        if (!winLoss[cand]) winLoss[cand] = { wins: 0, losses: 0 };
        if (advancedList.includes(cand)) {
          winLoss[cand].wins += 1;
        } else {
          winLoss[cand].losses += 1;
        }
      }
    }
  }

  const sortedCandidates = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([candidate, votes], index) => {
      const percentage = calculatePercentage(votes, totalVotesAllRounds);
      const fill = CONTENDER_COLORS[index % CONTENDER_COLORS.length];
      const wl = winLoss[candidate] || { wins: 0, losses: 0 };
      return {
        candidate,
        name: candidate,
        votes,
        totalVotes: votes,
        percentage,
        fill,
        wins: wl.wins,
        losses: wl.losses
      };
    });

  return {
    totals,
    totalVotesAllRounds,
    roundsPlayed: rounds.length,
    totalRounds: rounds.length,
    totalVotes: totalVotesAllRounds,
    sortedCandidates,
    candidates: sortedCandidates
  };
}


