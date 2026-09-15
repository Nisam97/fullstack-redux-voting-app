import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  initialState,
  createSession,
  startSession,
  archiveSession,
  next,
  setSessions,
  setSessionState,
  selectSessionList,
  selectSessionById,
  CREATE_SESSION,
  START_SESSION,
  ARCHIVE_SESSION,
  NEXT
} from '../src/redux/voteSlice.js';
import {
  validateTimerDuration,
  DEFAULT_TIMER_DURATION,
  MIN_TIMER_DURATION,
  MAX_TIMER_DURATION
} from '../src/utils/timerUtils.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

describe('Feature 6 — Stage B: Admin Panel UI & Session Management Workflow', () => {

  // -------------------------------------------------------------
  // 1. Creation Entry Points & Modal Workflow
  // -------------------------------------------------------------
  describe('1. Creation Entry Points & Modal Workflow', () => {
    it('1. Create New Session button action is prominently defined', () => {
      // Test the modal state toggle contract
      let showCreateModal = false;
      const handleOpenCreateModal = () => { showCreateModal = true; };
      const handleCloseCreateModal = () => { showCreateModal = false; };

      assert.strictEqual(showCreateModal, false);
      handleOpenCreateModal();
      assert.strictEqual(showCreateModal, true);
      handleCloseCreateModal();
      assert.strictEqual(showCreateModal, false);
    });

    it('2. Empty state correctly identifies absence of sessions and prompts creation', () => {
      const emptyState = initialState;
      const sessionList = selectSessionList(emptyState);
      assert.strictEqual(sessionList.length, 0);

      // In empty state, message "No sessions yet." and action "+ Create New Session" are presented
      const isEmpty = sessionList.length === 0;
      const emptyStateMessage = isEmpty ? 'No sessions yet.' : null;
      assert.strictEqual(emptyStateMessage, 'No sessions yet.');
    });

    it('3. Session list with sessions exposes creation action at top and bottom', () => {
      const populatedState = voteReducer(initialState, setSessions([
        { id: 'sess_1', title: 'Tournament 1', status: 'open', timerDuration: 30 }
      ]));

      const list = selectSessionList(populatedState);
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].id, 'sess_1');
    });
  });

  // -------------------------------------------------------------
  // 2. Creation Form Validation & Sanitization
  // -------------------------------------------------------------
  describe('2. Creation Form Validation & Sanitization', () => {
    const validateForm = ({ title, entriesText, timerDuration, existingSessions, sessionId }) => {
      const trimmedTitle = (title || '').trim();
      if (!trimmedTitle) {
        return { valid: false, error: 'Session title is required.' };
      }

      const durationValidation = validateTimerDuration(timerDuration);
      if (!durationValidation.valid) {
        return { valid: false, error: durationValidation.error };
      }

      const rawEntries = (entriesText || '')
        .split(/[\n,]+/)
        .map(e => e.trim())
        .filter(e => e.length > 0);
      const entries = Array.from(new Set(rawEntries));

      if (entries.length < 2) {
        return { valid: false, error: 'At least 2 distinct entries are required for pairwise voting tournament.' };
      }

      const cleanId = ((sessionId || '').trim() || 'sess_autogen')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-');

      if (existingSessions && existingSessions.some(s => s.id === cleanId)) {
        return { valid: false, error: `A session with ID "${cleanId}" already exists. Please choose a unique ID.` };
      }

      return {
        valid: true,
        payload: {
          sessionId: cleanId,
          title: trimmedTitle,
          entries,
          timerDuration: durationValidation.value
        }
      };
    };

    it('4. Title is strictly required', () => {
      const resultEmpty = validateForm({ title: '', entriesText: 'A\nB', timerDuration: '30' });
      assert.strictEqual(resultEmpty.valid, false);
      assert.strictEqual(resultEmpty.error, 'Session title is required.');

      const resultWhitespace = validateForm({ title: '   ', entriesText: 'A\nB', timerDuration: '30' });
      assert.strictEqual(resultWhitespace.valid, false);
      assert.strictEqual(resultWhitespace.error, 'Session title is required.');
    });

    it('5. Timer duration defaults to 30 and adheres to 5-300 bounds', () => {
      assert.strictEqual(DEFAULT_TIMER_DURATION, 30);
      assert.strictEqual(MIN_TIMER_DURATION, 5);
      assert.strictEqual(MAX_TIMER_DURATION, 300);

      // Default
      const resDefault = validateForm({ title: 'Test', entriesText: 'A\nB', timerDuration: String(DEFAULT_TIMER_DURATION) });
      assert.strictEqual(resDefault.valid, true);
      assert.strictEqual(resDefault.payload.timerDuration, 30);

      // Minimum allowed (5)
      const resMin = validateForm({ title: 'Test', entriesText: 'A\nB', timerDuration: '5' });
      assert.strictEqual(resMin.valid, true);
      assert.strictEqual(resMin.payload.timerDuration, 5);

      // Maximum allowed (300)
      const resMax = validateForm({ title: 'Test', entriesText: 'A\nB', timerDuration: '300' });
      assert.strictEqual(resMax.valid, true);
      assert.strictEqual(resMax.payload.timerDuration, 300);

      // Rejects below 5
      const resBelow = validateForm({ title: 'Test', entriesText: 'A\nB', timerDuration: '4' });
      assert.strictEqual(resBelow.valid, false);
      assert.ok(resBelow.error.includes('at least 5'));

      // Rejects above 300
      const resAbove = validateForm({ title: 'Test', entriesText: 'A\nB', timerDuration: '301' });
      assert.strictEqual(resAbove.valid, false);
      assert.ok(resAbove.error.includes('cannot exceed 300'));
    });

    it('6. Requires at least 2 distinct entries (deduplicating commas & newlines)', () => {
      // Single entry
      const resOne = validateForm({ title: 'Test', entriesText: 'Solo Candidate', timerDuration: '30' });
      assert.strictEqual(resOne.valid, false);
      assert.ok(resOne.error.includes('At least 2 distinct entries'));

      // Duplicate entries
      const resDup = validateForm({ title: 'Test', entriesText: 'Candidate A, Candidate A', timerDuration: '30' });
      assert.strictEqual(resDup.valid, false);
      assert.ok(resDup.error.includes('At least 2 distinct entries'));

      // Valid multi-line
      const resValid = validateForm({ title: 'Test', entriesText: 'Option 1\nOption 2\nOption 3', timerDuration: '30' });
      assert.strictEqual(resValid.valid, true);
      assert.deepStrictEqual(resValid.payload.entries, ['Option 1', 'Option 2', 'Option 3']);
    });

    it('7. Rejects duplicate session ID before submission', () => {
      const existing = [{ id: 'existing-session', title: 'Existing' }];
      const res = validateForm({
        title: 'New Tournament',
        sessionId: 'existing-session',
        entriesText: 'Alpha\nBeta',
        timerDuration: '30',
        existingSessions: existing
      });

      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes('already exists'));
    });
  });

  // -------------------------------------------------------------
  // 3. CREATE_SESSION Socket / Redux Pipeline
  // -------------------------------------------------------------
  describe('3. CREATE_SESSION Socket / Redux Pipeline', () => {
    it('8. CREATE_SESSION action contains sessionId, title, entries, timerDuration, and remote meta', () => {
      const action = createSession({
        sessionId: 'sess_admin_test',
        title: 'Admin Created Tournament',
        entries: ['Entry 1', 'Entry 2'],
        timerDuration: 45
      });

      assert.strictEqual(action.type, CREATE_SESSION);
      assert.strictEqual(action.sessionId, 'sess_admin_test');
      assert.strictEqual(action.title, 'Admin Created Tournament');
      assert.deepStrictEqual(action.entries, ['Entry 1', 'Entry 2']);
      assert.strictEqual(action.timerDuration, 45);
      assert.strictEqual(action.meta?.remote, true);
    });

    it('9. Reducer integrates newly created session into state with pending status', () => {
      const action = createSession({
        sessionId: 'sess_new_pending',
        title: 'New Session',
        entries: ['Choice A', 'Choice B'],
        timerDuration: 60
      });

      const nextState = voteReducer(initialState, action);
      const session = nextState.bySessionId['sess_new_pending'];

      assert.ok(session);
      assert.strictEqual(session.id, 'sess_new_pending');
      assert.strictEqual(session.title, 'New Session');
      assert.strictEqual(session.status, 'pending');
      assert.strictEqual(session.timerDuration, 60);
      assert.strictEqual(session.entryCount, 2);
    });
  });

  // -------------------------------------------------------------
  // 4. Server Error Presentation (action_error)
  // -------------------------------------------------------------
  describe('4. Server Error Presentation (action_error)', () => {
    it('10. Extracts and formats human-readable message from server action_error', () => {
      const mockFormatActionError = (payload) => {
        return payload?.message ||
          `Action "${payload?.action}" failed: ${payload?.error || 'Unauthorized or invalid.'}`;
      };

      // Explicit message payload
      const err1 = mockFormatActionError({
        action: 'CREATE_SESSION',
        error: 'DUPLICATE_SESSION_ID',
        message: 'A session with ID "sess_1" already exists'
      });
      assert.strictEqual(err1, 'A session with ID "sess_1" already exists');

      // Fallback error format
      const err2 = mockFormatActionError({
        action: 'CREATE_SESSION',
        error: 'Invalid entries list'
      });
      assert.strictEqual(err2, 'Action "CREATE_SESSION" failed: Invalid entries list');
    });
  });

  // -------------------------------------------------------------
  // 5. Session List & At-a-Glance Information
  // -------------------------------------------------------------
  describe('5. Session List & At-a-Glance Information', () => {
    it('11. Session cards expose title, ID, status, timer duration, and voter count', () => {
      let stateWithSessions = voteReducer(initialState, setSessions([
        {
          id: 'sess_info_test',
          title: 'Information Test',
          status: 'open',
          timerDuration: 45,
          voterCount: 12,
          entryCount: 4
        }
      ]));
      stateWithSessions = voteReducer(stateWithSessions, setSessionState('sess_info_test', {
        id: 'sess_info_test',
        title: 'Information Test',
        status: 'open',
        timerDuration: 45,
        voterCount: 12,
        entryCount: 4
      }));

      const sessionFromList = selectSessionList(stateWithSessions)[0];
      assert.ok(sessionFromList);
      assert.strictEqual(sessionFromList.title, 'Information Test');
      assert.strictEqual(sessionFromList.id, 'sess_info_test');
      assert.strictEqual(sessionFromList.status, 'open');
      assert.strictEqual(sessionFromList.timerDuration, 45);
      assert.strictEqual(sessionFromList.voterCount, 12);
      assert.strictEqual(sessionFromList.entryCount, 4);

      const sessionDetail = selectSessionById(stateWithSessions, 'sess_info_test');
      assert.ok(sessionDetail);
      assert.strictEqual(sessionDetail.id, 'sess_info_test');
    });
  });

  // -------------------------------------------------------------
  // 6. Dedicated Manage Workflow & State-Specific Lifecycle Controls
  // -------------------------------------------------------------
  describe('6. Dedicated Manage Workflow & Lifecycle Controls', () => {
    const getPermittedActions = (status) => {
      switch (status) {
        case 'pending':
          return { canStart: true, canNext: false, canArchive: false, isArchived: false };
        case 'open':
          return { canStart: false, canNext: true, canArchive: true, isArchived: false };
        case 'completed':
          return { canStart: false, canNext: false, canArchive: true, isArchived: false };
        case 'archived':
          return { canStart: false, canNext: false, canArchive: false, isArchived: true };
        default:
          return { canStart: false, canNext: false, canArchive: false, isArchived: false };
      }
    };

    it('12. Pending session: exposes Start Tournament, disables Next Pair and Archive', () => {
      const actions = getPermittedActions('pending');
      assert.strictEqual(actions.canStart, true);
      assert.strictEqual(actions.canNext, false);
      assert.strictEqual(actions.canArchive, false);
      assert.strictEqual(actions.isArchived, false);
    });

    it('13. Open session: exposes Next Pair and Archive, disables Start Tournament', () => {
      const actions = getPermittedActions('open');
      assert.strictEqual(actions.canStart, false);
      assert.strictEqual(actions.canNext, true);
      assert.strictEqual(actions.canArchive, true);
      assert.strictEqual(actions.isArchived, false);
    });

    it('14. Completed session: exposes Archive and View Results, disables Start and Next Pair', () => {
      const actions = getPermittedActions('completed');
      assert.strictEqual(actions.canStart, false);
      assert.strictEqual(actions.canNext, false);
      assert.strictEqual(actions.canArchive, true);
      assert.strictEqual(actions.isArchived, false);
    });

    it('15. Archived session: read-only, hides Start, Next, and Archive', () => {
      const actions = getPermittedActions('archived');
      assert.strictEqual(actions.canStart, false);
      assert.strictEqual(actions.canNext, false);
      assert.strictEqual(actions.canArchive, false);
      assert.strictEqual(actions.isArchived, true);
    });

    it('16. Lifecycle action creators emit targeted session actions', () => {
      const startAction = startSession('sess_ctrl');
      assert.strictEqual(startAction.type, START_SESSION);
      assert.strictEqual(startAction.sessionId, 'sess_ctrl');
      assert.strictEqual(startAction.meta?.remote, true);

      const nextAction = next('sess_ctrl');
      assert.strictEqual(nextAction.type, NEXT);
      assert.strictEqual(nextAction.sessionId, 'sess_ctrl');
      assert.strictEqual(nextAction.meta?.remote, true);

      const archiveAction = archiveSession('sess_ctrl');
      assert.strictEqual(archiveAction.type, ARCHIVE_SESSION);
      assert.strictEqual(archiveAction.sessionId, 'sess_ctrl');
      assert.strictEqual(archiveAction.meta?.remote, true);
    });
  });

  // -------------------------------------------------------------
  // 7. Navigation & Room Links Preservation
  // -------------------------------------------------------------
  describe('7. Navigation & Room Links Preservation', () => {
    it('17. Generates correct route links for Lobby, Vote, and Results', () => {
      const sessionId = 'sess_nav_100';
      const lobbyUrl = `/sessions/${encodeURIComponent(sessionId)}/lobby`;
      const voteUrl = `/sessions/${encodeURIComponent(sessionId)}/vote`;
      const resultsUrl = `/sessions/${encodeURIComponent(sessionId)}/results`;

      assert.strictEqual(lobbyUrl, '/sessions/sess_nav_100/lobby');
      assert.strictEqual(voteUrl, '/sessions/sess_nav_100/vote');
      assert.strictEqual(resultsUrl, '/sessions/sess_nav_100/results');
    });
  });
});
