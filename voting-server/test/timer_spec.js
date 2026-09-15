import { expect } from 'chai';
import { fromJS, Map, List } from 'immutable';
import {
  TimerManager,
  resolveDuration,
  DEFAULT_TIMER_DURATION,
  MIN_TIMER_DURATION,
  MAX_TIMER_DURATION
} from '../src/timer';

describe('Timer Domain — TimerManager', () => {
  let timerManager;

  beforeEach(() => {
    timerManager = new TimerManager();
  });

  afterEach(() => {
    timerManager.clearAllTimers();
  });

  describe('Duration Resolution', () => {
    const originalEnv = process.env.VOTE_TIMER_DURATION;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.VOTE_TIMER_DURATION = originalEnv;
      } else {
        delete process.env.VOTE_TIMER_DURATION;
      }
    });

    it('returns default duration (30s) when no override or env var is present', () => {
      delete process.env.VOTE_TIMER_DURATION;
      expect(resolveDuration()).to.equal(30);
      expect(resolveDuration(null)).to.equal(30);
      expect(resolveDuration('invalid')).to.equal(30);
    });

    it('uses valid override duration within bounds', () => {
      expect(resolveDuration(15)).to.equal(15);
      expect(resolveDuration(5)).to.equal(5);
      expect(resolveDuration(300)).to.equal(300);
    });

    it('falls back to default when override is below MIN_TIMER_DURATION (5s)', () => {
      delete process.env.VOTE_TIMER_DURATION;
      expect(resolveDuration(4)).to.equal(DEFAULT_TIMER_DURATION);
      expect(resolveDuration(0)).to.equal(DEFAULT_TIMER_DURATION);
      expect(resolveDuration(-10)).to.equal(DEFAULT_TIMER_DURATION);
    });

    it('falls back to default when override exceeds MAX_TIMER_DURATION (300s)', () => {
      delete process.env.VOTE_TIMER_DURATION;
      expect(resolveDuration(301)).to.equal(DEFAULT_TIMER_DURATION);
      expect(resolveDuration(1000)).to.equal(DEFAULT_TIMER_DURATION);
    });

    it('uses VOTE_TIMER_DURATION environment variable when valid and no override given', () => {
      process.env.VOTE_TIMER_DURATION = '45';
      expect(resolveDuration()).to.equal(45);
    });

    it('prefers valid override over VOTE_TIMER_DURATION environment variable', () => {
      process.env.VOTE_TIMER_DURATION = '45';
      expect(resolveDuration(20)).to.equal(20);
    });

    it('falls back to VOTE_TIMER_DURATION when override is invalid', () => {
      process.env.VOTE_TIMER_DURATION = '45';
      expect(resolveDuration(1)).to.equal(45);
    });
  });

  describe('startTimer', () => {
    it('creates a timer entry with correct fields and running status', () => {
      const before = Date.now();
      const entry = timerManager.startTimer('sess_1', 30);
      const after = Date.now();

      expect(entry).to.be.ok;
      expect(entry.sessionId).to.equal('sess_1');
      expect(entry.duration).to.equal(30);
      expect(entry.status).to.equal('running');
      expect(entry.startedAt).to.be.at.least(before);
      expect(entry.startedAt).to.be.at.most(after);
      expect(entry.expiresAt).to.equal(entry.startedAt + 30000);
    });

    it('rejects invalid or empty sessionId without throwing', () => {
      expect(timerManager.startTimer(null)).to.be.null;
      expect(timerManager.startTimer('')).to.be.null;
      expect(timerManager.startTimer('   ')).to.be.null;
      expect(timerManager.startTimer(123)).to.be.null;
    });

    it('replaces existing timer for the same session and cancels previous timeout', (done) => {
      let firstFired = false;
      const mockStore = {
        dispatch: (action) => {
          if (action.type === 'NEXT') {
            firstFired = true;
          }
        }
      };

      // Start first timer with 50ms
      const initialEntry = timerManager.startTimer('sess_replace', 5);
      const initialTimeoutId = timerManager.activeTimers.get('sess_replace').timeoutId;

      // Start second timer for same session
      const secondEntry = timerManager.startTimer('sess_replace', 10);
      const secondTimeoutId = timerManager.activeTimers.get('sess_replace').timeoutId;

      expect(secondEntry.duration).to.equal(10);
      expect(secondTimeoutId).to.not.equal(initialTimeoutId);

      // Verify the replaced timer entry is stored
      expect(timerManager.getTimer('sess_replace').duration).to.equal(10);
      done();
    });

    it('emits timer_state to session room if socket.io is provided', () => {
      let emittedRoom = null;
      let emittedEvent = null;
      let emittedPayload = null;

      const mockIo = {
        to: (room) => {
          emittedRoom = room;
          return {
            emit: (event, payload) => {
              emittedEvent = event;
              emittedPayload = payload;
            }
          };
        }
      };

      timerManager.startTimer('sess_broadcast', 25, null, mockIo);

      expect(emittedRoom).to.equal('session:sess_broadcast');
      expect(emittedEvent).to.equal('timer_state');
      expect(emittedPayload).to.be.ok;
      expect(emittedPayload.sessionId).to.equal('sess_broadcast');
      expect(emittedPayload.duration).to.equal(25);
      expect(emittedPayload.status).to.equal('running');
      expect(emittedPayload.expiresAt).to.be.a('number');
    });
  });

  describe('getTimer and clearTimer', () => {
    it('returns null for an unknown or non-existent session', () => {
      expect(timerManager.getTimer('non_existent')).to.be.null;
      expect(timerManager.getTimer('')).to.be.null;
      expect(timerManager.getTimer(null)).to.be.null;
    });

    it('returns active timer state without exposing internal timeoutId', () => {
      timerManager.startTimer('sess_safe', 20);
      const timer = timerManager.getTimer('sess_safe');

      expect(timer).to.be.ok;
      expect(timer.sessionId).to.equal('sess_safe');
      expect(timer.duration).to.equal(20);
      expect(timer.status).to.equal('running');
      expect(timer.timeoutId).to.be.undefined;
    });

    it('clears active timer, cancels timeout, and removes from map', () => {
      timerManager.startTimer('sess_clear', 30);
      expect(timerManager.getTimer('sess_clear')).to.be.ok;

      const cleared = timerManager.clearTimer('sess_clear');
      expect(cleared).to.be.ok;
      expect(cleared.status).to.equal('stopped');
      expect(timerManager.getTimer('sess_clear')).to.be.null;
    });

    it('clearTimer returns null if session had no active timer', () => {
      expect(timerManager.clearTimer('no_timer')).to.be.null;
    });

    it('clearTimer emits null timer_state if socket.io is provided', () => {
      let emittedPayload = null;
      const mockIo = {
        to: () => ({
          emit: (event, payload) => {
            emittedPayload = payload;
          }
        })
      };

      timerManager.startTimer('sess_clear_io', 30);
      timerManager.clearTimer('sess_clear_io', mockIo);

      expect(emittedPayload).to.deep.equal({
        sessionId: 'sess_clear_io',
        duration: null,
        expiresAt: null,
        status: null
      });
    });

    it('clearAllTimers clears all active timers across all sessions', () => {
      timerManager.startTimer('sess_1', 30);
      timerManager.startTimer('sess_2', 30);
      timerManager.startTimer('sess_3', 30);

      expect(timerManager.activeTimers.size).to.equal(3);

      timerManager.clearAllTimers();

      expect(timerManager.activeTimers.size).to.equal(0);
      expect(timerManager.getTimer('sess_1')).to.be.null;
      expect(timerManager.getTimer('sess_2')).to.be.null;
      expect(timerManager.getTimer('sess_3')).to.be.null;
    });
  });

  describe('Timer Expiry & Dispatch', () => {
    it('dispatches NEXT with sessionId to Redux store on timer expiry', (done) => {
      const dispatchedActions = [];
      const mockStore = {
        dispatch: (action) => {
          dispatchedActions.push(action);
        }
      };

      // Start timer with short duration and trigger expiry manually
      timerManager.startTimer('sess_expire', 30, mockStore);
      expect(timerManager.getTimer('sess_expire')).to.be.ok;

      // Simulate expiry
      timerManager.handleExpiry('sess_expire', mockStore);

      expect(dispatchedActions).to.deep.equal([
        { type: 'NEXT', sessionId: 'sess_expire' }
      ]);
      expect(timerManager.getTimer('sess_expire')).to.be.null;
      done();
    });

    it('handleExpiry is safe if session timer was already cleared', () => {
      const dispatchedActions = [];
      const mockStore = {
        dispatch: (action) => dispatchedActions.push(action)
      };

      timerManager.handleExpiry('sess_unknown', mockStore);
      expect(dispatchedActions).to.have.lengthOf(0);
    });
  });

  describe('Multi-Session Isolation', () => {
    it('tracks multiple session timers completely independently', () => {
      timerManager.startTimer('sess_alpha', 10);
      timerManager.startTimer('sess_beta', 45);

      const alpha = timerManager.getTimer('sess_alpha');
      const beta = timerManager.getTimer('sess_beta');

      expect(alpha.duration).to.equal(10);
      expect(beta.duration).to.equal(45);

      timerManager.clearTimer('sess_alpha');

      expect(timerManager.getTimer('sess_alpha')).to.be.null;
      expect(timerManager.getTimer('sess_beta')).to.be.ok;
      expect(timerManager.getTimer('sess_beta').duration).to.equal(45);
    });
  });

  describe('onStateChange Store Subscriber Integration', () => {
    it('starts timer when a session transitions to open with an active pair', () => {
      const prevState = fromJS({
        sessions: {
          sess_test: {
            id: 'sess_test',
            status: 'pending',
            entries: ['A', 'B', 'C'],
            vote: null
          }
        }
      });

      const currentState = fromJS({
        sessions: {
          sess_test: {
            id: 'sess_test',
            status: 'open',
            entries: ['C'],
            vote: { pair: ['A', 'B'] },
            timerDuration: 25
          }
        }
      });

      timerManager.onStateChange(prevState, currentState);

      const timer = timerManager.getTimer('sess_test');
      expect(timer).to.be.ok;
      expect(timer.sessionId).to.equal('sess_test');
      expect(timer.duration).to.equal(25);
      expect(timer.status).to.equal('running');
    });

    it('clears timer when session transitions to completed with a winner', () => {
      timerManager.startTimer('sess_test', 30);
      expect(timerManager.getTimer('sess_test')).to.be.ok;

      const prevState = fromJS({
        sessions: {
          sess_test: {
            id: 'sess_test',
            status: 'open',
            vote: { pair: ['A', 'B'] }
          }
        }
      });

      const currentState = fromJS({
        sessions: {
          sess_test: {
            id: 'sess_test',
            status: 'completed',
            winner: 'A',
            vote: null
          }
        }
      });

      timerManager.onStateChange(prevState, currentState);
      expect(timerManager.getTimer('sess_test')).to.be.null;
    });

    it('clears timer when session transitions to archived', () => {
      timerManager.startTimer('sess_test', 30);
      expect(timerManager.getTimer('sess_test')).to.be.ok;

      const prevState = fromJS({
        sessions: {
          sess_test: {
            id: 'sess_test',
            status: 'open',
            vote: { pair: ['A', 'B'] }
          }
        }
      });

      const currentState = fromJS({
        sessions: {
          sess_test: {
            id: 'sess_test',
            status: 'archived',
            vote: { pair: ['A', 'B'] }
          }
        }
      });

      timerManager.onStateChange(prevState, currentState);
      expect(timerManager.getTimer('sess_test')).to.be.null;
    });

    it('restarts timer when pair changes during tournament progression', () => {
      const prevState = fromJS({
        sessions: {
          sess_test: {
            id: 'sess_test',
            status: 'open',
            vote: { pair: ['A', 'B'] }
          }
        }
      });

      timerManager.startTimer('sess_test', 30);
      const originalTimer = timerManager.getTimer('sess_test');

      const currentState = fromJS({
        sessions: {
          sess_test: {
            id: 'sess_test',
            status: 'open',
            vote: { pair: ['C', 'A'] }
          }
        }
      });

      timerManager.onStateChange(prevState, currentState);

      const newTimer = timerManager.getTimer('sess_test');
      expect(newTimer).to.be.ok;
      expect(newTimer.sessionId).to.equal('sess_test');
    });

    it('does not start timer for pending sessions without active pair', () => {
      const state = fromJS({
        sessions: {
          sess_pending: {
            id: 'sess_pending',
            status: 'pending',
            entries: ['A', 'B'],
            vote: null
          }
        }
      });

      timerManager.onStateChange(null, state);
      expect(timerManager.getTimer('sess_pending')).to.be.null;
    });

    it('clears timer if session is removed from registry', () => {
      timerManager.startTimer('sess_removed', 30);

      const prevState = fromJS({
        sessions: {
          sess_removed: {
            id: 'sess_removed',
            status: 'open',
            vote: { pair: ['A', 'B'] }
          }
        }
      });

      const currentState = fromJS({
        sessions: {}
      });

      timerManager.onStateChange(prevState, currentState);
      expect(timerManager.getTimer('sess_removed')).to.be.null;
    });
  });
});
