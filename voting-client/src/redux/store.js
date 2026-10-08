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
import voterAuthReducer from './voterAuthSlice.js';
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
  'ARCHIVE_SESSION',
  'REFRESH_JOIN_CODE',
  'RESOLVE_TIE',
  'SET_ALLOWLIST',
  'APPROVE_PARTICIPANT',
  'REJECT_PARTICIPANT',
  'REMOVE_PARTICIPANT',
  'SET_WHO_CAN_JOIN',
  'SET_PUBLISH_RESULTS'
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
  'APPEND_ROUND_RESULT',
  'sessions/appendRoundResult',
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
  'sessions/resetState',
  'SET_TIE_PENDING',
  'tie_pending',
  'sessions/setTiePendingAction',
  'SET_TURNOUT',
  'session_turnout',
  'sessions/setTurnout',
  'SET_ADMIN_SESSION_EXPIRED',
  'sessions/setAdminSessionExpired',
  'SET_PUBLISH_RESULTS_LOCAL',
  'voterAuth/setVoterAuth',
  'voterAuth/clearVoterAuth',
  'voterAuth/setVoterLoading',
  'voterAuth/setVoterError'
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
}/**
 * Strips the local acknowledgement callback from an action before it goes on
 * the wire. A function is not serialisable, so leaving it in `meta` would be
 * dead weight in the payload and would trip a serialisability inspection; the
 * server has no use for it. The ack travels as the Socket.io emit callback
 * instead.
 *
 * @param {object} action
 * @returns {object} The action without `meta.onAck`.
 */
function withoutAck(action) {
  if (!action || !action.meta || typeof action.meta.onAck !== 'function') {
    return action;
  }
  const restMeta = { ...action.meta };
  delete restMeta.onAck;
  return { ...action, meta: restMeta };
}

/**
 * Remote Action Middleware: intercepts client actions and emits them via socket.emit('action', action).
 * Automatically enriches VOTE actions with session voterToken and admin lifecycle actions with admin JWT.
 *
 * An action may carry `meta.onAck`, a callback receiving the server's answer.
 * When present it is attached as the Socket.io acknowledgement callback and
 * removed from the payload, so the caller can wait for the authoritative
 * result instead of assuming one (spec 0008 AC-3).
 *
 * @param {object} [socketInstance] - Socket.io client instance
 */
export const createRemoteActionMiddleware = (socketInstance) => (storeApi) => (next) => (action) => {
  if (isRemoteAction(action)) {
    let enrichedAction = action;

    if (action.type === 'VOTE') {
      const sessionId = action.sessionId || action.electionId;
      const loggedInUserId = storeApi?.getState?.()?.voterAuth?.user?.id;
      const voterToken = action.voterToken || action.meta?.voterToken || getVoterToken(sessionId) || (loggedInUserId ? `user:${loggedInUserId}` : null);
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
      action.type === 'ARCHIVE_SESSION' ||
      action.type === 'REFRESH_JOIN_CODE' ||
      action.type === 'RESOLVE_TIE' ||
      action.type === 'SET_ALLOWLIST' ||
      action.type === 'APPROVE_PARTICIPANT' ||
      action.type === 'REJECT_PARTICIPANT' ||
      action.type === 'REMOVE_PARTICIPANT' ||
      action.type === 'SET_WHO_CAN_JOIN' ||
      action.type === 'SET_PUBLISH_RESULTS'
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
      const ack = typeof action.meta?.onAck === 'function' ? action.meta.onAck : null;
      if (ack) {
        socketInstance.emit('action', withoutAck(enrichedAction), ack);
      } else {
        socketInstance.emit('action', enrichedAction);
      }
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
      history: historyReducer,
      voterAuth: voterAuthReducer
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
