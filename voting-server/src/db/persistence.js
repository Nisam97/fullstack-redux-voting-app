import { isConnected } from './connection.js';
import * as repository from './repository.js';

/**
 * Persistence orchestration layer.
 *
 * Compares previous and current Redux state snapshots to detect
 * session lifecycle transitions and triggers the appropriate
 * repository persistence calls.
 *
 * This module is the sole boundary between the Redux runtime
 * and MongoDB persistence. It never touches core.js, Socket.io,
 * or authentication logic.
 */

/**
 * Detect session lifecycle changes between two Redux state snapshots
 * and persist the relevant transitions to MongoDB.
 *
 * Called from the store subscriber in server.js, after Socket.io
 * broadcasts have been sent.
 *
 * Persistence is fire-and-forget with error logging — failures
 * do not block the runtime or crash the server.
 *
 * @param {Map} prevState - Previous Immutable.js store state
 * @param {Map} currentState - Current Immutable.js store state
 */
export async function persistStateChanges(prevState, currentState) {
  if (!isConnected()) {
    return;
  }

  const prevSessions = prevState && typeof prevState.get === 'function'
    ? prevState.get('sessions')
    : null;
  const currSessions = currentState && typeof currentState.get === 'function'
    ? currentState.get('sessions')
    : null;

  if (!currSessions || typeof currSessions.forEach !== 'function') {
    return;
  }

  // Detect new sessions (present in current but not in previous)
  currSessions.forEach((currSession, sessionId) => {
    const prevSession = prevSessions ? prevSessions.get(sessionId) : null;

    // Skip if session reference hasn't changed
    if (currSession === prevSession) {
      return;
    }

    if (!prevSession) {
      // NEW SESSION — persist the full session metadata
      persistNewSession(sessionId, currSession);
      return;
    }

    // EXISTING SESSION — detect specific lifecycle transitions
    const prevStatus = prevSession.get('status');
    const currStatus = currSession.get('status');

    if (prevStatus !== currStatus) {
      persistStatusChange(sessionId, currSession, currStatus);
    } else if (currStatus === 'completed' && !prevSession.get('winner') && currSession.get('winner')) {
      persistCompletedResult(sessionId, currSession).catch(err => {
        console.error(`[Persistence] Failed to persist completed result for session "${sessionId}":`, err.message);
      });
    }

    // Detect entries change (SET_ENTRIES only)
    // Tournament advancement (NEXT/START_SESSION) mutates entries by consuming
    // them into vote.pair or determining winner. We must NOT overwrite the initial
    // entries in MongoDB with the remaining-queue entries.
    const prevEntries = prevSession.get('entries');
    const currEntries = currSession.get('entries');
    const prevVote = prevSession.get('vote');
    const currVote = currSession.get('vote');
    const isTournamentProgression = (prevStatus !== currStatus)
      || (prevVote !== currVote)
      || !!currSession.get('winner')
      || currStatus === 'completed';

    if (!isTournamentProgression && prevEntries !== currEntries && currEntries) {
      persistEntriesChange(sessionId, currEntries);
    }
  });
}

/**
 * Persist a newly created session to MongoDB.
 * @param {string} sessionId
 * @param {Map} session - Immutable session map
 */
function persistNewSession(sessionId, session) {
  const entries = session.get('entries');
  const entriesArray = entries && typeof entries.toJS === 'function'
    ? entries.toJS()
    : (Array.isArray(entries) ? entries : []);

  const storedDuration = session.get('timerDuration');
  const timerDuration = (Number.isInteger(storedDuration) && storedDuration >= 5 && storedDuration <= 300)
    ? storedDuration
    : 30;

  repository.saveSession({
    sessionId,
    title: session.get('title') || '',
    entries: entriesArray,
    status: session.get('status') || 'pending',
    timerDuration
  }).catch(err => {
    console.error(`[Persistence] Failed to persist new session "${sessionId}":`, err.message);
  });
}

/**
 * Persist a session status transition to MongoDB.
 * @param {string} sessionId
 * @param {Map} session - Current Immutable session map
 * @param {string} newStatus
 */
