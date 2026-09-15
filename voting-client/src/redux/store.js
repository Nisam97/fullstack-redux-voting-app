import { configureStore } from '@reduxjs/toolkit';
import voteReducer, {
  SET_STATE,
  SESSIONS,
  SESSION_STATE,
  SET_SESSIONS,
  SET_SESSION_STATE,
  SET_ACTIVE_SESSION,
  RESET_SESSIONS,
  LOBBY_UPDATE,
  SET_LOBBY_UPDATE,
  TIMER_STATE,
  SET_TIMER_STATE
} from './voteSlice.js';
import historyReducer from './historySlice.js';
import socket, { connectSocketToStore } from '../services/socket.js';
import { getAdminToken, getVoterToken } from '../services/auth.js';

/**
 * Domain actions intended for transmission to the authoritative backend server.
 */
export const REMOTE_ACTION_TYPES = new Set([
  'VOTE',
  'NEXT',
  'SET_ENTRIES',
  'CREATE_SESSION',
  'START_SESSION',
  'ARCHIVE_SESSION'
]);

/**
 * Actions that MUST NOT be emitted back to the server.
 * Mandatory echo-loop prevention.
 */
export const LOCAL_ACTION_TYPES = new Set([
  SET_STATE,
  SESSIONS,
  SESSION_STATE,
  SET_SESSIONS,
  SET_SESSION_STATE,
  SET_ACTIVE_SESSION,
  RESET_SESSIONS,
  LOBBY_UPDATE,
  SET_LOBBY_UPDATE,
  TIMER_STATE,
  SET_TIMER_STATE,
  'voting/setState',
  'voting/resetState',
  'sessions/setSessions',
  'sessions/setSessionState',
  'sessions/setActiveSession',
  'sessions/lobbyUpdate',
  'sessions/setLobbyUpdate',
  'sessions/timerState',
  'sessions/setTimerState',
  'sessions/setState',
  'sessions/resetState'
]);

/**
 * Evaluates whether an action qualifies for remote transmission.
 * Filters out local state synchronization and internal Redux actions.
 * 
 * @param {object} action
 * @returns {boolean}
 */
export function isRemoteAction(action) {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    return false;
  }

  // Echo Prevention: Never transmit local synchronization or internal Redux lifecycle actions
  if (LOCAL_ACTION_TYPES.has(action.type) || action.type.startsWith('@@')) {
    return false;
  }

  return action.meta?.remote === true || REMOTE_ACTION_TYPES.has(action.type);
}

/**
 * Remote Action Middleware: intercepts client actions and emits them via socket.emit('action', action).
 * Automatically enriches VOTE actions with session voterToken and admin lifecycle actions with admin JWT.
 * 
 * @param {object} [socketInstance] - Socket.io client instance
 */
export const createRemoteActionMiddleware = (socketInstance) => () => (next) => (action) => {
  if (isRemoteAction(action)) {
    let enrichedAction = action;

    if (action.type === 'VOTE') {
      const sessionId = action.sessionId || action.electionId;
      const voterToken = action.voterToken || action.meta?.voterToken || getVoterToken(sessionId);
      if (voterToken && !action.voterToken) {
        enrichedAction = {
          ...action,
          voterToken,
          meta: { ...(action.meta || {}), voterToken }
        };
      }
    } else if (
      action.type === 'NEXT' ||
      action.type === 'SET_ENTRIES' ||
      action.type === 'CREATE_SESSION' ||
      action.type === 'START_SESSION' ||
      action.type === 'ARCHIVE_SESSION'
    ) {
      const adminToken = action.token || action.meta?.token || getAdminToken();
      if (adminToken && !action.token) {
        enrichedAction = {
          ...action,
          token: adminToken,
          meta: { ...(action.meta || {}), token: adminToken }
        };
      }
    }

    if (socketInstance && typeof socketInstance.emit === 'function') {
      socketInstance.emit('action', enrichedAction);
    }
  }
  return next(action);
};

/**
 * Factory to create a configured Redux store instance.
 * Enables clean instantiation, dependency injection, and isolated unit testing.
 * 
 * @param {object} [socketInstance] - Socket.io client instance (defaults to singleton socket)
 */
export function createAppStore(socketInstance = socket) {
  const storeInstance = configureStore({
    reducer: {
      sessions: voteReducer,
      history: historyReducer
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: true
      }).concat(createRemoteActionMiddleware(socketInstance))
  });

  if (socketInstance) {
    connectSocketToStore(storeInstance, socketInstance);
  }

  return storeInstance;
}

/**
 * Singleton client Redux store bound to the primary socket connection.
 */
export const store = createAppStore(socket);

export default store;
