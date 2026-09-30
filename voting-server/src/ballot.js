import { List, Map } from 'immutable';

/**
 * VoteSphere — Single Ballot Pure Domain Module
 *
 * Implements pure functional single ballot mechanics for sessions with 2 to 6 candidates.
 * Kept strictly isolated from core.js to preserve core.js's pinned SHA-256 hash intact.
 */

/**
 * Initializes a single ballot vote state.
 * All candidates are placed in `candidates`.
 * `pair` is populated with the first two candidates as an alias for backwards compatibility.
 *
 * @param {List|Array<string>} entries
 * @returns {Map}
 */
export function initBallot(entries) {
  const list = List.isList(entries) ? entries : List(entries || []);
  return Map({
    candidates: list,
    pair: list.take(2),
    tally: Map()
  });
}

/**
 * Records a vote for a candidate in single ballot mode.
 * Only candidates present in `candidates` (or fallback `pair`) are accepted.
 *
 * @param {Map} voteState
 * @param {string} entry
 * @returns {Map}
 */
export function voteBallot(voteState, entry) {
  if (!voteState || !Map.isMap(voteState) || !entry || typeof entry !== 'string') {
    return voteState;
  }
  const candidates = voteState.get('candidates') || voteState.get('pair');
  if (!candidates || !candidates.includes(entry)) {
    return voteState;
  }
  return voteState.updateIn(
    ['tally', entry],
    0,
    tally => tally + 1
  );
}

/**
 * Derives total votes cast in a single ballot vote state.
 *
 * @param {Map} voteState
 * @returns {number}
 */
export function getTotalVotes(voteState) {
  if (!voteState || !Map.isMap(voteState)) return 0;
  const tally = voteState.get('tally');
  if (!tally || !Map.isMap(tally)) return 0;
  return tally.reduce((sum, count) => sum + (typeof count === 'number' ? count : 0), 0);
}

/**
 * Identifies the candidate(s) with the highest vote count in a single ballot round.
 * Returns an array of candidate strings tied for first place.
 *
 * @param {Map} voteState
 * @returns {Array<string>}
 */
export function getPluralityWinners(voteState) {
  if (!voteState || !Map.isMap(voteState)) return [];
  const candidates = voteState.get('candidates') || voteState.get('pair');
  if (!candidates || candidates.isEmpty()) return [];

  const candidatesList = candidates.toList();
  const tally = voteState.get('tally') || Map();

  let maxVotes = -1;
  let winners = [];

  candidatesList.forEach(candidate => {
    const votes = tally.get(candidate, 0);
    if (votes > maxVotes) {
      maxVotes = votes;
      winners = [candidate];
    } else if (votes === maxVotes) {
      winners.push(candidate);
    }
  });

  return winners;
}

/**
 * Derives a runoff ballot vote state containing only the tied candidates.
 *
 * @param {Map} voteState
 * @param {Array<string>|List<string>} tiedCandidates
 * @returns {Map}
 */
export function deriveRunoff(voteState, tiedCandidates) {
  const tiedList = List.isList(tiedCandidates) ? tiedCandidates : List(tiedCandidates || []);
  return Map({
    candidates: tiedList,
    pair: tiedList.take(2),
    tally: Map()
  });
}

export default {
  initBallot,
  voteBallot,
  getTotalVotes,
  getPluralityWinners,
  deriveRunoff
};
