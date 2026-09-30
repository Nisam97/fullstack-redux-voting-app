import { expect } from 'chai';
import makeStore from '../src/store.js';
import { TimerManager } from '../src/timer.js';
import roundManager, { ROUND_LIFECYCLE } from '../src/roundManager.js';

describe('Regression: admin NEXT during the reveal window must advance exactly once', () => {
  let store;
  let tm;
  let nextCount;
  let origDispatch;

  beforeEach(() => {
    roundManager.resetRounds();
    tm = new TimerManager();
    store = makeStore();
    nextCount = 0;
    origDispatch = store.dispatch;
    store.dispatch = (action) => {
      if (action.type === 'NEXT' && action.sessionId === 'sess_reveal_next') {
        nextCount++;
      }
      return origDispatch(action);
    };

    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_reveal_next',
      title: 'Reveal Next',
      entries: ['A', 'B', 'C']
    });
    store.dispatch({ type: 'START_SESSION', sessionId: 'sess_reveal_next' });
  });

  afterEach(() => {
    tm.clearAllTimers();
    roundManager.resetRounds();
  });

  it('admin NEXT during RESULTS_REVEALED does not cause a second advance when reveal expires', (done) => {
    const round = roundManager.getCurrentRound('sess_reveal_next', store);
    const closed = roundManager.closeRoundOnce({
      sessionId: 'sess_reveal_next',
      roundId: round.roundId,
      store,
      timerManager: tm,
      revealDuration: 1
    });
    expect(closed.revealing).to.be.true;
    expect(store.getState().getIn(['sessions', 'sess_reveal_next', 'roundLifecycle']))
      .to.equal(ROUND_LIFECYCLE.RESULTS_REVEALED);

    // Admin advances during the reveal window (socket ingress forwards this as-is)
    store.dispatch({ type: 'NEXT', sessionId: 'sess_reveal_next' });

    const afterNext = store.getState().getIn(['sessions', 'sess_reveal_next']);
    expect(afterNext.get('roundLifecycle')).to.equal(ROUND_LIFECYCLE.VOTING);

    // When the reveal timer fires, the stale round must not advance again
    setTimeout(() => {
      expect(nextCount).to.equal(1);
      done();
    }, 1500);
  });

  it('reveal expiry alone advances exactly once (control)', (done) => {
    const round = roundManager.getCurrentRound('sess_reveal_next', store);
    // Decisive vote first: an empty round is a 0:0 tie and travels the tie
    // ladder (rematch) instead of advancing the bracket on reveal expiry.
    store.dispatch({ type: 'VOTE', sessionId: 'sess_reveal_next', entry: 'A' });
    roundManager.closeRoundOnce({
      sessionId: 'sess_reveal_next',
      roundId: round.roundId,
      store,
      timerManager: tm,
      revealDuration: 1
    });

    setTimeout(() => {
      expect(nextCount).to.equal(1);
      done();
    }, 1500);
  });
});
