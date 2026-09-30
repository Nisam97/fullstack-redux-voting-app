import { test, describe } from 'node:test';
import assert from 'node:assert';
import voterAuthReducer, {
  initialState,
  setVoterAuth,
  clearVoterAuth,
  setVoterLoading,
  setVoterError,
  selectVoterAuth,
  selectCurrentVoter,
  selectIsVoterLoggedIn
} from '../src/redux/voterAuthSlice.js';
import { createAppStore, LOCAL_ACTION_TYPES, isRemoteAction } from '../src/redux/store.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 7: Client Voter Authentication Slice & Redux Integration (AC-8, AC-16)', () => {
  test('1. Reducer initial state has logged-out voter defaults', () => {
    const state = voterAuthReducer(undefined, { type: '@@INIT' });
    assert.deepStrictEqual(state, {
      isLoggedIn: false,
      user: null,
      loading: false,
      error: null
    });
  });

  test('2. setVoterAuth sets logged in status and user profile', () => {
    const mockUser = {
      id: 'usr_123',
      email: 'voter@example.com',
      name: 'Alice Voter',
      username: 'alice_v'
    };
    const state = voterAuthReducer(initialState, setVoterAuth({ user: mockUser }));
    assert.strictEqual(state.isLoggedIn, true);
    assert.deepStrictEqual(state.user, mockUser);
    assert.strictEqual(state.loading, false);
    assert.strictEqual(state.error, null);
  });

  test('3. clearVoterAuth resets auth state to logged out', () => {
    const loggedInState = {
      isLoggedIn: true,
      user: { id: 'usr_123', email: 'v@example.com', name: 'V', username: 'v' },
      loading: false,
      error: null
    };
    const state = voterAuthReducer(loggedInState, clearVoterAuth());
    assert.strictEqual(state.isLoggedIn, false);
    assert.strictEqual(state.user, null);
  });

  test('4. setVoterLoading and setVoterError update transient state', () => {
    let state = voterAuthReducer(initialState, setVoterLoading(true));
    assert.strictEqual(state.loading, true);

    state = voterAuthReducer(state, setVoterError('Failed to fetch profile'));
    assert.strictEqual(state.loading, false);
    assert.strictEqual(state.error, 'Failed to fetch profile');
  });

  test('5. Selectors query root store state correctly', () => {
    const rootState = {
      voterAuth: {
        isLoggedIn: true,
        user: { id: 'usr_456', email: 'bob@test.com', name: 'Bob', username: 'bob_v' },
        loading: false,
        error: null
      }
    };

    assert.strictEqual(selectIsVoterLoggedIn(rootState), true);
    assert.deepStrictEqual(selectCurrentVoter(rootState), rootState.voterAuth.user);
    assert.deepStrictEqual(selectVoterAuth(rootState), rootState.voterAuth);
  });

  test('6. Selectors gracefully handle empty or uninitialized root state', () => {
    assert.strictEqual(selectIsVoterLoggedIn({}), false);
    assert.strictEqual(selectCurrentVoter({}), null);
    assert.deepStrictEqual(selectVoterAuth({}), initialState);
  });

  test('7. Echo-prevention: voterAuth actions are registered in LOCAL_ACTION_TYPES', () => {
    assert.strictEqual(LOCAL_ACTION_TYPES.has('voterAuth/setVoterAuth'), true);
    assert.strictEqual(LOCAL_ACTION_TYPES.has('voterAuth/clearVoterAuth'), true);
    assert.strictEqual(LOCAL_ACTION_TYPES.has('voterAuth/setVoterLoading'), true);
    assert.strictEqual(LOCAL_ACTION_TYPES.has('voterAuth/setVoterError'), true);

    assert.strictEqual(isRemoteAction(setVoterAuth({ user: { id: '1' } })), false);
    assert.strictEqual(isRemoteAction(clearVoterAuth()), false);
  });

  test('8. createAppStore includes voterAuth reducer in store state', () => {
    const mockSocket = {
      on: () => {},
      emit: () => {},
      close: () => {}
    };
    const store = createAppStore(mockSocket);
    const state = store.getState();

    assert.ok(state.voterAuth !== undefined);
    assert.strictEqual(state.voterAuth.isLoggedIn, false);
    assert.strictEqual(state.voterAuth.user, null);

    store.dispatch(setVoterAuth({
      user: { id: 'user_abc', email: 'test@example.com', name: 'Test', username: 'test_user' }
    }));

    const updatedState = store.getState();
    assert.strictEqual(updatedState.voterAuth.isLoggedIn, true);
    assert.strictEqual(updatedState.voterAuth.user.id, 'user_abc');
  });

  test('9. Remote action middleware enriches VOTE with synthetic user:userId if logged in', () => {
    let emittedAction = null;
    const mockSocket = {
      on: () => {},
      emit: (event, payload) => {
        if (event === 'action') emittedAction = payload;
      },
      close: () => {}
    };

    const store = createAppStore(mockSocket);
    store.dispatch(setVoterAuth({
      user: { id: 'user_vip', email: 'vip@example.com', name: 'VIP', username: 'vip_user' }
    }));

    // Dispatch VOTE without explicit voterToken
    store.dispatch({
      type: 'VOTE',
      sessionId: 'sess_1',
      entry: 'Option A'
    });

    assert.ok(emittedAction !== null);
    assert.strictEqual(emittedAction.voterToken, 'user:user_vip');
  });
});
