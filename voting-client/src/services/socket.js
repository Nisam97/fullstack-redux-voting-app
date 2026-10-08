import { io } from 'socket.io-client';
import { setSessions, setSessionState, setState, lobbyUpdate, setPresenceUpdate, setTimerState, setTiePending, setTurnout, setAdminSessionExpired } from '../redux/voteSlice.js';

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
 * localStorage key holding the admin JWT. Owned here rather than in auth.js
 * because the socket handshake needs it at module load, before any login call
 * has run. auth.js re-exports it so its public API is unchanged.
 */
export const ADMIN_TOKEN_KEY = 'votesphere_admin_jwt';
// Lives here for the same reason as the token key: dropping a dead admin
// credential happens in this module, and auth.js must not be imported from here
// because it already imports this module.
export const ADMIN_USER_KEY = 'votesphere_admin_user';

/**
 * Reads the stored admin JWT, tolerating environments with no localStorage.
 */
export function readStoredAdminToken() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

const initialAdminToken = readStoredAdminToken();

/**
 * Singleton Socket.io client instance connecting to the authoritative voting server.
 *
 * The admin JWT is passed as handshake `auth` so the server can recognise this
 * socket as an admin. That matters because the server filters secured sessions
 * out of the registry broadcast for any socket it cannot authenticate, so an
 * admin whose token is missing sees an empty admin panel. Socket.io only sends
 * `auth` when a connection is established, which is why a stored token has to be
 * read here at construction rather than assigned after login.
 */
export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  ...(initialAdminToken ? { auth: { token: initialAdminToken } } : {})
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
 * Applies an admin JWT to the socket handshake and, when the token actually
 * changed, reconnects so the server sees it.
 *
 * Assigning `socket.auth` on its own does nothing for an already connected
 * socket: Socket.io only transmits `auth` during the handshake. Reconnecting is
 * the only way to change the identity the server holds. `connectSocketToStore`
 * re-requests the registry on every 'connect', so the admin session list
 * refreshes on its own.
 *
 * @param {string|null} token Admin JWT, or null to clear it (logout).
 * @returns {boolean} true when a reconnect was triggered.
 */
