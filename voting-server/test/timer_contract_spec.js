import { expect } from 'chai';
import { fromJS } from 'immutable';
import reducer, { INITIAL_STATE } from '../src/reducer';
import { getSessionsSummary } from '../src/server';
import { TimerManager } from '../src/timer';

describe('Stage F-B — Backend Timer Contract Extension', () => {

  describe('CREATE_SESSION — timerDuration validation & persistence', () => {
    it('1. timerDuration: 5 is stored', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_5',
        title: '5s Round',
        entries: ['A', 'B'],
        timerDuration: 5
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_5']);
      expect(session.get('timerDuration')).to.equal(5);
    });

    it('2. timerDuration: 30 is stored', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_30',
        title: '30s Round',
        entries: ['A', 'B'],
        timerDuration: 30
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_30']);
      expect(session.get('timerDuration')).to.equal(30);
    });

    it('3. timerDuration: 300 is stored', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_300',
        title: '300s Round',
        entries: ['A', 'B'],
        timerDuration: 300
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_300']);
      expect(session.get('timerDuration')).to.equal(300);
    });

    it('4. omitted duration defaults to 30', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_default',
        title: 'Default Round',
        entries: ['A', 'B']
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_default']);
      expect(session.get('timerDuration')).to.equal(30);
    });

    it('5. invalid low value (< 5) defaults to 30', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_low',
        title: 'Low Round',
        entries: ['A', 'B'],
        timerDuration: 4
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_low']);
      expect(session.get('timerDuration')).to.equal(30);
    });

    it('6. invalid high value (> 300) defaults to 30', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_high',
        title: 'High Round',
        entries: ['A', 'B'],
        timerDuration: 301
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_high']);
      expect(session.get('timerDuration')).to.equal(30);
    });

    it('7. negative value defaults to 30', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_neg',
        title: 'Negative Round',
        entries: ['A', 'B'],
        timerDuration: -10
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_neg']);
      expect(session.get('timerDuration')).to.equal(30);
    });

    it('8. zero defaults to 30', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_zero',
        title: 'Zero Round',
        entries: ['A', 'B'],
        timerDuration: 0
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_zero']);
      expect(session.get('timerDuration')).to.equal(30);
    });

    it('9. decimal value defaults to 30', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_decimal',
        title: 'Decimal Round',
        entries: ['A', 'B'],
        timerDuration: 25.5
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_decimal']);
      expect(session.get('timerDuration')).to.equal(30);
    });

    it('10. NaN defaults to 30', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_nan',
        title: 'NaN Round',
        entries: ['A', 'B'],
        timerDuration: NaN
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_nan']);
      expect(session.get('timerDuration')).to.equal(30);
    });

    it('11. string value such as "60" defaults to 30', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_str',
        title: 'String Round',
        entries: ['A', 'B'],
        timerDuration: '60'
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_str']);
      expect(session.get('timerDuration')).to.equal(30);
    });

    it('12. existing CREATE_SESSION behavior remains intact (title, status, entries, createdAt)', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_full',
        title: 'Full Session',
        entries: ['Trainspotting', '28 Days Later'],
        timerDuration: 45
      };
      const nextState = reducer(INITIAL_STATE, action);
      const session = nextState.getIn(['sessions', 'sess_full']);
      expect(session.get('id')).to.equal('sess_full');
      expect(session.get('title')).to.equal('Full Session');
      expect(session.get('status')).to.equal('pending');
      expect(session.get('entries').toJS()).to.deep.equal(['Trainspotting', '28 Days Later']);
      expect(session.get('vote')).to.equal(null);
      expect(session.get('winner')).to.equal(null);
      expect(session.get('createdAt')).to.be.a('string');
      expect(session.get('timerDuration')).to.equal(45);
    });

    it('13. multiple sessions retain independent timer durations', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_A',
        title: 'Session A',
        entries: ['A1', 'A2'],
        timerDuration: 20
      });
      state = reducer(state, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_B',
        title: 'Session B',
        entries: ['B1', 'B2'],
        timerDuration: 120
      });

      expect(state.getIn(['sessions', 'sess_A', 'timerDuration'])).to.equal(20);
      expect(state.getIn(['sessions', 'sess_B', 'timerDuration'])).to.equal(120);
    });
  });

  describe('Session Summary — getSessionsSummary()', () => {
    it('14. configured duration appears in getSessionsSummary()', () => {
      const state = fromJS({
        sessions: {
          sess_custom: {
            id: 'sess_custom',
            title: 'Custom Session',
            status: 'pending',
            entries: ['E1', 'E2'],
            timerDuration: 75
          }
        }
      });

      const summaries = getSessionsSummary(state);
      expect(summaries).to.be.an('array').with.lengthOf(1);
      expect(summaries[0].id).to.equal('sess_custom');
      expect(summaries[0].timerDuration).to.equal(75);
    });

    it('15. legacy/missing duration reports 30 in getSessionsSummary()', () => {
      const state = fromJS({
        sessions: {
          sess_legacy: {
            id: 'sess_legacy',
            title: 'Legacy Session',
            status: 'pending',
            entries: ['E1', 'E2']
            // timerDuration missing
          }
        }
      });

      const summaries = getSessionsSummary(state);
      expect(summaries).to.be.an('array').with.lengthOf(1);
      expect(summaries[0].id).to.equal('sess_legacy');
      expect(summaries[0].timerDuration).to.equal(30);
    });

    it('16. multiple sessions expose their own independent durations in getSessionsSummary()', () => {
      const state = fromJS({
        sessions: {
          sess_1: {
            id: 'sess_1',
            title: 'Session 1',
            status: 'open',
            entries: [],
            vote: { pair: ['A', 'B'] },
            timerDuration: 15
          },
          sess_2: {
            id: 'sess_2',
            title: 'Session 2',
            status: 'pending',
            entries: ['X', 'Y'],
            timerDuration: 90
          },
          sess_3: {
            id: 'sess_3',
            title: 'Session 3',
            status: 'pending',
            entries: ['M', 'N']
            // legacy
          }
        }
      });

      const summaries = getSessionsSummary(state);
      const s1 = summaries.find(s => s.id === 'sess_1');
      const s2 = summaries.find(s => s.id === 'sess_2');
      const s3 = summaries.find(s => s.id === 'sess_3');

      expect(s1.timerDuration).to.equal(15);
      expect(s2.timerDuration).to.equal(90);
      expect(s3.timerDuration).to.equal(30);
    });
  });

  describe('Timer Integration — TimerManager uses session timerDuration', () => {
    let timerManager;

    beforeEach(() => {
      timerManager = new TimerManager();
    });

    afterEach(() => {
      timerManager.clearAllTimers();
    });

    it('17. starting a session configured for 60 seconds creates a timer using 60', () => {
      // 1. Create session with 60s
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_60',
        title: '60s Tournament',
        entries: ['Candidate A', 'Candidate B'],
        timerDuration: 60
      });
      expect(state.getIn(['sessions', 'sess_60', 'timerDuration'])).to.equal(60);

      // 2. Start session (transitions to open with pair)
      const prevState = state;
      const currState = reducer(state, {
        type: 'START_SESSION',
        sessionId: 'sess_60'
      });

      timerManager.onStateChange(prevState, currState);

      const timer = timerManager.getTimer('sess_60');
      expect(timer).to.be.ok;
      expect(timer.sessionId).to.equal('sess_60');
      expect(timer.duration).to.equal(60);
      expect(timer.status).to.equal('running');
    });

    it('18. another session configured for 10 seconds retains 10', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_10',
        title: '10s Tournament',
        entries: ['Candidate X', 'Candidate Y'],
        timerDuration: 10
      });

      const prevState = state;
      const currState = reducer(state, {
        type: 'START_SESSION',
        sessionId: 'sess_10'
      });

      timerManager.onStateChange(prevState, currState);

      const timer = timerManager.getTimer('sess_10');
      expect(timer).to.be.ok;
      expect(timer.duration).to.equal(10);
      expect(timer.status).to.equal('running');
    });

    it('19. timer duration does not leak between sessions', () => {
      // Create session A (15s) and session B (45s)
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_A',
        title: 'Session A',
        entries: ['A1', 'A2'],
        timerDuration: 15
      });
      state = reducer(state, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_B',
        title: 'Session B',
        entries: ['B1', 'B2'],
        timerDuration: 45
      });

      // Start both
      let currState = reducer(state, { type: 'START_SESSION', sessionId: 'sess_A' });
      currState = reducer(currState, { type: 'START_SESSION', sessionId: 'sess_B' });

      timerManager.onStateChange(state, currState);

      const timerA = timerManager.getTimer('sess_A');
      const timerB = timerManager.getTimer('sess_B');

      expect(timerA).to.be.ok;
      expect(timerB).to.be.ok;
      expect(timerA.duration).to.equal(15);
      expect(timerB.duration).to.equal(45);
    });
  });

});
