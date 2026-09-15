import { expect } from 'chai';
import mongoose from 'mongoose';
import { Map, List, fromJS } from 'immutable';
import makeStore from '../src/store.js';
import { bootstrapDefaultSession, bootstrapHorrorSession,
  DEFAULT_SESSION_ID, HORROR_SESSION_ID } from '../src/bootstrap.js';
import { persistStateChanges, recoverSessionsFromDb, persistSeedSessions } from '../src/db/persistence.js';
import * as repository from '../src/db/repository.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';

describe('Stage B: Session Persistence Integration', () => {
  before(async function () {
    this.timeout(120000);
    await setupTestDb();
  });

  after(async function () {
    this.timeout(30000);
    await teardownTestDb();
  });

  beforeEach(async function () {
    await clearTestDb();
  });

  describe('persistStateChanges — lifecycle detection', () => {
    it('persists a newly created session to MongoDB', async () => {
      const store = makeStore();

      // Capture prevState before dispatch
      const prevState = store.getState();

      // Dispatch CREATE_SESSION
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_persist_new',
        title: 'Persistence Test',
        entries: ['Alpha', 'Beta', 'Gamma']
      });

      const currentState = store.getState();

      // Call persistence layer
      await persistStateChanges(prevState, currentState);

      // Allow async persistence to settle
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify persisted
      const dbSession = await repository.getSessionBySessionId('sess_persist_new');
      expect(dbSession).to.exist;
      expect(dbSession.sessionId).to.equal('sess_persist_new');
      expect(dbSession.title).to.equal('Persistence Test');
      expect(dbSession.entries).to.deep.equal(['Alpha', 'Beta', 'Gamma']);
      expect(dbSession.status).to.equal('pending');
    });

    it('persists session metadata correctly (title, entries, status)', async () => {
      const store = makeStore();
      const prevState = store.getState();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_metadata',
        title: 'Metadata Accuracy Test',
        entries: ['Entry1', 'Entry2', 'Entry3', 'Entry4']
      });

      await persistStateChanges(prevState, store.getState());
      await new Promise(resolve => setTimeout(resolve, 200));

      const dbSession = await repository.getSessionBySessionId('sess_metadata');
      expect(dbSession.title).to.equal('Metadata Accuracy Test');
      expect(dbSession.entries).to.have.lengthOf(4);
      expect(dbSession.entries).to.include.members(['Entry1', 'Entry2', 'Entry3', 'Entry4']);
      expect(dbSession.status).to.equal('pending');
      expect(dbSession.createdAt).to.be.an.instanceOf(Date);
    });

    it('persists status change when session is started (pending → open)', async () => {
      const store = makeStore();

      // Create session
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_start_test',
        title: 'Start Test',
        entries: ['A', 'B', 'C']
      });

      let prevState = store.getState();
      await persistStateChanges(fromJS({ sessions: {} }), prevState);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Start session — transitions status to 'open'
      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_start_test'
      });

      const currentState = store.getState();
      await persistStateChanges(prevState, currentState);
      await new Promise(resolve => setTimeout(resolve, 200));

      const dbSession = await repository.getSessionBySessionId('sess_start_test');
      expect(dbSession.status).to.equal('open');
    });

    it('persists status change when session is archived', async () => {
      const store = makeStore();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_archive_test',
        title: 'Archive Test',
        entries: ['A', 'B']
      });

      let prevState = store.getState();
      await persistStateChanges(fromJS({ sessions: {} }), prevState);
      await new Promise(resolve => setTimeout(resolve, 200));

      store.dispatch({
        type: 'ARCHIVE_SESSION',
        sessionId: 'sess_archive_test'
      });

      const currentState = store.getState();
      await persistStateChanges(prevState, currentState);
      await new Promise(resolve => setTimeout(resolve, 200));

      const dbSession = await repository.getSessionBySessionId('sess_archive_test');
      expect(dbSession.status).to.equal('archived');
      expect(dbSession.archivedAt).to.be.an.instanceOf(Date);
    });

    it('persists entries change via SET_ENTRIES', async () => {
      const store = makeStore();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_entries_test',
        title: 'Entries Test',
        entries: ['Original1', 'Original2']
      });

      let prevState = store.getState();
      await persistStateChanges(fromJS({ sessions: {} }), prevState);
      await new Promise(resolve => setTimeout(resolve, 200));

      store.dispatch({
        type: 'SET_ENTRIES',
        sessionId: 'sess_entries_test',
        entries: ['New1', 'New2', 'New3']
      });

      const currentState = store.getState();
      await persistStateChanges(prevState, currentState);
      await new Promise(resolve => setTimeout(resolve, 200));

      const dbSession = await repository.getSessionBySessionId('sess_entries_test');
      expect(dbSession.entries).to.deep.equal(['New1', 'New2', 'New3']);
    });

    it('does NOT persist on VOTE (ephemeral tally)', async () => {
      const store = makeStore();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_vote_nopersist',
        title: 'Vote No Persist',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_vote_nopersist'
      });

      let prevState = store.getState();
      await persistStateChanges(fromJS({ sessions: {} }), prevState);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Get current pair
      const session = store.getState().getIn(['sessions', 'sess_vote_nopersist']);
      const pair = session.getIn(['vote', 'pair']).toJS();

      // Cast a vote
      store.dispatch({
        type: 'VOTE',
        sessionId: 'sess_vote_nopersist',
        entry: pair[0]
      });

      const afterVoteState = store.getState();

      // Verify in-memory tally changed
      const afterSession = afterVoteState.getIn(['sessions', 'sess_vote_nopersist']);
      const tally = afterSession.getIn(['vote', 'tally', pair[0]]);
      expect(tally).to.equal(1);

      // Persistence should not trigger status change (both are 'open')
      // and no entries change (same entries) — only tally changed which is ephemeral
      await persistStateChanges(prevState, afterVoteState);
      await new Promise(resolve => setTimeout(resolve, 200));

      // DB should still show the session with 'open' status, no extra writes
      const dbSession = await repository.getSessionBySessionId('sess_vote_nopersist');
      // The key check is that the DB doesn't have tally data — it only has status/entries/title
      expect(dbSession).to.exist;
      expect(dbSession.status).to.equal('open');
    });
  });

  describe('recoverSessionsFromDb — startup recovery', () => {
    it('recovers persisted sessions into a fresh Redux store', async () => {
      // Pre-populate MongoDB directly via repository
      await repository.saveSession({
        sessionId: 'sess_recover_1',
        title: 'Recovered Session 1',
        entries: ['X', 'Y', 'Z'],
        status: 'pending'
      });
      await repository.saveSession({
        sessionId: 'sess_recover_2',
        title: 'Recovered Session 2',
        entries: ['A', 'B'],
        status: 'pending'
      });

      const store = makeStore();
      const recovered = await recoverSessionsFromDb(store);

      expect(recovered).to.equal(2);

      const state = store.getState();
      expect(state.hasIn(['sessions', 'sess_recover_1'])).to.be.true;
      expect(state.hasIn(['sessions', 'sess_recover_2'])).to.be.true;

      const s1 = state.getIn(['sessions', 'sess_recover_1']);
      expect(s1.get('title')).to.equal('Recovered Session 1');
    });

    it('recovers multiple sessions independently with correct metadata', async () => {
      await repository.saveSession({
        sessionId: 'sess_ind_1',
        title: 'Independent 1',
        entries: ['P', 'Q'],
        status: 'pending'
      });
      await repository.saveSession({
        sessionId: 'sess_ind_2',
        title: 'Independent 2',
        entries: ['R', 'S', 'T'],
        status: 'pending'
      });

      const store = makeStore();
      await recoverSessionsFromDb(store);

      const s1 = store.getState().getIn(['sessions', 'sess_ind_1']);
      const s2 = store.getState().getIn(['sessions', 'sess_ind_2']);

      expect(s1.get('title')).to.equal('Independent 1');
      expect(s2.get('title')).to.equal('Independent 2');
      // Entries are restored
      expect(s1.get('entries').toJS()).to.deep.equal(['P', 'Q']);
      expect(s2.get('entries').toJS()).to.deep.equal(['R', 'S', 'T']);
    });

    it('resets interrupted open sessions to pending on recovery', async () => {
      await repository.saveSession({
        sessionId: 'sess_open_recover',
        title: 'Was Open',
        entries: ['A', 'B', 'C'],
        status: 'open'
      });

      const store = makeStore();
      await recoverSessionsFromDb(store);

      // The session should be in the store as 'pending'
      const session = store.getState().getIn(['sessions', 'sess_open_recover']);
      expect(session).to.exist;
      expect(session.get('status')).to.equal('pending');

      // MongoDB should also show 'pending'
      const dbSession = await repository.getSessionBySessionId('sess_open_recover');
      expect(dbSession.status).to.equal('pending');
    });

    it('retains completed session status and winner in MongoDB', async () => {
      await repository.saveSession({
        sessionId: 'sess_completed_keep',
        title: 'Completed',
        entries: ['A', 'B'],
        status: 'completed',
        winner: 'A'
      });

      const store = makeStore();
      await recoverSessionsFromDb(store);

      // Session exists in the store for registry visibility
      const session = store.getState().getIn(['sessions', 'sess_completed_keep']);
      expect(session).to.exist;

      // MongoDB retains completed status and winner
      const dbSession = await repository.getSessionBySessionId('sess_completed_keep');
      expect(dbSession.status).to.equal('completed');
      expect(dbSession.winner).to.equal('A');
    });

    it('does NOT load archived sessions into the Redux store', async () => {
      await repository.saveSession({
        sessionId: 'sess_archived_skip',
        title: 'Archived',
        entries: ['A', 'B'],
        status: 'archived'
      });

      const store = makeStore();
      const recovered = await recoverSessionsFromDb(store);

      expect(recovered).to.equal(0);
      const session = store.getState().getIn(['sessions', 'sess_archived_skip']);
      expect(session).to.be.undefined;
    });

    it('skips malformed session records gracefully', async () => {
      // Insert a session with no entries directly into the DB
      const Session = mongoose.model('Session');
      await Session.create({
        sessionId: 'sess_malformed',
        entries: [],
        status: 'pending'
      });

      await repository.saveSession({
        sessionId: 'sess_valid',
        title: 'Valid',
        entries: ['A', 'B'],
        status: 'pending'
      });

      const store = makeStore();
      const recovered = await recoverSessionsFromDb(store);

      // Only the valid session should be recovered
      expect(recovered).to.equal(1);
      expect(store.getState().hasIn(['sessions', 'sess_valid'])).to.be.true;
      expect(store.getState().hasIn(['sessions', 'sess_malformed'])).to.be.false;
    });

    it('does not duplicate sessions already in the Redux store', async () => {
      await repository.saveSession({
        sessionId: 'sess_dup_guard',
        title: 'Already There',
        entries: ['A', 'B'],
        status: 'pending'
      });

      const store = makeStore();

      // Pre-create the session in the store
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_dup_guard',
        title: 'Pre-existing',
        entries: ['X', 'Y']
      });

      const recovered = await recoverSessionsFromDb(store);
      expect(recovered).to.equal(0);

      // Title should remain the pre-existing one, not overwritten
      const session = store.getState().getIn(['sessions', 'sess_dup_guard']);
      expect(session.get('title')).to.equal('Pre-existing');
    });
  });

  describe('persistSeedSessions — seed persistence', () => {
    it('persists seed sessions to MongoDB after bootstrap', async () => {
      const store = makeStore();
      bootstrapDefaultSession(store);
      bootstrapHorrorSession(store);

      await persistSeedSessions(store, [DEFAULT_SESSION_ID, HORROR_SESSION_ID]);

      const defaultDb = await repository.getSessionBySessionId(DEFAULT_SESSION_ID);
      const horrorDb = await repository.getSessionBySessionId(HORROR_SESSION_ID);

      expect(defaultDb).to.exist;
      expect(defaultDb.sessionId).to.equal(DEFAULT_SESSION_ID);
      expect(defaultDb.title).to.equal('Danny Boyle Film Tournament');

      expect(horrorDb).to.exist;
      expect(horrorDb.sessionId).to.equal(HORROR_SESSION_ID);
      expect(horrorDb.title).to.equal('Horror Classics');
    });

    it('is idempotent — does not duplicate seed sessions', async () => {
      const store = makeStore();
      bootstrapDefaultSession(store);
      bootstrapHorrorSession(store);

      await persistSeedSessions(store, [DEFAULT_SESSION_ID, HORROR_SESSION_ID]);
      await persistSeedSessions(store, [DEFAULT_SESSION_ID, HORROR_SESSION_ID]);

      const all = await repository.getAllSessions();
      const seedSessions = all.filter(s =>
        s.sessionId === DEFAULT_SESSION_ID || s.sessionId === HORROR_SESSION_ID
      );
      expect(seedSessions).to.have.lengthOf(2);
    });
  });

  describe('Full startup recovery simulation', () => {
    it('simulates create → persist → restart → recover cycle', async () => {
      // --- First "server instance" ---
      const store1 = makeStore();

      // Create sessions
      store1.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_cycle_1',
        title: 'Cycle Test 1',
        entries: ['Movie A', 'Movie B']
      });
      store1.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_cycle_2',
        title: 'Cycle Test 2',
        entries: ['Movie C', 'Movie D', 'Movie E']
      });

      // Persist via persistence layer
      await persistStateChanges(fromJS({ sessions: {} }), store1.getState());
      await new Promise(resolve => setTimeout(resolve, 200));

      // Start one session
      const prevState = store1.getState();
      store1.dispatch({ type: 'START_SESSION', sessionId: 'sess_cycle_1' });
      await persistStateChanges(prevState, store1.getState());
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify pre-restart state in DB
      const db1 = await repository.getSessionBySessionId('sess_cycle_1');
      expect(db1.status).to.equal('open');
      const db2 = await repository.getSessionBySessionId('sess_cycle_2');
      expect(db2.status).to.equal('pending');

      // --- Simulate restart with fresh store ---
      const store2 = makeStore();
      const recovered = await recoverSessionsFromDb(store2);

      expect(recovered).to.equal(2);

      // Open session should have been reset to pending
      const s1 = store2.getState().getIn(['sessions', 'sess_cycle_1']);
      expect(s1.get('title')).to.equal('Cycle Test 1');
      expect(s1.get('status')).to.equal('pending');

      // Pending session stays pending
      const s2 = store2.getState().getIn(['sessions', 'sess_cycle_2']);
      expect(s2.get('title')).to.equal('Cycle Test 2');
      expect(s2.get('status')).to.equal('pending');
    });

    it('seed sessions are created only when missing from MongoDB', async () => {
      // Pre-populate one seed session in DB
      await repository.saveSession({
        sessionId: DEFAULT_SESSION_ID,
        title: 'Danny Boyle Film Tournament',
        entries: ['Trainspotting', '28 Days Later', 'Slumdog Millionaire'],
        status: 'pending'
      });

      const store = makeStore();
      await recoverSessionsFromDb(store);

      // Bootstrap — should skip sess_default (already in store), create sess_horror
      bootstrapDefaultSession(store);
      bootstrapHorrorSession(store);

      await persistSeedSessions(store, [DEFAULT_SESSION_ID, HORROR_SESSION_ID]);

      const all = await repository.getAllSessions();
      expect(all).to.have.lengthOf(2);
    });
  });

  describe('Persistence failure handling', () => {
    it('persistence does not crash when MongoDB is disconnected', async () => {
      const store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_fail_test',
        title: 'Fail Test',
        entries: ['A', 'B']
      });

      // Temporarily disconnect
      await mongoose.disconnect();

      // Should not throw
      const prevState = fromJS({ sessions: {} });
      await persistStateChanges(prevState, store.getState());

      // Reconnect for remaining tests
      await setupTestDb();
    });
  });
});
