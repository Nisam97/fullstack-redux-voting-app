import { SERVER_URL, socket } from './socket.js';

export const ADMIN_TOKEN_KEY = 'votesphere_admin_jwt';
export const ADMIN_USER_KEY = 'votesphere_admin_user';

/**
 * Returns the currently stored admin JWT token, if any.
 */
export function getAdminToken() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) || null;
}

/**
 * Returns the stored admin user profile, if any.
 */
export function getAdminUser() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  const raw = window.localStorage.getItem(ADMIN_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Checks whether an admin session is currently active.
 */
export function isAdminLoggedIn() {
  const token = getAdminToken();
  if (!token) return false;
  // Basic payload expiration check if possible
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        logoutAdmin();
        return false;
      }
    }
  } catch {
    // If parsing fails, fall back to checking token presence
  }
  return true;
}

/**
 * Logs in the administrator using credentials, storing the returned JWT.
 *
 * @param {Object} credentials
 * @param {string} [credentials.username]
 * @param {string} [credentials.email]
 * @param {string} credentials.password
 * @returns {Promise<{ success: boolean, token?: string, user?: Object, error?: string, message?: string }>}
 */
export async function loginAdmin({ username, email, password }) {
  try {
    const response = await fetch(`${SERVER_URL}/api/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: username || email,
        email: email || username,
        password
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'INVALID_CREDENTIALS',
        message: data.message || 'Invalid username/email or password.'
      };
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      if (data.user) {
        window.localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
      }
    }

    // Also synchronize socket auth if socket is connected
    if (socket) {
      socket.auth = { ...socket.auth, token: data.token };
    }

    return {
      success: true,
      token: data.token,
      user: data.user
    };
  } catch (err) {
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: err.message || 'Failed to connect to authentication server.'
    };
  }
}

/**
 * Clears admin authentication tokens.
 */
export function logoutAdmin() {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    window.localStorage.removeItem(ADMIN_USER_KEY);
  }
  if (socket && socket.auth) {
    delete socket.auth.token;
  }
}

// --- Session-Scoped Voter Identity ---

export const getVoterTokenKey = (sessionId) => `votesphere_voter_token_${sessionId}`;
export const getVoterNameKey = (sessionId) => `votesphere_voter_name_${sessionId}`;

/**
 * Retrieves the session-scoped voter token for a specific session.
 *
 * @param {string} sessionId
 * @returns {string|null}
 */
export function getVoterToken(sessionId) {
  if (!sessionId) return null;
  if (typeof window === 'undefined') return null;

  const storage = window.sessionStorage || window.localStorage;
  if (!storage) return null;
  return storage.getItem(getVoterTokenKey(sessionId)) || null;
}

/**
 * Retrieves the stored display name for a specific session.
 *
 * @param {string} sessionId
 * @returns {string|null}
 */
export function getVoterDisplayName(sessionId) {
  if (!sessionId) return null;
  if (typeof window === 'undefined') return null;

  const storage = window.sessionStorage || window.localStorage;
  if (!storage) return null;
  return storage.getItem(getVoterNameKey(sessionId)) || null;
}

/**
 * Checks whether the voter has joined the given session.
 *
 * @param {string} sessionId
 * @returns {boolean}
 */
export function hasJoinedSession(sessionId) {
  return Boolean(getVoterToken(sessionId));
}

/**
 * Joins a voting session by submitting a display name.
 * Receives and stores a random session-scoped voter token.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.displayName
 * @returns {Promise<{ success: boolean, voterToken?: string, displayName?: string, error?: string, message?: string }>}
 */
export async function joinVoterSession({ sessionId, displayName }) {
  if (!sessionId) {
    return { success: false, error: 'INVALID_SESSION', message: 'Session ID is required.' };
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim() === '') {
    return { success: false, error: 'INVALID_DISPLAY_NAME', message: 'Display name is required.' };
  }

  try {
    const response = await fetch(`${SERVER_URL}/api/sessions/${encodeURIComponent(sessionId)}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ displayName: displayName.trim() })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'JOIN_FAILED',
        message: data.message || 'Failed to join voting session.'
      };
    }

    const voterToken = data.voterToken;
    const voterName = data.displayName;

    if (typeof window !== 'undefined') {
      const storage = window.sessionStorage || window.localStorage;
      if (storage) {
        storage.setItem(getVoterTokenKey(sessionId), voterToken);
        storage.setItem(getVoterNameKey(sessionId), voterName);
      }
    }

    // If socket is available, also notify socket of the join
    if (socket && socket.connected) {
      socket.emit('join_session', { sessionId, displayName: voterName });
    }

    return {
      success: true,
      voterToken,
      displayName: voterName,
      voterCount: data.voterCount,
      sessionId
    };
  } catch (err) {
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: err.message || 'Failed to connect to voting server.'
    };
  }
}

/**
 * Clears voter token for a specific session.
 *
 * @param {string} sessionId
 */
export function clearVoterSession(sessionId) {
  if (!sessionId || typeof window === 'undefined') return;
  const storage = window.sessionStorage || window.localStorage;
  if (storage) {
    storage.removeItem(getVoterTokenKey(sessionId));
    storage.removeItem(getVoterNameKey(sessionId));
  }
}
