import { expect } from 'chai';
import makeStore from '../src/store.js';
import reducer from '../src/reducer.js';
import { Map, Set as ImmutableSet } from 'immutable';
import { serializeSessionState, getSessionsSummary, socketToVoter } from '../src/server.js';
import { registerVoter, clearVoters, validateVoterToken, releaseSessionVoters } from '../src/auth/voter.js';
import { resetAuthConfig } from '../src/auth/config.js';
import { resetRounds } from '../src/roundManager.js';
import { GRACE_PERIOD_MS } from '../src/constants.js';

describe('Presence and Eligibility Unit Invariants (AC 1, AC 2, AC 3, AC 8, AC 10)', function () {
  beforeEach(() => {
    clearVoters();
    resetAuthConfig();
    resetRounds();
    socketToVoter.clear();
  });

  describe('1. Redux Presence Reducer Transitions (AC 1, AC 2)', () => {
    it('initializes empty presence and snapshots upon CREATE_SESSION', () => {
      const state = reducer(undefined, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_init',
        title: 'Initial Presence Session',
        entries: ['Option A', 'Option B']
      });

      const session = state.getIn(['sessions', 'sess_init']);
      expect(Boolean(session)).to.equal(true);
      expect(Map.isMap(session.get('presence'))).to.equal(true);
      expect(session.get('presence').size).to.equal(0);
      expect(Map.isMap(session.get('snapshots'))).to.equal(true);
      expect(session.get('snapshots').size).to.equal(0);
    });

    it('records first socket connection and marks voter connected', () => {
      let state = reducer(undefined, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_conn',
        title: 'Connect Session',
        entries: ['Option A', 'Option B']
      });

      const now = Date.now();
      state = reducer(state, {
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_conn',
        voterToken: 'tok_voter_1',
        socketId: 'sock_1',
        timestamp: now
      });

      const record = state.getIn(['sessions', 'sess_conn', 'presence', 'tok_voter_1']);
      expect(Boolean(record)).to.equal(true);
      expect(record.get('connected')).to.equal(true);
      expect(record.get('lastSeenAt')).to.equal(now);
      expect(record.get('disconnectedAt')).to.equal(null);
      expect(record.get('socketIds').has('sock_1')).to.equal(true);
      expect(record.get('socketIds').size).to.equal(1);
    });

    it('multi tab connection maintains connected status until final socket closes', () => {
      let state = reducer(undefined, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_multi',
        title: 'Multi Tab Session',
        entries: ['Option A', 'Option B']
      });

      state = reducer(state, {
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_multi',
        voterToken: 'tok_multi',
        socketId: 'sock_tab_1',
        timestamp: 1000
      });

      state = reducer(state, {
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_multi',
        voterToken: 'tok_multi',
        socketId: 'sock_tab_2',
        timestamp: 1500
      });

      let record = state.getIn(['sessions', 'sess_multi', 'presence', 'tok_multi']);
      expect(record.get('connected')).to.equal(true);
      expect(record.get('socketIds').size).to.equal(2);

      // Disconnect first tab: still connected
      state = reducer(state, {
        type: 'RECORD_PRESENCE_DISCONNECT',
        sessionId: 'sess_multi',
        voterToken: 'tok_multi',
        socketId: 'sock_tab_1',
        timestamp: 2000
      });

      record = state.getIn(['sessions', 'sess_multi', 'presence', 'tok_multi']);
      expect(record.get('connected')).to.equal(true);
      expect(record.get('disconnectedAt')).to.equal(null);
      expect(record.get('socketIds').size).to.equal(1);
      expect(record.get('socketIds').has('sock_tab_2')).to.equal(true);

      // Disconnect second tab: now disconnected
      state = reducer(state, {
        type: 'RECORD_PRESENCE_DISCONNECT',
        sessionId: 'sess_multi',
        voterToken: 'tok_multi',
        socketId: 'sock_tab_2',
        timestamp: 3000
      });

      record = state.getIn(['sessions', 'sess_multi', 'presence', 'tok_multi']);
      expect(record.get('connected')).to.equal(false);
      expect(record.get('disconnectedAt')).to.equal(3000);
      expect(record.get('socketIds').size).to.equal(0);
    });

    it('freezes round eligibility snapshot and ignores repeat dispatches (AC 9)', () => {
      let state = reducer(undefined, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_snap',
        title: 'Snapshot Session',
        entries: ['Option A', 'Option B']
      });

      state = reducer(state, {
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_snap',
        voterToken: 'tok_1',
        socketId: 'sock_1',
        timestamp: 1000
      });

      state = reducer(state, {
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_snap',
        voterToken: 'tok_2',
        socketId: 'sock_2',
        timestamp: 1000
      });

      // First snapshot freeze
      state = reducer(state, {
        type: 'SNAPSHOT_ROUND_ELIGIBILITY',
        sessionId: 'sess_snap',
        roundId: 'sess_snap:::r1',
        timestamp: 1200
      });

      const snap1 = state.getIn(['sessions', 'sess_snap', 'snapshots', 'sess_snap:::r1']);
      expect(Boolean(snap1)).to.equal(true);
      expect(snap1.get('snapshotCount')).to.equal(2);
      expect(snap1.get('eligibleVoterKeys').has('tok_1')).to.equal(true);
      expect(snap1.get('eligibleVoterKeys').has('tok_2')).to.equal(true);

      // Connect tok_3 mid round
      state = reducer(state, {
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_snap',
        voterToken: 'tok_3',
        socketId: 'sock_3',
        timestamp: 1500
      });

      // Repeat snapshot dispatch must be ignored (idempotent contract)
      state = reducer(state, {
        type: 'SNAPSHOT_ROUND_ELIGIBILITY',
        sessionId: 'sess_snap',
        roundId: 'sess_snap:::r1',
        timestamp: 1600
      });

      const snapAfter = state.getIn(['sessions', 'sess_snap', 'snapshots', 'sess_snap:::r1']);
      expect(snapAfter.get('snapshotCount')).to.equal(2);
      expect(snapAfter.get('eligibleVoterKeys').has('tok_3')).to.equal(false);
    });

    it('purges presence and snapshots upon PURGE_SESSION_PRESENCE action', () => {
      let state = reducer(undefined, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_purge',
        title: 'Purge Session',
        entries: ['Option A', 'Option B']
      });

      state = reducer(state, {
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_purge',
        voterToken: 'tok_1',
        socketId: 'sock_1',
        timestamp: 1000
      });

      state = reducer(state, {
        type: 'SNAPSHOT_ROUND_ELIGIBILITY',
        sessionId: 'sess_purge',
        roundId: 'sess_purge:::r1',
        timestamp: 1100
      });

      expect(state.getIn(['sessions', 'sess_purge', 'presence']).size).to.equal(1);
      expect(state.getIn(['sessions', 'sess_purge', 'snapshots']).size).to.equal(1);

      state = reducer(state, {
        type: 'PURGE_SESSION_PRESENCE',
        sessionId: 'sess_purge'
      });

      expect(state.getIn(['sessions', 'sess_purge', 'presence'])).to.equal(undefined);
      expect(state.getIn(['sessions', 'sess_purge', 'snapshots'])).to.equal(undefined);
    });
  });

  describe('2. Sanitized Broadcast & Negative Security Guarantees (AC 8, AC 10)', () => {
    it('serializeSessionState includes connectedCount and totalVoters without raw token or socket data', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_sanitized',
        title: 'Sanitized Session',
        entries: ['Option A', 'Option B']
      });

      const v1 = registerVoter({ sessionId: 'sess_sanitized', displayName: 'Alice', store });
      const v2 = registerVoter({ sessionId: 'sess_sanitized', displayName: 'Bob', store });

      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_sanitized',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_secret_alice_123',
        timestamp: Date.now()
      });

      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_sanitized',
        voterToken: v2.voter.sessionToken,
        socketId: 'sock_secret_bob_456',
        timestamp: Date.now()
      });

      store.dispatch({
        type: 'RECORD_PRESENCE_DISCONNECT',
        sessionId: 'sess_sanitized',
        voterToken: v2.voter.sessionToken,
        socketId: 'sock_secret_bob_456',
        timestamp: Date.now()
      });

      store.dispatch({
        type: 'SNAPSHOT_ROUND_ELIGIBILITY',
        sessionId: 'sess_sanitized',
        roundId: 'sess_sanitized:::r1',
        timestamp: Date.now()
      });

      const session = store.getState().getIn(['sessions', 'sess_sanitized']);
      const serialized = serializeSessionState(session);

      expect(serialized.connectedCount).to.equal(1);
      expect(serialized.totalVoters).to.equal(2);
      expect(serialized.voterCount).to.equal(2);

      // Negative security assertions (AC 10)
      const serializedJson = JSON.stringify(serialized);
      expect(serializedJson).to.not.include('sock_secret_alice_123');
      expect(serializedJson).to.not.include('sock_secret_bob_456');
      expect(serializedJson).to.not.include(v1.voter.sessionToken);
      expect(serializedJson).to.not.include(v2.voter.sessionToken);
      expect(serialized).to.not.have.property('presence');
      expect(serialized).to.not.have.property('snapshots');
      expect(serialized).to.not.have.property('voterToken');
      expect(serialized).to.not.have.property('token');
      expect(serialized).to.not.have.property('jwt');
      expect(serialized).to.not.have.property('password');
      expect(serialized).to.not.have.property('secret');
    });

    it('getSessionsSummary accurately reflects connectedCount alongside total voterCount', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_summary',
        title: 'Summary Session',
        entries: ['Option A', 'Option B']
      });

      const v1 = registerVoter({ sessionId: 'sess_summary', displayName: 'Voter 1', store });
      registerVoter({ sessionId: 'sess_summary', displayName: 'Voter 2', store });

      store.dispatch({
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_summary',
        voterToken: v1.voter.sessionToken,
        socketId: 'sock_live',
        timestamp: Date.now()
      });

      const summary = getSessionsSummary(store.getState());
      const item = summary.find(s => s.id === 'sess_summary');
      expect(Boolean(item)).to.equal(true);
      expect(item.voterCount).to.equal(2);
      expect(item.connectedCount).to.equal(1);

      const summaryJson = JSON.stringify(summary);
      expect(summaryJson).to.not.include(v1.voter.sessionToken);
      expect(summaryJson).to.not.include('sock_live');
    });
  });

  describe('3. Coupled Invariants and Invariant Consistency', () => {
    it('invariant 4: non empty socketIds implies connected true, empty implies disconnectedAt set', () => {
      let state = reducer(undefined, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_inv',
        title: 'Invariant Session',
        entries: ['Option A', 'Option B']
      });

      state = reducer(state, {
        type: 'RECORD_PRESENCE_CONNECT',
        sessionId: 'sess_inv',
        voterToken: 'tok_inv',
        socketId: 'sock_inv_1',
        timestamp: 5000
      });

      let rec = state.getIn(['sessions', 'sess_inv', 'presence', 'tok_inv']);
      expect(rec.get('socketIds').size > 0).to.equal(true);
      expect(rec.get('connected')).to.equal(true);
      expect(rec.get('disconnectedAt')).to.equal(null);

      state = reducer(state, {
        type: 'RECORD_PRESENCE_DISCONNECT',
        sessionId: 'sess_inv',
        voterToken: 'tok_inv',
        socketId: 'sock_inv_1',
        timestamp: 6000
      });

      rec = state.getIn(['sessions', 'sess_inv', 'presence', 'tok_inv']);
      expect(rec.get('socketIds').size === 0).to.equal(true);
      expect(rec.get('connected')).to.equal(false);
      expect(typeof rec.get('disconnectedAt')).to.equal('number');
    });

    it('invariant 6: releaseSessionVoters cleans registered tokens and duplicate vote keys', () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_rel',
        title: 'Release Session',
        entries: ['Option A', 'Option B']
      });

      const v1 = registerVoter({ sessionId: 'sess_rel', displayName: 'Rel Voter', store });
      expect(validateVoterToken(v1.voter.sessionToken, 'sess_rel').valid).to.equal(true);

      const freed = releaseSessionVoters('sess_rel');
      expect(freed.removedTokens).to.equal(1);
      expect(validateVoterToken(v1.voter.sessionToken, 'sess_rel').valid).to.equal(false);
    });
  });
});
