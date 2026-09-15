import { fromJS } from 'immutable';
import { expect } from 'chai';

import makeStore from '../src/store';

describe('store', () => {

  it('is a Redux store configured with the correct reducer', () => {
    const store = makeStore();

    expect(store.getState()).to.equal(fromJS({
      sessions: {}
    }));

    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_1',
      title: 'Movies',
      entries: ['Trainspotting', '28 Days Later']
    });

    expect(store.getState().getIn(['sessions', 'sess_1', 'id'])).to.equal('sess_1');
    expect(store.getState().getIn(['sessions', 'sess_1', 'title'])).to.equal('Movies');
    expect(store.getState().getIn(['sessions', 'sess_1', 'status'])).to.equal('pending');
    expect(store.getState().getIn(['sessions', 'sess_1', 'entries'])).to.equal(fromJS([
      'Trainspotting', '28 Days Later'
    ]));
  });

});