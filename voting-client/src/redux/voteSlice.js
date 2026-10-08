import { createSlice } from '@reduxjs/toolkit';
import { deriveTotals } from '../components/results/resultsUtils.js';

/**
 * Normalized initial state for multi-session management
 */
export const initialState = {
  list: [],
  activeSessionId: null,
  bySessionId: {},
  // Set when the server rejects the stored admin JWT. Not session data, so it
  // stays at the top level next to the normalized session shape.
  adminSessionExpired: false
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
// Declared here with the other action types, not next to its creator: the
// reducer below references it while the slice is being built, so a later
// `const` would still be in its temporal dead zone and the case would register
// under a bogus key, silently never matching any dispatch.
export const SET_ADMIN_SESSION_EXPIRED = 'SET_ADMIN_SESSION_EXPIRED';
export const LOBBY_UPDATE = 'lobby_update';
export const SET_LOBBY_UPDATE = 'SET_LOBBY_UPDATE';
export const CREATE_SESSION = 'CREATE_SESSION';
export const START_SESSION = 'START_SESSION';
export const ARCHIVE_SESSION = 'ARCHIVE_SESSION';
export const TIMER_STATE = 'timer_state';
export const SET_TIMER_STATE = 'SET_TIMER_STATE';
export const APPEND_ROUND_RESULT = 'APPEND_ROUND_RESULT';
export const RESOLVE_TIE = 'RESOLVE_TIE';
export const SET_TIE_PENDING = 'SET_TIE_PENDING';
export const TIE_PENDING = 'tie_pending';
export const PRESENCE_UPDATE = 'presence_update';
export const SET_PRESENCE_UPDATE = 'SET_PRESENCE_UPDATE';
export const SET_ALLOWLIST = 'SET_ALLOWLIST';
export const APPROVE_PARTICIPANT = 'APPROVE_PARTICIPANT';
export const REJECT_PARTICIPANT = 'REJECT_PARTICIPANT';
export const REMOVE_PARTICIPANT = 'REMOVE_PARTICIPANT';
export const SET_WHO_CAN_JOIN = 'SET_WHO_CAN_JOIN';
export const SET_PUBLISH_RESULTS = 'SET_PUBLISH_RESULTS';
// Local only: rolls the store copy back after the server refuses a publish.
// Registered with the same handler, but never eligible for remote transmission.
export const SET_PUBLISH_RESULTS_LOCAL = 'SET_PUBLISH_RESULTS_LOCAL';
export const SET_TURNOUT = 'SET_TURNOUT';
export const TURNOUT = 'session_turnout';

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

  const votingMode = raw.votingMode !== undefined
    ? raw.votingMode
    : (existing.votingMode !== undefined ? existing.votingMode : 'tournament');
  const tieCount = raw.tieCount !== undefined
    ? Number(raw.tieCount)
    : (existing.tieCount !== undefined ? Number(existing.tieCount) : 0);
  const zeroVoteCount = raw.zeroVoteCount !== undefined
    ? Number(raw.zeroVoteCount)
    : (existing.zeroVoteCount !== undefined ? Number(existing.zeroVoteCount) : 0);
  const tiePending = (winner || status === 'completed' || status === 'archived')
    ? null
    : (raw.tiePending !== undefined
        ? raw.tiePending
        : (existing.tiePending !== undefined ? existing.tiePending : null));

  const rounds = (raw.roundLifecycle === 'VOTING' && status !== 'completed')
    ? []
    : (Array.isArray(raw.rounds)
        ? raw.rounds
        : (raw.rounds !== undefined || raw.roundIndex !== undefined || raw.correctedRound
            ? []
            : (Array.isArray(existing.rounds) ? existing.rounds : [])));

  const connectedCount = raw.connectedCount !== undefined
    ? Number(raw.connectedCount)
    : (existing.connectedCount !== undefined ? Number(existing.connectedCount) : 0);
  const totalVoters = raw.totalVoters !== undefined
    ? Number(raw.totalVoters)
    : (existing.totalVoters !== undefined ? Number(existing.totalVoters) : voterCount);

  const sessionType = raw.sessionType || raw.type || existing.sessionType || existing.type || 'open';
  const whoCanJoin = raw.whoCanJoin || existing.whoCanJoin || (sessionType === 'secured' ? 'allowlist' : 'public');
  const publishResultsPublicly = raw.publishResultsPublicly !== undefined
    ? Boolean(raw.publishResultsPublicly)
    : (existing.publishResultsPublicly !== undefined ? Boolean(existing.publishResultsPublicly) : (sessionType !== 'secured'));
  const participantCounts = raw.participantCounts !== undefined
    ? raw.participantCounts
    : (existing.participantCounts !== undefined ? existing.participantCounts : null);

  // Security: Sanitize incoming raw object to ensure voter tokens, credentials, and raw presence structures never enter Redux
  const sanitizedRaw = { ...raw };
  delete sanitizedRaw.voterToken;
  delete sanitizedRaw.token;
  delete sanitizedRaw.jwt;
  delete sanitizedRaw.password;
  delete sanitizedRaw.secret;
  delete sanitizedRaw.presence;
  delete sanitizedRaw.snapshots;

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
    connectedCount,
    totalVoters,
    entryCount,
    isArchived,
    votingStarted,
    votingMode,
    sessionType,
    type: sessionType,
    whoCanJoin,
    publishResultsPublicly,
    participantCounts,
    tieCount,
    zeroVoteCount,
    tiePending,
    roundLifecycle,
    roundId,
    roundIndex,
    finalVote,
    revealTimer,
    rounds,
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
        type: summary.type !== undefined ? summary.type : existing.type,
        votingMode: summary.votingMode !== undefined ? summary.votingMode : existing.votingMode,
        joinCode: summary.joinCode !== undefined ? summary.joinCode : existing.joinCode,
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
 *
 * Deliberately a no-op: the server is authoritative, so the client never
 * tallies votes locally (local math would drift from `core.js` and briefly
 * show wrong standings under ties). This action is pure intent; the remote
 * action middleware ships it to the server and the resulting `session_state`
 * broadcast updates this slice.
 */
function handleVote(state) {
  return state;
}

/**
 * Reducer handler for NEXT action.
 *
 * Deliberately a no-op: only the server computes winners and round
 * advancement. This action is pure intent; the resulting `session_state`
 * broadcast updates this slice.
 */
function handleNext(state) {
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
  const connectedCount = incoming.connectedCount !== undefined
    ? Number(incoming.connectedCount)
    : (existing.connectedCount !== undefined ? existing.connectedCount : (existing.voterCount !== undefined ? existing.voterCount : 0));
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

  // The secured session access fields must survive this reducer. The lobby
  // hydrates itself with lobbyUpdate on mount, and Lobby.jsx decides whether to
  // show the sign in wall from sessionType / whoCanJoin. Rebuilding the entry
  // from a fixed field list silently dropped all three, so a secured session
  // looked open, the wall never rendered, and an anonymous visitor was offered
  // the plain join form. handleSetSessions already preserved type for the same
  // reason.
  const sessionType = incoming.sessionType !== undefined
    ? incoming.sessionType
    : (incoming.type !== undefined ? incoming.type : existing.sessionType);
  const type = incoming.type !== undefined
    ? incoming.type
    : (incoming.sessionType !== undefined ? incoming.sessionType : existing.type);
  const whoCanJoin = incoming.whoCanJoin !== undefined
    ? incoming.whoCanJoin
    : existing.whoCanJoin;

  state.bySessionId[cleanSessionId] = {
    ...existing,
    id: cleanSessionId,
    title,
    status,
    voterCount,
    connectedCount,
    entryCount,
    isArchived,
    votingStarted,
    ...(sessionType !== undefined ? { sessionType } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(whoCanJoin !== undefined ? { whoCanJoin } : {}),
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
        connectedCount,
        entryCount: incoming.entryCount !== undefined ? entryCount : state.list[idx].entryCount,
        isArchived,
        votingStarted
      };
    }
  }

  return state;
}

