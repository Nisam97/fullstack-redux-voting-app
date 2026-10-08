import { describe, it, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  joinVoterSession,
  getVoterTokenKey,
  getVoterNameKey
} from '../src/services/auth.js';
import voteReducer, {
  createSession,
  setAllowlist,
  approveParticipant,
  rejectParticipant,
  removeParticipant,
  setWhoCanJoin,
  selectWhoCanJoin,
  selectSessionType,
  selectParticipantCounts,
  setSessions,
  setSessionState,
  initialState
} from '../src/redux/voteSlice.js';
import {
  createRemoteActionMiddleware,
  isRemoteAction,
  LOCAL_ACTION_TYPES
} from '../src/redux/store.js';
import socket from '../src/services/socket.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupMockWindow(seed = {}) {
  const sessionMap = new Map(Object.entries(seed));
  globalThis.window = {
    localStorage: {
      getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null),
      setItem: (k, v) => sessionMap.set(k, String(v)),
      removeItem: (k) => sessionMap.delete(k),
      clear: () => sessionMap.clear()
    },
    sessionStorage: {
      getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null),
      setItem: (k, v) => sessionMap.set(k, String(v)),
      removeItem: (k) => sessionMap.delete(k),
      clear: () => sessionMap.clear()
    }
  };
  return sessionMap;
}

// Builds a fetch stand in that answers with a fixed status and body.
function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  };
  return calls;
}

const realFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
  // The singleton socket keeps the event loop alive unless it is closed.
  try {
    socket.close();
  } catch {
    // harmless
  }
});

