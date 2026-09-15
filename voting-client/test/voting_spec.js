import test from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  vote,
  next,
  setEntries,
  setSessions,
  setSessionState,
  setActiveSession,
  setStateAction,
  getSessionPairLockKey,
  selectSessionList,
  selectActiveSessionId,
  selectSessionById,
  selectActiveSession,
  selectEntries,
  selectVote,
  selectWinner,
  selectSessionStatus,
  selectHasLoaded,
  initialState,
  SESSION_STATE,
  VOTE,
  NEXT,
  SET_ENTRIES
} from '../src/redux/voteSlice.js';
import { createAppStore } from '../src/redux/store.js';
import socket, {
  connectSocketToStore,
  subscribeSession,
  unsubscribeSession,
  setSubscribedSession,
  getSubscribedSessions,
  clearSubscriptions
} from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

test('Stage F — Redux Multi-Session Architecture & State Isolation', async (t) => {
  await t.test('1. Initial State has normalized multi-session structure', () => {
    assert.deepStrictEqual(initialState.list, []);
    assert.strictEqual(initialState.activeSessionId, null);
    assert.deepStrictEqual(initialState.bySessionId, {});

    // Verify configured store initial shape
    const store = createAppStore(null);
    const rootState = store.getState();
    assert.ok(rootState.sessions);
    assert.deepStrictEqual(selectSessionList(rootState), []);
    assert.strictEqual(selectActiveSessionId(rootState), null);
    assert.strictEqual(selectActiveSession(rootState), null);
  });

  await t.test('2. Registry update (sessions) stores summaries without destroying bySessionId', () => {
    const summaryList = [
      { id: 'sess_default', title: 'Danny Boyle Film Tournament', status: 'open' },
      { id: 'sess_horror', title: 'Horror Classics', status: 'pending' }
    ];

    // Pre-populate a session with vote data in bySessionId
    const stateWithSession = {
      list: [],
      activeSessionId: 'sess_default',
      bySessionId: {
        sess_default: {
          id: 'sess_default',
          title: 'Danny Boyle Film Tournament',
          status: 'open',
          entries: ['Slumdog Millionaire'],
          vote: { pair: ['A', 'B'], tally: { A: 2 } },
          hasLoaded: true
        }
      }
    };

    const nextState = voteReducer(stateWithSession, setSessions(summaryList));
    assert.strictEqual(nextState.list.length, 2);
    assert.strictEqual(nextState.list[0].id, 'sess_default');
    assert.strictEqual(nextState.list[1].id, 'sess_horror');

    // Existing session vote and entries in bySessionId MUST NOT be wiped out
    assert.ok(nextState.bySessionId.sess_default);
    assert.deepStrictEqual(nextState.bySessionId.sess_default.vote, { pair: ['A', 'B'], tally: { A: 2 } });
    assert.deepStrictEqual(nextState.bySessionId.sess_default.entries, ['Slumdog Millionaire']);
  });

  await t.test('3. Session state updates store into bySessionId strictly by sessionId', () => {
    const sessionA = {
      id: 'sess_default',
      title: 'Danny Boyle Film Tournament',
      status: 'open',
      entries: ['Slumdog Millionaire'],
      vote: { pair: ['Trainspotting', '28 Days Later'], tally: { Trainspotting: 1 } }
    };

    const sessionB = {
      id: 'sess_horror',
      title: 'Horror Classics',
      status: 'open',
      entries: ['The Shining'],
      vote: { pair: ['Alien', 'Halloween'], tally: { Alien: 3 } }
    };

    let state = voteReducer(initialState, setSessionState(sessionA));
    state = voteReducer(state, setSessionState(sessionB));

    assert.ok(state.bySessionId.sess_default);
    assert.ok(state.bySessionId.sess_horror);
    assert.strictEqual(state.bySessionId.sess_default.vote.pair[0], 'Trainspotting');
    assert.strictEqual(state.bySessionId.sess_horror.vote.pair[0], 'Alien');
  });

  await t.test('4. Multi-Session Isolation: updating session A does not mutate session B', () => {
    const sessionA = {
      id: 'sess_default',
      title: 'Danny Boyle Film Tournament',
      status: 'open',
      entries: ['Sunshine'],
      vote: { pair: ['Trainspotting', '28 Days Later'], tally: { Trainspotting: 4 } }
    };

    const sessionB = {
      id: 'sess_horror',
      title: 'Horror Classics',
      status: 'open',
      entries: ['The Thing'],
      vote: { pair: ['Alien', 'Halloween'], tally: { Alien: 7 } }
    };

    let state = voteReducer(initialState, setSessionState(sessionA));
    state = voteReducer(state, setSessionState(sessionB));

    // Cast vote in session A
    const stateAfterVoteA = voteReducer(state, vote('sess_default', 'Trainspotting'));
    assert.strictEqual(stateAfterVoteA.bySessionId.sess_default.vote.tally.Trainspotting, 5);
    // Session B tally MUST remain exactly 7
    assert.strictEqual(stateAfterVoteA.bySessionId.sess_horror.vote.tally.Alien, 7);

    // Cast vote in session B
    const stateAfterVoteB = voteReducer(stateAfterVoteA, vote('sess_horror', 'Alien'));
    assert.strictEqual(stateAfterVoteB.bySessionId.sess_horror.vote.tally.Alien, 8);
    // Session A tally MUST remain exactly 5
    assert.strictEqual(stateAfterVoteB.bySessionId.sess_default.vote.tally.Trainspotting, 5);
  });

  await t.test('5. Active session selection and switching preserves both states', () => {
    let state = voteReducer(initialState, setSessionState({
      id: 'sess_default',
      vote: { pair: ['A', 'B'] }
    }));
    state = voteReducer(state, setSessionState({
      id: 'sess_horror',
      vote: { pair: ['X', 'Y'] }
    }));

    // Select session B as active
    state = voteReducer(state, setActiveSession('sess_horror'));
    assert.strictEqual(selectActiveSessionId(state), 'sess_horror');
    assert.strictEqual(selectActiveSession(state).id, 'sess_horror');
    assert.deepStrictEqual(selectVote(state).pair, ['X', 'Y']);

    // Switch back to session A
    state = voteReducer(state, setActiveSession('sess_default'));
    assert.strictEqual(selectActiveSessionId(state), 'sess_default');
    assert.strictEqual(selectActiveSession(state).id, 'sess_default');
    assert.deepStrictEqual(selectVote(state).pair, ['A', 'B']);

    // Both sessions in bySessionId are intact
    assert.ok(selectSessionById(state, 'sess_default'));
    assert.ok(selectSessionById(state, 'sess_horror'));
  });

  await t.test('6. Session actions VOTE, NEXT, SET_ENTRIES carry sessionId', () => {
    const voteAction = vote('sess_default', 'Trainspotting');
    assert.strictEqual(voteAction.type, VOTE);
    assert.strictEqual(voteAction.sessionId, 'sess_default');
    assert.strictEqual(voteAction.entry, 'Trainspotting');
    assert.strictEqual(voteAction.meta?.remote, true);

    const nextAction = next('sess_default');
    assert.strictEqual(nextAction.type, NEXT);
    assert.strictEqual(nextAction.sessionId, 'sess_default');
    assert.strictEqual(nextAction.meta?.remote, true);

    const entriesAction = setEntries('sess_default', ['A', 'B', 'C']);
    assert.strictEqual(entriesAction.type, SET_ENTRIES);
    assert.strictEqual(entriesAction.sessionId, 'sess_default');
    assert.deepStrictEqual(entriesAction.entries, ['A', 'B', 'C']);
    assert.strictEqual(entriesAction.meta?.remote, true);
  });

  await t.test('7. Reducer handles NEXT and SET_ENTRIES with explicit sessionId targeted isolation', () => {
    let state = voteReducer(initialState, setSessionState({
      id: 'sess_default',
      entries: ['Slumdog Millionaire', '127 Hours'],
      vote: { pair: ['Trainspotting', '28 Days Later'], tally: { Trainspotting: 5, '28 Days Later': 2 } }
    }));
    state = voteReducer(state, setSessionState({
      id: 'sess_horror',
      entries: ['Psycho'],
      vote: { pair: ['Alien', 'Halloween'], tally: { Alien: 1 } }
    }));

    // SET_ENTRIES on sess_default
    state = voteReducer(state, setEntries('sess_default', ['Shallow Grave', 'The Beach']));
    assert.deepStrictEqual(selectEntries(state, 'sess_default'), ['Shallow Grave', 'The Beach']);
    // sess_horror entries remain unchanged
    assert.deepStrictEqual(selectEntries(state, 'sess_horror'), ['Psycho']);

    // NEXT on sess_default
    state = voteReducer(state, next('sess_default'));
    assert.deepStrictEqual(selectVote(state, 'sess_default').pair, ['Shallow Grave', 'The Beach']);
    // sess_horror vote remains unchanged
    assert.deepStrictEqual(selectVote(state, 'sess_horror').pair, ['Alien', 'Halloween']);
  });

  await t.test('8. Safe handling of missing or malformed session payloads', () => {
    const stateBefore = { ...initialState };

    // Missing/empty sessionId
    const stateNoId = voteReducer(stateBefore, { type: SESSION_STATE, payload: { title: 'Untitled' } });
    assert.deepStrictEqual(stateNoId.bySessionId, {});

    // Malformed non-object payload
    const stateNull = voteReducer(stateBefore, { type: SESSION_STATE, payload: null });
    assert.deepStrictEqual(stateNull.bySessionId, {});

    // Unknown session action safe no-op
    const stateUnknownVote = voteReducer(stateBefore, vote('nonexistent_id', 'Candidate'));
    assert.deepStrictEqual(stateUnknownVote.bySessionId, {});

    // Invalid active session ID handled safely
    const stateInvalidActive = voteReducer(stateBefore, setActiveSession(12345));
    assert.strictEqual(stateInvalidActive.activeSessionId, null);
  });

  await t.test('9. Local Lock: getSessionPairLockKey produces independent session-scoped keys', () => {
    const pair = ['Trainspotting', '28 Days Later'];
    const lockKeyDefault = getSessionPairLockKey('sess_default', pair);
    const lockKeyHorror = getSessionPairLockKey('sess_horror', pair);

    assert.strictEqual(lockKeyDefault, 'sess_default:::Trainspotting:::28 Days Later');
    assert.strictEqual(lockKeyHorror, 'sess_horror:::Trainspotting:::28 Days Later');
    assert.notStrictEqual(lockKeyDefault, lockKeyHorror);

    // Missing params return null safely
    assert.strictEqual(getSessionPairLockKey(null, pair), null);
    assert.strictEqual(getSessionPairLockKey('sess_default', null), null);
    assert.strictEqual(getSessionPairLockKey('sess_default', []), null);
  });

  await t.test('10. Selectors accurately query active session, specific sessions, and lists', () => {
    let state = voteReducer(initialState, setSessions([
      { id: 'sess_default', title: 'Boyle', status: 'open' },
      { id: 'sess_horror', title: 'Horror', status: 'completed', winner: 'Alien' }
    ]));
    state = voteReducer(state, setSessionState({
      id: 'sess_default',
      title: 'Boyle',
      status: 'open',
      entries: ['127 Hours'],
      vote: { pair: ['A', 'B'] },
      winner: null
    }));
    state = voteReducer(state, setSessionState({
      id: 'sess_horror',
      title: 'Horror',
      status: 'completed',
      entries: [],
      vote: null,
      winner: 'Alien'
    }));
    state = voteReducer(state, setActiveSession('sess_default'));

    assert.strictEqual(selectSessionList(state).length, 2);
    assert.strictEqual(selectActiveSessionId(state), 'sess_default');
    assert.strictEqual(selectActiveSession(state).title, 'Boyle');

    // Query active session via default selector arguments
    assert.strictEqual(selectSessionStatus(state), 'open');
    assert.strictEqual(selectWinner(state), null);
    assert.deepStrictEqual(selectEntries(state), ['127 Hours']);
    assert.deepStrictEqual(selectVote(state).pair, ['A', 'B']);
    assert.strictEqual(selectHasLoaded(state), true);

    // Query specific session by explicit ID
    assert.strictEqual(selectSessionStatus(state, 'sess_horror'), 'completed');
    assert.strictEqual(selectWinner(state, 'sess_horror'), 'Alien');
    assert.strictEqual(selectVote(state, 'sess_horror'), null);
    assert.strictEqual(selectHasLoaded(state, 'sess_horror'), true);
  });

  await t.test('11. Remote action middleware emits VOTE, NEXT, SET_ENTRIES carrying sessionId', () => {
    const emittedEvents = [];
    const mockSocket = {
      emit: (event, data) => {
        emittedEvents.push({ event, data });
      },
      off: () => {},
      on: () => {}
    };

    const clientStore = createAppStore(mockSocket);
    clientStore.dispatch(vote('sess_default', 'Slumdog Millionaire'));
    clientStore.dispatch(next('sess_default'));
    clientStore.dispatch(setEntries('sess_default', ['A', 'B']));

    assert.strictEqual(emittedEvents.length, 3);
    assert.strictEqual(emittedEvents[0].data.type, VOTE);
    assert.strictEqual(emittedEvents[0].data.sessionId, 'sess_default');
    assert.strictEqual(emittedEvents[0].data.entry, 'Slumdog Millionaire');

    assert.strictEqual(emittedEvents[1].data.type, NEXT);
    assert.strictEqual(emittedEvents[1].data.sessionId, 'sess_default');

    assert.strictEqual(emittedEvents[2].data.type, SET_ENTRIES);
    assert.strictEqual(emittedEvents[2].data.sessionId, 'sess_default');
  });

  await t.test('12. Echo prevention: incoming registry and session_state are not re-emitted', () => {
    const emittedEvents = [];
    const mockSocket = {
      emit: (event, data) => {
        emittedEvents.push({ event, data });
      },
      off: () => {},
      on: () => {}
    };

    const clientStore = createAppStore(mockSocket);

    clientStore.dispatch(setSessions([{ id: 'sess_default', title: 'Test' }]));
    clientStore.dispatch(setSessionState({ id: 'sess_default', vote: { pair: ['A', 'B'] } }));
    clientStore.dispatch(setActiveSession('sess_default'));
    clientStore.dispatch(setStateAction({ id: 'sess_default', vote: { pair: ['A', 'B'] } }));

    // Zero remote action emissions must occur for sync actions
    assert.strictEqual(emittedEvents.length, 0);
  });
});