/**
 * Reducer handler for room scoped presence updates (presence_update / SET_PRESENCE_UPDATE).
 * Updates live connected count and total voters strictly under bySessionId[sessionId].
 */
function handlePresenceUpdate(state, action) {
  const incoming = action.payload !== undefined
    ? action.payload
    : (action.data || action);

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
  const connectedCount = incoming.connectedCount !== undefined
    ? Number(incoming.connectedCount)
    : (existing.connectedCount !== undefined ? existing.connectedCount : 0);
  const totalVoters = incoming.totalVoters !== undefined
    ? Number(incoming.totalVoters)
    : (existing.totalVoters !== undefined ? existing.totalVoters : (existing.voterCount !== undefined ? existing.voterCount : 0));

  state.bySessionId[cleanSessionId] = {
    ...existing,
    id: cleanSessionId,
    connectedCount,
    totalVoters,
    voterCount: totalVoters
  };

  if (Array.isArray(state.list)) {
    const idx = state.list.findIndex(
      (item) => item && (item.id === cleanSessionId || item.sessionId === cleanSessionId)
    );
    if (idx !== -1) {
      state.list[idx] = {
        ...state.list[idx],
        id: cleanSessionId,
        connectedCount,
        totalVoters,
        voterCount: totalVoters
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

  // The access fields have to land on the local copy too, not just on the wire.
  // Without them the freshly created session looked public here until a server
  // broadcast replaced it, so the Admin list and the lobby's secured sign in
  // wall were briefly (and wrongly) public.
  const sessionType = normalizeSessionType(action.sessionType ?? action.type);
  const whoCanJoin = sessionType === 'secured' ? (action.whoCanJoin || 'allowlist') : 'public';

  if (!state.bySessionId) state.bySessionId = {};
  if (!state.bySessionId[cleanId]) {
    state.bySessionId[cleanId] = normalizeSession({
      id: cleanId,
      title: action.title || '',
      status: 'pending',
      entries: Array.isArray(action.entries) ? action.entries : [],
      voterCount: 0,
      entryCount: Array.isArray(action.entries) ? action.entries.length : 0,
      timerDuration,
      type: sessionType,
      sessionType,
      whoCanJoin
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
      type: sessionType,
      sessionType,
      whoCanJoin,
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

function handleSetWhoCanJoin(state, action) {
  const sessionId = action.sessionId || action.id;
  if (!sessionId || !state.bySessionId || !state.bySessionId[sessionId]) return state;
  const session = state.bySessionId[sessionId];
  state.bySessionId[sessionId] = {
    ...session,
    whoCanJoin: action.whoCanJoin
  };
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
      tiePending: null,
      revealTimer: {
        duration: typeof incoming.duration === 'number' ? incoming.duration : Number(incoming.duration) || null,
        expiresAt: typeof incoming.expiresAt === 'number' ? incoming.expiresAt : Number(incoming.expiresAt) || null,
        startedAt: incoming.startedAt || existing.revealTimer?.startedAt || (incoming.expiresAt && incoming.duration ? incoming.expiresAt - (incoming.duration * 1000) : null),
        status: 'revealing',
        roundId: incoming.roundId || existing.roundId || null
      }
    };
  } else if (status === 'tie_pending') {
    state.bySessionId[cleanId] = {
      ...existing,
      roundLifecycle: 'TIE_PENDING',
      timer: null,
      revealTimer: null,
      tiePending: {
        candidates: incoming.candidates || existing.tiePending?.candidates || [],
        duration: typeof incoming.duration === 'number' ? incoming.duration : Number(incoming.duration) || 30,
        expiresAt: typeof incoming.expiresAt === 'number' ? incoming.expiresAt : Number(incoming.expiresAt) || (Date.now() + 30000),
        roundId: incoming.roundId || existing.roundId || null
      }
    };
  } else if (status === 'running') {
    state.bySessionId[cleanId] = {
      ...existing,
      roundLifecycle: 'VOTING',
      revealTimer: null,
      tiePending: null,
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

/**
 * Reducer handler for SET_TIE_PENDING and tie_pending events.
 * Updates roundLifecycle to TIE_PENDING and stores tiePending parameters.
 */
function handleSetTiePending(state, action) {
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
  state.bySessionId[cleanId] = {
    ...existing,
    roundLifecycle: 'TIE_PENDING',
    timer: null,
    revealTimer: null,
    tiePending: {
      candidates: incoming.candidates || incoming.tiePending?.candidates || existing.vote?.candidates || existing.vote?.pair || [],
      expiresAt: typeof incoming.expiresAt === 'number' ? incoming.expiresAt : Number(incoming.expiresAt) || (Date.now() + 30000),
      duration: typeof incoming.duration === 'number' ? incoming.duration : Number(incoming.duration) || 30,
      roundId: incoming.roundId || existing.roundId || null
    }
  };
  return state;
}

/**
 * Reducer handler for RESOLVE_TIE.
 * Pure intent remote action dispatched to authoritative server.
 */
function handleResolveTie(state) {
  return state;
}

/**
 * Reducer handler for CORRECT_ROUND_RESULT action (spec 0003 advanced fix).
 * Replaces the advanced field of an already stored round snapshot after the
 * server corrected it post NEXT. Mirrors the server's CORRECT_ROUND_RESULT
 * reducer: same roundIndex lookup, same advanced-only replacement.
 */
function handleCorrectRoundResult(state, action) {
  const incoming = action.payload !== undefined ? action.payload : action;
  if (!incoming || typeof incoming !== 'object') {
    return state;
  }
  const sessionId = action.sessionId || incoming.sessionId || incoming.id;
  const round = action.round || incoming.round;
  const roundIndex = action.roundIndex !== undefined ? action.roundIndex : incoming.roundIndex;
  if (!sessionId || !round || typeof round !== 'object' || roundIndex === undefined) {
    return state;
  }
  const cleanId = sessionId.trim();
  const existing = state.bySessionId[cleanId];
  if (!existing || !Array.isArray(existing.rounds)) {
    return state;
  }
  const idx = existing.rounds.findIndex(r => r && r.roundIndex === roundIndex);
  if (idx === -1) {
    return state;
  }
  const correctedRounds = existing.rounds.slice();
  correctedRounds[idx] = { ...correctedRounds[idx], advanced: round.advanced === undefined ? null : round.advanced };
  state.bySessionId[cleanId] = {
    ...existing,
    rounds: correctedRounds
  };
  return state;
}

/**
 * Reducer handler for APPEND_ROUND_RESULT action (AC-1, AC-4).
 * Appends frozen round result to session's rounds list, guarded by roundIndex idempotency.
 */
function handleAppendRoundResult(state, action) {
  const incoming = action.payload !== undefined ? action.payload : action;
  if (!incoming || typeof incoming !== 'object') {
    return state;
  }
  const sessionId = action.sessionId || incoming.sessionId || incoming.id;
  const round = action.round || incoming.round || action.roundSnapshot || incoming.roundSnapshot;
  if (!sessionId || !round || typeof round !== 'object') {
    return state;
  }
  const cleanId = sessionId.trim();
  if (!state.bySessionId) {
    state.bySessionId = {};
  }
  const existing = state.bySessionId[cleanId] || normalizeSession({ id: cleanId }, cleanId);
  const existingRounds = Array.isArray(existing.rounds) ? existing.rounds : [];
  if (!existingRounds.some(r => r.roundIndex === round.roundIndex)) {
    state.bySessionId[cleanId] = {
      ...existing,
      rounds: [...existingRounds, round]
    };
  }
  return state;
}

/**
 * Spec 0008 AC-3: stores the admin publish switch on the live session so the
 * toggle reflects the accepted value without a full session state round trip.
 */
function handleSetPublishResults(state, action) {
  const sessionId = action.sessionId || action.payload?.sessionId;
  if (!sessionId || typeof sessionId !== 'string' || !state.bySessionId || !state.bySessionId[sessionId]) {
    return state;
  }
  if (typeof action.publishResultsPublicly !== 'boolean') {
    return state;
  }
  state.bySessionId[sessionId] = {
    ...state.bySessionId[sessionId],
    publishResultsPublicly: action.publishResultsPublicly
  };
  if (Array.isArray(state.list)) {
    const item = state.list.find(s => s && (s.id === sessionId || s.sessionId === sessionId));
    if (item) item.publishResultsPublicly = action.publishResultsPublicly;
  }
  return state;
}

/**
 * Stores the admin per round turnout snapshot (spec 0008 AC-7) under
 * bySessionId[sessionId], keeping session data out of the slice top level.
 */
function handleSetTurnout(state, action) {
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
  state.bySessionId[cleanId] = {
    ...existing,
    turnout: Array.isArray(incoming.rounds) ? incoming.rounds : []
  };
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
    appendRoundResult: handleAppendRoundResult,
    setTiePendingAction: handleSetTiePending,
    resolveTieAction: handleResolveTie,
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
      .addCase(SET_ADMIN_SESSION_EXPIRED, (state, action) => {
        state.adminSessionExpired = action.payload !== undefined
          ? Boolean(action.payload)
          : Boolean(action.expired);
      })
      .addCase(SESSIONS, handleSetSessions)
      .addCase(SET_SESSIONS, handleSetSessions)
      .addCase(SESSION_STATE, handleSetSessionState)
      .addCase(SET_SESSION_STATE, handleSetSessionState)
      .addCase(SET_ACTIVE_SESSION, handleSetActiveSession)
      .addCase(LOBBY_UPDATE, handleLobbyUpdate)
      .addCase(SET_LOBBY_UPDATE, handleLobbyUpdate)
      .addCase(PRESENCE_UPDATE, handlePresenceUpdate)
      .addCase(SET_PRESENCE_UPDATE, handlePresenceUpdate)
      .addCase(CREATE_SESSION, handleCreateSession)
      .addCase(START_SESSION, handleStartSession)
      .addCase(ARCHIVE_SESSION, handleArchiveSession)
      .addCase(TIMER_STATE, handleTimerState)
      .addCase(SET_TIMER_STATE, handleTimerState)
      .addCase(APPEND_ROUND_RESULT, handleAppendRoundResult)
      .addCase('CORRECT_ROUND_RESULT', handleCorrectRoundResult)
      .addCase(SET_TIE_PENDING, handleSetTiePending)
      .addCase(TIE_PENDING, handleSetTiePending)
      .addCase(RESOLVE_TIE, handleResolveTie)
      .addCase(SET_WHO_CAN_JOIN, handleSetWhoCanJoin)
      .addCase(SET_PUBLISH_RESULTS, handleSetPublishResults)
      .addCase(SET_PUBLISH_RESULTS_LOCAL, handleSetPublishResults)
      .addCase(SET_TURNOUT, handleSetTurnout)
      .addCase(TURNOUT, handleSetTurnout)
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

export const presenceUpdate = (sessionIdOrPayload, maybePresence) => {
  if (typeof sessionIdOrPayload === 'string' && maybePresence && typeof maybePresence === 'object') {
    return {
      type: PRESENCE_UPDATE,
      sessionId: sessionIdOrPayload,
      payload: { ...maybePresence, sessionId: maybePresence.sessionId || sessionIdOrPayload }
    };
  }

  const payload = sessionIdOrPayload && typeof sessionIdOrPayload === 'object' ? sessionIdOrPayload : {};
  const sessionId = payload.sessionId || payload.id;
  return {
    type: PRESENCE_UPDATE,
    sessionId,
    payload
  };
};

export const setPresenceUpdate = presenceUpdate;

// The server validates the session type against 'public' and 'secured' and the
// Session schema stores the same enum. The create form has always spoken
// "open" for a public session, which is a *status* in this codebase rather than
// a type, so it is normalised here instead of at every call site.
const SESSION_TYPE_VALUES = ['public', 'secured'];

function normalizeSessionType(rawType) {
  if (rawType === 'open') return 'public';
  return SESSION_TYPE_VALUES.includes(rawType) ? rawType : 'public';
}

export const createSession = (payloadOrId, maybeTitle, maybeEntries, maybeTimerDuration) => {
  if (payloadOrId && typeof payloadOrId === 'object') {
    const sessionId = payloadOrId.sessionId || payloadOrId.id || `sess_${Date.now()}`;
    const rawDuration = payloadOrId.timerDuration !== undefined
      ? payloadOrId.timerDuration
      : payloadOrId.duration;
    // The access fields have to survive the trip to the server. Dropping them
    // here made every session created from the Admin form public, which in turn
    // made the secured eligibility gates and the allowlist actions unreachable
    // for anything the UI created.
    const sessionType = normalizeSessionType(payloadOrId.sessionType ?? payloadOrId.type);
    const whoCanJoin = sessionType === 'secured'
      ? (payloadOrId.whoCanJoin || 'allowlist')
      : 'public';
    return {
      type: CREATE_SESSION,
      sessionId,
      title: payloadOrId.title || '',
      entries: Array.isArray(payloadOrId.entries) ? payloadOrId.entries : [],
      timerDuration: rawDuration !== undefined ? rawDuration : 30,
      sessionType,
      whoCanJoin,
      meta: { remote: true }
    };
  }
  return {
    type: CREATE_SESSION,
    sessionId: payloadOrId || `sess_${Date.now()}`,
    title: maybeTitle || '',
    entries: Array.isArray(maybeEntries) ? maybeEntries : [],
    timerDuration: maybeTimerDuration !== undefined ? maybeTimerDuration : 30,
    sessionType: 'public',
    whoCanJoin: 'public',
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

export const refreshJoinCode = (sessionIdOrPayload) => {
  const sessionId = sessionIdOrPayload && typeof sessionIdOrPayload === 'object'
    ? (sessionIdOrPayload.sessionId || sessionIdOrPayload.id)
    : sessionIdOrPayload;
  return {
    type: 'REFRESH_JOIN_CODE',
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

export const setTiePending = (sessionIdOrPayload, maybeTieData) => {
  if (typeof sessionIdOrPayload === 'string') {
    const payload = maybeTieData && typeof maybeTieData === 'object' ? maybeTieData : {};
    return {
      type: SET_TIE_PENDING,
      sessionId: sessionIdOrPayload,
      payload: { ...payload, sessionId: sessionIdOrPayload }
    };
  }
  const payload = sessionIdOrPayload && typeof sessionIdOrPayload === 'object' ? sessionIdOrPayload : {};
  const sessionId = payload.sessionId || payload.id;
  return {
    type: SET_TIE_PENDING,
    sessionId,
    payload
  };
};

export const resolveTie = (sessionIdOrPayload, maybeRoundId, maybeChoice, maybeWinner, maybeToken) => {
  if (sessionIdOrPayload && typeof sessionIdOrPayload === 'object') {
    const sessionId = sessionIdOrPayload.sessionId || sessionIdOrPayload.id;
    const token = sessionIdOrPayload.token || sessionIdOrPayload.meta?.token;
    return {
      type: RESOLVE_TIE,
      sessionId,
      roundId: sessionIdOrPayload.roundId,
      choice: sessionIdOrPayload.choice,
      winner: sessionIdOrPayload.winner,
      ...(token ? { token } : {}),
      meta: { remote: true, ...(token ? { token } : {}), ...(sessionIdOrPayload.meta || {}) }
    };
  }
  return {
    type: RESOLVE_TIE,
    sessionId: sessionIdOrPayload,
    roundId: maybeRoundId,
    choice: maybeChoice,
    winner: maybeWinner,
    ...(maybeToken ? { token: maybeToken } : {}),
    meta: { remote: true, ...(maybeToken ? { token: maybeToken } : {}) }
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
  if (state.vote && typeof state.vote === 'object' && ('bySessionId' in state.vote || 'list' in state.vote)) {
    return state.vote;
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

export const selectSessionRounds = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && Array.isArray(session.rounds) ? session.rounds : [];
};

export const selectRoundTotals = (state, sessionId) => {
  const rounds = selectSessionRounds(state, sessionId);
  return deriveTotals(rounds);
};

export const appendRoundResult = (sessionIdOrPayload, maybeRound) => {
  if (typeof sessionIdOrPayload === 'string') {
    return {
      type: APPEND_ROUND_RESULT,
      sessionId: sessionIdOrPayload,
      round: maybeRound,
      payload: { sessionId: sessionIdOrPayload, round: maybeRound }
    };
  }
  const payload = sessionIdOrPayload && typeof sessionIdOrPayload === 'object' ? sessionIdOrPayload : {};
  const sessionId = payload.sessionId || payload.id;
  const round = payload.round || payload.roundSnapshot || maybeRound;
  return {
    type: APPEND_ROUND_RESULT,
    sessionId,
    round,
    payload: { ...payload, sessionId, round }
  };
};

export const selectVotingMode = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.votingMode ? session.votingMode : 'tournament';
};

export const selectTiePending = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.tiePending ? session.tiePending : null;
};

export const selectIsTiePending = (state, sessionId) => {
  return selectRoundLifecycle(state, sessionId) === 'TIE_PENDING';
};

export const selectCandidates = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (!session || !session.vote) return [];
  if (Array.isArray(session.vote.candidates)) return session.vote.candidates;
  if (Array.isArray(session.vote.pair)) return session.vote.pair;
  return [];
};

export const selectConnectedCount = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && typeof session.connectedCount === 'number' ? session.connectedCount : 0;
};

export const selectTotalVoters = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  if (session && typeof session.totalVoters === 'number') {
    return session.totalVoters;
  }
  return selectVoterCount(state, targetId);
};

export const setAllowlist = (sessionId, emails) => ({
  type: SET_ALLOWLIST,
  sessionId,
  emails
});

export const approveParticipant = (sessionId, requestId) => ({
  type: APPROVE_PARTICIPANT,
  sessionId,
  requestId
});

export const rejectParticipant = (sessionId, requestId) => ({
  type: REJECT_PARTICIPANT,
  sessionId,
  requestId
});

// Targets the voter by email rather than by token. The admin allowlist panel
// only ever holds the email and the status, and the server resolves the email
// to a user and a token itself, so passing an email keeps the client from
// holding voter tokens it has no business seeing (AC-11, AC-14).
export const removeParticipant = (sessionId, email) => ({
  type: REMOVE_PARTICIPANT,
  sessionId,
  email
});

export const setWhoCanJoin = (sessionId, whoCanJoin) => ({
  type: SET_WHO_CAN_JOIN,
  sessionId,
  whoCanJoin
});

// Spec 0008 AC-3: admin publish/unpublish of a completed secured result. Remote
// intent, enriched with the admin token by the remote action middleware.
// Spec 0008 AC-3: `onAck` is optional and receives the server's answer, so the
// caller can render the value the server actually stored rather than the one it
// asked for. The middleware turns it into the Socket.io acknowledgement
// callback and keeps it off the wire.
export const setPublishResults = (sessionId, publishResultsPublicly, onAck) => ({
  type: SET_PUBLISH_RESULTS,
  sessionId,
  publishResultsPublicly,
  meta: {
    remote: true,
    ...(typeof onAck === 'function' ? { onAck } : {})
  }
});

// Spec 0008 AC-3: keeps the local copy in step with a publish the server
// accepted. Local only: echoing it back would ask the server to undo a change
// it never took.
export const setPublishResultsLocal = (sessionId, publishResultsPublicly) => ({
  type: SET_PUBLISH_RESULTS_LOCAL,
  sessionId,
  publishResultsPublicly
});

// Local-only: the server pushes turnout through the `session_turnout` event, so
// this action must never echo back to the server.
export const setTurnout = (sessionIdOrPayload, maybeRounds) => {
  if (typeof sessionIdOrPayload === 'string') {
    return {
      type: SET_TURNOUT,
      sessionId: sessionIdOrPayload,
      payload: { sessionId: sessionIdOrPayload, rounds: Array.isArray(maybeRounds) ? maybeRounds : [] }
    };
  }
  const payload = sessionIdOrPayload && typeof sessionIdOrPayload === 'object' ? sessionIdOrPayload : {};
  return {
    type: SET_TURNOUT,
    sessionId: payload.sessionId || payload.id,
    payload
  };
};

// Local-only: set when the server rejects the stored admin JWT, so admin only
// surfaces can say the session is gone instead of rendering as if data simply
// does not exist yet. Cleared on a fresh admin login.
export const setAdminSessionExpired = (expired = true) => ({
  type: SET_ADMIN_SESSION_EXPIRED,
  expired: Boolean(expired)
});

// A single shared empty array, so a session with no turnout returns the same
// reference on every call. Returning a fresh [] here made react-redux warn that
// the selector was unstable, which is noise that hides real warnings.
const EMPTY_TURNOUT = Object.freeze([]);

/**
 * True once the server has rejected the stored admin JWT (spec 0008 AC-7).
 * Admin only surfaces then have to say so, because the local expiry check still
 * passes and the UI would otherwise render an admin panel that silently does
 * nothing.
 */
export const selectAdminSessionExpired = (state) => Boolean(getSessionsState(state).adminSessionExpired);

export const selectTurnout = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && Array.isArray(session.turnout) ? session.turnout : EMPTY_TURNOUT;
};

export const selectPublishResultsPublicly = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return Boolean(session && session.publishResultsPublicly);
};

export const selectSessionType = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.type ? session.type : 'open';
};

export const selectWhoCanJoin = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.whoCanJoin ? session.whoCanJoin : 'public';
};

export const selectParticipantCounts = (state, sessionId) => {
  const targetId = sessionId || selectActiveSessionId(state);
  const session = targetId ? selectSessionById(state, targetId) : null;
  return session && session.participantCounts ? session.participantCounts : null;
};

export default voteSlice.reducer;