export function applyAdminTokenToSocket(token) {
  if (!socket) return false;
  const next = token || null;
  const current = socket.auth?.token || null;
  if (next === current) return false;

  socket.auth = { ...socket.auth };
  if (next) {
    socket.auth.token = next;
  } else {
    delete socket.auth.token;
  }

  try {
    socket.disconnect();
    socket.connect();
  } catch {
    // A transport failure here surfaces through the normal reconnect path.
  }
  return true;
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

export function disconnectSocket() {
  if (socket) {
    try {
      socket.disconnect();
    } catch {
      // harmless
    }
    if (socket.io && typeof socket.io.close === 'function') {
      try {
        socket.io.close();
      } catch {
        // harmless
      }
    }
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
 * Retrieves the stored session-scoped voter token for a specific session.
 * 
 * @param {string} sessionId
 * @returns {string|null}
 */
export function getStoredVoterToken(sessionId) {
  if (!sessionId || typeof window === 'undefined') return null;
  const key = `votesphere_voter_token_${sessionId}`;
  if (window.sessionStorage) {
    const token = window.sessionStorage.getItem(key);
    if (token) return token;
  }
  if (window.localStorage) {
    const token = window.localStorage.getItem(key);
    if (token) return token;
  }
  return null;
}


/**
 * Subscribes to updates for a specific session room.
 * Records the session in the local subscription registry and emits 'subscribe_session'.
 * 
 * @param {string} sessionId
 * @param {object} [socketInstance=socket]
 * @param {string} [voterTokenOverride]
 */
export function subscribeSession(sessionId, socketInstance = socket, voterTokenOverride = null) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return;
  }

  const normalizedId = sessionId.trim();
  subscribedSessions.add(normalizedId);

  const token = voterTokenOverride || getStoredVoterToken(normalizedId);
  const payload = token ? { sessionId: normalizedId, voterToken: token } : { sessionId: normalizedId };

  if (socketInstance && typeof socketInstance.emit === 'function') {
    socketInstance.emit('subscribe_session', payload);
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
 * Admin subscription to the per round turnout view (spec 0008 AC-7). The server
 * pushes the initial snapshot on subscribe and a fresh one after each round
 * closes. Admin only; a non admin socket receives an action_error.
 *
 * @param {string} sessionId
 * @param {object} [socketInstance=socket]
 */
export function subscribeTurnout(sessionId, socketInstance = socket) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return;
  }
  const token = readStoredAdminToken();
  const payload = token
    ? { sessionId: sessionId.trim(), token }
    : { sessionId: sessionId.trim() };
  if (socketInstance && typeof socketInstance.emit === 'function') {
    socketInstance.emit('subscribe_turnout', payload);
  }
}

/**
 * Unsubscribes from the turnout view.
 *
 * @param {string} sessionId
 * @param {object} [socketInstance=socket]
 */
export function unsubscribeTurnout(sessionId, socketInstance = socket) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return;
  }
  if (socketInstance && typeof socketInstance.emit === 'function') {
    socketInstance.emit('unsubscribe_turnout', { sessionId: sessionId.trim() });
  }
}

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
    socketInstance.off('presence_update');
    socketInstance.off('timer_state');
    socketInstance.off('tie_pending');
    socketInstance.off('state');
    socketInstance.off('session_turnout');
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

  // Listen for room scoped lobby updates
  socketInstance.on('lobby_update', (lobbyData) => {
    store.dispatch(lobbyUpdate(lobbyData));
  });

  // Listen for room scoped presence updates
  socketInstance.on('presence_update', (presenceData) => {
    store.dispatch(setPresenceUpdate(presenceData));
  });

  // Listen for room-scoped timer updates
  socketInstance.on('timer_state', (timerData) => {
    store.dispatch(setTimerState(timerData));
  });

  // Listen for tie pending ladder updates
  socketInstance.on('tie_pending', (tieData) => {
    store.dispatch(setTiePending(tieData));
  });

  // Admin per round turnout snapshot (spec 0008 AC-7)
  socketInstance.on('session_turnout', (turnoutData) => {
    store.dispatch(setTurnout(turnoutData));
  });

  // A server side UNAUTHORIZED means the stored admin JWT is no longer
  // verifiable: the server restarted under a different JWT secret, the secret
  // was rotated, or the credential was revoked. The local expiry check in
  // isAdminLoggedIn still passes, so without this the app keeps rendering admin
  // UI whose every action is refused, and the admin reads an empty per round
  // turnout as "no rounds recorded yet". Drop the dead credential, clear the
  // socket handshake, and let the store say the session is gone.
  socketInstance.on('action_error', (err) => {
    if (!err || err.error !== 'UNAUTHORIZED') return;
    if (!readStoredAdminToken()) return;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(ADMIN_TOKEN_KEY);
        window.localStorage.removeItem(ADMIN_USER_KEY);
      }
    } catch {
      // storage unavailable; the handshake reset below is the part that matters
    }
    applyAdminTokenToSocket(null);
    store.dispatch(setAdminSessionExpired(true));
  });

  // Backward compatibility: legacy single-session 'state' event
  socketInstance.on('state', (serverState) => {
    store.dispatch(setState(serverState));
  });

  // Reconnection lifecycle: on connect/reconnect, restore registry and room subscriptions
  socketInstance.on('connect', () => {
    // Request fresh registry
    requestSessionsRegistry(socketInstance);

    // Restore any active session subscriptions with voter token if present
    for (const sessionId of subscribedSessions) {
      if (typeof socketInstance.emit === 'function') {
        const voterToken = getStoredVoterToken(sessionId);
        const payload = voterToken ? { sessionId, voterToken } : { sessionId };
        socketInstance.emit('subscribe_session', payload);
      }
    }
  });

  return socketInstance;
}

export default socket;
