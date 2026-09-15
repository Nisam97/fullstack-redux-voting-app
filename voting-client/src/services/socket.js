import { io } from 'socket.io-client';
import { setSessions, setSessionState, setState, lobbyUpdate, setTimerState } from '../redux/voteSlice.js';

const getDefaultServerUrl = () => {
  if (typeof window !== 'undefined' && window.__VOTING_SERVER_URL__) {
    return window.__VOTING_SERVER_URL__;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL;
  }
  if (typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env && globalThis.process.env.VITE_SERVER_URL) {
    return globalThis.process.env.VITE_SERVER_URL;
  }
  return 'http://localhost:8090';
};

export const SERVER_URL = getDefaultServerUrl();

/**
 * Singleton Socket.io client instance connecting to the authoritative voting server.
 */
export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling']
});

/**
 * Registry of active session IDs the client has subscribed to.
 * Ensures subscriptions can be restored after a disconnect/reconnect event.
 */
export const subscribedSessions = new Set();
export const subscribedElections = subscribedSessions;

/**
 * Returns the current socket instance.
 */
export function getSocket() {
  return socket;
}

/**
 * Connect the socket if disconnected.
 */
export function connectSocket() {
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

/**
 * Disconnect the socket.
 */
export function disconnectSocket() {
  if (socket.connected) {
    socket.disconnect();
  }
  return socket;
}

/**
 * Send an action object to the backend server via the 'action' Socket.io event.
 * 
 * @param {object} action
 * @param {object} [socketInstance=socket]
 */
export function sendAction(action, socketInstance = socket) {
  if (action && typeof action === 'object' && socketInstance && typeof socketInstance.emit === 'function') {
    socketInstance.emit('action', action);
  }
}

/**
 * Requests the latest sessions registry summary from the server.
 * 
 * @param {object} [socketInstance=socket]
 */
export function requestSessionsRegistry(socketInstance = socket) {
  if (socketInstance && typeof socketInstance.emit === 'function') {
    socketInstance.emit('sessions');
  }
}

export const requestElectionsRegistry = requestSessionsRegistry;

/**
 * Subscribes to updates for a specific session room.
 * Records the session in the local subscription registry and emits 'subscribe_session'.
 * 
 * @param {string} sessionId
 * @param {object} [socketInstance=socket]
 */
export function subscribeSession(sessionId, socketInstance = socket) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return;
  }

  const normalizedId = sessionId.trim();
  subscribedSessions.add(normalizedId);

  if (socketInstance && typeof socketInstance.emit === 'function') {
    socketInstance.emit('subscribe_session', { sessionId: normalizedId });
  }
}

export const subscribeElection = subscribeSession;

/**
 * Unsubscribes from updates for a specific session room.
 * Removes the session from the local subscription registry and emits 'unsubscribe_session'.
 * 
 * @param {string} sessionId
 * @param {object} [socketInstance=socket]
 */
export function unsubscribeSession(sessionId, socketInstance = socket) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return;
  }

  const normalizedId = sessionId.trim();
  subscribedSessions.delete(normalizedId);

  if (socketInstance && typeof socketInstance.emit === 'function') {
    socketInstance.emit('unsubscribe_session', { sessionId: normalizedId });
  }
}

export const unsubscribeElection = unsubscribeSession;

/**
 * Convenience helper to set a single active session subscription.
 * Unsubscribes from all other active sessions and subscribes to the new one.
 * 
 * @param {string} newSessionId
 * @param {object} [socketInstance=socket]
 */
export function setSubscribedSession(newSessionId, socketInstance = socket) {
  for (const currentId of Array.from(subscribedSessions)) {
    if (currentId !== newSessionId) {
      unsubscribeSession(currentId, socketInstance);
    }
  }

  if (newSessionId) {
    subscribeSession(newSessionId, socketInstance);
  }
}

export const setSubscribedElection = setSubscribedSession;

/**
 * Returns a list of currently subscribed session IDs.
 * 
 * @returns {string[]}
 */
export function getSubscribedSessions() {
  return Array.from(subscribedSessions);
}

export const getSubscribedElections = getSubscribedSessions;

/**
 * Clears all session subscriptions.
 * 
 * @param {object} [socketInstance=socket]
 */
export function clearSubscriptions(socketInstance = socket) {
  for (const sessionId of Array.from(subscribedSessions)) {
    unsubscribeSession(sessionId, socketInstance);
  }
  subscribedSessions.clear();
}

/**
 * Connects Socket.io client events to the Redux store.
 * Subscribes to:
 * - 'sessions': Updates state.sessions.list
 * - 'session_state': Updates state.sessions.bySessionId[sessionId]
 * - 'elections': Backward compat registry update
 * - 'election_state': Backward compat room update
 * - 'state': Legacy fallback for single-session state
 * - 'connect': Automatically queries registry and restores active subscriptions
 * 
 * @param {object} store - Redux store instance with dispatch
 * @param {object} [socketInstance=socket] - Socket.io client instance
 */
export function connectSocketToStore(store, socketInstance = socket) {
  if (!store || typeof store.dispatch !== 'function') {
    throw new Error('connectSocketToStore requires a valid Redux store with a dispatch method');
  }

  if (!socketInstance || typeof socketInstance.on !== 'function') {
    return socketInstance;
  }

  // Remove pre-existing listeners to prevent duplicate dispatches
  if (typeof socketInstance.off === 'function') {
    socketInstance.off('sessions');
    socketInstance.off('session_state');
    socketInstance.off('lobby_update');
    socketInstance.off('timer_state');
    socketInstance.off('state');
    socketInstance.off('connect');
  }

  // Listen for registry summary updates
  socketInstance.on('sessions', (registryList) => {
    store.dispatch(setSessions(registryList));
  });

  // Listen for authoritative session-specific state updates
  socketInstance.on('session_state', (sessionData) => {
    store.dispatch(setSessionState(sessionData));
  });

  // Listen for room-scoped lobby updates
  socketInstance.on('lobby_update', (lobbyData) => {
    store.dispatch(lobbyUpdate(lobbyData));
  });

  // Listen for room-scoped timer updates
  socketInstance.on('timer_state', (timerData) => {
    store.dispatch(setTimerState(timerData));
  });

  // Backward compatibility: legacy single-session 'state' event
  socketInstance.on('state', (serverState) => {
    store.dispatch(setState(serverState));
  });

  // Reconnection lifecycle: on connect/reconnect, restore registry and room subscriptions
  socketInstance.on('connect', () => {
    // Request fresh registry
    requestSessionsRegistry(socketInstance);

    // Restore any active session subscriptions
    for (const sessionId of subscribedSessions) {
      if (typeof socketInstance.emit === 'function') {
        socketInstance.emit('subscribe_session', { sessionId });
      }
    }
  });

  return socketInstance;
}

export default socket;
