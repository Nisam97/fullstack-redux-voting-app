import http from 'http';
import { Server } from 'socket.io';
import makeStore from './store';
import { bootstrapDefaultSession, bootstrapHorrorSession } from './bootstrap';
import { seedAdmin, verifyAdminCredentials, generateAdminToken, verifyAdminToken } from './auth/admin';
import { registerVoter, validateVoterToken, canCastVote, recordVote, getVoterCount } from './auth/voter';
import { isConnected } from './db/connection';
import * as repository from './db/repository';
import { persistStateChanges } from './db/persistence';
import timerManager from './timer';
import roundManager from './roundManager';

/**
 * Protected action types requiring valid admin JWT authorization.
 */
export const ADMIN_ACTION_TYPES = new Set([
  'CREATE_SESSION',
  'START_SESSION',
  'ARCHIVE_SESSION',
  'SET_ENTRIES',
  'NEXT'
]);

/**
 * Parses HTTP cookie header string into key-value map.
 * @param {string} cookieHeader
 * @returns {Object}
 */
export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

/**
 * Extracts a client-facing summary list of all sessions from the store state.
 *
 * @param {Map} state - Immutable.js store state
 * @returns {Array<Object>} Array of session summary objects
 */
export function getSessionsSummary(state) {
  if (!state || typeof state.get !== 'function') {
    return [];
  }
  const sessions = state.get('sessions');
  if (!sessions || typeof sessions.valueSeq !== 'function') {
    return [];
  }
  return sessions.valueSeq().map((session) => {
    const sessionId = session.get('id');
    const rawEntries = session.get('entries');
    const activePair = session.getIn(['vote', 'pair']);
    const pairCount = (activePair && typeof activePair.size === 'number') ? activePair.size : 0;
    const queueCount = (rawEntries && typeof rawEntries.size === 'number')
      ? rawEntries.size
      : (Array.isArray(rawEntries) ? rawEntries.length : 0);
    const entryCount = pairCount + queueCount;

    const storedDuration = session.get('timerDuration');
    const timerDuration = (Number.isInteger(storedDuration) && storedDuration >= 5 && storedDuration <= 300)
      ? storedDuration
      : 30;

    const summary = {
      id: sessionId,
      sessionId: sessionId,
      title: session.get('title'),
      status: session.get('status'),
      entryCount: entryCount,
      voterCount: getVoterCount(sessionId),
      timerDuration: timerDuration
    };
    if (session.get('createdAt')) {
      summary.createdAt = session.get('createdAt');
    }
    if (session.get('winner')) {
      summary.winner = session.get('winner');
    }
    return summary;
  }).toJS();
}

/**
 * Reads JSON payload from an incoming HTTP request stream.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Sends a JSON HTTP response.
 */
function sendJson(res, statusCode, data, headers = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers
  });
  res.end(payload);
}

/**
 * Sets standard CORS response headers.
 */
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

/**
 * Starts the authoritative voting server with Socket.io and HTTP API endpoints.
 *
 * @param {Object|number} [store] - Redux store instance or port number if store omitted
 * @param {number} [port=8090] - Port number to listen on (0 for ephemeral)
 * @returns {Server} Socket.io server instance
 */
