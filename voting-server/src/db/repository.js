import Session from './models/Session.js';
import Result from './models/Result.js';

/**
 * Save or update session metadata in MongoDB (upsert).
 * @param {Object} sessionData
 * @returns {Promise<Object>}
 */
export async function saveSession(sessionData) {
  if (!sessionData || !sessionData.sessionId) {
    throw new Error('sessionId is required to save a session');
  }
  const update = { ...sessionData };
  return await Session.findOneAndUpdate(
    { sessionId: sessionData.sessionId },
    { $set: update },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
  );
}

/**
 * Update the status of a session, with optional winner and lifecycle timestamp.
 * @param {string} sessionId
 * @param {'pending'|'open'|'completed'|'archived'} status
 * @param {string|null} [winner]
 * @returns {Promise<Object|null>}
 */
export async function updateSessionStatus(sessionId, status, winner = null) {
  if (!sessionId) {
    throw new Error('sessionId is required to update session status');
  }
  const update = { status };
  if (winner !== null && winner !== undefined) {
    update.winner = winner;
  }
  if (status === 'completed') {
    update.completedAt = new Date();
  } else if (status === 'archived') {
    update.archivedAt = new Date();
  }
  // Prevent out-of-order concurrent transitions from regressing lifecycle status
  const filter = { sessionId };
  if (status === 'open') {
    filter.status = { $nin: ['completed', 'archived'] };
  } else if (status === 'completed') {
    filter.status = { $ne: 'archived' };
  }

  return await Session.findOneAndUpdate(
    filter,
    { $set: update },
    { returnDocument: 'after', runValidators: true }
  );
}

/**
 * Retrieve all non-archived sessions.
 * @returns {Promise<Array>}
 */
export async function getActiveSessions() {
  return await Session.find({ status: { $ne: 'archived' } }).sort({ createdAt: 1 });
}

/**
 * Retrieve all sessions including archived ones.
 * @returns {Promise<Array>}
 */
export async function getAllSessions() {
  return await Session.find({}).sort({ createdAt: 1 });
}

/**
 * Retrieve a specific session by its sessionId.
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function getSessionBySessionId(sessionId) {
  return await Session.findOne({ sessionId });
}

/**
 * Mark a session as open (active tournament).
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function markSessionOpen(sessionId) {
  return await updateSessionStatus(sessionId, 'open');
}

/**
 * Mark a session as completed with the specified winner.
 * @param {string} sessionId
 * @param {string} winner
 * @returns {Promise<Object|null>}
 */
export async function markSessionCompleted(sessionId, winner) {
  return await updateSessionStatus(sessionId, 'completed', winner);
}

/**
 * Mark a session as archived.
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function markSessionArchived(sessionId) {
  return await updateSessionStatus(sessionId, 'archived');
}

/**
 * Reset all 'open' sessions to 'pending' (used during server recovery).
 * @returns {Promise<Object>}
 */
export async function resetOpenSessionsToPending() {
  return await Session.updateMany(
    { status: 'open' },
    { $set: { status: 'pending' } }
  );
}

/**
 * Save an immutable completed tournament result.
 * @param {Object} resultData
 * @returns {Promise<Object>}
 */
export async function saveResult(resultData) {
  if (!resultData || !resultData.sessionId || !resultData.winner || !resultData.entries) {
    throw new Error('sessionId, winner, and entries are required to save a result');
  }
  // Idempotency: avoid creating duplicate Result records for the same session
  const existing = await Result.findOne({ sessionId: resultData.sessionId });
  if (existing) {
    return existing;
  }
  return await Result.findOneAndUpdate(
    { sessionId: resultData.sessionId },
    {
      $setOnInsert: {
        sessionId: resultData.sessionId,
        title: resultData.title || '',
        entries: resultData.entries,
        winner: resultData.winner,
        completedAt: resultData.completedAt || new Date()
      }
    },
    { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true }
  );
}

/**
 * Retrieve completed results sorted by completedAt desc.
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function getCompletedResults(limit = 50) {
  const parsedLimit = parseInt(limit, 10);
  const maxResults = isNaN(parsedLimit) || parsedLimit <= 0 ? 50 : Math.min(parsedLimit, 100);
  return await Result.find({}).sort({ completedAt: -1 }).limit(maxResults).lean();
}

/**
 * Retrieve the completed result for a specific session.
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function getResultBySessionId(sessionId) {
  return await Result.findOne({ sessionId }).sort({ completedAt: -1 }).lean();
}
