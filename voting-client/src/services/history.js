import { SERVER_URL } from './socket.js';

/**
 * Fetch list of completed tournament results history.
 *
 * @param {number} [limit=50]
 * @returns {Promise<{ success: boolean, results?: Array<object>, count?: number, error?: string, message?: string }>}
 */
export async function fetchSessionHistory(limit = 50) {
  try {
    const url = new URL(`${SERVER_URL}/api/sessions/history`);
    if (limit) {
      url.searchParams.set('limit', String(limit));
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'DATABASE_ERROR',
        message: data.message || 'Failed to retrieve results history.',
        results: []
      };
    }

    return {
      success: true,
      results: Array.isArray(data.results) ? data.results : [],
      count: typeof data.count === 'number' ? data.count : (data.results?.length || 0)
    };
  } catch (err) {
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: err.message || 'Network error connecting to history server.',
      results: []
    };
  }
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

  try {
    const response = await fetch(`${SERVER_URL}/api/sessions/${encodeURIComponent(sessionId)}/result`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'RESULT_NOT_FOUND',
        message: data.message || `No result found for session "${sessionId}".`
      };
    }

    return {
      success: true,
      result: data.result || null
    };
  } catch (err) {
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: err.message || 'Network error connecting to history server.'
    };
  }
}