test('Stage G — Socket.io Multi-Session Integration Contract', async (t) => {
  // Helper to construct a mock socket client for testing events
  function createMockSocket() {
    const listeners = new Map();
    const emitted = [];

    return {
      listeners,
      emitted,
      on: (event, handler) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
      },
      off: (event) => {
        listeners.delete(event);
      },
      emit: (event, data) => {
        emitted.push({ event, data });
      },
      // Simulate server sending event to client
      simulateServerEmit: (event, payload) => {
        const handlers = listeners.get(event) || [];
        for (const handler of handlers) {
          handler(payload);
        }
      }
    };
  }

  t.beforeEach(() => {
    clearSubscriptions();
  });

  t.afterEach(() => {
    clearSubscriptions();
  });

  await t.test('1. connectSocketToStore registers listeners for sessions, session_state, state, connect', () => {
    const mockSocket = createMockSocket();
    const store = createAppStore(null);

    connectSocketToStore(store, mockSocket);

    assert.ok(mockSocket.listeners.has('sessions'));
    assert.ok(mockSocket.listeners.has('session_state'));
    assert.ok(mockSocket.listeners.has('state'));
    assert.ok(mockSocket.listeners.has('connect'));
  });

  await t.test('2. Server sessions event updates Redux session list without erasing bySessionId', () => {
    const mockSocket = createMockSocket();
    const store = createAppStore(mockSocket);

    // Seed a session with state
    store.dispatch(setSessionState({
      id: 'sess_default',
      vote: { pair: ['A', 'B'] }
    }));

    // Server broadcasts registry
    mockSocket.simulateServerEmit('sessions', [
      { id: 'sess_default', title: 'Default Session', status: 'open' },
      { id: 'sess_horror', title: 'Horror Tournament', status: 'pending' }
    ]);

    const state = store.getState();
    assert.strictEqual(selectSessionList(state).length, 2);
    assert.strictEqual(selectSessionList(state)[0].id, 'sess_default');
    assert.strictEqual(selectSessionList(state)[1].id, 'sess_horror');

    // Existing bySessionId data remains intact
    assert.ok(selectSessionById(state, 'sess_default'));
    assert.deepStrictEqual(selectSessionById(state, 'sess_default').vote.pair, ['A', 'B']);
  });

  await t.test('3. Server session_state event updates specific session in bySessionId', () => {
    const mockSocket = createMockSocket();
    const store = createAppStore(mockSocket);

    mockSocket.simulateServerEmit('session_state', {
      id: 'sess_default',
      title: 'Danny Boyle Film Tournament',
      status: 'open',
      entries: ['Slumdog Millionaire'],
      vote: {
        pair: ['Trainspotting', '28 Days Later'],
        tally: { Trainspotting: 3 }
      }
    });

    const state = store.getState();
    const session = selectSessionById(state, 'sess_default');
    assert.ok(session);
    assert.strictEqual(session.id, 'sess_default');
    assert.strictEqual(session.status, 'open');
    assert.deepStrictEqual(session.vote.pair, ['Trainspotting', '28 Days Later']);
    assert.strictEqual(session.vote.tally.Trainspotting, 3);
  });

  await t.test('4. subscribeSession emits subscribe_session and records active subscription', () => {
    const mockSocket = createMockSocket();

    subscribeSession('sess_default', mockSocket);

    assert.strictEqual(mockSocket.emitted.length, 1);
    assert.strictEqual(mockSocket.emitted[0].event, 'subscribe_session');
    assert.deepStrictEqual(mockSocket.emitted[0].data, { sessionId: 'sess_default' });
    assert.deepStrictEqual(getSubscribedSessions(), ['sess_default']);
  });

  await t.test('5. unsubscribeSession emits unsubscribe_session and removes subscription', () => {
    const mockSocket = createMockSocket();

    subscribeSession('sess_default', mockSocket);
    subscribeSession('sess_horror', mockSocket);
    assert.strictEqual(getSubscribedSessions().length, 2);

    unsubscribeSession('sess_default', mockSocket);

    const unsubEmits = mockSocket.emitted.filter(e => e.event === 'unsubscribe_session');
    assert.strictEqual(unsubEmits.length, 1);
    assert.deepStrictEqual(unsubEmits[0].data, { sessionId: 'sess_default' });
    assert.deepStrictEqual(getSubscribedSessions(), ['sess_horror']);
  });

  await t.test('6. setSubscribedSession un-subscribes prior and subscribes new session', () => {
    const mockSocket = createMockSocket();

    setSubscribedSession('sess_default', mockSocket);
    assert.deepStrictEqual(getSubscribedSessions(), ['sess_default']);

    setSubscribedSession('sess_horror', mockSocket);
    assert.deepStrictEqual(getSubscribedSessions(), ['sess_horror']);

    const unsubEvents = mockSocket.emitted.filter(e => e.event === 'unsubscribe_session');
    assert.strictEqual(unsubEvents.length, 1);
    assert.deepStrictEqual(unsubEvents[0].data, { sessionId: 'sess_default' });

    const subEvents = mockSocket.emitted.filter(e => e.event === 'subscribe_session');
    assert.strictEqual(subEvents.length, 2);
    assert.deepStrictEqual(subEvents[1].data, { sessionId: 'sess_horror' });
  });

  await t.test('7. VOTE, NEXT, SET_ENTRIES emit through socket action event with sessionId intact', () => {
    const mockSocket = createMockSocket();
    const store = createAppStore(mockSocket);

    store.dispatch(vote('sess_default', 'Trainspotting'));
    store.dispatch(next('sess_default'));
    store.dispatch(setEntries('sess_default', ['A', 'B']));

    const actionEmits = mockSocket.emitted.filter(e => e.event === 'action');
    assert.strictEqual(actionEmits.length, 3);

    assert.strictEqual(actionEmits[0].data.type, 'VOTE');
    assert.strictEqual(actionEmits[0].data.sessionId, 'sess_default');
    assert.strictEqual(actionEmits[0].data.entry, 'Trainspotting');

    assert.strictEqual(actionEmits[1].data.type, 'NEXT');
    assert.strictEqual(actionEmits[1].data.sessionId, 'sess_default');

    assert.strictEqual(actionEmits[2].data.type, 'SET_ENTRIES');
    assert.strictEqual(actionEmits[2].data.sessionId, 'sess_default');
    assert.deepStrictEqual(actionEmits[2].data.entries, ['A', 'B']);
  });

  await t.test('8. Multi-session isolation across incoming socket events', () => {
    const mockSocket = createMockSocket();
    const store = createAppStore(mockSocket);

    // Initial server state for sess_default
    mockSocket.simulateServerEmit('session_state', {
      id: 'sess_default',
      vote: { pair: ['A', 'B'], tally: { A: 10 } }
    });

    // Initial server state for sess_horror
    mockSocket.simulateServerEmit('session_state', {
      id: 'sess_horror',
      vote: { pair: ['X', 'Y'], tally: { X: 20 } }
    });

    let state = store.getState();
    assert.strictEqual(selectSessionById(state, 'sess_default').vote.tally.A, 10);
    assert.strictEqual(selectSessionById(state, 'sess_horror').vote.tally.X, 20);

    // Server broadcasts updated state for sess_default only
    mockSocket.simulateServerEmit('session_state', {
      id: 'sess_default',
      vote: { pair: ['A', 'B'], tally: { A: 11 } }
    });

    state = store.getState();
    assert.strictEqual(selectSessionById(state, 'sess_default').vote.tally.A, 11);
    // sess_horror MUST remain untouched
    assert.strictEqual(selectSessionById(state, 'sess_horror').vote.tally.X, 20);
  });

  await t.test('9. Reconnection restores required subscriptions and queries registry', () => {
    const mockSocket = createMockSocket();
    createAppStore(mockSocket);

    // User subscribes to two sessions during active connection
    subscribeSession('sess_default', mockSocket);
    subscribeSession('sess_horror', mockSocket);
    mockSocket.emitted.length = 0; // reset emit tracker

    // Simulate disconnect and reconnect
    mockSocket.simulateServerEmit('connect');

    // Verify 'sessions' registry request was sent
    const registryRequests = mockSocket.emitted.filter(e => e.event === 'sessions');
    assert.strictEqual(registryRequests.length, 1);

    // Verify both subscriptions were restored
    const subEmits = mockSocket.emitted.filter(e => e.event === 'subscribe_session');
    assert.strictEqual(subEmits.length, 2);
    assert.deepStrictEqual(subEmits[0].data, { sessionId: 'sess_default' });
    assert.deepStrictEqual(subEmits[1].data, { sessionId: 'sess_horror' });
  });

  await t.test('10. Echo-loop prevention: server-originated events do NOT emit action back', () => {
    const mockSocket = createMockSocket();
    createAppStore(mockSocket);

    mockSocket.emitted.length = 0;

    // Simulate incoming server broadcast
    mockSocket.simulateServerEmit('sessions', [{ id: 'sess_default', title: 'Test' }]);
    mockSocket.simulateServerEmit('session_state', { id: 'sess_default', vote: { pair: ['A', 'B'] } });
    mockSocket.simulateServerEmit('state', { vote: { pair: ['A', 'B'] } });

    // Ensure zero 'action' events were emitted to socket
    const actionEmits = mockSocket.emitted.filter(e => e.event === 'action');
    assert.strictEqual(actionEmits.length, 0);
  });

  await t.test('11. Safe handling of malformed or invalid socket payloads', () => {
    const mockSocket = createMockSocket();
    const store = createAppStore(mockSocket);

    // Malformed sessions payload
    mockSocket.simulateServerEmit('sessions', null);
    mockSocket.simulateServerEmit('sessions', 'not-an-array');

    // Malformed session_state payload
    mockSocket.simulateServerEmit('session_state', null);
    mockSocket.simulateServerEmit('session_state', {});
    mockSocket.simulateServerEmit('session_state', { id: '' });

    // Invalid subscription requests
    subscribeSession(null, mockSocket);
    subscribeSession('', mockSocket);
    unsubscribeSession(null, mockSocket);

    const state = store.getState();
    assert.deepStrictEqual(selectSessionList(state), []);
    assert.deepStrictEqual(state.sessions.bySessionId, {});
  });
});