function persistStatusChange(sessionId, session, newStatus) {
  const winner = session.get('winner') || null;

  repository.updateSessionStatus(sessionId, newStatus, winner)
    .then(async () => {
      if (newStatus === 'completed' && winner) {
        await persistCompletedResult(sessionId, session);
      }
    })
    .catch(err => {
      console.error(`[Persistence] Failed to persist status "${newStatus}" for session "${sessionId}":`, err.message);
    });
}

/**
 * Persist the final tournament result when a session is completed.
 *
 * Idempotency: Checks whether a result for the sessionId already exists
 * before creating one. If one exists, returns the existing record.
 *
 * Captures:
 * - sessionId
 * - title (from MongoDB Session document or Redux state)
 * - entries (from MongoDB Session document, since core.next() clears entries on completion)
 * - winner (from Redux state or Session document)
 * - completedAt (timestamp)
 *
 * @param {string} sessionId
 * @param {Map|Object} session - Current Immutable session map or plain object
 * @returns {Promise<Object|null>} The saved or existing Result document
 */
export async function persistCompletedResult(sessionId, session) {
  if (!isConnected()) {
    console.warn(`[Persistence] MongoDB not connected, cannot persist result for "${sessionId}"`);
    return null;
  }

  // Idempotency check: don't save duplicate result for the same session
  const existingResult = await repository.getResultBySessionId(sessionId);
  if (existingResult) {
    return existingResult;
  }

  // Retrieve original Session document from MongoDB to get complete entries list & title
  const sessionDoc = await repository.getSessionBySessionId(sessionId);

  const title = (sessionDoc && sessionDoc.title)
    || (session && typeof session.get === 'function' ? session.get('title') : (session && session.title))
    || '';

  let entries = null;
  if (sessionDoc && sessionDoc.entries && sessionDoc.entries.length > 0) {
    entries = sessionDoc.entries;
  } else if (session) {
    const sessionEntries = typeof session.get === 'function' ? session.get('entries') : session.entries;
    if (sessionEntries && typeof sessionEntries.toJS === 'function') {
      entries = sessionEntries.toJS();
    } else if (Array.isArray(sessionEntries)) {
      entries = sessionEntries;
    }
  }

  const winner = (session && typeof session.get === 'function' ? session.get('winner') : (session && session.winner))
    || (sessionDoc && sessionDoc.winner)
    || null;

  if (!winner) {
    console.warn(`[Persistence] Cannot persist result for session "${sessionId}": winner is missing`);
    return null;
  }

  // If entries could not be retrieved from DB or session, fallback to [winner] to satisfy schema
  if (!entries || entries.length === 0) {
    entries = [winner];
  }

  try {
    const savedResult = await repository.saveResult({
      sessionId,
      title,
      entries,
      winner,
      completedAt: (sessionDoc && sessionDoc.completedAt) || new Date()
    });
    console.log(`[Persistence] Persisted completed result for session "${sessionId}" (Winner: "${winner}")`);
    return savedResult;
  } catch (err) {
    console.error(`[Persistence] Failed to save result for session "${sessionId}":`, err.message);
    throw err;
  }
}

/**
 * Persist updated entries for a session to MongoDB.
 * @param {string} sessionId
 * @param {List} entries - Immutable List of entries
 */
function persistEntriesChange(sessionId, entries) {
  const entriesArray = entries && typeof entries.toJS === 'function'
    ? entries.toJS()
    : (Array.isArray(entries) ? entries : []);

  repository.saveSession({
    sessionId,
    entries: entriesArray
  }).catch(err => {
    console.error(`[Persistence] Failed to persist entries for session "${sessionId}":`, err.message);
  });
}

/**
 * Load persisted sessions from MongoDB and reconstruct the runtime
 * session registry by dispatching actions into the Redux store.
 *
 * Recovery semantics:
 * - 'pending' sessions: restored as-is (CREATE_SESSION only)
 * - 'open' sessions: reset to 'pending' (mid-round state is lost; CREATE_SESSION only)
 * - 'completed' sessions: restored with winner (CREATE_SESSION only, status stays in store)
 * - 'archived' sessions: NOT loaded into Redux store (queryable only via history API)
 *
 * @param {Object} store - Redux store instance
 * @returns {Promise<number>} Number of sessions recovered
 */
