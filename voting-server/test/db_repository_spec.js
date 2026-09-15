import { expect } from 'chai';
import * as repository from '../src/db/repository.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';

describe('MongoDB Repository Layer', () => {
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

  describe('Session Repository Operations', () => {
    it('saveSession creates a new session in MongoDB', async () => {
      const session = await repository.saveSession({
        sessionId: 'sess_repo_1',
        title: 'Movie Night',
        entries: ['Inception', 'Interstellar'],
        status: 'pending'
      });

      expect(session).to.exist;
      expect(session.sessionId).to.equal('sess_repo_1');
      expect(session.title).to.equal('Movie Night');
      expect(session.entries).to.deep.equal(['Inception', 'Interstellar']);
      expect(session.status).to.equal('pending');
    });

    it('saveSession is idempotent and updates existing session on duplicate sessionId', async () => {
      await repository.saveSession({
        sessionId: 'sess_repo_dup',
        title: 'Initial Title',
        entries: ['A', 'B'],
        status: 'pending'
      });

      const updated = await repository.saveSession({
        sessionId: 'sess_repo_dup',
        title: 'Updated Title',
        entries: ['A', 'B', 'C']
      });

      expect(updated.title).to.equal('Updated Title');
      expect(updated.entries).to.deep.equal(['A', 'B', 'C']);

      const all = await repository.getAllSessions();
      expect(all).to.have.lengthOf(1);
    });

    it('updateSessionStatus transitions session through lifecycle', async () => {
      await repository.saveSession({
        sessionId: 'sess_status_test',
        title: 'Tournament',
        entries: ['A', 'B'],
        status: 'pending'
      });

      // Transition to open
      const openSession = await repository.markSessionOpen('sess_status_test');
      expect(openSession.status).to.equal('open');

      // Transition to completed with winner
      const completedSession = await repository.markSessionCompleted('sess_status_test', 'A');
      expect(completedSession.status).to.equal('completed');
      expect(completedSession.winner).to.equal('A');
      expect(completedSession.completedAt).to.be.an.instanceOf(Date);

      // Transition to archived
      const archivedSession = await repository.markSessionArchived('sess_status_test');
      expect(archivedSession.status).to.equal('archived');
      expect(archivedSession.archivedAt).to.be.an.instanceOf(Date);
    });

    it('getActiveSessions returns only non-archived sessions', async () => {
      await repository.saveSession({ sessionId: 'sess_active_1', entries: ['A'], status: 'pending' });
      await repository.saveSession({ sessionId: 'sess_active_2', entries: ['B'], status: 'open' });
      await repository.saveSession({ sessionId: 'sess_archived', entries: ['C'], status: 'archived' });

      const active = await repository.getActiveSessions();
      expect(active).to.have.lengthOf(2);
      const ids = active.map(s => s.sessionId);
      expect(ids).to.include('sess_active_1');
      expect(ids).to.include('sess_active_2');
      expect(ids).to.not.include('sess_archived');
    });

    it('getSessionBySessionId retrieves specific session or returns null', async () => {
      await repository.saveSession({ sessionId: 'sess_find_me', entries: ['X'], title: 'Find Me' });

      const found = await repository.getSessionBySessionId('sess_find_me');
      expect(found).to.exist;
      expect(found.title).to.equal('Find Me');

      const notFound = await repository.getSessionBySessionId('sess_nonexistent');
      expect(notFound).to.be.null;
    });

    it('resetOpenSessionsToPending resets open sessions on recovery', async () => {
      await repository.saveSession({ sessionId: 'sess_open_1', entries: ['A'], status: 'open' });
      await repository.saveSession({ sessionId: 'sess_open_2', entries: ['B'], status: 'open' });
      await repository.saveSession({ sessionId: 'sess_comp', entries: ['C'], status: 'completed' });

      const result = await repository.resetOpenSessionsToPending();
      expect(result.modifiedCount).to.equal(2);

      const s1 = await repository.getSessionBySessionId('sess_open_1');
      const s2 = await repository.getSessionBySessionId('sess_open_2');
      const s3 = await repository.getSessionBySessionId('sess_comp');

      expect(s1.status).to.equal('pending');
      expect(s2.status).to.equal('pending');
      expect(s3.status).to.equal('completed');
    });
  });

  describe('Result Repository Operations', () => {
    it('saveResult creates an immutable result record', async () => {
      const res = await repository.saveResult({
        sessionId: 'sess_res_test',
        title: 'Best Movie',
        entries: ['Inception', 'Memento'],
        winner: 'Memento'
      });

      expect(res.sessionId).to.equal('sess_res_test');
      expect(res.winner).to.equal('Memento');
      expect(res.entries).to.deep.equal(['Inception', 'Memento']);
      expect(res.completedAt).to.be.an.instanceOf(Date);
    });

    it('saveResult throws if required fields are missing', async () => {
      let err = null;
      try {
        await repository.saveResult({ sessionId: 'sess_incomplete' });
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
    });

    it('getCompletedResults returns results ordered by completedAt descending with limit', async () => {
      const now = Date.now();
      await repository.saveResult({
        sessionId: 'res_old',
        entries: ['A', 'B'],
        winner: 'A',
        completedAt: new Date(now - 10000)
      });
      await repository.saveResult({
        sessionId: 'res_mid',
        entries: ['C', 'D'],
        winner: 'C',
        completedAt: new Date(now - 5000)
      });
      await repository.saveResult({
        sessionId: 'res_new',
        entries: ['E', 'F'],
        winner: 'E',
        completedAt: new Date(now)
      });

      const all = await repository.getCompletedResults(10);
      expect(all).to.have.lengthOf(3);
      expect(all[0].sessionId).to.equal('res_new');
      expect(all[1].sessionId).to.equal('res_mid');
      expect(all[2].sessionId).to.equal('res_old');

      const limited = await repository.getCompletedResults(2);
      expect(limited).to.have.lengthOf(2);
      expect(limited[0].sessionId).to.equal('res_new');
      expect(limited[1].sessionId).to.equal('res_mid');
    });

    it('getResultBySessionId returns the latest result for a given session or null', async () => {
      await repository.saveResult({
        sessionId: 'sess_target',
        entries: ['X', 'Y'],
        winner: 'X'
      });

      const found = await repository.getResultBySessionId('sess_target');
      expect(found).to.exist;
      expect(found.sessionId).to.equal('sess_target');
      expect(found.winner).to.equal('X');

      const notFound = await repository.getResultBySessionId('sess_missing');
      expect(notFound).to.be.null;
    });
  });
});
