import { createSlice } from '@reduxjs/toolkit';

/**
 * Normalized initial state for multi-session management
 */
export const initialState = {
  list: [],
  activeSessionId: null,
  bySessionId: {}
};

// Action Type Constants
export const SESSIONS = 'sessions';
export const SESSION_STATE = 'session_state';
export const SET_SESSIONS = 'SET_SESSIONS';
export const SET_SESSION_STATE = 'SET_SESSION_STATE';
export const SET_ACTIVE_SESSION = 'SET_ACTIVE_SESSION';
export const SET_STATE = 'SET_STATE';
export const VOTE = 'VOTE';
export const NEXT = 'NEXT';
export const SET_ENTRIES = 'SET_ENTRIES';
export const RESET_SESSIONS = 'RESET_SESSIONS';
export const LOBBY_UPDATE = 'lobby_update';
export const SET_LOBBY_UPDATE = 'SET_LOBBY_UPDATE';
export const CREATE_SESSION = 'CREATE_SESSION';
export const START_SESSION = 'START_SESSION';
export const ARCHIVE_SESSION = 'ARCHIVE_SESSION';
export const TIMER_STATE = 'timer_state';
export const SET_TIMER_STATE = 'SET_TIMER_STATE';

/**
 * Normalizes a session detail object into a consistent shape
 * 
 * @param {object} raw
 * @param {string} sessionId
 * @param {object} [existing]
 * @returns {object}
 */
export function normalizeSession(raw = {}, sessionId, existing = {}) {
  const id = sessionId || raw.id || raw.sessionId || existing.id;
  const winner = raw.winner !== undefined
    ? raw.winner
    : (existing.winner !== undefined ? existing.winner : null);
  const title = raw.title !== undefined ? raw.title : (existing.title || '');
  const status = raw.status !== undefined
    ? raw.status
    : (winner ? 'completed' : (existing.status || 'open'));
  const entries = winner
    ? []
    : (Array.isArray(raw.entries)
        ? raw.entries
        : (Array.isArray(existing.entries) ? existing.entries : []));
  const vote = winner
    ? null
    : (raw.vote !== undefined
        ? raw.vote
        : (existing.vote !== undefined ? existing.vote : null));
  const createdAt = raw.createdAt || existing.createdAt || new Date().toISOString();
  const voterCount = raw.voterCount !== undefined
    ? Number(raw.voterCount)
    : (existing.voterCount !== undefined ? Number(existing.voterCount) : 0);
  const entryCount = raw.entryCount !== undefined
    ? Number(raw.entryCount)
    : (existing.entryCount !== undefined ? Number(existing.entryCount) : (entries ? entries.length : 0));
  const isArchived = raw.isArchived !== undefined
    ? Boolean(raw.isArchived)
    : (existing.isArchived !== undefined ? Boolean(existing.isArchived) : (status === 'archived'));
  const votingStarted = raw.votingStarted !== undefined
    ? Boolean(raw.votingStarted)
    : (existing.votingStarted !== undefined
        ? Boolean(existing.votingStarted)
        : (status === 'open' || status === 'completed'));
  const isPairChanged = Boolean(
    existing.vote?.pair && raw.vote?.pair && (
      existing.vote.pair[0] !== raw.vote.pair[0] || existing.vote.pair[1] !== raw.vote.pair[1]
    )
  );
  const timer = (winner || status === 'completed' || status === 'archived' || isPairChanged)
    ? (raw.timer !== undefined ? raw.timer : null)
    : (raw.timer !== undefined
        ? raw.timer
        : (existing.timer !== undefined ? existing.timer : null));
  const rawTimerDuration = raw.timerDuration !== undefined
    ? raw.timerDuration
    : (raw.duration !== undefined
        ? raw.duration
        : existing.timerDuration);
  const timerDuration = typeof rawTimerDuration === 'number'
    ? rawTimerDuration
    : (rawTimerDuration !== undefined && !Number.isNaN(Number(rawTimerDuration))
        ? Number(rawTimerDuration)
        : 30);

  const roundLifecycle = raw.roundLifecycle !== undefined
    ? raw.roundLifecycle
    : (isPairChanged ? 'VOTING' : (existing.roundLifecycle !== undefined ? existing.roundLifecycle : 'VOTING'));
  const roundId = raw.roundId !== undefined
    ? raw.roundId
    : (existing.roundId !== undefined ? existing.roundId : null);
  const roundIndex = raw.roundIndex !== undefined
    ? raw.roundIndex
    : (existing.roundIndex !== undefined ? existing.roundIndex : null);
  const finalVote = (isPairChanged || roundLifecycle === 'VOTING')
    ? (raw.finalVote !== undefined ? raw.finalVote : null)
    : (raw.finalVote !== undefined ? raw.finalVote : (existing.finalVote || null));
  const revealTimer = (winner || status === 'completed' || status === 'archived' || isPairChanged || roundLifecycle === 'VOTING')
    ? (raw.revealTimer !== undefined ? raw.revealTimer : null)
    : (raw.revealTimer !== undefined ? raw.revealTimer : (existing.revealTimer || null));

  // Security: Sanitize incoming raw object to ensure voter tokens and credentials never enter Redux
  const sanitizedRaw = { ...raw };
  delete sanitizedRaw.voterToken;
  delete sanitizedRaw.token;
  delete sanitizedRaw.jwt;
  delete sanitizedRaw.password;
  delete sanitizedRaw.secret;

  return {
    ...existing,
    ...sanitizedRaw,
    id,
    title,
    status,
    entries,
    vote,
    winner,
    createdAt,
    voterCount,
    entryCount,
    isArchived,
    votingStarted,
    roundLifecycle,
    roundId,
    roundIndex,
    finalVote,
    revealTimer,
    timer: timer || null,
    timerDuration,
    hasLoaded: true
  };
}

