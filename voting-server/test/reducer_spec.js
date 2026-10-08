import {Map, fromJS} from 'immutable';
import {expect} from 'chai';

import reducer, {INITIAL_STATE} from '../src/reducer';

describe('reducer', () => {

  it('handles SET_ENTRIES', () => {
    const initialState = fromJS({
      sessions: {
        sess_1: {
          id: 'sess_1',
          title: 'Movies',
          status: 'pending',
          entries: []
        }
      }
    });
    const action = {type: 'SET_ENTRIES', sessionId: 'sess_1', entries: ['Trainspotting']};
    const nextState = reducer(initialState, action);

    expect(nextState.getIn(['sessions', 'sess_1', 'entries'])).to.equal(fromJS(['Trainspotting']));
  });

  it('handles NEXT', () => {
    const initialState = fromJS({
      sessions: {
        sess_1: {
          id: 'sess_1',
          status: 'open',
          entries: ['Trainspotting', '28 Days Later']
        }
      }
    });
    const action = {type: 'NEXT', sessionId: 'sess_1'};
    const nextState = reducer(initialState, action);

    expect(nextState.getIn(['sessions', 'sess_1', 'vote'])).to.equal(fromJS({
      pair: ['Trainspotting', '28 Days Later']
    }));
    expect(nextState.getIn(['sessions', 'sess_1', 'entries'])).to.equal(fromJS([]));
  });

  // Spec 0008 AC-3: the admin publish switch on the live store session.
  describe('SET_PUBLISH_RESULTS (AC-3)', () => {
    const storeWithSession = (overrides = {}) => fromJS({
      sessions: {
        sess_secured: {
          id: 'sess_secured',
          title: 'Board picks',
          status: 'completed',
          type: 'secured',
          entries: [],
          ...overrides
        }
      }
    });

    it('writes publishResultsPublicly true onto the live session', () => {
      const nextState = reducer(
        storeWithSession(),
        { type: 'SET_PUBLISH_RESULTS', sessionId: 'sess_secured', publishResultsPublicly: true }
      );

      expect(nextState.getIn(['sessions', 'sess_secured', 'publishResultsPublicly'])).to.equal(true);
    });

    it('writes it back to false, so unpublishing is the same action', () => {
      const nextState = reducer(
        storeWithSession({ publishResultsPublicly: true }),
        { type: 'SET_PUBLISH_RESULTS', sessionId: 'sess_secured', publishResultsPublicly: false }
      );

      expect(nextState.getIn(['sessions', 'sess_secured', 'publishResultsPublicly'])).to.equal(false);
    });

    it('accepts an archived session, because archiving must not strand a result', () => {
      const nextState = reducer(
        storeWithSession({ status: 'archived' }),
        { type: 'SET_PUBLISH_RESULTS', sessionId: 'sess_secured', publishResultsPublicly: true }
      );

      expect(nextState.getIn(['sessions', 'sess_secured', 'publishResultsPublicly'])).to.equal(true);
    });

    it('accepts electionId as the session id alias', () => {
      const nextState = reducer(
        storeWithSession(),
        { type: 'SET_PUBLISH_RESULTS', electionId: 'sess_secured', publishResultsPublicly: true }
      );

      expect(nextState.getIn(['sessions', 'sess_secured', 'publishResultsPublicly'])).to.equal(true);
    });

    it('leaves the state untouched when the flag is not a boolean', () => {
      const initialState = storeWithSession();

      for (const flag of ['true', 1, 0, null, undefined]) {
        const nextState = reducer(
          initialState,
          { type: 'SET_PUBLISH_RESULTS', sessionId: 'sess_secured', publishResultsPublicly: flag }
        );
        expect(nextState.getIn(['sessions', 'sess_secured', 'publishResultsPublicly'])).to.be.undefined;
      }
    });

    it('leaves the state untouched when the session id is missing or not a string', () => {
      const initialState = storeWithSession();

      const noId = reducer(initialState, { type: 'SET_PUBLISH_RESULTS', publishResultsPublicly: true });
      const numericId = reducer(initialState, {
        type: 'SET_PUBLISH_RESULTS', sessionId: 42, publishResultsPublicly: true
      });

      expect(noId).to.equal(initialState);
      expect(numericId).to.equal(initialState);
    });

    it('leaves the state untouched for a session that is not in the store', () => {
      const initialState = storeWithSession();

      const nextState = reducer(initialState, {
        type: 'SET_PUBLISH_RESULTS', sessionId: 'sess_missing', publishResultsPublicly: true
      });

      expect(nextState).to.equal(initialState);
    });

    it('never mutates the state it was given', () => {
      const initialState = storeWithSession();

      reducer(initialState, { type: 'SET_PUBLISH_RESULTS', sessionId: 'sess_secured', publishResultsPublicly: true });

      expect(initialState.getIn(['sessions', 'sess_secured', 'publishResultsPublicly'])).to.be.undefined;
    });
  });

  it('handles VOTE', () => {
    const initialState = fromJS({
      sessions: {
        sess_1: {
          id: 'sess_1',
          status: 'open',
          vote: {
            pair: ['Trainspotting', '28 Days Later']
          },
          entries: []
        }
      }
    });
    const action = {type: 'VOTE', sessionId: 'sess_1', entry: 'Trainspotting'};
    const nextState = reducer(initialState, action);

    expect(nextState.getIn(['sessions', 'sess_1', 'vote'])).to.equal(fromJS({
      pair: ['Trainspotting', '28 Days Later'],
      tally: {Trainspotting: 1}
    }));
    expect(nextState.getIn(['sessions', 'sess_1', 'entries'])).to.equal(fromJS([]));
  });

  it('has an initial state', () => {
    const action = {
      type: 'CREATE_SESSION',
      sessionId: 'sess_1',
      title: 'Movies',
      entries: ['Trainspotting']
    };
    const nextState = reducer(undefined, action);

    expect(nextState.getIn(['sessions', 'sess_1', 'id'])).to.equal('sess_1');
    expect(nextState.getIn(['sessions', 'sess_1', 'title'])).to.equal('Movies');
    expect(nextState.getIn(['sessions', 'sess_1', 'status'])).to.equal('pending');
    expect(nextState.getIn(['sessions', 'sess_1', 'entries'])).to.equal(fromJS(['Trainspotting']));
  });

  it('can be used with reduce', () => {
    const actions = [
      {type: 'CREATE_SESSION', sessionId: 'sess_1', title: 'Movies', entries: ['Trainspotting', '28 Days Later']},
      {type: 'START_SESSION', sessionId: 'sess_1'},
      {type: 'VOTE', sessionId: 'sess_1', entry: 'Trainspotting'},
      {type: 'VOTE', sessionId: 'sess_1', entry: '28 Days Later'},
      {type: 'VOTE', sessionId: 'sess_1', entry: 'Trainspotting'},
      {type: 'NEXT', sessionId: 'sess_1'}
    ];

    const finalState = actions.reduce(reducer, Map());

    expect(finalState.getIn(['sessions', 'sess_1', 'status'])).to.equal('completed');
    expect(finalState.getIn(['sessions', 'sess_1', 'winner'])).to.equal('Trainspotting');
  });

  it('can be used with reduce across multiple concurrent sessions', () => {
    const actions = [
      {type: 'CREATE_SESSION', sessionId: 'sess_movies', title: 'Movies', entries: ['Trainspotting', '28 Days Later']},
      {type: 'CREATE_SESSION', sessionId: 'sess_music', title: 'Music', entries: ['Rock', 'Jazz']},
      {type: 'START_SESSION', sessionId: 'sess_movies'},
      {type: 'START_SESSION', sessionId: 'sess_music'},
      {type: 'VOTE', sessionId: 'sess_movies', entry: 'Trainspotting'},
      {type: 'VOTE', sessionId: 'sess_music', entry: 'Jazz'},
      {type: 'NEXT', sessionId: 'sess_movies'}
    ];

    const finalState = actions.reduce(reducer, Map());

    expect(finalState.getIn(['sessions', 'sess_movies', 'winner'])).to.equal('Trainspotting');
    expect(finalState.getIn(['sessions', 'sess_movies', 'status'])).to.equal('completed');

    expect(finalState.getIn(['sessions', 'sess_music', 'status'])).to.equal('open');
    expect(finalState.getIn(['sessions', 'sess_music', 'vote', 'tally', 'Jazz'])).to.equal(1);
    expect(finalState.getIn(['sessions', 'sess_music', 'winner'])).to.be.null;
  });

});