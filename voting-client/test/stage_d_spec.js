import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import voteReducer, {
  createSession,
  startSession,
  archiveSession,
  next,
  CREATE_SESSION,
  START_SESSION,
  ARCHIVE_SESSION,
  NEXT
} from '../src/redux/voteSlice.js';
import { createRemoteActionMiddleware, REMOTE_ACTION_TYPES } from '../src/redux/store.js';
import {
  ADMIN_TOKEN_KEY,
  ADMIN_USER_KEY,
  isAdminLoggedIn,
  logoutAdmin
} from '../src/services/auth.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

function setupMockWindow() {
  const localMap = new Map();
  const sessionMap = new Map();

  globalThis.window = {
    location: {
      origin: 'http://localhost:5173'
    },
    localStorage: {
      getItem: (key) => localMap.get(key) || null,
      setItem: (key, val) => localMap.set(key, String(val)),
      removeItem: (key) => localMap.delete(key),
      clear: () => localMap.clear()
    },
    sessionStorage: {
      getItem: (key) => sessionMap.get(key) || null,
      setItem: (key, val) => sessionMap.set(key, String(val)),
      removeItem: (key) => sessionMap.delete(key),
      clear: () => sessionMap.clear()
    }
  };
}

describe('Stage D — Admin Panel UI & Lifecycle Controls', () => {
  beforeEach(() => {
    setupMockWindow();
  });

  afterEach(() => {
    logoutAdmin();
  });

  // -------------------------------------------------------------
  // 1. Authentication & Route Protection Boundary
  // -------------------------------------------------------------
  describe('1. Authentication Boundary', () => {
    test('/admin guard: unauthenticated access rejected', () => {
      assert.strictEqual(isAdminLoggedIn(), false);
    });

    test('/admin guard: authenticated admin recognized with valid token', () => {
      window.localStorage.setItem(ADMIN_TOKEN_KEY, 'admin-jwt-token-12345');
      window.localStorage.setItem(ADMIN_USER_KEY, JSON.stringify({ username: 'superadmin' }));

      assert.strictEqual(isAdminLoggedIn(), true);
    });
  });

  // -------------------------------------------------------------
  // 2. Session Creation Action & Validation
  // -------------------------------------------------------------
  describe('2. Session Creation Action & Form Validation', () => {
    test('createSession action creator formats payload with sessionId, title, and entries', () => {
      const action = createSession({
        sessionId: 'sess_oscars',
        title: 'Academy Awards 2026',
        entries: ['Oppenheimer', 'Poor Things', 'The Zone of Interest']
      });

      assert.strictEqual(action.type, CREATE_SESSION);
      assert.strictEqual(action.sessionId, 'sess_oscars');
      assert.strictEqual(action.title, 'Academy Awards 2026');
      assert.deepStrictEqual(action.entries, ['Oppenheimer', 'Poor Things', 'The Zone of Interest']);
      assert.strictEqual(action.meta?.remote, true);
    });

    test('voteReducer handles CREATE_SESSION locally by initializing pending session in bySessionId and list', () => {
      const preState = {
        list: [],
        activeSessionId: null,
        bySessionId: {}
      };

      const action = createSession({
        sessionId: 'sess_oscars',
        title: 'Academy Awards 2026',
        entries: ['Oppenheimer', 'Poor Things']
      });

      const nextState = voteReducer(preState, action);

      assert.strictEqual(nextState.list.length, 1);
      assert.strictEqual(nextState.list[0].id, 'sess_oscars');
      assert.strictEqual(nextState.list[0].title, 'Academy Awards 2026');
      assert.strictEqual(nextState.list[0].status, 'pending');

      assert.ok(nextState.bySessionId.sess_oscars);
      assert.strictEqual(nextState.bySessionId.sess_oscars.status, 'pending');
      assert.deepStrictEqual(nextState.bySessionId.sess_oscars.entries, ['Oppenheimer', 'Poor Things']);
    });

    test('Validation logic: rejects empty title or fewer than 2 distinct entries', () => {
      const validateInput = (title, entriesText) => {
        const trimmedTitle = (title || '').trim();
        if (!trimmedTitle) return { valid: false, error: 'TITLE_REQUIRED' };

        const entries = Array.from(
          new Set(
            (entriesText || '')
              .split(/[\n,]+/)
              .map((e) => e.trim())
              .filter((e) => e.length > 0)
          )
        );

        if (entries.length < 2) return { valid: false, error: 'INSUFFICIENT_ENTRIES' };
        return { valid: true, title: trimmedTitle, entries };
      };

      assert.strictEqual(validateInput('', 'A, B').valid, false);
      assert.strictEqual(validateInput('   ', 'A, B').valid, false);
      assert.strictEqual(validateInput('Title', '').valid, false);
      assert.strictEqual(validateInput('Title', 'Only One').valid, false);
      assert.strictEqual(validateInput('Title', 'Duplicate, Duplicate').valid, false);

      const validResult = validateInput('Best Picture', 'Dune 2\nOppenheimer\nPast Lives');
      assert.strictEqual(validResult.valid, true);
      assert.strictEqual(validResult.entries.length, 3);
    });
  });

  // -------------------------------------------------------------
  // 3. Lifecycle Controls & Reducer Transitions
  // -------------------------------------------------------------
  describe('3. Lifecycle Controls & Reducer Transitions', () => {
    test('startSession action dispatches START_SESSION with sessionId', () => {
      const action = startSession('sess_default');
      assert.strictEqual(action.type, START_SESSION);
      assert.strictEqual(action.sessionId, 'sess_default');
      assert.strictEqual(action.meta?.remote, true);
    });

    test('handleStartSession transitions status from pending to open', () => {
      const preState = {
        list: [{ id: 'sess_default', title: 'Default', status: 'pending' }],
        activeSessionId: 'sess_default',
        bySessionId: {
          sess_default: {
            id: 'sess_default',
            title: 'Default',
            status: 'pending',
            entries: ['A', 'B', 'C']
          }
        }
      };

      const nextState = voteReducer(preState, startSession('sess_default'));
      assert.strictEqual(nextState.bySessionId.sess_default.status, 'open');
      assert.strictEqual(nextState.list[0].status, 'open');
    });

    test('archiveSession action dispatches ARCHIVE_SESSION with sessionId', () => {
      const action = archiveSession('sess_default');
      assert.strictEqual(action.type, ARCHIVE_SESSION);
      assert.strictEqual(action.sessionId, 'sess_default');
      assert.strictEqual(action.meta?.remote, true);
    });

    test('handleArchiveSession transitions status to archived and sets isArchived: true', () => {
      const preState = {
        list: [{ id: 'sess_default', title: 'Default', status: 'open' }],
        activeSessionId: 'sess_default',
        bySessionId: {
          sess_default: {
            id: 'sess_default',
            title: 'Default',
            status: 'open',
            entries: ['A']
          }
        }
      };

      const nextState = voteReducer(preState, archiveSession('sess_default'));
      assert.strictEqual(nextState.bySessionId.sess_default.status, 'archived');
      assert.strictEqual(nextState.bySessionId.sess_default.isArchived, true);
      assert.strictEqual(nextState.list[0].status, 'archived');
    });

    test('next action dispatches NEXT with sessionId', () => {
      const action = next('sess_default');
      assert.strictEqual(action.type, NEXT);
      assert.strictEqual(action.sessionId, 'sess_default');
      assert.strictEqual(action.meta?.remote, true);
    });
  });

  // -------------------------------------------------------------
  // 4. Remote Action Middleware Admin Token Enrichment
  // -------------------------------------------------------------
  describe('4. Remote Action Middleware & Socket Pipeline', () => {
    test('REMOTE_ACTION_TYPES contains all admin lifecycle actions', () => {
      assert.ok(REMOTE_ACTION_TYPES.has(CREATE_SESSION));
      assert.ok(REMOTE_ACTION_TYPES.has(START_SESSION));
      assert.ok(REMOTE_ACTION_TYPES.has(ARCHIVE_SESSION));
      assert.ok(REMOTE_ACTION_TYPES.has(NEXT));
    });

    test('Middleware enriches START_SESSION, NEXT, ARCHIVE_SESSION with admin JWT', () => {
      window.localStorage.setItem(ADMIN_TOKEN_KEY, 'admin-secret-jwt-xyz');

      const dispatchedActions = [];
      const mockSocket = {
        emit: (event, payload) => {
          if (event === 'action') dispatchedActions.push(payload);
        }
      };

      const middleware = createRemoteActionMiddleware(mockSocket)();
      const nextFn = (act) => act;

      middleware(nextFn)(startSession('sess_default'));
      assert.strictEqual(dispatchedActions.length, 1);
      assert.strictEqual(dispatchedActions[0].type, START_SESSION);
      assert.strictEqual(dispatchedActions[0].token, 'admin-secret-jwt-xyz');

      middleware(nextFn)(next('sess_default'));
      assert.strictEqual(dispatchedActions.length, 2);
      assert.strictEqual(dispatchedActions[1].type, NEXT);
      assert.strictEqual(dispatchedActions[1].token, 'admin-secret-jwt-xyz');

      middleware(nextFn)(archiveSession('sess_default'));
      assert.strictEqual(dispatchedActions.length, 3);
      assert.strictEqual(dispatchedActions[2].type, ARCHIVE_SESSION);
      assert.strictEqual(dispatchedActions[2].token, 'admin-secret-jwt-xyz');
    });
  });

  // -------------------------------------------------------------
  // 5. Session Isolation
  // -------------------------------------------------------------
  describe('5. Session Isolation in Admin Operations', () => {
    test('Advancing or archiving session A leaves session B completely untouched', () => {
      const preState = {
        list: [
          { id: 'sess_default', title: 'Default', status: 'open' },
          { id: 'sess_horror', title: 'Horror', status: 'pending' }
        ],
        activeSessionId: 'sess_default',
        bySessionId: {
          sess_default: {
            id: 'sess_default',
            title: 'Default',
            status: 'open',
            entries: ['D1', 'D2']
          },
          sess_horror: {
            id: 'sess_horror',
            title: 'Horror',
            status: 'pending',
            entries: ['H1', 'H2', 'H3']
          }
        }
      };

      // Archive sess_default
      const archivedState = voteReducer(preState, archiveSession('sess_default'));
      assert.strictEqual(archivedState.bySessionId.sess_default.status, 'archived');

      // sess_horror must still be pending with identical entries
      assert.strictEqual(archivedState.bySessionId.sess_horror.status, 'pending');
      assert.deepStrictEqual(archivedState.bySessionId.sess_horror.entries, ['H1', 'H2', 'H3']);
    });
  });

  // -------------------------------------------------------------
  // 6. Session Sharing & QR Generation
  // -------------------------------------------------------------
  describe('6. Session Sharing & QR Generation', () => {
    test('Participant share URL encodes session-specific lobby route', () => {
      const getLobbyUrl = (sessionId) => {
        const origin = window.location.origin;
        return `${origin}/sessions/${encodeURIComponent(sessionId)}/lobby`;
      };

      assert.strictEqual(
        getLobbyUrl('sess_default'),
        'http://localhost:5173/sessions/sess_default/lobby'
      );
      assert.strictEqual(
        getLobbyUrl('sess_horror'),
        'http://localhost:5173/sessions/sess_horror/lobby'
      );
    });

    test('QRCode.toDataURL generates valid data URL for participant lobby URL', async () => {
      const targetUrl = 'http://localhost:5173/sessions/sess_default/lobby';
      const qrDataUrl = await QRCode.toDataURL(targetUrl, { width: 240 });

      assert.ok(typeof qrDataUrl === 'string');
      assert.ok(qrDataUrl.startsWith('data:image/png;base64,'));
    });

    test('QR Code generation updates strictly according to selected session', async () => {
      const urlA = 'http://localhost:5173/sessions/sess_default/lobby';
      const urlB = 'http://localhost:5173/sessions/sess_horror/lobby';

      const qrA = await QRCode.toDataURL(urlA);
      const qrB = await QRCode.toDataURL(urlB);

      assert.notStrictEqual(qrA, qrB);
    });
  });

  // -------------------------------------------------------------
  // 7. Status-Aware Control Eligibility
  // -------------------------------------------------------------
  describe('7. Status-Aware Control Eligibility', () => {
    test('Determines valid controls for each lifecycle status', () => {
      const getEligibleActions = (status) => {
        switch (status) {
          case 'pending':
            return { canStart: true, canNext: false, canArchive: true };
          case 'open':
            return { canStart: false, canNext: true, canArchive: true };
          case 'completed':
            return { canStart: false, canNext: false, canArchive: true };
          case 'archived':
            return { canStart: false, canNext: false, canArchive: false };
          default:
            return { canStart: false, canNext: false, canArchive: false };
        }
      };

      assert.deepStrictEqual(getEligibleActions('pending'), { canStart: true, canNext: false, canArchive: true });
      assert.deepStrictEqual(getEligibleActions('open'), { canStart: false, canNext: true, canArchive: true });
      assert.deepStrictEqual(getEligibleActions('completed'), { canStart: false, canNext: false, canArchive: true });
      assert.deepStrictEqual(getEligibleActions('archived'), { canStart: false, canNext: false, canArchive: false });
    });
  });
});