export const normalizeElection = normalizeSession;

/**
 * Generates a session-scoped pair lock key to guarantee
 * independent pairwise locking per session.
 * 
 * Concept: ${sessionId}:::${pair}
 * 
 * @param {string} sessionId
 * @param {string[]|string} pair
 * @returns {string|null}
 */
export function getSessionPairLockKey(sessionId, pair) {
  if (!sessionId || typeof sessionId !== 'string') {
    return null;
  }
  if (!pair) {
    return null;
  }
  const pairStr = Array.isArray(pair) ? pair.join(':::') : String(pair);
  if (!pairStr) {
    return null;
  }
  return `${sessionId}:::${pairStr}`;
}

export const getElectionPairLockKey = getSessionPairLockKey;

/**
 * Reducer handler for registry summary updates (`sessions` / `SET_SESSIONS`).
 * Updates `state.list` while preserving existing `bySessionId` records.
 */
function handleSetSessions(state, action) {
  const rawList = action.payload !== undefined
    ? action.payload
    : (action.sessions || action.list);

  if (!rawList) {
    return state;
  }

  let list;
  if (Array.isArray(rawList)) {
    list = rawList;
  } else if (rawList && Array.isArray(rawList.list)) {
    list = rawList.list;
  } else if (rawList && Array.isArray(rawList.sessions)) {
    list = rawList.sessions;
  } else {
    return state;
  }

  // Preserve existing bySessionId state while updating summaries in list
  state.list = list.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const sId = item.id || item.sessionId;
    const rawDur = item.timerDuration !== undefined ? item.timerDuration : item.duration;
    const timerDuration = typeof rawDur === 'number' ? rawDur : (Number(rawDur) || 30);
    return {
      ...item,
      id: sId,
      sessionId: sId,
      voterCount: item.voterCount !== undefined ? Number(item.voterCount) : 0,
      entryCount: item.entryCount !== undefined
        ? Number(item.entryCount)
        : (Array.isArray(item.entries) ? item.entries.length : 0),
      timerDuration
    };
  });

  if (!state.bySessionId) {
    state.bySessionId = {};
  }

  // Sync basic metadata into existing bySessionId without wiping session-specific vote/entries/winner
  for (const summary of state.list) {
    const sId = summary && (summary.id || summary.sessionId);
    if (sId && state.bySessionId[sId]) {
      const existing = state.bySessionId[sId];
      state.bySessionId[sId] = {
        ...existing,
        title: summary.title !== undefined ? summary.title : existing.title,
        status: summary.status !== undefined ? summary.status : existing.status,
        voterCount: summary.voterCount !== undefined ? Number(summary.voterCount) : (existing.voterCount || 0),
        entryCount: summary.entryCount !== undefined ? Number(summary.entryCount) : (existing.entryCount || 0),
        timerDuration: summary.timerDuration !== undefined ? Number(summary.timerDuration) : (existing.timerDuration !== undefined ? existing.timerDuration : 30),
        isArchived: summary.isArchived !== undefined ? Boolean(summary.isArchived) : existing.isArchived,
        votingStarted: summary.votingStarted !== undefined ? Boolean(summary.votingStarted) : existing.votingStarted,
        ...(summary.winner !== undefined && summary.winner !== null ? { winner: summary.winner } : {})
      };
    }
  }

  return state;
}