describe('Secured session voter join contract (AC-4, AC-5, AC-6)', () => {
  beforeEach(() => {
    setupMockWindow();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('1. approval mode: a 202 pending_approval join returns the request id and stores no voter token', async () => {
    // covers: AC-5
    const map = setupMockWindow();
    stubFetch(202, {
      success: true,
      status: 'pending_approval',
      requestId: '6ac0825ea3eeb4043cb43222',
      message: 'Join request awaiting admin approval'
    });

    const res = await joinVoterSession({ sessionId: 'sec_1', displayName: 'Ada' });

    assert.equal(res.success, true);
    assert.equal(res.status, 'pending_approval');
    assert.equal(res.requestId, '6ac0825ea3eeb4043cb43222');

    // A pending voter is NOT a participant yet, so no session token may be
    // written. Writing one here would let the voter skip the eligibility gate.
    assert.equal(
      map.get(getVoterTokenKey('sec_1')),
      undefined,
      'a pending request must not store a session voter token'
    );
  });

  it('2. approval mode: the pending join is posted with credentials so the vs_voter cookie travels', async () => {
    // covers: AC-5, AC-15
    stubFetch(202, { success: true, status: 'pending_approval', requestId: 'r1' });
    const calls = stubFetch(202, { success: true, status: 'pending_approval', requestId: 'r1' });

    await joinVoterSession({ sessionId: 'sec 1/2', displayName: '  Ada  ' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.endsWith('/api/sessions/sec%201%2F2/join'), true, 'sessionId must be encoded');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.credentials, 'include', 'the vs_voter cookie must be sent');
    assert.deepEqual(JSON.parse(calls[0].init.body), { displayName: 'Ada' }, 'displayName is trimmed');
  });

  it('3. allowlist mode: a signed in voter is refused with the code the lobby renders as a sign in wall', async () => {
    // covers: AC-4. Lobby.jsx branches on exactly this error code.
    setupMockWindow();
    stubFetch(401, {
      success: false,
      error: 'AUTHENTICATION_REQUIRED',
      message: 'Sign in to join this secured session.'
    });

    const res = await joinVoterSession({ sessionId: 'sec_1', displayName: 'Ada' });

    assert.equal(res.success, false);
    assert.equal(res.error, 'AUTHENTICATION_REQUIRED');
    assert.equal(res.message, 'Sign in to join this secured session.');
  });

  it('4. allowlist mode: a voter who is not on the list is refused with the code the lobby renders', async () => {
    // covers: AC-4. Lobby.jsx branches on NOT_ON_ALLOWLIST.
    stubFetch(403, {
      success: false,
      error: 'NOT_ON_ALLOWLIST',
      message: 'You are not on the allowlist for this session.'
    });

    const res = await joinVoterSession({ sessionId: 'sec_1', displayName: 'Ada' });

    assert.equal(res.success, false);
    assert.equal(res.error, 'NOT_ON_ALLOWLIST');
  });

  it('5. approval mode: a rejected voter is refused and cannot re request', async () => {
    // covers: AC-5. Lobby.jsx branches on REQUEST_REJECTED.
    stubFetch(403, {
      success: false,
      error: 'REQUEST_REJECTED',
      message: 'Your join request was rejected.'
    });

    const res = await joinVoterSession({ sessionId: 'sec_1', displayName: 'Ada' });

    assert.equal(res.success, false);
    assert.equal(res.error, 'REQUEST_REJECTED');
  });

  it('6. an approved voter joining successfully stores the token and subscribes to the session', async () => {
    // covers: AC-5, AC-6
    const map = setupMockWindow();
    stubFetch(200, {
      success: true,
      sessionId: 'sec_1',
      displayName: 'Ada',
      voterToken: 'user:6ac08162a3eeb4043cb43201',
      displayNameSource: 'profile',
      voterCount: 3,
      isRegisteredUser: true
    });

    const res = await joinVoterSession({ sessionId: 'sec_1', displayName: 'Ada' });

    assert.equal(res.success, true);
    assert.equal(res.voterToken, 'user:6ac08162a3eeb4043cb43201');
    assert.equal(
      map.get(getVoterTokenKey('sec_1')),
      'user:6ac08162a3eeb4043cb43201',
      'the server derived user token must be stored under the session scoped key'
    );
    assert.equal(map.get(getVoterNameKey('sec_1')), 'Ada');
  });

  it('7. joining refuses a blank display name before any request is made', async () => {
    // covers: AC-4. The lobby relies on this to show a local validation error.
    setupMockWindow();
    const calls = stubFetch(200, { success: true });

    const res = await joinVoterSession({ sessionId: 'sec_1', displayName: '   ' });

    assert.equal(res.success, false);
    assert.equal(res.error, 'INVALID_DISPLAY_NAME');
    assert.equal(calls.length, 0, 'no request should be sent for a blank name');
  });

  it('8. joining refuses a missing session id before any request is made', async () => {
    // covers: AC-4
    setupMockWindow();
    const calls = stubFetch(200, { success: true });

    const res = await joinVoterSession({ displayName: 'Ada' });

    assert.equal(res.success, false);
    assert.equal(res.error, 'INVALID_SESSION');
    assert.equal(calls.length, 0);
  });
});

describe('Secured session admin action contract (AC-2, AC-3, AC-6, AC-7)', () => {
  beforeEach(() => {
    setupMockWindow();
  });

  // These five action names are the whole secured session admin surface. The
  // server registers the same five in ADMIN_ACTION_TYPES and rejects anything
  // else at ingress, so a rename on either side silently disables the feature.
  const ADMIN_ACTIONS = [
    ['SET_ALLOWLIST', () => setAllowlist('sec_1', 'a@b.test'), { emails: 'a@b.test' }],
    ['APPROVE_PARTICIPANT', () => approveParticipant('sec_1', 'req_1'), { requestId: 'req_1' }],
    ['REJECT_PARTICIPANT', () => rejectParticipant('sec_1', 'req_1'), { requestId: 'req_1' }],
    // Targets by email, not by token. The admin allowlist panel only ever holds an
// email and a status, and the server resolves the email to a user and a token
// itself, so a voter token never has to reach the client (AC-14).
    ['REMOVE_PARTICIPANT', () => removeParticipant('sec_1', 'gone@example.com'), { email: 'gone@example.com' }],
    ['SET_WHO_CAN_JOIN', () => setWhoCanJoin('sec_1', 'approval'), { whoCanJoin: 'approval' }]
  ];

  for (const [type, make, expectedFields] of ADMIN_ACTIONS) {
    it(`9. ${type} builds an action the server recognises, scoped to its session`, () => {
      // covers: AC-2, AC-3, AC-6, AC-7
      const action = make();
      assert.equal(action.type, type);
      assert.equal(action.sessionId, 'sec_1', 'every secured action must carry its sessionId');
      for (const [field, value] of Object.entries(expectedFields)) {
        assert.equal(action[field], value, `${type} must carry ${field}`);
      }
    });

    it(`10. ${type} is forwarded to the server and is never suppressed by the echo guard`, () => {
      // covers: AC-2, AC-3, AC-6, AC-7
      assert.equal(
        LOCAL_ACTION_TYPES.has(type),
        false,
        `${type} is an admin intent and must not sit in LOCAL_ACTION_TYPES, or it would never reach the server`
      );
      assert.equal(isRemoteAction(make()), true, `${type} must qualify as a remote action`);
    });

    it(`11. ${type} carries the admin JWT, because the server rejects it without one`, () => {
      // covers: AC-2, AC-3, AC-6, AC-7
      window.localStorage.setItem('votesphere_admin_jwt', 'admin.jwt.value');

      const emitted = [];
      const mockSocket = { emit: (evt, payload) => emitted.push({ evt, payload }) };
      const middleware = createRemoteActionMiddleware(mockSocket);
      const next = () => {};

      middleware({})(next)(make());

      assert.equal(emitted.length, 1);
      assert.equal(emitted[0].evt, 'action');
      assert.equal(emitted[0].payload.token, 'admin.jwt.value', `${type} must be enriched with the admin token`);
      assert.equal(emitted[0].payload.meta?.token, 'admin.jwt.value');
    });
  }

  it('12. an explicit token on the action wins over the stored one', () => {
    // covers: AC-2, AC-3, AC-6, AC-7
    window.localStorage.setItem('votesphere_admin_jwt', 'stored.jwt');

    const emitted = [];
    const mockSocket = { emit: (evt, payload) => emitted.push({ evt, payload }) };
    const middleware = createRemoteActionMiddleware(mockSocket);

    middleware({})(() => {})({ ...setAllowlist('sec_1', 'a@b.test'), token: 'explicit.jwt' });

    assert.equal(emitted[0].payload.token, 'explicit.jwt', 'an explicit token must not be overwritten');
  });
});

describe('Secured session selectors (AC-2, AC-11)', () => {
  // The registry broadcast fills `list`; `bySessionId` is filled by the
  // per session `session_state` payload the client subscribes to. The secured
  // UI selectors all read bySessionId, so that is what these seed.
  const securedSession = {
    id: 'sec_1',
    sessionId: 'sec_1',
    title: 'Secured one',
    status: 'pending',
    type: 'secured',
    sessionType: 'secured',
    whoCanJoin: 'approval',
    participantCounts: { approvedCount: 5, pendingCount: 3, rejectedCount: 2 }
  };
  const publicSession = {
    id: 'pub_1',
    sessionId: 'pub_1',
    title: 'Public one',
    status: 'pending',
    type: 'public',
    whoCanJoin: 'public'
  };

  const sessionState = [
    securedSession,
    publicSession
  ].reduce((acc, payload) => voteReducer(acc, setSessionState(payload)), initialState);

  it('19. the registry list and the per session map are kept separate', () => {
    // covers: AC-11. A secured session must never be readable from the wrong place.
    const withList = voteReducer(initialState, setSessions([securedSession, publicSession]));
    assert.equal(withList.list.length, 2, 'the registry populates list');
    assert.deepEqual(Object.keys(withList.bySessionId), [], 'the registry must not populate bySessionId');
    assert.equal(
      selectWhoCanJoin(withList, 'sec_1'),
      'public',
      'a selector must not invent a mode for a session it has no state for'
    );
  });

  it('13. selectSessionType reports secured and public sessions distinctly', () => {
    assert.equal(selectSessionType(sessionState, 'sec_1'), 'secured');
    assert.equal(selectSessionType(sessionState, 'pub_1'), 'public');
  });

  it('14. selectWhoCanJoin reports the eligibility mode the admin panel switches', () => {
    assert.equal(selectWhoCanJoin(sessionState, 'sec_1'), 'approval');
    assert.equal(selectWhoCanJoin(sessionState, 'pub_1'), 'public');
  });

  it('15. selectParticipantCounts returns the approval queue counts for a secured session', () => {
    // covers: AC-11. The admin panel renders "5 approved · 3 pending · 2 rejected".
    assert.deepEqual(selectParticipantCounts(sessionState, 'sec_1'), {
      approvedCount: 5,
      pendingCount: 3,
      rejectedCount: 2
    });
  });

  it('16. selectParticipantCounts is null for a public session, which has no roster', () => {
    assert.equal(selectParticipantCounts(sessionState, 'pub_1'), null);
  });

  it('17. a mode switch updates only the target session and leaves other sessions alone', () => {
    // covers: AC-2. Session data must stay under bySessionId, never leak across.
    const after = voteReducer(sessionState, setWhoCanJoin('sec_1', 'allowlist'));

    assert.equal(selectWhoCanJoin(after, 'sec_1'), 'allowlist');
    assert.equal(selectWhoCanJoin(after, 'pub_1'), 'public');
    assert.equal(selectSessionType(after, 'sec_1'), 'secured', 'the switch must not change the session type');
  });

  it('18. a mode switch for an unknown session is ignored rather than inventing one', () => {
    const after = voteReducer(sessionState, setWhoCanJoin('sec_missing', 'approval'));
    assert.equal(after.bySessionId['sec_missing'], undefined);
    assert.equal(selectWhoCanJoin(after, 'sec_1'), 'approval', 'other sessions must be untouched');
  });
});
// ---------------------------------------------------------------------------
// Regression (spec 0007): createSession used to build its action from
// sessionId, title, entries and timerDuration only. sessionType and whoCanJoin
// were dropped on the floor, so the Admin form could only ever create a public
// session: the server defaults an untyped CREATE_SESSION to public, and
// SET_ALLOWLIST is then refused because the session is not secured.
// ---------------------------------------------------------------------------
describe('createSession forwards the access fields to the server', () => {
  const base = {
    sessionId: 'sec_created_1',
    title: 'Board Election',
    entries: ['Alpha', 'Beta']
  };

  it('19. carries a secured session through with whoCanJoin allowlist', () => {
    const action = createSession({ ...base, sessionType: 'secured', whoCanJoin: 'allowlist' });
    assert.equal(action.sessionType, 'secured');
    assert.equal(action.whoCanJoin, 'allowlist');
  });

  it('20. carries the approval mode through unchanged', () => {
    const action = createSession({ ...base, sessionType: 'secured', whoCanJoin: 'approval' });
    assert.equal(action.sessionType, 'secured');
    assert.equal(action.whoCanJoin, 'approval');
  });

  it('21. normalises the form\'s "open" to the "public" the server accepts', () => {
    // The server validates the type against 'public' and 'secured' and rejects
    // anything else with VALIDATION_ERROR. "open" is a session *status* in this
    // codebase, so forwarding it verbatim would break every public session.
    const action = createSession({ ...base, sessionType: 'open' });
    assert.equal(action.sessionType, 'public');
    assert.equal(action.whoCanJoin, 'public');
  });

  it('22. defaults a secured session to the allowlist rather than to public', () => {
    // The reducer defaults a missing whoCanJoin to 'public', and the server
    // rejects secured plus public, so leaving it unset would build a session
    // that contradicts itself.
    const action = createSession({ ...base, sessionType: 'secured' });
    assert.equal(action.whoCanJoin, 'allowlist');
  });

  it('23. reads the type from the `type` alias the form also sets', () => {
    const action = createSession({ ...base, type: 'secured', whoCanJoin: 'allowlist' });
    assert.equal(action.sessionType, 'secured');
  });

  it('24. falls back to public for an unrecognised type instead of passing it through', () => {
    const action = createSession({ ...base, sessionType: 'banana' });
    assert.equal(action.sessionType, 'public');
  });

  it('25. forces whoCanJoin to public on a public session whatever was asked for', () => {
    const action = createSession({ ...base, sessionType: 'public', whoCanJoin: 'allowlist' });
    assert.equal(action.whoCanJoin, 'public');
  });

  it('26. still defaults a payload with no access fields to a public session', () => {
    const action = createSession(base);
    assert.equal(action.sessionType, 'public');
    assert.equal(action.whoCanJoin, 'public');
    assert.equal(action.timerDuration, 30);
    assert.deepEqual(action.entries, ['Alpha', 'Beta']);
  });

  it('27. the positional form also declares a public session', () => {
    const action = createSession('sec_positional', 'Titled', ['A', 'B'], 45);
    assert.equal(action.sessionType, 'public');
    assert.equal(action.whoCanJoin, 'public');
  });

  it('28. the reducer reads the forwarded type and eligibility onto the session', () => {
    // End of the chain: the action now carries the fields, so the local copy is
    // secured too. Before the fix this session came out public even though the
    // admin had chosen otherwise.
    const action = createSession({ ...base, sessionType: 'secured', whoCanJoin: 'approval' });
    const state = voteReducer(initialState, action);
    assert.equal(selectSessionType(state, 'sec_created_1'), 'secured');
    assert.equal(selectWhoCanJoin(state, 'sec_created_1'), 'approval');
  });

  it('29. the payload still carries no publish flag', () => {
    // Spec 0008 AC-11: publishing is a post completion decision, never a create
    // time one, so the create payload must not offer it.
    const action = createSession({ ...base, sessionType: 'secured', whoCanJoin: 'allowlist' });
    assert.equal(Object.keys(action).includes('publishResultsPublicly'), false);
  });
});
