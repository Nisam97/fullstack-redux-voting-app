import test from 'node:test';
import assert from 'node:assert/strict';
import historyReducer, {
  initialState,
  historyLoading,
  historySuccess,
  historyFailure,
  resultLoading,
  resultSuccess,
  resultFailure,
  clearSelectedResult,
  resetHistoryState,
  loadHistory,
  loadSessionResult,
  selectHistoryItems,
  selectHistoryLoading,
  selectHistoryError,
  selectSelectedResult,
  selectResultLoading,
  selectResultError
} from '../src/redux/historySlice.js';
import { createAppStore } from '../src/redux/store.js';
import { fetchSessionHistory, fetchSessionResult } from '../src/services/history.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

test('Stage D: Frontend History Integration & State Isolation', async (t) => {
  const originalFetch = globalThis.fetch;

  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test('1. History API: fetchSessionHistory handles successful responses with results', async () => {
    const mockResults = [
      {
        sessionId: 'sess_1',
        title: 'Film Fest',
        winner: 'Movie A',
        entries: ['Movie A', 'Movie B'],
        completedAt: '2026-09-12T12:00:00.000Z'
      }
    ];

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        success: true,
        results: mockResults,
        count: 1
      })
    });

    const res = await fetchSessionHistory();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.count, 1);
    assert.deepStrictEqual(res.results, mockResults);
  });

  await t.test('2. History API: fetchSessionHistory handles empty history gracefully', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        success: true,
        results: [],
        count: 0
      })
    });

    const res = await fetchSessionHistory();
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.count, 0);
    assert.deepStrictEqual(res.results, []);
  });

  await t.test('3. History API: fetchSessionHistory handles HTTP error status codes', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({
        success: false,
        error: 'DATABASE_ERROR',
        message: 'Database connection is unavailable'
      })
    });

    const res = await fetchSessionHistory();
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'DATABASE_ERROR');
    assert.strictEqual(res.message, 'Database connection is unavailable');
    assert.deepStrictEqual(res.results, []);
  });

  await t.test('4. History API: fetchSessionHistory handles network failures without throwing', async () => {
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch');
    };

    const res = await fetchSessionHistory();
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'NETWORK_ERROR');
    assert.strictEqual(res.message, 'Failed to fetch');
  });

  await t.test('5. History API: fetchSessionResult retrieves individual completed session result', async () => {
    const mockResult = {
      sessionId: 'sess_target',
      title: 'Target Tourney',
      winner: 'Champ',
      entries: ['Champ', 'Runner-up'],
      completedAt: '2026-09-12T12:30:00.000Z'
    };

    globalThis.fetch = async (url) => {
      assert.ok(String(url).includes('/api/sessions/sess_target/result'));
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: mockResult
        })
      };
    };

    const res = await fetchSessionResult('sess_target');
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.result, mockResult);
  });

  await t.test('6. History API: fetchSessionResult returns error on 404 NOT FOUND', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({
        success: false,
        error: 'RESULT_NOT_FOUND',
        message: 'No completed result found for session "sess_ghost"'
      })
    });

    const res = await fetchSessionResult('sess_ghost');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'RESULT_NOT_FOUND');
  });

  await t.test('7. Redux History Reducer: manages loading, success, and error states correctly', () => {
    // Initial State
    assert.deepStrictEqual(initialState.items, []);
    assert.strictEqual(initialState.loading, false);
    assert.strictEqual(initialState.error, null);

    // Loading transition
    let state = historyReducer(initialState, historyLoading());
    assert.strictEqual(state.loading, true);
    assert.strictEqual(state.error, null);

    // Success transition
    const sampleItems = [{ sessionId: 'sess_1', winner: 'Winner A' }];
    state = historyReducer(state, historySuccess(sampleItems));
    assert.strictEqual(state.loading, false);
    assert.deepStrictEqual(state.items, sampleItems);
    assert.strictEqual(state.error, null);

    // Error transition
    state = historyReducer(state, historyFailure('Database error'));
    assert.strictEqual(state.loading, false);
    assert.strictEqual(state.error, 'Database error');

    // Reset transition
    state = historyReducer(state, resetHistoryState());
    assert.deepStrictEqual(state, initialState);
  });

  await t.test('8. Redux History Reducer: manages individual result states correctly', () => {
    let state = historyReducer(initialState, resultLoading());
    assert.strictEqual(state.resultLoading, true);
    assert.strictEqual(state.resultError, null);

    const sampleResult = { sessionId: 'sess_x', winner: 'Champ X' };
    state = historyReducer(state, resultSuccess(sampleResult));
    assert.strictEqual(state.resultLoading, false);
    assert.deepStrictEqual(state.selectedResult, sampleResult);

    state = historyReducer(state, resultFailure('Result not found'));
    assert.strictEqual(state.resultLoading, false);
    assert.strictEqual(state.resultError, 'Result not found');
    assert.strictEqual(selectResultError({ history: state }), 'Result not found');

    state = historyReducer(state, clearSelectedResult());
    assert.strictEqual(state.selectedResult, null);
  });

  await t.test('9. Redux Thunks: loadHistory and loadSessionResult dispatch lifecycle actions', async () => {
    const store = createAppStore(null);

    // Test loadHistory success
    const mockItems = [{ sessionId: 'sess_thunk', winner: 'Winner T' }];
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ success: true, results: mockItems, count: 1 })
    });

    await store.dispatch(loadHistory());
    assert.strictEqual(selectHistoryLoading(store.getState()), false);
    assert.deepStrictEqual(selectHistoryItems(store.getState()), mockItems);
    assert.strictEqual(selectHistoryError(store.getState()), null);

    // Test loadHistory failure
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({ success: false, error: 'DB_DOWN', message: 'DB offline' })
    });

    await store.dispatch(loadHistory());
    assert.strictEqual(selectHistoryLoading(store.getState()), false);
    assert.strictEqual(selectHistoryError(store.getState()), 'DB offline');

    // Test loadSessionResult success
    const mockResult = { sessionId: 'sess_res_thunk', winner: 'Winner R' };
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ success: true, result: mockResult })
    });

    await store.dispatch(loadSessionResult('sess_res_thunk'));
    assert.strictEqual(selectResultLoading(store.getState()), false);
    assert.deepStrictEqual(selectSelectedResult(store.getState()), mockResult);
  });

  await t.test('10. State Isolation: history state is strictly isolated from live sessions state', () => {
    const store = createAppStore(null);

    // Update live session in sessions slice
    store.dispatch({
      type: 'SET_SESSION_STATE',
      sessionId: 'sess_live_1',
      state: { id: 'sess_live_1', title: 'Live Session', status: 'open' }
    });

    // Update history slice
    store.dispatch(historySuccess([{ sessionId: 'sess_archived', winner: 'Old Champion' }]));

    const rootState = store.getState();

    // Verify live session remains intact and unaltered
    assert.ok(rootState.sessions.bySessionId['sess_live_1']);
    assert.strictEqual(rootState.sessions.bySessionId['sess_live_1'].title, 'Live Session');

    // Verify history slice is isolated
    assert.strictEqual(rootState.history.items.length, 1);
    assert.strictEqual(rootState.history.items[0].sessionId, 'sess_archived');

    // Ensure no cross-pollution
    assert.strictEqual(rootState.sessions.bySessionId['sess_archived'], undefined);
  });
});