/**
 * Reducer handler for session-specific state updates (`session_state` / `SET_SESSION_STATE`).
 * Updates or inserts session state strictly under `bySessionId[sessionId]`.
 */
function handleSetSessionState(state, action) {
  const incoming = action.payload !== undefined
    ? action.payload
    : (action.state || action.session);
  if (!incoming || typeof incoming !== 'object') {
    return state;
  }

  const sessionId = action.sessionId || incoming.sessionId || incoming.id;
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return state;
  }

  if (!state.bySessionId) {
    state.bySessionId = {};
  }

  const existing = state.bySessionId[sessionId] || {};

  // Stale round protection: if incoming payload belongs to an older round index, ignore it
  if (
    typeof existing.roundIndex === 'number' &&
    typeof incoming.roundIndex === 'number' &&
    incoming.roundIndex < existing.roundIndex
  ) {
    return state;
  }

  state.bySessionId[sessionId] = normalizeSession(incoming, sessionId, existing);

  // If activeSessionId is not yet set, automatically default to this first session
  if (!state.activeSessionId) {
    state.activeSessionId = sessionId;
  }

  return state;
}

/**
 * Reducer handler for setting the active session (`SET_ACTIVE_SESSION`).
 */
function handleSetActiveSession(state, action) {
  const targetId = action.payload !== undefined
    ? action.payload
    : action.sessionId;

  if (targetId === null) {
    state.activeSessionId = null;
    return state;
  }

  if (typeof targetId === 'string' && targetId.trim() !== '') {
    state.activeSessionId = targetId.trim();
    return state;
  }

  // Malformed or invalid input: safe no-op
  return state;
}

/**
 * Reducer handler for client-side VOTE action.
 * Carries sessionId and safely targets bySessionId[sessionId].
 */
function handleVote(state, action) {
  const sessionId = action.sessionId || state.activeSessionId;
  const entry = action.entry;

  if (!sessionId || !entry || typeof entry !== 'string' || !state.bySessionId || !state.bySessionId[sessionId]) {
    return state;
  }

  const session = state.bySessionId[sessionId];
  if (!session.vote || !Array.isArray(session.vote.pair) || !session.vote.pair.includes(entry)) {
    return state;
  }

  const currentTally = session.vote.tally ? { ...session.vote.tally } : {};
  currentTally[entry] = (currentTally[entry] || 0) + 1;

  state.bySessionId[sessionId] = {
    ...session,
    vote: {
      ...session.vote,
      tally: currentTally
    }
  };

  return state;
}

/**
 * Reducer handler for NEXT action.
 * Carries sessionId and safely advances bySessionId[sessionId].
 */
function handleNext(state, action) {
  const sessionId = action.sessionId || state.activeSessionId;
  if (!sessionId || !state.bySessionId || !state.bySessionId[sessionId]) {
    return state;
  }

  const session = state.bySessionId[sessionId];
  const entries = Array.isArray(session.entries) ? [...session.entries] : [];
  const currentVote = session.vote;

  let winners = [];
  if (currentVote && Array.isArray(currentVote.pair) && currentVote.pair.length >= 2) {
    const [a, b] = currentVote.pair;
    const tally = currentVote.tally || {};
    const aVotes = tally[a] || 0;
    const bVotes = tally[b] || 0;
    if (aVotes > bVotes) winners = [a];
    else if (aVotes < bVotes) winners = [b];
    else winners = [a, b];
  }

  const combined = entries.concat(winners);
  if (combined.length === 1) {
    state.bySessionId[sessionId] = {
      ...session,
      vote: null,
      entries: [],
      winner: combined[0],
      status: 'completed'
    };
  } else if (combined.length >= 2) {
    state.bySessionId[sessionId] = {
      ...session,
      vote: {
        pair: combined.slice(0, 2),
        tally: {}
      },
      entries: combined.slice(2)
    };
  }

  return state;
}

/**
 * Reducer handler for SET_ENTRIES action.
 * Carries sessionId and sets entries for bySessionId[sessionId].
 */
