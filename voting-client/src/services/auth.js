import { socket, ADMIN_TOKEN_KEY, ADMIN_USER_KEY, applyAdminTokenToSocket, reattachVoterIdentityToSocket } from './socket.js';
import { apiRequest } from './api.js';

// Re-exported so existing importers of auth.js keep working. The keys live in
// socket.js now, because the socket handshake reads them at module load and
// dropping a dead credential happens there too.
export { ADMIN_TOKEN_KEY, ADMIN_USER_KEY };

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
  // Admin auth is the JWT in the body, not a cookie, but every request to this
  // app's own server carries credentials so no endpoint can silently depend on
  // a cookie the client forgot to send. apiRequest sets that centrally.
  const res = await apiRequest('/api/admin/login', {
    method: 'POST',
    body: {
      username: username || email,
      email: email || username,
      password
    }
  });

  const data = res.data || {};

  if (!res.ok || !data.success) {
    return {
      success: false,
      error: res.networkError ? 'NETWORK_ERROR' : (data.error || 'INVALID_CREDENTIALS'),
      message: res.networkError
        ? (res.message || 'Failed to connect to authentication server.')
        : (data.message || 'Invalid username/email or password.')
    };
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    if (data.user) {
      window.localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(data.user));
    }
  }

  // The server decides admin vs voter from the socket handshake, so the new
  // token only takes effect once the socket reconnects with it. Without this
  // the admin panel keeps showing the voter filtered session list.
  applyAdminTokenToSocket(data.token);

  return {
    success: true,
    token: data.token,
    user: data.user
  };
}

/**
 * Clears admin authentication tokens.
 */
