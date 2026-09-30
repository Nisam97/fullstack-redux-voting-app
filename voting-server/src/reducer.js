import { Map, List, Set, fromJS } from 'immutable';
import { setEntries, next, vote } from './core';
import { initBallot, voteBallot, deriveRunoff } from './ballot.js';

export const INITIAL_STATE = fromJS({
  sessions: {}
});

export default function reducer(state = INITIAL_STATE, action) {
  if (!action || typeof action !== 'object' || !action.type) {
    return state;
  }

  // Ensure state has sessions Map if passed custom or empty Map
  const currentState = (state && Map.isMap(state) && (state.has('sessions') || state.has('elections')))
    ? (state.has('sessions') ? state : state.set('sessions', state.get('elections')).remove('elections'))
    : (state && Map.isMap(state) && state.isEmpty() ? INITIAL_STATE : (state || INITIAL_STATE));

  switch (action.type) {
    case 'CREATE_SESSION': {
      const sessionId = action.sessionId || action.electionId;
      const { title, entries } = action;
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        return currentState;
      }
      if (currentState.hasIn(['sessions', sessionId])) {
        // Safe no-op on duplicate session ID
        return currentState;
      }

      const rawDuration = action.timerDuration !== undefined
        ? action.timerDuration
        : action.duration;
      const timerDuration = (Number.isInteger(rawDuration) && rawDuration >= 5 && rawDuration <= 300)
        ? rawDuration
        : 30;

      const entriesList = List.isList(entries) ? entries : List(entries || []);
      const sessionType = action.sessionType || (action.type !== 'CREATE_SESSION' ? action.type : null) || 'public';
      const votingMode = action.votingMode || 'tournament';
      const candidateInfo = action.candidateInfo
        ? (List.isList(action.candidateInfo) ? action.candidateInfo : fromJS(action.candidateInfo))
        : List();
      const publishResultsPublicly = action.publishResultsPublicly !== undefined
        ? action.publishResultsPublicly
        : (sessionType !== 'secured');

      const newSession = Map({
        id: sessionId,
        title: typeof title === 'string' ? title : '',
        status: 'pending',
        entries: entriesList,
        vote: null,
        winner: null,
        timerDuration,
        type: sessionType,
        votingMode,
        joinCode: action.joinCode || null,
        whoCanJoin: action.whoCanJoin || 'public',
        candidateInfo,
        publishResultsPublicly,
        pendingExpiresAt: action.pendingExpiresAt || null,
        rounds: List(),
        tieCount: 0,
        zeroVoteCount: 0,
        tiePending: null,
        presence: Map(),
        snapshots: Map(),
        createdAt: new Date().toISOString()
      });
      return currentState.setIn(['sessions', sessionId], newSession);
    }

    case 'START_SESSION': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      const session = currentState.getIn(['sessions', sessionId]);
      if (session.get('status') === 'archived') {
        return currentState;
      }

      const votingMode = session.get('votingMode');
      const activePair = session.getIn(['vote', 'pair']);
      const activeCandidates = session.getIn(['vote', 'candidates']);
      const hasActiveVote = (activeCandidates && List.isList(activeCandidates) && !activeCandidates.isEmpty()) ||
                            (activePair && List.isList(activePair) && !activePair.isEmpty());

      let updatedSession;
      if (votingMode === 'single_ballot') {
        const entries = session.get('entries') || List();
        if (entries.size <= 1) {
          updatedSession = session.set('winner', entries.first() || null)
            .set('status', 'completed')
            .remove('vote')
            .remove('entries')
            .remove('roundLifecycle')
            .remove('finalVote')
            .remove('revealTimer')
            .remove('tiePending');
        } else if (!hasActiveVote) {
          const ballotVote = initBallot(entries);
          updatedSession = session.set('vote', ballotVote)
            .set('status', 'open')
            .set('roundLifecycle', 'VOTING')
            .set('tieCount', 0)
            .set('zeroVoteCount', 0)
            .set('tiePending', null);
        } else {
          updatedSession = session.set('status', 'open').set('roundLifecycle', 'VOTING');
        }
      } else {
        if (!hasActiveVote) {
          updatedSession = next(session);
        } else {
          updatedSession = session;
        }
        if (updatedSession.get('winner')) {
          updatedSession = updatedSession.set('status', 'completed');
        } else {
          updatedSession = updatedSession.set('status', 'open').set('roundLifecycle', 'VOTING');
        }
      }

      return currentState.setIn(['sessions', sessionId], updatedSession);
    }

    case 'SET_ROUND_LIFECYCLE': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      const { lifecycle, roundId, roundIndex, finalVote, revealTimer, tiePending, tieCount } = action;
      let session = currentState.getIn(['sessions', sessionId]);
      if (lifecycle) {
        session = session.set('roundLifecycle', lifecycle);
      }
      if (typeof tieCount === 'number') {
        session = session.set('tieCount', tieCount);
      }
      if (roundId) {
        session = session.set('roundId', roundId);
      }
      if (roundIndex !== undefined) {
        session = session.set('roundIndex', roundIndex);
      }
      if (finalVote) {
        session = session.set('finalVote', fromJS(finalVote));
      }
      if (revealTimer !== undefined) {
        session = session.set('revealTimer', revealTimer ? fromJS(revealTimer) : null);
      }
      if (tiePending !== undefined) {
        session = session.set('tiePending', tiePending ? fromJS(tiePending) : null);
      }
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'SET_ENTRIES': {
      const sessionId = action.sessionId || action.electionId;
      const { entries } = action;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      const session = currentState.getIn(['sessions', sessionId]);
      const updatedSession = setEntries(session, entries);
      return currentState.setIn(['sessions', sessionId], updatedSession);
    }

    case 'NEXT': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      const session = currentState.getIn(['sessions', sessionId]);
      if (session.get('status') === 'archived' || session.get('winner') || !session.get('entries')) {
        return currentState;
      }

      // Single ballot mode resolves ties through the tie ladder
      // (START_RUNOFF / TIE_PENDING / RESOLVE_TIE), never through NEXT.
      const votingMode = session.get('votingMode');
      const preVote = session.get('vote');
      const preTally = preVote && preVote.get('tally') ? preVote.get('tally') : null;
      const voted = preTally && !preTally.isEmpty();
      const prePair = preVote && preVote.get('pair') ? preVote.get('pair') : null;
      let updatedSession = next(session);
      if (votingMode === 'tournament') {
        // Tie detection reads the pair that was actually voted on (the pre NEXT
        // pair). Comparing the post NEXT pair instead made every decisive round
        // look tied, because the fresh pair starts at 0 equals 0.
        if (voted && prePair && List.isList(prePair) && prePair.size === 2) {
          const a = prePair.get(0);
          const b = prePair.get(1);
          const aVotes = preTally.get(a, 0);
          const bVotes = preTally.get(b, 0);
          if (aVotes === bVotes) {
            updatedSession = updatedSession.set('tieCount', (session.get('tieCount') || 0) + 1);
          }
        }
      }

      if (updatedSession.get('winner')) {
        updatedSession = updatedSession.set('status', 'completed')
          .set('tieCount', 0)
          .set('zeroVoteCount', 0)
          .remove('roundLifecycle')
          .remove('finalVote')
          .remove('revealTimer');
      } else {
        updatedSession = updatedSession.set('roundLifecycle', 'VOTING')
          .remove('finalVote')
          .remove('revealTimer');
        // A decisive voted win closes the ladder run for this matchup; the
        // counter must reset so the NEXT matchup starts its own fresh ladder
        // (a first tie owes a rematch, not an admin window).
        if (votingMode === 'tournament' && voted && updatedSession.get('tieCount') !== 0) {
          const prePairFinal = prePair;
          const decisive = prePairFinal && List.isList(prePairFinal) && prePairFinal.size === 2
            && preTally.get(prePairFinal.get(0), 0) !== preTally.get(prePairFinal.get(1), 0);
          if (decisive) {
            updatedSession = updatedSession.set('tieCount', 0)
              // Real votes were cast: the empty round run is over, so a future
              // empty round may start a fresh ladder run again.
              .set('zeroVoteCount', 0);
          }
        }
      }

      if (action.round) {
        const currentRounds = updatedSession.get('rounds') || List();
        const roundData = action.round;
        if (!currentRounds.some(r => r.get('roundIndex') === roundData.roundIndex)) {
          updatedSession = updatedSession.set('rounds', currentRounds.push(fromJS(roundData)));
        }
      }

      return currentState.setIn(['sessions', sessionId], updatedSession);
    }

    case 'VOTE': {
      const sessionId = action.sessionId || action.electionId;
      const { entry } = action;
      if (!sessionId || !entry || typeof entry !== 'string') {
        return currentState;
      }
      if (!currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      const session = currentState.getIn(['sessions', sessionId]);
      if (session.get('status') !== 'open') {
        return currentState;
      }
      // Feature 8: Reject votes in reducer if round is closed or revealing or tie pending
      const roundLifecycle = session.get('roundLifecycle');
      if (roundLifecycle === 'ROUND_CLOSED' || roundLifecycle === 'RESULTS_REVEALED' || roundLifecycle === 'TIE_PENDING') {
        return currentState;
      }
      const voteState = session.get('vote');
      if (!voteState || !Map.isMap(voteState)) {
        return currentState;
      }
      const candidates = voteState.get('candidates') || voteState.get('pair');
      if (!candidates || !List.isList(candidates) || !candidates.includes(entry)) {
        return currentState;
      }

      const votingMode = session.get('votingMode');
      const updatedVote = votingMode === 'single_ballot'
        ? voteBallot(voteState, entry)
        : vote(voteState, entry);
      return currentState.setIn(['sessions', sessionId, 'vote'], updatedVote);
    }

    case 'REPLAY_ZERO_VOTE': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) return currentState;
      let session = currentState.getIn(['sessions', sessionId]);
      const zeroVoteCount = (session.get('zeroVoteCount') || 0) + 1;
      let voteState = session.get('vote');
      if (voteState && Map.isMap(voteState)) {
        voteState = voteState.set('tally', Map());
      }
      session = session.set('zeroVoteCount', zeroVoteCount)
        .set('vote', voteState)
        .set('roundLifecycle', 'VOTING')
        .remove('finalVote')
        .remove('revealTimer')
        .remove('tiePending');
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'START_RUNOFF': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) return currentState;
      let session = currentState.getIn(['sessions', sessionId]);
      const tieCount = (session.get('tieCount') || 0) + 1;
      const tiedCandidates = action.tiedCandidates || action.candidates;
      // A tournament rematch started by an EMPTY round counts that empty round
      // in zeroVoteCount (the empty round persists across the ladder). The
      // round manager terminates the session as no_result when the FOLLOW UP
      // round is also empty, bounding dead sessions to one ladder run.
      const emptyTournamentRematch = action.emptyRound === true && session.get('votingMode') !== 'single_ballot';
      const nextZeroVoteCount = emptyTournamentRematch
        ? (session.get('zeroVoteCount') || 0) + 1
        : 0;
      let voteState = session.get('vote');
      if (session.get('votingMode') === 'single_ballot' && tiedCandidates) {
        voteState = deriveRunoff(voteState, tiedCandidates);
      } else if (voteState && Map.isMap(voteState)) {
        voteState = voteState.set('tally', Map());
      }
      session = session.set('tieCount', tieCount)
        .set('zeroVoteCount', nextZeroVoteCount)
        .set('vote', voteState)
        .set('roundLifecycle', 'VOTING')
        .remove('finalVote')
        .remove('revealTimer')
        .remove('tiePending');
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'SET_TIE_LADDER_COUNT': {
      // Server internal: the round manager bumps the consecutive tie counter
      // when a second tie enters the TIE_PENDING admin window. Never client
      // dispatchable (the ingress allowlist rejects it).
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || typeof action.tieCount !== 'number' || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      return currentState.setIn(['sessions', sessionId, 'tieCount'], action.tieCount);
    }

    case 'SET_TIE_PENDING': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) return currentState;
      let session = currentState.getIn(['sessions', sessionId]);
      session = session.set('roundLifecycle', 'TIE_PENDING')
        .set('tiePending', action.tiePending ? fromJS(action.tiePending) : null);
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'RESOLVE_TIE': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) return currentState;
      let session = currentState.getIn(['sessions', sessionId]);
      const { winner, choice, resolution, roundId } = action;
      if (session.get('votingMode') === 'single_ballot') {
        // Single ballot: the matchup IS the session, so resolution completes it.
        session = session.set('status', 'completed')
          .set('winner', winner)
          .remove('vote')
          .remove('roundLifecycle')
          .remove('finalVote')
          .remove('revealTimer')
          .remove('tiePending')
          .set('tieCount', 0)
          .set('zeroVoteCount', 0);
      } else {
        // Tournament: the matchup is one bracket match. Resolve it by keeping
        // the chosen winner first in the pair and eliminating the tied loser;
        // the remaining queue in `entries` is untouched. When the rematch round
        // closes, core.next regrows the bracket from the queue and the winner,
        // so the ladder ends the session with a decisive champion instead of
        // ending it on a tied matchup.
        const voteState = session.get('vote');
        const rawPair = voteState ? voteState.get('pair') : null;
        const pair = rawPair && List.isList(rawPair) ? rawPair : List();
        const loser = pair.find(c => c !== winner) || null;

        session = session.set('vote', Map({
          pair: List(loser ? [winner, loser] : [winner]),
          tally: Map()
        }));
        session = session.set('roundLifecycle', 'VOTING')
          .remove('finalVote')
          .remove('revealTimer')
          .remove('tiePending')
          .set('tieCount', 0)
          .set('zeroVoteCount', 0);
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[TieLadder] Tournament tie resolved by ${choice || 'resolution'}: "${winner}" advances, "${loser || 'none'}" eliminated (round ${roundId || 'current'})`);
        }
      }
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'TERMINATE_NO_RESULT': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) return currentState;
      let session = currentState.getIn(['sessions', sessionId]);
      session = session.set('status', 'completed')
        .set('winner', null)
        .remove('vote')
        .remove('roundLifecycle')
        .remove('finalVote')
        .remove('revealTimer')
        .remove('tiePending')
        .set('tieCount', 0)
        .set('zeroVoteCount', 0);
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'ARCHIVE_SESSION': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      let session = currentState.getIn(['sessions', sessionId]);
      session = session.set('status', 'archived');
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'REFRESH_JOIN_CODE': {
      const sessionId = action.sessionId || action.electionId;
      const joinCode = action.joinCode;
      if (!sessionId || !joinCode || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      return currentState.setIn(['sessions', sessionId, 'joinCode'], joinCode);
    }

    case 'SET_WHO_CAN_JOIN': {
      const sessionId = action.sessionId || action.electionId;
      const whoCanJoin = action.whoCanJoin;
      if (!sessionId || !whoCanJoin || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      const session = currentState.getIn(['sessions', sessionId]);
      if (session.get('status') !== 'pending' || session.get('type') !== 'secured') {
        return currentState;
      }
      if (whoCanJoin !== 'allowlist' && whoCanJoin !== 'approval') {
        return currentState;
      }
      return currentState.setIn(['sessions', sessionId, 'whoCanJoin'], whoCanJoin);
    }

    case 'APPEND_ROUND_RESULT': {
      const sessionId = action.sessionId || action.electionId;
      const roundData = action.round || action.roundSnapshot;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId]) || !roundData) {
        return currentState;
      }
      const session = currentState.getIn(['sessions', sessionId]);
      const currentRounds = session.get('rounds') || List();
      const roundIndex = roundData.roundIndex;

      // Idempotency: skip if already appended
      if (currentRounds.some(r => r.get('roundIndex') === roundIndex)) {
        return currentState;
      }

      const roundSnapshot = fromJS(roundData);
      const updatedRounds = currentRounds.push(roundSnapshot);
      return currentState.setIn(['sessions', sessionId, 'rounds'], updatedRounds);
    }

    case 'CORRECT_ROUND_RESULT': {
      // Server internal only (see AGENTS.md: server is authoritative).
      // Replaces the provisional advanced field of an already appended
      // round snapshot once NEXT has actually run. Snapshots stay frozen
      // in every other field; only the advanced list is corrected.
      const sessionId = action.sessionId || action.electionId;
      const roundData = action.round;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId]) || !roundData) {
        return currentState;
      }
      const session = currentState.getIn(['sessions', sessionId]);
      const currentRounds = session.get('rounds') || List();
      const idx = currentRounds.findIndex(r => r.get('roundIndex') === action.roundIndex);
      if (idx === -1) {
        // Snapshot not appended yet (defensive): treat as an append.
        return currentState.setIn(
          ['sessions', sessionId, 'rounds'],
          currentRounds.push(fromJS(roundData))
        );
      }
      const existing = currentRounds.get(idx);
      const corrected = existing.set('advanced', roundData.advanced === undefined ? null : fromJS(roundData.advanced));
      return currentState.setIn(['sessions', sessionId, 'rounds'], currentRounds.set(idx, corrected));
    }

    case 'RECORD_PRESENCE_CONNECT': {
      const sessionId = action.sessionId || action.electionId;
      const { voterToken, socketId, timestamp } = action;
      if (!sessionId || !voterToken || !socketId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      let session = currentState.getIn(['sessions', sessionId]);
      let presence = session.get('presence') || Map();
      let voterRecord = presence.get(voterToken) || Map({
        socketIds: Set(),
        lastSeenAt: timestamp || Date.now(),
        disconnectedAt: null,
        connected: false
      });

      const currentSocketIds = voterRecord.get('socketIds') || Set();
      const nextSocketIds = Set.isSet(currentSocketIds)
        ? currentSocketIds.add(socketId)
        : Set([socketId]);

      voterRecord = voterRecord
        .set('socketIds', nextSocketIds)
        .set('connected', true)
        .set('lastSeenAt', timestamp || Date.now())
        .set('disconnectedAt', null);

      session = session.set('presence', presence.set(voterToken, voterRecord));
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'RECORD_PRESENCE_DISCONNECT': {
      const sessionId = action.sessionId || action.electionId;
      const { voterToken, socketId, timestamp } = action;
      if (!sessionId || !voterToken || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      let session = currentState.getIn(['sessions', sessionId]);
      let presence = session.get('presence') || Map();
      if (!presence.has(voterToken)) {
        return currentState;
      }
      let voterRecord = presence.get(voterToken);
      const currentSocketIds = voterRecord.get('socketIds') || Set();
      const nextSocketIds = Set.isSet(currentSocketIds)
        ? currentSocketIds.remove(socketId)
        : Set();

      if (nextSocketIds.isEmpty()) {
        voterRecord = voterRecord
          .set('socketIds', nextSocketIds)
          .set('connected', false)
          .set('disconnectedAt', timestamp !== undefined ? timestamp : Date.now());
      } else {
        voterRecord = voterRecord
          .set('socketIds', nextSocketIds)
          .set('connected', true)
          .set('disconnectedAt', null);
      }

      session = session.set('presence', presence.set(voterToken, voterRecord));
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'SNAPSHOT_ROUND_ELIGIBILITY': {
      const sessionId = action.sessionId || action.electionId;
      const { roundId, timestamp } = action;
      if (!sessionId || !roundId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      let session = currentState.getIn(['sessions', sessionId]);
      let snapshots = session.get('snapshots') || Map();

      // Idempotent: a snapshot already frozen for the roundId is never replaced (AC-9)
      if (snapshots.has(roundId)) {
        return currentState;
      }

      const presence = session.get('presence') || Map();
      const eligibleTokens = presence
        .filter(v => v.get('connected') === true)
        .keySeq()
        .toSet();

      const snapshotData = Map({
        roundId,
        createdAt: timestamp || Date.now(),
        eligibleVoterKeys: eligibleTokens,
        snapshotCount: eligibleTokens.size
      });

      session = session.set('snapshots', snapshots.set(roundId, snapshotData));
      return currentState.setIn(['sessions', sessionId], session);
    }

    case 'PURGE_SESSION_PRESENCE': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      let session = currentState.getIn(['sessions', sessionId]);
      session = session.remove('presence').remove('snapshots');
      return currentState.setIn(['sessions', sessionId], session);
    }

    default:
      return currentState;
  }
}