function handleSetEntries(state, action) {
  const sessionId = action.sessionId || state.activeSessionId;
  const entries = Array.isArray(action.entries) ? action.entries : [];

  if (!sessionId || !state.bySessionId || !state.bySessionId[sessionId]) {
    return state;
  }

  state.bySessionId[sessionId] = {
    ...state.bySessionId[sessionId],
    entries: [...entries]
  };

  return state;
}

/**
 * Backward compatibility handler for SET_STATE / setState.
 * Maps legacy single-session payload into bySessionId under target or default session.
 */
function handleSetState(state, action) {
  const incoming = action.payload !== undefined ? action.payload : action.state;
  if (!incoming || typeof incoming !== 'object') {
    return state;
  }

  const sessionId = incoming.id || incoming.sessionId || state.activeSessionId || 'sess_default';
  if (!state.bySessionId) {
    state.bySessionId = {};
  }
  const existing = state.bySessionId[sessionId] || {};

  state.bySessionId[sessionId] = normalizeSession(incoming, sessionId, existing);
  if (!state.activeSessionId) {
    state.activeSessionId = sessionId;
  }

  return state;
}

/**
 * Reducer handler for room-isolated lobby updates (`lobby_update` / `SET_LOBBY_UPDATE`).
 * Updates voter count and lobby metadata strictly under `bySessionId[sessionId]`.
 */
function handleLobbyUpdate(state, action) {
  const incoming = action.payload !== undefined
    ? action.payload
    : (action.data || action.lobby);

  if (!incoming || typeof incoming !== 'object') {
    return state;
  }

  const sessionId = action.sessionId || incoming.sessionId || incoming.id;
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return state;
  }

  const cleanSessionId = sessionId.trim();

  if (!state.bySessionId) {
    state.bySessionId = {};
  }

  const existing = state.bySessionId[cleanSessionId] || {};
  const voterCount = incoming.voterCount !== undefined
    ? Number(incoming.voterCount)
    : (existing.voterCount !== undefined ? existing.voterCount : 0);
  const entryCount = incoming.entryCount !== undefined
    ? Number(incoming.entryCount)
    : (existing.entryCount !== undefined ? existing.entryCount : 0);
  const status = incoming.status !== undefined ? incoming.status : (existing.status || 'open');
  const title = incoming.title !== undefined ? incoming.title : (existing.title || '');
  const isArchived = incoming.isArchived !== undefined
    ? Boolean(incoming.isArchived)
    : (existing.isArchived !== undefined ? existing.isArchived : (status === 'archived'));
  const votingStarted = incoming.votingStarted !== undefined
    ? Boolean(incoming.votingStarted)
    : (existing.votingStarted !== undefined ? existing.votingStarted : (status === 'open' || status === 'completed'));

  state.bySessionId[cleanSessionId] = {
    ...existing,
    id: cleanSessionId,
    title,
    status,
    voterCount,
    entryCount,
    isArchived,
    votingStarted,
    hasLoaded: true
  };

  // Synchronize matching summary in state.list if present
  if (Array.isArray(state.list)) {
    const idx = state.list.findIndex(
      (item) => item && (item.id === cleanSessionId || item.sessionId === cleanSessionId)
    );
    if (idx !== -1) {
      state.list[idx] = {
        ...state.list[idx],
        id: cleanSessionId,
        title: title || state.list[idx].title,
        status: status || state.list[idx].status,
        voterCount,
        entryCount: incoming.entryCount !== undefined ? entryCount : state.list[idx].entryCount,
        isArchived,
        votingStarted
      };
    }
  }

  return state;
}

function handleCreateSession(state, action) {
  const sessionId = action.sessionId || action.id;
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') return state;
  const cleanId = sessionId.trim();
  const rawDuration = action.timerDuration !== undefined ? action.timerDuration : action.duration;
  const timerDuration = (Number.isInteger(rawDuration) && rawDuration >= 5 && rawDuration <= 300)
    ? rawDuration
    : (rawDuration !== undefined ? rawDuration : 30);

  if (!state.bySessionId) state.bySessionId = {};
  if (!state.bySessionId[cleanId]) {
    state.bySessionId[cleanId] = normalizeSession({
      id: cleanId,
      title: action.title || '',
      status: 'pending',
      entries: Array.isArray(action.entries) ? action.entries : [],
      voterCount: 0,
      entryCount: Array.isArray(action.entries) ? action.entries.length : 0,
      timerDuration
    }, cleanId);
  }
  if (Array.isArray(state.list) && !state.list.some(s => s.id === cleanId || s.sessionId === cleanId)) {
    state.list.push({
      id: cleanId,
      sessionId: cleanId,
      title: action.title || '',
      status: 'pending',
      voterCount: 0,
      entryCount: Array.isArray(action.entries) ? action.entries.length : 0,
      timerDuration,
      createdAt: new Date().toISOString()
    });
  }
  return state;
}

