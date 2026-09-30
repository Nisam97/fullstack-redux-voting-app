import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAppStore
} from '../src/redux/store.js';
import { socket as singletonSocket } from '../src/services/socket.js';
import {
  setSessionState,
  selectVote,
  selectWinner,
  selectEntries,
  selectSessionStatus
} from '../src/redux/voteSlice.js';

/**
 * The server is authoritative: client VOTE and NEXT actions are pure intent
 * (shipped to the server by the remote action middleware) and must never apply
 * voting math locally. These specs pin that contract.
 */
// Importing the store module creates the singleton socket client, whose
// reconnect attempts to localhost:8090 keep the test process alive. Disconnect
// it once every test has run so the runner exits promptly.
after(() => {
  try {
    singletonSocket.disconnect();
  } catch {
    // Already disconnected or never connected: nothing to do
  }
});

describe('Server authority: no client-side voting math', () => {
  test('1. VOTE does not mutate the local tally; only session_state writes state', () => {
    const emittedActions = [];
    const mockSocket = {
      emit: (event, payload) => {
        if (event === 'action') emittedActions.push(payload);
      },
      on: () => {},
      off: () => {}
    };

    const store = createAppStore(mockSocket);
    const sessionId = 'sess_no_local_math';

    // Seed a live voting round the way the server broadcast does
    store.dispatch(setSessionState({
      id: sessionId,
      title: 'Authority check',
      status: 'open',
      entries: ['C', 'D'],
      vote: { pair: ['C', 'D'], tally: { C: 1, D: 0 } },
      roundLifecycle: 'VOTING'
    }));

    const before = selectVote(store.getState(), sessionId);
    assert.deepStrictEqual(before, { pair: ['C', 'D'], tally: { C: 1, D: 0 } });

    // Local vote dispatch: emitted remotely, no local tally change
    store.dispatch({ type: 'VOTE', sessionId, entry: 'D', meta: { remote: true } });

    const afterVote = selectVote(store.getState(), sessionId);
    assert.deepStrictEqual(afterVote, { pair: ['C', 'D'], tally: { C: 1, D: 0 } },
      'client VOTE must not change the local tally');

    assert.strictEqual(emittedActions.length, 1);
    assert.strictEqual(emittedActions[0].type, 'VOTE');
    assert.strictEqual(emittedActions[0].entry, 'D');

    // The authoritative session_state broadcast is what updates the tally
    store.dispatch(setSessionState({
      id: sessionId,
      title: 'Authority check',
      status: 'open',
      entries: ['C', 'D'],
      vote: { pair: ['C', 'D'], tally: { C: 1, D: 1 } },
      roundLifecycle: 'VOTING'
    }));
    assert.deepStrictEqual(selectVote(store.getState(), sessionId).tally, { C: 1, D: 1 });
  });

  test('2. NEXT does not advance the tournament locally; server NEXT broadcast does', () => {
    const emittedActions = [];
    const mockSocket = {
      emit: (event, payload) => {
        if (event === 'action') emittedActions.push(payload);
      },
      on: () => {},
      off: () => {}
    };

    const store = createAppStore(mockSocket);
    const sessionId = 'sess_no_local_next';

    store.dispatch(setSessionState({
      id: sessionId,
      title: 'Authority check 2',
      status: 'open',
      entries: ['D', 'E', 'F'],
      vote: { pair: ['D', 'E'], tally: { D: 3, E: 1 } },
      roundLifecycle: 'VOTING'
    }));

    store.dispatch({ type: 'NEXT', sessionId, meta: { remote: true } });

    // No local advancement: same pair, same entries, no winner
    assert.deepStrictEqual(selectVote(store.getState(), sessionId)?.pair, ['D', 'E']);
    assert.deepStrictEqual(selectEntries(store.getState(), sessionId), ['D', 'E', 'F']);
    assert.strictEqual(selectWinner(store.getState(), sessionId), null);
    assert.strictEqual(selectSessionStatus(store.getState(), sessionId), 'open');

    assert.strictEqual(emittedActions.length, 1);
    assert.strictEqual(emittedActions[0].type, 'NEXT');

    // The authoritative broadcast moves the tournament forward
    store.dispatch(setSessionState({
      id: sessionId,
      title: 'Authority check 2',
      status: 'open',
      entries: ['E', 'F'],
      vote: { pair: ['E', 'F'], tally: {} },
      roundLifecycle: 'VOTING'
    }));
    assert.deepStrictEqual(selectEntries(store.getState(), sessionId), ['E', 'F']);
    assert.deepStrictEqual(selectVote(store.getState(), sessionId)?.pair, ['E', 'F']);
  });

  test('3. NEXT still emits remotely for admin use despite being a local no-op', () => {
    const emittedActions = [];
    const mockSocket = {
      emit: (event, payload) => {
        if (event === 'action') emittedActions.push(payload);
      },
      on: () => {},
      off: () => {}
    };

    const store = createAppStore(mockSocket);
    store.dispatch({ type: 'NEXT', sessionId: 'sess_any', token: 'jwt' });

    assert.strictEqual(emittedActions.length, 1);
    assert.strictEqual(emittedActions[0].type, 'NEXT');
    assert.strictEqual(emittedActions[0].token, 'jwt');
  });
});