export async function recoverSessionsFromDb(store) {
  if (!isConnected()) {
    console.warn('[Persistence] MongoDB not connected, skipping session recovery');
    return 0;
  }

  try {
    // Reset any 'open' sessions to 'pending' in MongoDB first
    const resetResult = await repository.resetOpenSessionsToPending();
    if (resetResult.modifiedCount > 0) {
      console.log(`[Persistence] Reset ${resetResult.modifiedCount} interrupted open session(s) to pending`);
    }

    // Load non-archived sessions
    const sessions = await repository.getActiveSessions();
    let recovered = 0;

    for (const session of sessions) {
      try {
        const sessionData = session.toObject ? session.toObject() : session;

        // Validate minimum required fields
        if (!sessionData.sessionId || !sessionData.entries || sessionData.entries.length === 0) {
          console.warn(`[Persistence] Skipping malformed session record: ${sessionData.sessionId || 'unknown'}`);
          continue;
        }

        // Check if session already exists in Redux store (avoid duplicates)
        const currentState = store.getState();
        const sessionsMap = currentState && typeof currentState.get === 'function'
          ? currentState.get('sessions')
          : null;
        if (sessionsMap && sessionsMap.has(sessionData.sessionId)) {
          continue;
        }

        // Dispatch CREATE_SESSION to reconstruct in Redux
        const rawDuration = sessionData.timerDuration;
        const timerDuration = (Number.isInteger(rawDuration) && rawDuration >= 5 && rawDuration <= 300)
          ? rawDuration
          : 30;

        store.dispatch({
          type: 'CREATE_SESSION',
          sessionId: sessionData.sessionId,
          title: sessionData.title || '',
          entries: sessionData.entries,
          timerDuration
        });

        // For completed sessions, we need to reflect their completed status.
        // The session starts as 'pending' from CREATE_SESSION — we don't START
        // it because that would advance the tournament. The session's metadata
        // (title, entries, winner) is preserved in MongoDB for history queries.
        // The Redux store only needs CREATE_SESSION to register the session
        // in the registry for visibility.

        recovered++;
        console.log(`[Persistence] Recovered session "${sessionData.sessionId}" (status: ${sessionData.status})`);
      } catch (sessionErr) {
        console.error(`[Persistence] Error recovering session:`, sessionErr.message);
      }
    }

    return recovered;
  } catch (err) {
    console.error('[Persistence] Error during session recovery:', err.message);
    return 0;
  }
}

/**
 * Persist seed sessions to MongoDB after bootstrap.
 * Called after bootstrapDefaultSession/bootstrapHorrorSession creates
 * sessions in the Redux store — this persists their metadata to MongoDB
 * so they survive restarts.
 *
 * @param {Object} store - Redux store instance
 * @param {Array<string>} seedSessionIds - Session IDs to persist
 */
export async function persistSeedSessions(store, seedSessionIds) {
  if (!isConnected()) {
    return;
  }

  const state = store.getState();
  const sessions = state && typeof state.get === 'function'
    ? state.get('sessions')
    : null;

  if (!sessions) return;

  for (const sessionId of seedSessionIds) {
    try {
      // Check if already persisted in MongoDB
      const existing = await repository.getSessionBySessionId(sessionId);
      if (existing) continue;

      const session = sessions.get(sessionId);
      if (!session) continue;

      const entries = session.get('entries');
      const entriesArray = entries && typeof entries.toJS === 'function'
        ? entries.toJS()
        : (Array.isArray(entries) ? entries : []);

      const storedDuration = session.get('timerDuration');
      const timerDuration = (Number.isInteger(storedDuration) && storedDuration >= 5 && storedDuration <= 300)
        ? storedDuration
        : 30;

      await repository.saveSession({
        sessionId,
        title: session.get('title') || '',
        entries: entriesArray,
        status: session.get('status') || 'pending',
        timerDuration
      });
      console.log(`[Persistence] Persisted seed session "${sessionId}"`);
    } catch (err) {
      console.error(`[Persistence] Failed to persist seed session "${sessionId}":`, err.message);
    }
  }
}