function handleStartSession(state, action) {
  const sessionId = action.sessionId || action.id;
  if (!sessionId || !state.bySessionId || !state.bySessionId[sessionId]) return state;
  const session = state.bySessionId[sessionId];
  if (session.status === 'archived') return state;
  state.bySessionId[sessionId] = {
    ...session,
    status: 'open',
    votingStarted: true
  };
  if (Array.isArray(state.list)) {
    const item = state.list.find(s => s.id === sessionId || s.sessionId === sessionId);
    if (item) item.status = 'open';
  }
  return state;
}

function handleArchiveSession(state, action) {
  const sessionId = action.sessionId || action.id;
  if (!sessionId || !state.bySessionId || !state.bySessionId[sessionId]) return state;
  const session = state.bySessionId[sessionId];
  state.bySessionId[sessionId] = {
    ...session,
    status: 'archived',
    isArchived: true,
    timer: null
  };
  if (Array.isArray(state.list)) {
    const item = state.list.find(s => s.id === sessionId || s.sessionId === sessionId);
    if (item) item.status = 'archived';
  }
  return state;
}

/**
 * Reducer handler for session timer state updates (`timer_state` / `SET_TIMER_STATE`).
 * Updates or clears `timer` strictly under `bySessionId[sessionId]`.
 */
function handleTimerState(state, action) {
  const incoming = action.payload !== undefined ? action.payload : action;
  if (!incoming || typeof incoming !== 'object') {
    return state;
  }

  const sessionId = action.sessionId || incoming.sessionId || incoming.id;
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return state;
  }

  const cleanId = sessionId.trim();
  if (!state.bySessionId) {
    state.bySessionId = {};
  }

  const existing = state.bySessionId[cleanId] || normalizeSession({ id: cleanId }, cleanId);
  const status = incoming.status;

  if (status === 'revealing') {
    state.bySessionId[cleanId] = {
      ...existing,
      roundLifecycle: existing.roundLifecycle === 'VOTING' ? 'RESULTS_REVEALED' : (existing.roundLifecycle || 'RESULTS_REVEALED'),
      timer: null,
      revealTimer: {
        duration: typeof incoming.duration === 'number' ? incoming.duration : Number(incoming.duration) || null,
        expiresAt: typeof incoming.expiresAt === 'number' ? incoming.expiresAt : Number(incoming.expiresAt) || null,
        startedAt: incoming.startedAt || existing.revealTimer?.startedAt || (incoming.expiresAt && incoming.duration ? incoming.expiresAt - (incoming.duration * 1000) : null),
        status: 'revealing',
        roundId: incoming.roundId || existing.roundId || null
      }
    };
  } else if (status === 'running') {
    state.bySessionId[cleanId] = {
      ...existing,
      roundLifecycle: 'VOTING',
      revealTimer: null,
      timer: {
        duration: typeof incoming.duration === 'number' ? incoming.duration : Number(incoming.duration) || null,
        expiresAt: typeof incoming.expiresAt === 'number' ? incoming.expiresAt : Number(incoming.expiresAt) || null,
        status: 'running'
      }
    };
  } else {
    // Clear timer for this specific session when status is null, expired, stopped, or absent
    state.bySessionId[cleanId] = {
      ...existing,
      timer: null,
      revealTimer: null
    };
  }

  return state;
}

