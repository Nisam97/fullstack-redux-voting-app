import { Map, List, fromJS } from 'immutable';
import { setEntries, next, vote } from './core';

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

      const newSession = Map({
        id: sessionId,
        title: typeof title === 'string' ? title : '',
        status: 'pending',
        entries: List.isList(entries) ? entries : List(entries || []),
        vote: null,
        winner: null,
        timerDuration,
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

      const activePair = session.getIn(['vote', 'pair']);
      const hasActiveVote = activePair && List.isList(activePair) && !activePair.isEmpty();

      let updatedSession;
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

      return currentState.setIn(['sessions', sessionId], updatedSession);
    }

    case 'SET_ROUND_LIFECYCLE': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      const { lifecycle, roundId, roundIndex, finalVote, revealTimer } = action;
      let session = currentState.getIn(['sessions', sessionId]);
      if (lifecycle) {
        session = session.set('roundLifecycle', lifecycle);
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

      let updatedSession = next(session);
      if (updatedSession.get('winner')) {
        updatedSession = updatedSession.set('status', 'completed')
          .remove('roundLifecycle')
          .remove('finalVote')
          .remove('revealTimer');
      } else {
        updatedSession = updatedSession.set('roundLifecycle', 'VOTING')
          .remove('finalVote')
          .remove('revealTimer');
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
      // Feature 8: Reject votes in reducer if round is closed or revealing
      const roundLifecycle = session.get('roundLifecycle');
      if (roundLifecycle === 'ROUND_CLOSED' || roundLifecycle === 'RESULTS_REVEALED') {
        return currentState;
      }
      const voteState = session.get('vote');
      if (!voteState || !Map.isMap(voteState)) {
        return currentState;
      }
      const pair = voteState.get('pair');
      if (!pair || !List.isList(pair) || !pair.includes(entry)) {
        return currentState;
      }

      const updatedVote = vote(voteState, entry);
      return currentState.setIn(['sessions', sessionId, 'vote'], updatedVote);
    }

    case 'ARCHIVE_SESSION': {
      const sessionId = action.sessionId || action.electionId;
      if (!sessionId || !currentState.hasIn(['sessions', sessionId])) {
        return currentState;
      }
      return currentState.setIn(['sessions', sessionId, 'status'], 'archived');
    }

    default:
      return currentState;
  }
}