import { apiRequest } from './api.js';

/**
 * Fetch list of completed tournament results history.
 *
 * @param {number} [limit=50]
 * @returns {Promise<{ success: boolean, results?: Array<object>, count?: number, error?: string, message?: string }>}
 */
export async function fetchSessionHistory(limit = 50) {
  const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
  // apiRequest attaches the `vs_voter` cookie and, when an admin token is
  // stored, the admin Bearer header, so the admin and an approved participant
  // can both read a gated secured result (spec 0008).
  const res = await apiRequest(`/api/sessions/history${query}`);
  const data = res.data;

  if (!res.ok || !data || !data.success) {
    return {
      success: false,
      error: res.networkError ? 'NETWORK_ERROR' : ((data && data.error) || 'DATABASE_ERROR'),
      message: res.networkError
        ? (res.message || 'Network error connecting to history server.')
        : ((data && data.message) || 'Failed to retrieve results history.'),
      results: []
    };
  }

  return {
    success: true,
    results: Array.isArray(data.results) ? data.results : [],
    count: typeof data.count === 'number' ? data.count : (data.results?.length || 0)
  };
}

/**
 * Fetch the completed result for a specific session ID.
 *
 * @param {string} sessionId
 * @returns {Promise<{ success: boolean, result?: object, error?: string, message?: string }>}
 */
export async function fetchSessionResult(sessionId) {
  if (!sessionId) {
    return {
      success: false,
      error: 'INVALID_SESSION_ID',
      message: 'Session ID is required.'
    };
  }

  const res = await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/result`);
  const data = res.data;

  if (!res.ok || !data || !data.success) {
    return {
      success: false,
      error: res.networkError ? 'NETWORK_ERROR' : ((data && data.error) || 'RESULT_NOT_FOUND'),
      message: res.networkError
        ? (res.message || 'Network error connecting to history server.')
        : ((data && data.message) || `No result found for session "${sessionId}".`)
    };
  }

  return {
    success: true,
    result: data.result || null
  };
}

/**
 * Fetch the round history array for a specific session ID (AC-7).
 *
 * @param {string} sessionId
 * @returns {Promise<{ success: boolean, sessionId?: string, rounds?: Array<object>, error?: string, message?: string }>}
 */
export async function fetchSessionRounds(sessionId) {
  if (!sessionId) {
    return {
      success: false,
      error: 'INVALID_SESSION_ID',
      message: 'Session ID is required.'
    };
  }

  const res = await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}/rounds`);
  const data = res.data;

  if (!res.ok || !data || !data.success) {
    return {
      success: false,
      error: res.networkError ? 'NETWORK_ERROR' : ((data && data.error) || 'ROUNDS_NOT_FOUND'),
      message: res.networkError
        ? (res.message || 'Network error connecting to history server.')
        : ((data && data.message) || `No rounds found for session "${sessionId}".`),
      rounds: []
    };
  }

  return {
    success: true,
    sessionId: data.sessionId,
    rounds: Array.isArray(data.rounds) ? data.rounds : []
  };
}
