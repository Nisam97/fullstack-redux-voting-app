import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  setSessions,
  setSessionState,
  setPublishResults,
  setPublishResultsLocal,
  setTurnout,
  selectTurnout,
  selectPublishResultsPublicly,
  normalizeSession,
  initialState
} from '../src/redux/voteSlice.js';
import {
  createRemoteActionMiddleware,
  isRemoteAction,
  LOCAL_ACTION_TYPES,
  REMOTE_ACTION_TYPES
} from '../src/redux/store.js';
import { subscribeTurnout, unsubscribeTurnout } from '../src/services/socket.js';
import { fetchSessionResult, fetchSessionHistory, fetchSessionRounds } from '../src/services/history.js';
import socket from '../src/services/socket.js';

const ADMIN_TOKEN_KEY = 'votesphere_admin_jwt';

function setupMockWindow(seed = {}) {
  const map = new Map(Object.entries(seed));
  globalThis.window = {
    localStorage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear()
    }
  };
  return map;
}

function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  };
  return calls;
}

const realFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
  try {
    socket.close();
  } catch {
    // harmless
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Visibility and privacy client contract (spec 0008)', () => {
  beforeEach(() => {
    setupMockWindow();
  });

  it('1. setPublishResults is a remote action the middleware enriches with the admin token', () => {
    // covers: AC-3
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'admin.jwt.token' });
    const emitted = [];
    const fakeSocket = { emit: (evt, action) => emitted.push({ evt, action }) };
    const dispatch = createRemoteActionMiddleware(fakeSocket)({
      getState: () => ({ voterAuth: { user: null } })
    })((a) => a);

    assert.equal(isRemoteAction(setPublishResults('sess_1', true)), true);
    assert.equal(REMOTE_ACTION_TYPES.has('SET_PUBLISH_RESULTS'), true);

    dispatch(setPublishResults('sess_1', true));

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].evt, 'action');
    assert.equal(emitted[0].action.type, 'SET_PUBLISH_RESULTS');
    assert.equal(emitted[0].action.sessionId, 'sess_1');
    assert.equal(emitted[0].action.publishResultsPublicly, true);
    assert.equal(emitted[0].action.token, 'admin.jwt.token');
  });

  it('2. the reducer writes the publish flag onto the session and the list summary', () => {
    // covers: AC-3
    let state = voteReducer(initialState, setSessions([
      { id: 'sess_1', sessionId: 'sess_1', title: 'S', status: 'completed', type: 'secured' }
    ]));
    state = voteReducer(state, setSessionState('sess_1', {
      id: 'sess_1',
      status: 'completed',
      type: 'secured',
      publishResultsPublicly: false
    }));

    state = voteReducer(state, {
      type: 'SET_PUBLISH_RESULTS',
      sessionId: 'sess_1',
      publishResultsPublicly: true
    });

    assert.equal(selectPublishResultsPublicly(state, 'sess_1'), true);
    assert.equal(state.list.find((s) => s.id === 'sess_1').publishResultsPublicly, true);
  });

  it('3. setTurnout stores rounds under bySessionId and selectTurnout reads them back', () => {
    // covers: AC-7
    let state = voteReducer(initialState, setSessionState('sess_1', { id: 'sess_1', status: 'completed' }));
    const rounds = [{ roundIndex: 1, roundId: 'sess_1:::r1', voters: [{ name: 'Ada', email: 'ada@example.com' }] }];

    state = voteReducer(state, setTurnout('sess_1', rounds));

    assert.deepEqual(selectTurnout(state, 'sess_1'), rounds);
    assert.equal(Array.isArray(state.turnout), false, 'turnout must not be promoted to the slice top level');
    // The socket event name maps to the same reducer.
    const viaEvent = voteReducer(state, { type: 'session_turnout', payload: { sessionId: 'sess_1', rounds: [] } });
    assert.deepEqual(selectTurnout(viaEvent, 'sess_1'), []);
  });

  it('4. turnout actions are local only and never echo back to the server', () => {
    // covers: AC-7
    assert.equal(isRemoteAction(setTurnout('sess_1', [])), false);
    assert.equal(LOCAL_ACTION_TYPES.has('SET_TURNOUT'), true);
    assert.equal(LOCAL_ACTION_TYPES.has('session_turnout'), true);
  });

  it('5. normalizeSession carries the publish flag and keeps stripping tokens', () => {
    // covers: AC-9, AC-12
    const normalized = normalizeSession({
      id: 'sess_1',
      type: 'secured',
      publishResultsPublicly: true,
      voterToken: 'secret',
      token: 'nope'
    }, 'sess_1');

    assert.equal(normalized.publishResultsPublicly, true);
    assert.equal(normalized.voterToken, undefined);
    assert.equal(normalized.token, undefined);
  });

  it('6. subscribeTurnout emits the admin token with the subscription', () => {
    // covers: AC-7
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'admin.jwt.token' });
    const emitted = [];
    const fakeSocket = { emit: (evt, payload) => emitted.push({ evt, payload }) };

    subscribeTurnout('sess_1', fakeSocket);
    unsubscribeTurnout('sess_1', fakeSocket);

    assert.equal(emitted[0].evt, 'subscribe_turnout');
    assert.deepEqual(emitted[0].payload, { sessionId: 'sess_1', token: 'admin.jwt.token' });
    assert.equal(emitted[1].evt, 'unsubscribe_turnout');
    assert.deepEqual(emitted[1].payload, { sessionId: 'sess_1' });
  });

  it('6b. a turnout subscription with no admin token in storage omits the token field', () => {
    // covers: AC-7, AC-8
    // The server refuses an anonymous subscription anyway, so the payload must
    // not pretend to carry a token it does not have.
    setupMockWindow();
    const emitted = [];
    const fakeSocket = { emit: (evt, payload) => emitted.push({ evt, payload }) };

    subscribeTurnout('sess_1', fakeSocket);

    assert.deepEqual(emitted[0].payload, { sessionId: 'sess_1' });
    assert.equal('token' in emitted[0].payload, false);
  });

  it('6c. the turnout subscription is refused locally for a blank session id', () => {
    // covers: AC-7
    // Nothing is emitted, so the server is never asked about a session nobody
    // named.
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'admin.jwt.token' });
    const emitted = [];
    const fakeSocket = { emit: (evt, payload) => emitted.push({ evt, payload }) };

    subscribeTurnout('   ', fakeSocket);
    subscribeTurnout('', fakeSocket);
    subscribeTurnout(undefined, fakeSocket);
    unsubscribeTurnout('  ', fakeSocket);
    unsubscribeTurnout(null, fakeSocket);

    assert.equal(emitted.length, 0);
  });

  it('6d. the turnout subscription trims the session id it sends', () => {
    // covers: AC-7
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'admin.jwt.token' });
    const emitted = [];
    const fakeSocket = { emit: (evt, payload) => emitted.push({ evt, payload }) };

    subscribeTurnout('  sess_1  ', fakeSocket);
    unsubscribeTurnout('  sess_1  ', fakeSocket);

    assert.equal(emitted[0].payload.sessionId, 'sess_1');
    assert.equal(emitted[1].payload.sessionId, 'sess_1');
  });

  it('7. result reads send the vs_voter cookie and the admin bearer header', async () => {
    // covers: AC-2, AC-12
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'admin.jwt.token' });
    const calls = stubFetch(404, { success: false, error: 'RESULT_NOT_FOUND' });

    await fetchSessionResult('sess 1/2');
    await fetchSessionHistory(10);

    assert.equal(calls[0].init.credentials, 'include', 'the vs_voter cookie must travel');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer admin.jwt.token');
    assert.equal(calls[0].url.endsWith('/api/sessions/sess%201%2F2/result'), true, 'sessionId must be encoded');
    assert.equal(calls[1].init.credentials, 'include');
  });

  it('7b. an anonymous read sends the cookie but no Authorization header', () => {
    // covers: AC-2
    // There is no admin token in storage, so nothing may be attached. Sending
    // the literal string "Bearer null" would make the server log a parse error
    // on every anonymous read.
    setupMockWindow();
    const calls = stubFetch(404, { success: false, error: 'RESULT_NOT_FOUND' });

    return fetchSessionResult('sess_1').then(() => {
      assert.equal('Authorization' in calls[0].init.headers, false);
      assert.deepEqual(calls[0].init.headers, { Accept: 'application/json' });
      assert.equal(calls[0].init.credentials, 'include', 'the vs_voter cookie still travels');
    });
  });

  it('7c. the rounds read sends the cookie and the admin bearer header too (AC-4)', () => {
    // covers: AC-2, AC-4
    // Publishing opens the rounds read as well as the result read, so the
    // headers have to be on this call too. A gap here shows up as a published
    // result whose round ledger stays empty for the admin.
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'admin.jwt.token' });
    const calls = stubFetch(200, { success: true, rounds: [] });

    return fetchSessionRounds('sess_1').then(() => {
      assert.equal(calls[0].init.credentials, 'include');
      assert.equal(calls[0].init.headers.Authorization, 'Bearer admin.jwt.token');
      assert.equal(calls[0].url.endsWith('/api/sessions/sess_1/rounds'), true);
    });
  });

  // The publish toggle now waits for the server's acknowledgement, so the server's
  // answer is the only thing that moves the control. The local action applies
  // that accepted value to the store, and it must never travel back as a second
  // intent.

  it('8. setPublishResultsLocal is local only and never reaches the server', () => {
    // covers: AC-3
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'admin.jwt.token' });
    const emitted = [];
    const fakeSocket = { emit: (evt, action) => emitted.push({ evt, action }) };
    const dispatch = createRemoteActionMiddleware(fakeSocket)({
      getState: () => ({ voterAuth: { user: null } })
    })((a) => a);

    assert.equal(isRemoteAction(setPublishResultsLocal('sess_1', false)), false);
    assert.equal(LOCAL_ACTION_TYPES.has('SET_PUBLISH_RESULTS_LOCAL'), true);

    dispatch(setPublishResultsLocal('sess_1', false));

    assert.equal(emitted.length, 0, 'the local confirmation must not be sent to the server');
  });

  it('8b. the middleware attaches the acknowledgement callback and keeps it off the wire', () => {
    // covers: AC-3
    // The ack is a local function, so it belongs in the Socket.io emit callback
    // rather than in the action body. A payload carrying it would be
    // unserialisable and would tell the server nothing.
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'admin.jwt.token' });
    const emitted = [];
    const fakeSocket = {
      emit: (evt, action, ack) => emitted.push({ evt, action, ack })
    };
    const dispatch = createRemoteActionMiddleware(fakeSocket)({
      getState: () => ({ voterAuth: { user: null } })
    })((a) => a);

    const onAck = () => {};
    dispatch(setPublishResults('sess_1', true, onAck));

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].evt, 'action');
    assert.equal(emitted[0].action.type, 'SET_PUBLISH_RESULTS');
    assert.equal(emitted[0].action.publishResultsPublicly, true);
    assert.equal(emitted[0].action.meta.onAck, undefined, 'the ack must not travel in the payload');
    assert.equal(emitted[0].ack, onAck, 'the ack must be the emit callback');
  });

  it('8c. an action without an acknowledgement is emitted exactly as before', () => {
    // covers: AC-3
    // The callback is optional: every other remote action still goes out with
    // the same single argument it always did.
    setupMockWindow({ [ADMIN_TOKEN_KEY]: 'admin.jwt.token' });
    const calls = [];
    const fakeSocket = { emit: (...args) => calls.push(args) };
    const dispatch = createRemoteActionMiddleware(fakeSocket)({
      getState: () => ({ voterAuth: { user: null } })
    })((a) => a);

    dispatch(setPublishResults('sess_1', true));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2, 'no callback argument when none was supplied');
    assert.equal(calls[0][1].type, 'SET_PUBLISH_RESULTS');
  });

  it('9. the server answer lands on the session and the list summary', () => {
    // covers: AC-3, AC-12
    let state = voteReducer(initialState, setSessions([
      { id: 'sess_1', sessionId: 'sess_1', title: 'S', status: 'completed', type: 'secured' }
    ]));
    state = voteReducer(state, setSessionState('sess_1', {
      id: 'sess_1',
      status: 'completed',
      type: 'secured',
      publishResultsPublicly: false
    }));

    // The click records the intent locally...
    state = voteReducer(state, setPublishResults('sess_1', true));
    assert.equal(selectPublishResultsPublicly(state, 'sess_1'), true);

    // ...and the server's acknowledgement settles it. The server can answer
    // with the value it actually stored, which is what drives the control.
    state = voteReducer(state, setPublishResultsLocal('sess_1', false));

    assert.equal(selectPublishResultsPublicly(state, 'sess_1'), false);
    assert.equal(state.list.find((s) => s.id === 'sess_1').publishResultsPublicly, false);
  });

  it('10. a local confirmation for an unknown session or a non boolean leaves the state untouched', () => {
    // covers: AC-3
    let state = voteReducer(initialState, setSessionState('sess_1', {
      id: 'sess_1',
      status: 'completed',
      type: 'secured',
      publishResultsPublicly: true
    }));

    const afterUnknownSession = voteReducer(state, setPublishResultsLocal('ghost_session', false));
    assert.equal(Object.keys(afterUnknownSession.bySessionId).includes('ghost_session'), false,
      'a rollback must not invent a session entry');
    assert.equal(selectPublishResultsPublicly(afterUnknownSession, 'sess_1'), true);

    const afterNonBoolean = voteReducer(state, setPublishResultsLocal('sess_1', 'yes'));
    assert.equal(selectPublishResultsPublicly(afterNonBoolean, 'sess_1'), true,
      'a non boolean must not overwrite the flag');
  });
});