export function logoutAdmin() {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    window.localStorage.removeItem(ADMIN_USER_KEY);
  }
  // Drop the admin identity from the handshake and reconnect, otherwise the
  // socket would keep its previous admin privileges until the page reloads.
  applyAdminTokenToSocket(null);
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

  const res = await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/join`, {
    method: 'POST',
    body: { displayName: displayName.trim() }
  });
  const data = res.data || {};

  if (!res.ok || !data.success) {
    return {
      success: false,
      error: res.networkError ? 'NETWORK_ERROR' : (data.error || 'JOIN_FAILED'),
      message: res.networkError
        ? (res.message || 'Failed to connect to voting server.')
        : (data.message || 'Failed to join voting session.')
    };
  }

  if (data.status === 'pending_approval') {
    return {
      success: true,
      status: 'pending_approval',
      requestId: data.requestId,
      message: data.message || 'Your join request is pending organizer approval.',
      sessionId
    };
  }

  const voterToken = data.voterToken;
  const voterName = data.displayName;

  if (typeof window !== 'undefined' && voterToken) {
    const storage = window.sessionStorage || window.localStorage;
    if (storage) {
      storage.setItem(getVoterTokenKey(sessionId), voterToken);
      if (voterName) {
        storage.setItem(getVoterNameKey(sessionId), voterName);
      }
    }
  }

  if (socket && typeof socket.emit === 'function' && voterToken) {
    socket.emit('subscribe_session', { sessionId, voterToken });
  }

  return {
    success: true,
    voterToken,
    displayName: voterName,
    displayNameSource: data.displayNameSource,
    voterCount: data.voterCount,
    sessionId
  };
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

// --- Passwordless Voter Account & OTP APIs ---

/**
 * Requests an OTP code to be sent to email.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} [params.name]
 * @param {string} [params.username]
 * @returns {Promise<{ success: boolean, message?: string, error?: string, retryAfterSeconds?: number }>}
 */
export async function requestOtp({ email, name, username }) {
  const res = await apiRequest('/api/auth/otp/request', {
    method: 'POST',
    body: { email, name, username }
  });
  const data = res.data || {};

  if (!res.ok || !data.success) {
    return {
      success: false,
      error: res.networkError ? 'NETWORK_ERROR' : (data.error || 'OTP_REQUEST_FAILED'),
      message: res.networkError
        ? (res.message || 'Failed to connect to authentication server.')
        : (data.message || 'Failed to request verification code.'),
      retryAfterSeconds: data.retryAfterSeconds
    };
  }

  return {
    success: true,
    message: data.message
  };
}

/**
 * Verifies a 6-digit OTP code, sets vs_voter httpOnly cookie on backend,
 * and returns user profile.
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.code
 * @returns {Promise<{ success: boolean, user?: Object, isNewUser?: boolean, error?: string, message?: string }>}
 */
export async function verifyOtp({ email, code }) {
  const res = await apiRequest('/api/auth/otp/verify', {
    method: 'POST',
    body: { email, code }
  });
  const data = res.data || {};

  if (!res.ok || !data.success) {
    return {
      success: false,
      error: res.networkError ? 'NETWORK_ERROR' : (data.error || 'VERIFY_FAILED'),
      message: res.networkError
        ? (res.message || 'Failed to connect to authentication server.')
        : (data.message || 'Failed to verify code.'),
      remainingAttempts: data.remainingAttempts
    };
  }

  return {
    success: true,
    user: data.user,
    isNewUser: data.isNewUser
  };
}

/**
 * Retrieves the current voter's profile using the vs_voter cookie.
 *
 * @returns {Promise<{ success: boolean, user?: Object, error?: string }>}
 */
export async function getVoterProfile() {
  const res = await apiRequest('/api/auth/voter/me');
  const data = res.data;

  if (!res.ok || !data || !data.success) {
    return {
      success: false,
      error: res.networkError ? 'NETWORK_ERROR' : ((data && data.error) || 'UNAUTHORIZED')
    };
  }

  return {
    success: true,
    user: data.user
  };
}

/**
 * Updates the voter's display name or username.
 *
 * @param {Object} params
 * @param {string} [params.name]
 * @param {string} [params.username]
 * @returns {Promise<{ success: boolean, user?: Object, error?: string, message?: string }>}
 */
export async function updateVoterProfile({ name, username }) {
  const res = await apiRequest('/api/auth/profile', {
    method: 'POST',
    body: { name, username }
  });
  const data = res.data || {};

  if (!res.ok || !data.success) {
    return {
      success: false,
      error: res.networkError ? 'NETWORK_ERROR' : (data.error || 'UPDATE_FAILED'),
      message: res.networkError
        ? (res.message || 'Failed to connect to server.')
        : (data.message || 'Failed to update profile.')
    };
  }

  return {
    success: true,
    user: data.user
  };
}

/**
 * Logs out the voter by clearing the vs_voter cookie on the backend.
 *
 * On success the socket re-handshakes, the mirror of what
 * `applyAdminTokenToSocket(null)` does for admin logout. The server derived the
 * voter identity from the cookie when this socket first connected, so clearing
 * the cookie alone leaves the old identity on the connection; only a fresh
 * handshake drops it. A failed logout deliberately does not reconnect, because
 * the cookie is still set and a new handshake would just re-adopt the identity
 * the voter asked to leave.
 *
 * @returns {Promise<{ success: boolean, status: number, error: string|null, message: string|null }>}
 */
export async function logoutVoter() {
  const res = await apiRequest('/api/auth/logout', { method: 'POST' });

  const success = res.ok && Boolean(res.data && res.data.success);
  if (success) {
    reattachVoterIdentityToSocket();
    return { success: true, status: res.status, error: null, message: null };
  }

  // No response at all, so nothing is known about the cookie: status 0 marks
  // "the request never landed" rather than an HTTP verdict.
  if (res.networkError) {
    return {
      success: false,
      status: 0,
      error: 'NETWORK_ERROR',
      message: res.message
        ? `Could not reach the voting server: ${res.message}`
        : 'Could not reach the voting server.'
    };
  }

  // A refused logout leaves the vs_voter cookie in place, so the caller must
  // not treat this as a completed sign out: clearing local voter state here
  // would render a signed out navbar while the server still honours the
  // cookie. Report the status and the server's own words so the surface can
  // say what happened, and so a 401 (there is no live voter session to keep)
  // can be told apart from a failure that leaves the state unknown.
  return {
    success: false,
    status: res.status,
    error: (res.data && res.data.error) || 'LOGOUT_FAILED',
    message: (res.data && res.data.message) || 'The server could not complete the sign out.'
  };
}
