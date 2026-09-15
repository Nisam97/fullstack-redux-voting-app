import fs from 'fs';
import path from 'path';

export const DEFAULT_SESSION_ID = 'sess_default';
export const DEFAULT_SESSION_TITLE = 'Danny Boyle Film Tournament';

export const HORROR_SESSION_ID = 'sess_horror';
export const HORROR_SESSION_TITLE = 'Horror Classics';
export const HORROR_SESSION_ENTRIES = ['The Shining', 'Psycho', 'Alien'];

// Backward compatibility exports
export const DEFAULT_ELECTION_ID = DEFAULT_SESSION_ID;
export const DEFAULT_ELECTION_TITLE = DEFAULT_SESSION_TITLE;
export const HORROR_ELECTION_ID = HORROR_SESSION_ID;
export const HORROR_ELECTION_TITLE = HORROR_SESSION_TITLE;
export const HORROR_ELECTION_ENTRIES = HORROR_SESSION_ENTRIES;

/**
 * Loads entries from entries.json.
 *
 * @param {string} [entriesPath] - Optional custom path for entries.json
 * @returns {Array<string>|null} Array of entry names or null on failure
 */
export function loadEntries(entriesPath) {
  const resolvedPath = entriesPath || path.resolve(__dirname, '../entries.json');
  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`[Bootstrap] Warning: entries file at ${resolvedPath} does not contain a non-empty array.`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[Bootstrap] Error: Failed to load entries from ${resolvedPath}:`, err.message);
    return null;
  }
}

/**
 * Bootstraps the default seed session in the provided Redux store.
 *
 * Dispatches CREATE_SESSION and START_SESSION according to the reducer contract.
 *
 * @param {Object} store - Redux store configured with the multi-session reducer
 * @param {Object} [options={}] - Optional configuration
 * @param {string} [options.entriesPath] - Path to entries file
 * @param {Array<string>} [options.entries] - Explicit entries array (overrides file load)
 * @param {string} [options.sessionId=DEFAULT_SESSION_ID] - Session ID
 * @param {string} [options.title=DEFAULT_SESSION_TITLE] - Session title
 * @returns {Object|null} Serialized session state or null if bootstrap failed
 */
export function bootstrapDefaultSession(store, options = {}) {
  if (!store || typeof store.dispatch !== 'function' || typeof store.getState !== 'function') {
    console.error('[Bootstrap] Error: A valid Redux store with dispatch and getState is required.');
    return null;
  }

  const sessionId = options.sessionId || options.electionId || DEFAULT_SESSION_ID;
  const title = options.title || DEFAULT_SESSION_TITLE;

  const currentState = store.getState();
  const sessionsMap = (currentState && typeof currentState.get === 'function')
    ? (currentState.get('sessions') || currentState.get('elections'))
    : null;

  if (sessionsMap && typeof sessionsMap.has === 'function' && sessionsMap.has(sessionId)) {
    console.warn(`[Bootstrap] Notice: Session "${sessionId}" already exists in registry. Skipping duplicate creation.`);
    const existing = sessionsMap.get(sessionId);
    return existing ? existing.toJS() : null;
  }

  const entries = options.entries || loadEntries(options.entriesPath);
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    console.error(`[Bootstrap] Error: Cannot bootstrap session "${sessionId}" without valid entries.`);
    return null;
  }

  // 1. CREATE_SESSION
  store.dispatch({
    type: 'CREATE_SESSION',
    sessionId,
    title,
    entries
  });

  // 2. START_SESSION
  store.dispatch({
    type: 'START_SESSION',
    sessionId
  });

  const state = store.getState();
  const updatedSessions = (state && typeof state.get === 'function')
    ? (state.get('sessions') || state.get('elections'))
    : null;
  const session = updatedSessions && typeof updatedSessions.get === 'function' ? updatedSessions.get(sessionId) : null;
  return session ? session.toJS() : null;
}

export const bootstrapDefaultElection = bootstrapDefaultSession;

/**
 * Bootstraps the horror seed session in the provided Redux store.
 *
 * Dispatches CREATE_SESSION and START_SESSION according to the reducer contract.
 *
 * @param {Object} store - Redux store configured with the multi-session reducer
 * @param {Object} [options={}] - Optional configuration
 * @param {Array<string>} [options.entries] - Explicit entries array (overrides default horror entries)
 * @param {string} [options.sessionId=HORROR_SESSION_ID] - Session ID
 * @param {string} [options.title=HORROR_SESSION_TITLE] - Session title
 * @returns {Object|null} Serialized session state or null if bootstrap failed
 */
export function bootstrapHorrorSession(store, options = {}) {
  if (!store || typeof store.dispatch !== 'function' || typeof store.getState !== 'function') {
    console.error('[Bootstrap] Error: A valid Redux store with dispatch and getState is required.');
    return null;
  }

  const sessionId = options.sessionId || options.electionId || HORROR_SESSION_ID;
  const title = options.title || HORROR_SESSION_TITLE;

  const currentState = store.getState();
  const sessionsMap = (currentState && typeof currentState.get === 'function')
    ? (currentState.get('sessions') || currentState.get('elections'))
    : null;

  if (sessionsMap && typeof sessionsMap.has === 'function' && sessionsMap.has(sessionId)) {
    console.warn(`[Bootstrap] Notice: Session "${sessionId}" already exists in registry. Skipping duplicate creation.`);
    const existing = sessionsMap.get(sessionId);
    return existing ? existing.toJS() : null;
  }

  const entries = options.entries || HORROR_SESSION_ENTRIES;
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    console.error(`[Bootstrap] Error: Cannot bootstrap session "${sessionId}" without valid entries.`);
    return null;
  }

  // 1. CREATE_SESSION
  store.dispatch({
    type: 'CREATE_SESSION',
    sessionId,
    title,
    entries
  });

  // 2. START_SESSION
  store.dispatch({
    type: 'START_SESSION',
    sessionId
  });

  const state = store.getState();
  const updatedSessions = (state && typeof state.get === 'function')
    ? (state.get('sessions') || state.get('elections'))
    : null;
  const session = updatedSessions && typeof updatedSessions.get === 'function' ? updatedSessions.get(sessionId) : null;
  return session ? session.toJS() : null;
}

export const bootstrapHorrorElection = bootstrapHorrorSession;
