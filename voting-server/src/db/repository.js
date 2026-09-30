import Session from './models/Session.js';
import Result from './models/Result.js';

const sessionWriteQueues = new Map();

function enqueueSessionWrite(sessionId, fn) {
  const prev = sessionWriteQueues.get(sessionId) || Promise.resolve();
  const next = prev.then(fn, fn);
  const cleanup = () => {
    if (sessionWriteQueues.get(sessionId) === tail) {
      sessionWriteQueues.delete(sessionId);
    }
  };
  const tail = next.then(cleanup, cleanup);
  sessionWriteQueues.set(sessionId, tail);
  return next;
}

/**
 * Save or update session metadata in MongoDB (upsert).
 * @param {Object} sessionData
 * @returns {Promise<Object>}
 */
export async function saveSession(sessionData) {
  if (!sessionData || !sessionData.sessionId) {
    throw new Error('sessionId is required to save a session');
  }
  return enqueueSessionWrite(sessionData.sessionId, () => saveSessionInner(sessionData));
}

async function saveSessionInner(sessionData) {
  const update = { ...sessionData };
  const updateOps = { $set: update };

  if (update.status === 'pending') {
    delete update.status;
    updateOps.$setOnInsert = { status: 'pending' };
  }

  return await Session.findOneAndUpdate(
    { sessionId: sessionData.sessionId },
    updateOps,
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
  return enqueueSessionWrite(sessionId, () => updateSessionStatusInner(sessionId, status, winner));
}

async function updateSessionStatusInner(sessionId, status, winner = null) {
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
 * Incrementally append a closed round snapshot to the session's Result document.
 * Creates a partial Result document on first round close if one does not exist.
 * Idempotent via roundIndex check: if a snapshot with the same roundIndex already exists, skips the push.
 *
 * @param {string} sessionId
 * @param {Object} roundData - Round snapshot
 * @param {Object} [sessionMeta={}] - Optional metadata (title, entries) for initialization
 * @returns {Promise<Object>} The updated or existing Result document
 */
export async function pushRoundToResult(sessionId, roundData, sessionMeta = {}) {
  if (!sessionId || !roundData || roundData.roundIndex === undefined) {
    throw new Error('sessionId and roundData with roundIndex are required');
  }
  return enqueueResultWrite(sessionId, () => pushRoundToResultInner(sessionId, roundData, sessionMeta));
}

// One write at a time per session Result document. Round pushes fire and
// forget, so without this queue the completion persist could run while the
// first round push was still in flight, see no document, and create a second
// Result doc for the same session. The server is a single authoritative
// process, so an in process queue is a complete serialization here.
const resultWriteQueues = new Map();

function enqueueResultWrite(sessionId, fn) {
  const prev = resultWriteQueues.get(sessionId) || Promise.resolve();
  const next = prev.then(fn, fn);
  const cleanup = () => {
    if (resultWriteQueues.get(sessionId) === tail) {
      resultWriteQueues.delete(sessionId);
    }
  };
  const tail = next.then(cleanup, cleanup);
  resultWriteQueues.set(sessionId, tail);
  return next;
}

async function pushRoundToResultInner(sessionId, roundData, sessionMeta = {}) {

  const existing = await Result.findOne({ sessionId });
  if (existing) {
    const rounds = existing.rounds || [];
    const alreadyPushed = rounds.some(r => r.roundIndex === roundData.roundIndex);
    if (alreadyPushed) {
      // Same index already stored. If the content matches, this is a harmless
      // idempotent replay. If it differs, a fresher snapshot closed the round
      // and the stored row is stale (for example an empty tally captured by a
      // stray identity before the tie window resolved), so correct it in place.
      const stored = rounds.find(r => r.roundIndex === roundData.roundIndex);
      const sameContent = stored
        && stored.resolution === roundData.resolution
        && JSON.stringify(stored.tally || {}) === JSON.stringify(roundData.tally || {})
        && JSON.stringify(stored.candidates || []) === JSON.stringify(roundData.candidates || []);
      if (sameContent) {
        return existing;
      }
      await Result.updateOne(
        { sessionId, 'rounds.roundIndex': roundData.roundIndex },
        { $set: { 'rounds.$': roundData } }
      );
      return await Result.findOne({ sessionId });
    }
    // Atomic guarded push: the filter rechecks the round index inside the
    // update, so two concurrent pushes for the same round cannot both append.
    // The old read then push race persisted the same snapshot twice. $position
    // keeps the array ordered by roundIndex, matching the store's rounds order
    // even when a racing writer appended an out of order snapshot first.
    const higherIndex = rounds.some(r => r.roundIndex > roundData.roundIndex);
    const pushOp = higherIndex
      ? { $each: [roundData], $position: rounds.findIndex(r => r.roundIndex > roundData.roundIndex) }
      : roundData;
    const guarded = await Result.updateOne(
      { sessionId, 'rounds.roundIndex': { $ne: roundData.roundIndex } },
      {
        $push: { rounds: pushOp },
        $set: {
          ...(sessionMeta.title && !existing.title ? { title: sessionMeta.title } : {}),
          ...(sessionMeta.entries && Array.isArray(sessionMeta.entries) && sessionMeta.entries.length > 0 && (!existing.entries || existing.entries.length === 0) ? { entries: sessionMeta.entries } : {})
        }
      }
    );
    if (guarded.matchedCount === 0) {
      // A racing writer appended this index first; replace its row with the
      // freshest snapshot this caller holds.
      await Result.updateOne(
        { sessionId, 'rounds.roundIndex': roundData.roundIndex },
        { $set: { 'rounds.$': roundData } }
      );
    }
    return await Result.findOne({ sessionId });
  }

  // Create partial Result document on first round close
  const title = sessionMeta.title || '';
  const entries = Array.isArray(sessionMeta.entries) && sessionMeta.entries.length > 0
    ? sessionMeta.entries
    : (roundData.candidates || []);

  await Result.collection.updateOne(
    { sessionId },
    {
      $setOnInsert: {
        sessionId,
        title,
        entries,
        winner: null,
        completedAt: null
      },
      $push: {
        rounds: roundData
      }
    },
    { upsert: true }
  );

  // Race guard: a concurrent first push for the same round can append onto the
  // document this upsert just created (its read saw no document). Collapse any
  // duplicate the race produced.
  return await reconcileRoundRow(sessionId, roundData, sessionMeta);
}

/**
 * Collapses duplicate rows for one round index down to a single row and keeps
 * the rounds array ordered by roundIndex. The freshest content wins for the
 * reconciled index. Returns the document unchanged when there is no duplicate.
 */
async function reconcileRoundRow(sessionId, roundData, sessionMeta = {}) {
  const doc = await Result.findOne({ sessionId });
  if (!doc) return doc;
  const rounds = doc.rounds || [];
  const duplicates = rounds.filter(r => r.roundIndex === roundData.roundIndex).length;
  if (duplicates <= 1) {
    return doc;
  }
  const merged = new Map();
  for (const r of rounds) {
    merged.set(r.roundIndex, r);
  }
  merged.set(roundData.roundIndex, roundData);
  const ordered = [...merged.values()].sort((a, b) => a.roundIndex - b.roundIndex);
  await Result.updateOne(
    { sessionId },
    {
      $set: {
        rounds: ordered,
        ...(sessionMeta.title && !doc.title ? { title: sessionMeta.title } : {}),
        ...(sessionMeta.entries && Array.isArray(sessionMeta.entries) && sessionMeta.entries.length > 0 && (!doc.entries || doc.entries.length === 0) ? { entries: sessionMeta.entries } : {})
      }
    }
  );
  return await Result.findOne({ sessionId });
}

/**
 * Save an immutable completed tournament result.
 * If a partial Result document already exists (from round snapshots),
 * updates its winner and completedAt.
 *
 * @param {Object} resultData
 * @returns {Promise<Object>}
 */
export async function saveResult(resultData) {
  if (!resultData || !resultData.sessionId || (resultData.winner === undefined) || !resultData.entries) {
    throw new Error('sessionId, winner, and entries are required to save a result');
  }
  return enqueueResultWrite(resultData.sessionId, () => saveResultInner(resultData));
}

async function saveResultInner(resultData) {
  // Idempotency: avoid creating duplicate Result records for the same session
  const existing = await Result.findOne({ sessionId: resultData.sessionId });
  if (existing) {
    if (existing.winner) {
      return existing;
    }
    // Field targeted update, never a whole document save. A full save writes
    // back the rounds array as it was read, which clobbers round snapshots
    // pushed by the closing round between this read and the write.
    const setFields = {
      winner: resultData.winner,
      completedAt: resultData.completedAt || new Date()
    };
    if (resultData.title && !existing.title) {
      setFields.title = resultData.title;
    }
    if (resultData.entries && (!existing.entries || existing.entries.length === 0)) {
      setFields.entries = resultData.entries;
    }
    await Result.updateOne({ _id: existing._id }, { $set: setFields });
    return await Result.findOne({ _id: existing._id });
  }
  return await Result.create({
    sessionId: resultData.sessionId,
    title: resultData.title || '',
    entries: resultData.entries,
    winner: resultData.winner,
    completedAt: resultData.completedAt || new Date(),
    rounds: resultData.rounds || []
  });
}

/**
 * Retrieve completed results sorted by completedAt desc.
 * Filters only sessions with an official winner.
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function getCompletedResults(limit = 50) {
  const parsedLimit = parseInt(limit, 10);
  const maxResults = isNaN(parsedLimit) || parsedLimit <= 0 ? 50 : Math.min(parsedLimit, 100);
  return await Result.find({ winner: { $ne: null } }, { rounds: 0 }).sort({ completedAt: -1 }).limit(maxResults).lean();
}

/**
 * Retrieve the completed result for a specific session.
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function getResultBySessionId(sessionId) {
  return await Result.findOne({ sessionId }).sort({ completedAt: -1 }).lean();
}