test('Stage H — Frontend Routing & Multi-Session UI Architecture', async (t) => {

  await t.test('1. Route session ID determines session state, not activeSessionId', () => {
    const store = createAppStore(null);

    // Populate two sessions
    store.dispatch(setSessionState('sess_default', {
      id: 'sess_default',
      title: 'Default Movie Session',
      vote: { pair: ['MovieA', 'MovieB'], tally: { MovieA: 10, MovieB: 5 } },
      winner: null,
      entries: ['MovieA', 'MovieB', 'MovieC'],
      hasLoaded: true
    }));
    store.dispatch(setSessionState('sess_horror', {
      id: 'sess_horror',
      title: 'Horror Session',
      vote: { pair: ['Scream', 'Alien'], tally: { Scream: 3, Alien: 7 } },
      winner: null,
      entries: ['Scream', 'Alien', 'Saw'],
      hasLoaded: true
    }));

    // Set active to sess_default
    store.dispatch(setActiveSession('sess_default'));

    const state = store.getState();

    // Route ID sess_horror should return horror session data, ignoring activeSessionId
    const routeSessionId = 'sess_horror';
    const sessionData = selectSessionById(state, routeSessionId);
    assert.ok(sessionData, 'Route ID should resolve a session');
    assert.strictEqual(sessionData.id, 'sess_horror');
    assert.strictEqual(sessionData.title, 'Horror Session');

    // selectVote with explicit ID should return that session's vote
    const voteState = selectVote(state, routeSessionId);
    assert.ok(voteState, 'selectVote with route ID should return vote state');
    assert.deepStrictEqual(voteState.pair, ['Scream', 'Alien']);

    // selectWinner with explicit ID should return null (no winner yet)
    const winner = selectWinner(state, routeSessionId);
    assert.strictEqual(winner, null);

    // activeSessionId is still sess_default
    assert.strictEqual(selectActiveSessionId(state), 'sess_default');
  });

  await t.test('2. setActiveSession synchronizes Redux when entering a route', () => {
    const store = createAppStore(null);

    // Set up two sessions so auto-default picks the first one
    store.dispatch(setSessionState('other_sess', {
      id: 'other_sess',
      title: 'Other',
      hasLoaded: true
    }));
    store.dispatch(setSessionState('route_sess', {
      id: 'route_sess',
      title: 'Route Test',
      hasLoaded: true
    }));

    // Auto-default should have set to 'other_sess' (first registered)
    assert.strictEqual(selectActiveSessionId(store.getState()), 'other_sess');

    // Simulate what Voting/Results pages do on mount — switch to route_sess
    store.dispatch(setActiveSession('route_sess'));

    assert.strictEqual(selectActiveSessionId(store.getState()), 'route_sess');
    const active = selectActiveSession(store.getState());
    assert.ok(active);
    assert.strictEqual(active.id, 'route_sess');
    assert.strictEqual(active.title, 'Route Test');
  });

  await t.test('3. Subscription lifecycle: subscribe on enter, unsubscribe on leave', () => {
    function createMockSocket() {
      const emitted = [];
      const listeners = {};
      return {
        emitted,
        emit: (event, data) => { emitted.push({ event, data }); },
        on: (event, fn) => { listeners[event] = listeners[event] || []; listeners[event].push(fn); },
        off: (event) => { delete listeners[event]; },
        connected: true,
        listeners,
        simulateServerEmit(event, ...args) {
          (listeners[event] || []).forEach(fn => fn(...args));
        }
      };
    }

    const mockSocket = createMockSocket();

    // Subscribe
    subscribeSession('sess_alpha', mockSocket);
    const subscribed = getSubscribedSessions();
    assert.ok(subscribed.includes('sess_alpha'), 'Should be in subscription registry');

    const subEmit = mockSocket.emitted.find(e => e.event === 'subscribe_session' && e.data?.sessionId === 'sess_alpha');
    assert.ok(subEmit, 'Should emit subscribe_session');

    // Unsubscribe (simulating route leave)
    unsubscribeSession('sess_alpha', mockSocket);
    const afterUnsub = getSubscribedSessions();
    assert.ok(!afterUnsub.includes('sess_alpha'), 'Should be removed from subscription registry');

    const unsubEmit = mockSocket.emitted.find(e => e.event === 'unsubscribe_session' && e.data?.sessionId === 'sess_alpha');
    assert.ok(unsubEmit, 'Should emit unsubscribe_session');
  });

  await t.test('4. Invalid session ID: selectSessionById returns null', () => {
    const store = createAppStore(null);

    store.dispatch(setSessionState('valid_id', {
      id: 'valid_id',
      title: 'Valid',
      hasLoaded: true
    }));

    const state = store.getState();

    // Non-existent ID
    assert.strictEqual(selectSessionById(state, 'does_not_exist'), null);
    assert.strictEqual(selectVote(state, 'does_not_exist'), null);
    assert.strictEqual(selectWinner(state, 'does_not_exist'), null);
    assert.strictEqual(selectHasLoaded(state, 'does_not_exist'), false);

    // Null/undefined ID
    assert.strictEqual(selectSessionById(state, null), null);
    assert.strictEqual(selectSessionById(state, undefined), null);
  });

  await t.test('5. Legacy route resolution: selectSessionList returns ordered sessions for redirect', () => {
    const store = createAppStore(null);

    // Register sessions via registry
    store.dispatch(setSessions([
      { id: 'first_sess', title: 'First', status: 'open' },
      { id: 'second_sess', title: 'Second', status: 'open' }
    ]));

    const state = store.getState();
    const list = selectSessionList(state);

    assert.ok(Array.isArray(list), 'List should be an array');
    assert.ok(list.length >= 2, 'Should have at least 2 sessions');

    // Legacy redirect logic: pick first session
    const firstSession = list[0];
    assert.ok(firstSession.id, 'First session should have an id');
    assert.strictEqual(firstSession.id, 'first_sess');
  });

  await t.test('6. Legacy route fallback: empty session list returns empty array', () => {
    const store = createAppStore(null);

    const state = store.getState();
    const list = selectSessionList(state);
    assert.deepStrictEqual(list, []);
  });

  await t.test('7. Multi-session isolation: route-scoped selectors return independent data', () => {
    const store = createAppStore(null);

    store.dispatch(setSessionState('iso_a', {
      id: 'iso_a',
      title: 'Session A',
      vote: { pair: ['CandA1', 'CandA2'], tally: { CandA1: 100, CandA2: 50 } },
      winner: null,
      hasLoaded: true
    }));

    store.dispatch(setSessionState('iso_b', {
      id: 'iso_b',
      title: 'Session B',
      vote: { pair: ['CandB1', 'CandB2'], tally: { CandB1: 7, CandB2: 12 } },
      winner: null,
      hasLoaded: true
    }));

    const state = store.getState();

    // Route A data
    const voteA = selectVote(state, 'iso_a');
    assert.deepStrictEqual(voteA.pair, ['CandA1', 'CandA2']);
    assert.strictEqual(selectWinner(state, 'iso_a'), null);

    // Route B data - completely independent
    const voteB = selectVote(state, 'iso_b');
    assert.deepStrictEqual(voteB.pair, ['CandB1', 'CandB2']);
    assert.strictEqual(selectWinner(state, 'iso_b'), null);

    // Confirm no cross-contamination
    assert.notDeepStrictEqual(voteA, voteB);
  });

  await t.test('8. Session-scoped pair lock keys remain independent across routes', () => {
    const lockA = getSessionPairLockKey('route_sess_a', ['X', 'Y']);
    const lockB = getSessionPairLockKey('route_sess_b', ['X', 'Y']);

    assert.notStrictEqual(lockA, lockB, 'Same pair in different sessions must produce different lock keys');
    assert.ok(lockA.startsWith('route_sess_a'), 'Lock key should contain session A ID');
    assert.ok(lockB.startsWith('route_sess_b'), 'Lock key should contain session B ID');
  });

  await t.test('9. Switching active session via route preserves previous session state', () => {
    const store = createAppStore(null);

    // Set up session A with votes
    store.dispatch(setSessionState('persist_a', {
      id: 'persist_a',
      title: 'Persist A',
      vote: { pair: ['P1', 'P2'], tally: { P1: 20, P2: 30 } },
      hasLoaded: true
    }));
    store.dispatch(setActiveSession('persist_a'));

    // "Navigate" to session B
    store.dispatch(setSessionState('persist_b', {
      id: 'persist_b',
      title: 'Persist B',
      vote: { pair: ['Q1', 'Q2'], tally: { Q1: 1, Q2: 2 } },
      hasLoaded: true
    }));
    store.dispatch(setActiveSession('persist_b'));

    const state = store.getState();

    // Active is now B
    assert.strictEqual(selectActiveSessionId(state), 'persist_b');

    // But A's state is fully preserved
    const sessA = selectSessionById(state, 'persist_a');
    assert.ok(sessA);
    assert.deepStrictEqual(sessA.vote.tally, { P1: 20, P2: 30 });
    assert.strictEqual(sessA.title, 'Persist A');
  });

  await t.test('10. selectHasLoaded returns false for unsubscribed/unknown session IDs', () => {
    const store = createAppStore(null);

    store.dispatch(setSessionState('loaded_one', {
      id: 'loaded_one',
      hasLoaded: true
    }));

    const state = store.getState();
    assert.strictEqual(selectHasLoaded(state, 'loaded_one'), true);
    assert.strictEqual(selectHasLoaded(state, 'never_loaded'), false);
  });
});