export const voteSlice = createSlice({
  name: 'sessions',
  initialState,
  reducers: {
    setSessions: handleSetSessions,
    setSessionState: handleSetSessionState,
    setActiveSession: handleSetActiveSession,
    lobbyUpdate: handleLobbyUpdate,
    setLobbyUpdate: handleLobbyUpdate,
    createSessionAction: handleCreateSession,
    startSessionAction: handleStartSession,
    archiveSessionAction: handleArchiveSession,
    timerState: handleTimerState,
    setTimerState: handleTimerState,
    // Aliases
    setElections: handleSetSessions,
    setElectionState: handleSetSessionState,
    setActiveElection: handleSetActiveSession,
    voteAction: handleVote,
    nextAction: handleNext,
    setEntriesAction: handleSetEntries,
    setState: handleSetState,
    resetState: () => initialState
  },
  extraReducers: (builder) => {
    builder
      .addCase(SESSIONS, handleSetSessions)
      .addCase(SET_SESSIONS, handleSetSessions)
      .addCase(SESSION_STATE, handleSetSessionState)
      .addCase(SET_SESSION_STATE, handleSetSessionState)
      .addCase(SET_ACTIVE_SESSION, handleSetActiveSession)
      .addCase(LOBBY_UPDATE, handleLobbyUpdate)
      .addCase(SET_LOBBY_UPDATE, handleLobbyUpdate)
      .addCase(CREATE_SESSION, handleCreateSession)
      .addCase(START_SESSION, handleStartSession)
      .addCase(ARCHIVE_SESSION, handleArchiveSession)
      .addCase(TIMER_STATE, handleTimerState)
      .addCase(SET_TIMER_STATE, handleTimerState)
      .addCase(VOTE, handleVote)
      .addCase(NEXT, handleNext)
      .addCase(SET_ENTRIES, handleSetEntries)
      .addCase(SET_STATE, handleSetState)
      .addCase(RESET_SESSIONS, () => initialState);
  }
});

export const {
  setSessions: setSessionsReducerAction,
  setSessionState: setSessionStateReducerAction,
  setActiveSession: setActiveSessionReducerAction,
  lobbyUpdate: lobbyUpdateReducerAction,
  setLobbyUpdate: setLobbyUpdateReducerAction,
  setElections: setElectionsReducerAction,
  setElectionState: setElectionStateReducerAction,
  setActiveElection: setActiveElectionReducerAction,
  timerState: timerStateReducerAction,
  setTimerState: setTimerStateReducerAction,
  setState,
  resetState
} = voteSlice.actions;

// --- Action Creators ---

export const setSessions = (sessionsList) => {
  const list = Array.isArray(sessionsList)
    ? sessionsList
    : (sessionsList && Array.isArray(sessionsList.list)
        ? sessionsList.list
        : (sessionsList && Array.isArray(sessionsList.sessions)
            ? sessionsList.sessions : []));
  return {
    type: SESSIONS,
    payload: list,
    list
  };
};

export const setElections = setSessions;

export const setSessionState = (sessionOrId, maybeState) => {
  if (typeof sessionOrId === 'string' && maybeState && typeof maybeState === 'object') {
    const payload = { ...maybeState, id: maybeState.id || sessionOrId };
    return {
      type: SESSION_STATE,
      sessionId: sessionOrId,
      payload,
      state: payload
    };
  }

  const payload = sessionOrId && typeof sessionOrId === 'object' ? sessionOrId : {};
  const sessionId = payload.sessionId || payload.id;
  return {
    type: SESSION_STATE,
    sessionId,
    payload,
    state: payload
  };
};

export const setElectionState = setSessionState;

export const setActiveSession = (sessionId) => ({
  type: SET_ACTIVE_SESSION,
  payload: sessionId,
  sessionId
});

export const setActiveElection = setActiveSession;

export const lobbyUpdate = (sessionIdOrPayload, maybeData) => {
  if (typeof sessionIdOrPayload === 'string' && maybeData && typeof maybeData === 'object') {
    const payload = { ...maybeData, sessionId: maybeData.sessionId || sessionIdOrPayload };
    return {
      type: LOBBY_UPDATE,
      sessionId: sessionIdOrPayload,
      payload
    };
  }

  const payload = sessionIdOrPayload && typeof sessionIdOrPayload === 'object' ? sessionIdOrPayload : {};
  const sessionId = payload.sessionId || payload.id;
  return {
    type: LOBBY_UPDATE,
    sessionId,
    payload
  };
};

export const setLobbyUpdate = lobbyUpdate;

