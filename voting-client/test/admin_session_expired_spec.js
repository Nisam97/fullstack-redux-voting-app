import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { configureStore } from '@reduxjs/toolkit';
import voteReducer, {
  initialState,
  selectAdminSessionExpired,
  setAdminSessionExpired,
  setTurnout
} from '../src/redux/voteSlice.js';
import { isRemoteAction } from '../src/redux/store.js';
import socket from '../src/services/socket.js';

// store.js creates the app socket on import, so it has to be closed or the
// runner keeps a live handle and never exits.
after(() => {
  socket.close();
});

// Regression: the admin "Per round turnout" panel said "No rounds recorded
// yet" on a completed session that had persisted rounds, and the server was
// pushing them correctly. The chain was: the stored admin JWT was no longer
// verifiable under the running server's JWT secret, `subscribe_turnout` came
// back UNAUTHORIZED, and socket.js had no `action_error` listener at all, so
// the refusal was dropped on the floor. `isAdminLoggedIn()` only checks the
// local `exp`, which was still valid, so the UI kept rendering admin UI that
// silently did nothing and the admin read an empty panel as missing rounds.

describe('admin session expired flag', () => {
  const makeStore = () => configureStore({ reducer: { sessions: voteReducer } });

  it('starts false', () => {
    assert.strictEqual(selectAdminSessionExpired({ sessions: initialState }), false);
  });

  it('is set when the server rejects the stored admin token', () => {
    const store = makeStore();
    store.dispatch(setAdminSessionExpired(true));
    assert.strictEqual(selectAdminSessionExpired(store.getState()), true);
  });

  it('is cleared by a fresh admin login', () => {
    const store = makeStore();
    store.dispatch(setAdminSessionExpired(true));
    store.dispatch(setAdminSessionExpired(false));
    assert.strictEqual(selectAdminSessionExpired(store.getState()), false);
  });

  it('survives a turnout push that follows the rejection', () => {
    // A late session_turnout must not paper over the fact that admin reads are
    // being refused; the flag describes the credential, not the payload.
    const store = makeStore();
    store.dispatch(setAdminSessionExpired(true));
    store.dispatch(setTurnout('sess_x', [{ roundIndex: 1, roundId: 'sess_x:::r1', voters: [] }]));
    assert.strictEqual(selectAdminSessionExpired(store.getState()), true);
  });

  it('never travels to the server as a remote action', () => {
    // The flag is a local observation. Echoing it would ask the server for an
    // action type it does not know.
    assert.strictEqual(isRemoteAction(setAdminSessionExpired(true)), false);
    assert.strictEqual(isRemoteAction(setAdminSessionExpired(false)), false);
  });

  it('defaults to not expired when the action carries no value, and never throws', () => {
    // A payload free action says nothing about the credential, so the safe
    // default is "still an admin": claiming the opposite would hide admin UI
    // for a reason nobody can explain.
    const store = makeStore();
    store.dispatch({ type: 'SET_ADMIN_SESSION_EXPIRED' });
    assert.strictEqual(selectAdminSessionExpired(store.getState()), false);
  });
});
