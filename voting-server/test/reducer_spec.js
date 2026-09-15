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