export const createSession = (payloadOrId, maybeTitle, maybeEntries, maybeTimerDuration) => {
  if (payloadOrId && typeof payloadOrId === 'object') {
    const sessionId = payloadOrId.sessionId || payloadOrId.id || `sess_${Date.now()}`;
    const rawDuration = payloadOrId.timerDuration !== undefined
      ? payloadOrId.timerDuration
      : payloadOrId.duration;
    return {
      type: CREATE_SESSION,
      sessionId,
      title: payloadOrId.title || '',
      entries: Array.isArray(payloadOrId.entries) ? payloadOrId.entries : [],
      timerDuration: rawDuration !== undefined ? rawDuration : 30,
      meta: { remote: true }
    };
  }
  return {
    type: CREATE_SESSION,
    sessionId: payloadOrId || `sess_${Date.now()}`,
    title: maybeTitle || '',
    entries: Array.isArray(maybeEntries) ? maybeEntries : [],
    timerDuration: maybeTimerDuration !== undefined ? maybeTimerDuration : 30,
    meta: { remote: true }
  };
};

export const startSession = (sessionIdOrPayload) => {
  const sessionId = sessionIdOrPayload && typeof sessionIdOrPayload === 'object'
    ? (sessionIdOrPayload.sessionId || sessionIdOrPayload.id)
    : sessionIdOrPayload;
  return {
    type: START_SESSION,
    sessionId,
    meta: { remote: true }
  };
};

export const archiveSession = (sessionIdOrPayload) => {
  const sessionId = sessionIdOrPayload && typeof sessionIdOrPayload === 'object'
    ? (sessionIdOrPayload.sessionId || sessionIdOrPayload.id)
    : sessionIdOrPayload;
  return {
    type: ARCHIVE_SESSION,
    sessionId,
    meta: { remote: true }
  };
};

export const vote = (sessionIdOrPayload, maybeEntry) => {
  if (typeof sessionIdOrPayload === 'object' && sessionIdOrPayload !== null) {
    const sessionId = sessionIdOrPayload.sessionId || sessionIdOrPayload.electionId;
    return {
      type: VOTE,
      sessionId,
      entry: sessionIdOrPayload.entry,
      meta: { remote: true }
    };
  }

  if (maybeEntry !== undefined) {
    return {
      type: VOTE,
      sessionId: sessionIdOrPayload,
      entry: maybeEntry,
      meta: { remote: true }
    };
  }

  return {
    type: VOTE,
    entry: sessionIdOrPayload,
    meta: { remote: true }
  };
};

export const next = (sessionIdOrPayload) => {
  const sessionId = typeof sessionIdOrPayload === 'object' && sessionIdOrPayload !== null
    ? (sessionIdOrPayload.sessionId || sessionIdOrPayload.electionId)
    : sessionIdOrPayload;
  return {
    type: NEXT,
    sessionId,
    meta: { remote: true }
  };
};

export const setEntries = (sessionIdOrPayload, maybeEntries) => {
  if (typeof sessionIdOrPayload === 'string') {
    return {
      type: SET_ENTRIES,
      sessionId: sessionIdOrPayload,
      entries: Array.isArray(maybeEntries) ? maybeEntries : [],
      meta: { remote: true }
    };
  }

  if (sessionIdOrPayload && typeof sessionIdOrPayload === 'object') {
    const sessionId = sessionIdOrPayload.sessionId || sessionIdOrPayload.electionId;
    return {
      type: SET_ENTRIES,
      sessionId,
      entries: Array.isArray(sessionIdOrPayload.entries)
        ? sessionIdOrPayload.entries
        : (Array.isArray(maybeEntries) ? maybeEntries : []),
      meta: { remote: true }
    };
  }

  return {
    type: SET_ENTRIES,
    entries: Array.isArray(sessionIdOrPayload) ? sessionIdOrPayload : [],
    meta: { remote: true }
  };
};

// Legacy SET_STATE action creator for backward compatibility
export const setStateAction = (statePayload, sessionId) => {
  const payload = statePayload && typeof statePayload === 'object' ? statePayload : {};
  const targetId = sessionId || payload.id || payload.sessionId;
  return {
    type: SET_STATE,
    sessionId: targetId,
    payload: { ...payload, ...(targetId ? { id: targetId } : {}) },
    state: { ...payload, ...(targetId ? { id: targetId } : {}) }
  };
};

// --- Selectors ---

/**
 * Extracts the slice state regardless of whether root store state or slice state is passed.
 */
export function getSessionsState(state) {
  if (!state) return initialState;
  if (state.sessions && typeof state.sessions === 'object' && ('bySessionId' in state.sessions || 'list' in state.sessions)) {
    return state.sessions;
  }
  return state;
}