export default function startServer(store, port = 8090) {
  let actualStore = store;
  let actualPort = port;

  if (typeof store === 'number') {
    actualPort = store;
    actualStore = null;
  }

  if (!actualStore) {
    actualStore = makeStore();
    bootstrapDefaultSession(actualStore);
    bootstrapHorrorSession(actualStore);
  }

  // Ensure single admin is seeded from environment
  seedAdmin();

  let io;

  // Create native HTTP server for REST endpoints
  const httpServer = http.createServer(async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      // 1. POST /api/admin/login
      if (pathname === '/api/admin/login' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const identifier = body.username || body.email;
        const password = body.password;

        const authResult = verifyAdminCredentials(identifier, password);
        if (!authResult.valid) {
          sendJson(res, 401, {
            success: false,
            error: authResult.error || 'INVALID_CREDENTIALS',
            message: authResult.message || 'Invalid credentials'
          });
          return;
        }

        const token = generateAdminToken(authResult.admin);
        sendJson(res, 200, {
          success: true,
          token,
          user: authResult.admin
        });
        return;
      }

      // 2. GET /api/auth/me
      if (pathname === '/api/auth/me' && req.method === 'GET') {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        const verifyResult = verifyAdminToken(token);
        if (!verifyResult.valid) {
          sendJson(res, 401, {
            success: false,
            error: verifyResult.error,
            message: verifyResult.message
          });
          return;
        }
        sendJson(res, 200, {
          success: true,
          admin: verifyResult.admin
        });
        return;
      }

      // 3. POST /api/sessions/:sessionId/join
      const joinMatch = pathname.match(/^\/api\/sessions\/([^/?]+)\/join$/);
      if (joinMatch && req.method === 'POST') {
        const sessionId = decodeURIComponent(joinMatch[1]);
        const body = await readJsonBody(req);
        const displayName = body.displayName;

        const result = registerVoter({ sessionId, displayName, store: actualStore });
        if (!result.success) {
          const statusCode = result.error === 'SESSION_NOT_FOUND' ? 404 : 400;
          sendJson(res, statusCode, {
            success: false,
            error: result.error,
            message: result.message
          });
          return;
        }

        const voterCount = getVoterCount(result.voter.sessionId);

        // Broadcast real-time lobby_update to session room
        if (io) {
          io.to(`session:${result.voter.sessionId}`).emit('lobby_update', {
            sessionId: result.voter.sessionId,
            voterCount
          });
          io.emit('sessions', getSessionsSummary(actualStore.getState()));
        }

        const cookieValue = `voter_token_${result.voter.sessionId}=${encodeURIComponent(result.voter.sessionToken)}; Path=/; SameSite=Lax`;
        sendJson(res, 200, {
          success: true,
          sessionId: result.voter.sessionId,
          displayName: result.voter.displayName,
          voterToken: result.voter.sessionToken,
          voterCount
        }, {
          'Set-Cookie': cookieValue
        });
        return;
      }

      // 4. GET /api/sessions (Session Discovery)
      if (pathname === '/api/sessions' && req.method === 'GET') {
        const summaries = getSessionsSummary(actualStore.getState());
        sendJson(res, 200, {
          success: true,
          sessions: summaries,
          count: summaries.length
        });
        return;
      }

      // 5. GET /api/sessions/:sessionId/lobby (Waiting Room & Lobby Metadata)
      const lobbyMatch = pathname.match(/^\/api\/sessions\/([^/?]+)\/lobby$/);
      if (lobbyMatch && req.method === 'GET') {
        const sessionId = decodeURIComponent(lobbyMatch[1]);
        const state = actualStore.getState();
        const sessions = state && typeof state.get === 'function' ? state.get('sessions') : null;
        const session = sessions ? sessions.get(sessionId) : null;

        if (session) {
          const status = session.get('status');
          const title = session.get('title') || '';
          const rawEntries = session.get('entries');
          const activePair = session.getIn(['vote', 'pair']);
          const pairCount = (activePair && typeof activePair.size === 'number') ? activePair.size : 0;
          const queueCount = (rawEntries && typeof rawEntries.size === 'number')
            ? rawEntries.size
            : (Array.isArray(rawEntries) ? rawEntries.length : 0);
          const entryCount = pairCount + queueCount;
          const voterCount = getVoterCount(sessionId);
          const winner = session.get('winner') || null;

          const lobbyData = {
            sessionId,
            title,
            status,
            entryCount,
            voterCount,
            winner,
            votingStarted: status === 'open' || status === 'completed',
            isArchived: status === 'archived'
          };

          sendJson(res, 200, {
            success: true,
            ...lobbyData,
            session: lobbyData
          });
          return;
        }

        // If not in memory, check MongoDB (for archived sessions not loaded into Redux)
        if (isConnected()) {
          try {
            const dbSession = await repository.getSessionBySessionId(sessionId);
            if (dbSession) {
              const lobbyData = {
                sessionId: dbSession.sessionId,
                title: dbSession.title || '',
                status: dbSession.status,
                entryCount: Array.isArray(dbSession.entries) ? dbSession.entries.length : 0,
                voterCount: getVoterCount(sessionId),
                winner: dbSession.winner || null,
                votingStarted: dbSession.status === 'open' || dbSession.status === 'completed',
                isArchived: dbSession.status === 'archived'
              };
              sendJson(res, 200, {
                success: true,
                ...lobbyData,
                session: lobbyData
              });
              return;
            }
          } catch (dbErr) {
            console.error('[Server] Lobby DB lookup error:', dbErr.message);
          }
        }

        sendJson(res, 404, {
          success: false,
          error: 'SESSION_NOT_FOUND',
          message: `Session "${sessionId}" was not found.`
        });
        return;
      }

      // 4. GET /api/sessions/history
      if (pathname === '/api/sessions/history' && req.method === 'GET') {
        if (!isConnected()) {
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Database connection is unavailable'
          });
          return;
        }

        try {
          const limit = url.searchParams.get('limit') || 50;
          const results = await repository.getCompletedResults(limit);
          const formattedResults = results.map(r => ({
            sessionId: r.sessionId,
            title: r.title || '',
            winner: r.winner,
            entries: r.entries,
            completedAt: r.completedAt
          }));

          sendJson(res, 200, {
            success: true,
            results: formattedResults,
            count: formattedResults.length
          });
        } catch (dbErr) {
          console.error('[Server] History query error:', dbErr.message);
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Failed to retrieve results history'
          });
        }
        return;
      }

      // 5. GET /api/sessions/:sessionId/result (or /api/sessions/:sessionId/history)
      const sessionResultMatch = pathname.match(/^\/api\/sessions\/([^/?]+)\/(result|history)$/);
      if (sessionResultMatch && req.method === 'GET') {
        const sessionId = decodeURIComponent(sessionResultMatch[1]);
        if (!isConnected()) {
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Database connection is unavailable'
          });
          return;
        }

        try {
          const resultDoc = await repository.getResultBySessionId(sessionId);
          if (!resultDoc) {
            sendJson(res, 404, {
              success: false,
              error: 'RESULT_NOT_FOUND',
              message: `No completed result found for session "${sessionId}"`
            });
            return;
          }

          sendJson(res, 200, {
            success: true,
            result: {
              sessionId: resultDoc.sessionId,
              title: resultDoc.title || '',
              winner: resultDoc.winner,
              entries: resultDoc.entries,
              completedAt: resultDoc.completedAt
            }
          });
        } catch (dbErr) {
          console.error('[Server] Result query error:', dbErr.message);
          sendJson(res, 500, {
            success: false,
            error: 'DATABASE_ERROR',
            message: 'Failed to retrieve result for session'
          });
        }
        return;
      }

      // Default: 404 for unhandled API endpoints
      sendJson(res, 404, {
        error: 'NOT_FOUND',
        message: 'Endpoint not found'
      });
    } catch (err) {
      console.error('[Server] HTTP error:', err);
      sendJson(res, 500, {
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected server error occurred.'
      });
    }
  });

  io = new Server(httpServer, {
    cors: {
      origin: '*',
      credentials: true,
      methods: ['GET', 'POST']
    }
  });

  httpServer.listen(actualPort);

  let prevState = actualStore.getState();

  // Initialize round timers for any sessions already open with an active pair
  timerManager.onStateChange(null, prevState, actualStore, io);

  // Broadcast state changes
  actualStore.subscribe(() => {
    const currentState = actualStore.getState();
    if (currentState === prevState) {
      return;
    }

    const prevSessions = prevState && typeof prevState.get === 'function'
      ? prevState.get('sessions')
      : null;
    const currSessions = currentState && typeof currentState.get === 'function'
      ? currentState.get('sessions')
      : null;

    if (currSessions && typeof currSessions.forEach === 'function') {
      currSessions.forEach((session, sessionId) => {
        const prevSession = prevSessions ? prevSessions.get(sessionId) : null;
        if (session !== prevSession) {
          io.to(`session:${sessionId}`).emit('session_state', session.toJS());
        }
      });

      const prevSummary = getSessionsSummary(prevState);
      const currSummary = getSessionsSummary(currentState);
      if (JSON.stringify(prevSummary) !== JSON.stringify(currSummary)) {
        io.emit('sessions', currSummary);
      }
    }

    // Persist session lifecycle changes to MongoDB (fire-and-forget)
    persistStateChanges(prevState, currentState);

    // Synchronize round timer state transitions
    timerManager.onStateChange(prevState, currentState, actualStore, io);

    prevState = currentState;
  });

  io.on('connection', (socket) => {
    socket.data = socket.data || {};
    socket.data.voterTokens = socket.data.voterTokens || {};

    // Initial registry delivery
    socket.emit('sessions', getSessionsSummary(actualStore.getState()));

    // On-demand registry query
    socket.on('sessions', () => {
      socket.emit('sessions', getSessionsSummary(actualStore.getState()));
    });

    // Socket-based admin login
    socket.on('admin_login', (credentials, callback) => {
      try {
        const identifier = credentials?.username || credentials?.email;
        const password = credentials?.password;
        const authResult = verifyAdminCredentials(identifier, password);
        if (!authResult.valid) {
          if (typeof callback === 'function') {
            callback({ success: false, error: authResult.error, message: authResult.message });
          }
          return;
        }

        const token = generateAdminToken(authResult.admin);
        socket.data.adminToken = token;
        socket.data.isAdmin = true;

        if (typeof callback === 'function') {
          callback({ success: true, token, user: authResult.admin });
        }
      } catch (err) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'INTERNAL_ERROR', message: err.message });
        }
      }
    });

    // Socket-based voter session join
    socket.on('join_session', (payload, callback) => {
      try {
        const sessionId = payload?.sessionId;
        const displayName = payload?.displayName;
        const result = registerVoter({ sessionId, displayName, store: actualStore });
        if (!result.success) {
          if (typeof callback === 'function') {
            callback({ success: false, error: result.error, message: result.message });
          }
          return;
        }

        socket.data.voterTokens[result.voter.sessionId] = result.voter.sessionToken;
        const voterCount = getVoterCount(result.voter.sessionId);

        // Broadcast real-time lobby_update to session room
        io.to(`session:${result.voter.sessionId}`).emit('lobby_update', {
          sessionId: result.voter.sessionId,
          voterCount
        });
        io.emit('sessions', getSessionsSummary(actualStore.getState()));

        if (typeof callback === 'function') {
          callback({
            success: true,
            sessionId: result.voter.sessionId,
            displayName: result.voter.displayName,
            voterToken: result.voter.sessionToken,
            voterCount
          });
        }
      } catch (err) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'INTERNAL_ERROR', message: err.message });
        }
      }
    });

    // Subscribe to a session room
    socket.on('subscribe_session', (payload) => {
      try {
        let sessionId;
        if (typeof payload === 'string') {
          sessionId = payload;
        } else if (payload && typeof payload === 'object' && typeof payload.sessionId === 'string') {
          sessionId = payload.sessionId;
        }

        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
          return;
        }

        const state = actualStore.getState();
        const sessions = state && typeof state.get === 'function' ? state.get('sessions') : null;
        if (!sessions || !sessions.has(sessionId)) {
          return;
        }

        const roomName = `session:${sessionId}`;
        socket.join(roomName);

        const session = sessions.get(sessionId);
        socket.emit('session_state', session.toJS());

        // Hydrate current timer state for the session
        const revealTimer = timerManager.getRevealTimer(sessionId);
        const timer = timerManager.getTimer(sessionId);
        if (revealTimer && revealTimer.status === 'revealing') {
          socket.emit('timer_state', {
            sessionId,
            roundId: revealTimer.roundId,
            duration: revealTimer.duration,
            expiresAt: revealTimer.expiresAt,
            status: 'revealing'
          });
        } else if (timer && timer.status === 'running') {
          socket.emit('timer_state', {
            sessionId,
            roundId: timer.roundId,
            duration: timer.duration,
            expiresAt: timer.expiresAt,
            status: 'running'
          });
        } else {
          socket.emit('timer_state', {
            sessionId,
            duration: null,
            expiresAt: null,
            status: null
          });
        }
      } catch (err) {
        console.error('Error handling subscribe_session:', err);
      }
    });

    // Unsubscribe from a session room
    socket.on('unsubscribe_session', (payload) => {
      try {
        let sessionId;
        if (typeof payload === 'string') {
          sessionId = payload;
        } else if (payload && typeof payload === 'object' && typeof payload.sessionId === 'string') {
          sessionId = payload.sessionId;
        }

        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
          return;
        }

        const roomName = `session:${sessionId}`;
        socket.leave(roomName);
      } catch (err) {
        console.error('Error handling unsubscribe_session:', err);
      }
    });

    // Authoritative Action Ingress Handler
    socket.on('action', (action) => {
      try {
        if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
          return;
        }

        const actionType = action.type;

        // 1. PROTECT ADMIN ACTIONS
        if (ADMIN_ACTION_TYPES.has(actionType)) {
          const authHeader = socket.handshake?.headers?.authorization;
          const headerToken = authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : authHeader;

          const adminToken = action.token ||
            action.meta?.token ||
            socket.data?.adminToken ||
            socket.handshake?.auth?.token ||
            headerToken;

          const verification = verifyAdminToken(adminToken);
          if (!verification.valid) {
            socket.emit('action_error', {
              action: actionType,
              error: verification.error || 'UNAUTHORIZED',
              message: verification.message || 'Admin authorization required.'
            });
            return;
          }

          // Authoritative validation for CREATE_SESSION
          if (actionType === 'CREATE_SESSION') {
            const sessionId = action.sessionId || action.electionId;
            if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INVALID_SESSION_ID',
                message: 'Session ID is required and must be a non-empty string.'
              });
              return;
            }

            const state = actualStore.getState();
            const sessionsMap = state && typeof state.get === 'function' ? state.get('sessions') : null;
            if (sessionsMap && typeof sessionsMap.has === 'function' && sessionsMap.has(sessionId)) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'DUPLICATE_SESSION_ID',
                message: `Session with ID "${sessionId}" already exists.`
              });
              return;
            }

            const title = action.title;
            if (!title || typeof title !== 'string' || title.trim() === '') {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INVALID_TITLE',
                message: 'Session title is required and cannot be blank.'
              });
              return;
            }

            const entries = action.entries;
            if (!entries || !Array.isArray(entries) || entries.length < 2) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INSUFFICIENT_ENTRIES',
                message: 'At least 2 entries are required to create a tournament session.'
              });
              return;
            }

            const hasInvalidEntry = entries.some(e => typeof e !== 'string' || e.trim() === '');
            if (hasInvalidEntry) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INVALID_ENTRIES',
                message: 'All entries must be non-empty strings.'
              });
              return;
            }

            const distinctEntries = new Set(entries.map(e => e.trim()));
            if (distinctEntries.size < 2) {
              socket.emit('action_error', {
                action: 'CREATE_SESSION',
                error: 'INSUFFICIENT_ENTRIES',
                message: 'At least 2 distinct entries are required for pairwise voting tournament.'
              });
              return;
            }

            const rawDuration = action.timerDuration !== undefined
              ? action.timerDuration
              : action.duration;

            if (rawDuration !== undefined) {
              if (typeof rawDuration !== 'number' || !Number.isInteger(rawDuration)) {
                socket.emit('action_error', {
                  action: 'CREATE_SESSION',
                  error: 'INVALID_TIMER_DURATION_TYPE',
                  message: 'Timer duration must be an integer.'
                });
                return;
              }

              if (rawDuration < 5 || rawDuration > 300) {
                socket.emit('action_error', {
                  action: 'CREATE_SESSION',
                  error: 'INVALID_TIMER_DURATION',
                  message: 'Timer duration must be between 5 and 300 seconds.'
                });
                return;
              }
            }
          }

          // Authorized admin action — forward to Redux store
          actualStore.dispatch(action);
          return;
        }

        // 2. PROTECT VOTE ACTION
        if (actionType === 'VOTE') {
          const sessionId = action.sessionId || action.electionId;
          if (!sessionId || typeof sessionId !== 'string') {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'SESSION_REQUIRED',
              message: 'Session ID is required to vote.'
            });
            return;
          }

          // Parse cookies from socket handshake
          const cookies = parseCookies(socket.handshake?.headers?.cookie);
          const sessionCookieToken = cookies[`voter_token_${sessionId}`] || cookies['voter_token'];

          const voterToken = action.voterToken ||
            action.meta?.voterToken ||
            socket.data?.voterTokens?.[sessionId] ||
            socket.handshake?.auth?.voterToken ||
            sessionCookieToken;

          // Anonymous voting is strictly rejected
          if (!voterToken) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'VOTER_TOKEN_REQUIRED',
              message: 'A session voter token is required to cast a vote.'
            });
            return;
          }

          // Validate token and session match
          const tokenValidation = validateVoterToken(voterToken, sessionId);
          if (!tokenValidation.valid) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: tokenValidation.error,
              message: tokenValidation.message
            });
            return;
          }

          // Check current active pair in tournament
          const state = actualStore.getState();
          const session = state && typeof state.get === 'function'
            ? state.getIn(['sessions', sessionId])
            : null;

          if (!session || session.get('status') !== 'open') {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'SESSION_NOT_OPEN',
              message: 'Voting is not open for this session.'
            });
            return;
          }

          const activePair = session.getIn(['vote', 'pair']);
          const pairArray = activePair && typeof activePair.toJS === 'function'
            ? activePair.toJS()
            : (Array.isArray(activePair) ? activePair : []);

          if (!pairArray || pairArray.length < 2) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'NO_ACTIVE_PAIR',
              message: 'No active pair currently open for voting.'
            });
            return;
          }

          const entry = action.entry;
          if (!entry || typeof entry !== 'string' || !pairArray.includes(entry)) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'INVALID_ENTRY',
              message: `Vote entry "${entry}" is not part of the active voting pair.`
            });
            return;
          }

          // Feature 8 — Reject votes if the round is closed or revealing
          const roundLifecycle = session.get('roundLifecycle');
          const currentRound = roundManager.getCurrentRound(sessionId, actualStore);
          const isClosed = roundLifecycle === 'ROUND_CLOSED' ||
                           roundLifecycle === 'RESULTS_REVEALED' ||
                           (currentRound && currentRound.closed && currentRound.lifecycle !== 'VOTING');
          if (isClosed) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: 'ROUND_CLOSED',
              message: 'Voting is closed for this round.'
            });
            return;
          }

          // Server-side duplicate vote prevention
          const voteCheck = canCastVote({
            sessionToken: voterToken,
            sessionId,
            pair: pairArray
          });

          if (!voteCheck.allowed) {
            socket.emit('action_error', {
              action: 'VOTE',
              error: voteCheck.error,
              message: voteCheck.message
            });
            return;
          }

          // Authorize and record vote key
          recordVote(voteCheck.voteKey);

          // Feature 7 — Record current-round voter participation
          const currentRoundId = roundManager.getCurrentRoundId(sessionId, actualStore);
          if (currentRoundId) {
            roundManager.recordRoundSubmission({
              sessionId,
              roundId: currentRoundId,
              sessionToken: voterToken
            });
          }

          // Authoritative vote dispatch
          actualStore.dispatch(action);

          // Feature 7 — Idempotent early round completion check
          if (currentRoundId && roundManager.canCompleteEarly({ sessionId, roundId: currentRoundId })) {
            roundManager.closeRoundOnce({
              sessionId,
              roundId: currentRoundId,
              store: actualStore,
              timerManager,
              io
            });
          }
          return;
        }

        // 3. Other actions (e.g. unknown or internal)
        actualStore.dispatch(action);
      } catch (err) {
        console.error('Error handling socket action:', err);
      }
    });
  });

  io.timerManager = timerManager;
  io.roundManager = roundManager;

  const originalClose = io.close.bind(io);
  io.close = (callback) => {
    timerManager.clearAllTimers();
    roundManager.resetRounds();
    return originalClose(callback);
  };

  return io;
}