export const getElectionsState = getSessionsState;

export const selectSessionList = (state) => {
  const slice = getSessionsState(state);
  return Array.isArray(slice.list) ? slice.list : [];
};

export const selectElectionList = selectSessionList;

export const selectActiveSessionId = (state) => {
  const slice = getSessionsState(state);
  return slice.activeSessionId || null;
};

export const selectActiveElectionId = selectActiveSessionId;

export const selectSessionById = (state, sessionId) => {
  if (!sessionId) return null;
  const slice = getSessionsState(state);
  return slice.bySessionId?.[sessionId] || null;
};

export const selectElectionById = selectSessionById;

export const selectActiveSession = (state) => {
  const slice = getSessionsState(state);
  const activeId = slice.activeSessionId;
  return activeId ? (slice.bySessionId?.[activeId] || null) : null;
};

export const selectActiveElection = selectActiveSession;

export const selectEntries = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (session && Array.isArray(session.entries)) {
    return session.entries;
  }
  if (state && Array.isArray(state.entries)) {
    return state.entries;
  }
  return [];
};

export const selectVote = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (session && session.vote !== undefined) {
    return session.vote;
  }
  if (state && state.vote !== undefined && !state.sessions && !state.bySessionId) {
    return state.vote;
  }
  return null;
};

export const selectWinner = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (session && session.winner !== undefined) {
    return session.winner;
  }
  if (state && state.winner !== undefined && !state.sessions && !state.bySessionId) {
    return state.winner;
  }
  return null;
};

export const selectSessionStatus = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (session && session.status !== undefined) {
    return session.status;
  }
  return null;
};

export const selectElectionStatus = selectSessionStatus;

export const selectHasLoaded = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (session) {
    return Boolean(session.hasLoaded);
  }
  if (state && state.hasLoaded !== undefined && !state.sessions && !state.bySessionId) {
    return Boolean(state.hasLoaded);
  }
  return false;
};

export const selectVoterCount = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (session && typeof session.voterCount === 'number') {
    return session.voterCount;
  }
  return 0;
};

export const selectEntryCount = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (session && typeof session.entryCount === 'number') {
    return session.entryCount;
  }
  if (session && Array.isArray(session.entries)) {
    return session.entries.length;
  }
  return 0;
};

export const setTimerState = (sessionIdOrPayload, maybeTimer) => {
  if (typeof sessionIdOrPayload === 'string' && maybeTimer && typeof maybeTimer === 'object') {
    const payload = { ...maybeTimer, sessionId: maybeTimer.sessionId || sessionIdOrPayload };
    return {
      type: TIMER_STATE,
      sessionId: sessionIdOrPayload,
      payload
    };
  }

  const payload = sessionIdOrPayload && typeof sessionIdOrPayload === 'object' ? sessionIdOrPayload : {};
  const sessionId = payload.sessionId || payload.id;
  return {
    type: TIMER_STATE,
    sessionId,
    payload
  };
};

export const timerStateAction = setTimerState;

export const selectTimer = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.timer ? session.timer : null;
};

export const selectTimerBySessionId = (state, sessionId) => {
  if (!sessionId) return null;
  const session = selectSessionById(state, sessionId);
  return session && session.timer ? session.timer : null;
};

export const selectTimerDuration = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (session && session.timerDuration !== undefined) {
    return session.timerDuration;
  }
  const slice = getSessionsState(state);
  if (targetId && Array.isArray(slice.list)) {
    const item = slice.list.find(s => s && (s.id === targetId || s.sessionId === targetId));
    if (item && item.timerDuration !== undefined) {
      return item.timerDuration;
    }
  }
  return 30;
};

export const selectTimerDurationBySessionId = (state, sessionId) => {
  return selectTimerDuration(state, sessionId);
};

export const selectRoundLifecycle = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.roundLifecycle ? session.roundLifecycle : 'VOTING';
};

export const selectRoundId = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.roundId ? session.roundId : null;
};

export const selectRoundIndex = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.roundIndex !== undefined ? session.roundIndex : null;
};

export const selectFinalVote = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.finalVote ? session.finalVote : null;
};

export const selectRevealTimer = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.revealTimer ? session.revealTimer : null;
};

export const selectIsRevealActive = (state, sessionId) => {
  return selectRoundLifecycle(state, sessionId) === 'RESULTS_REVEALED';
};

export default voteSlice.reducer;
