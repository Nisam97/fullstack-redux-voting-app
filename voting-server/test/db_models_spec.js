import { expect } from 'chai';
import mongoose from 'mongoose';
import Session from '../src/db/models/Session.js';
import Result from '../src/db/models/Result.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';

describe('MongoDB Models', () => {
  before(async function () {
    this.timeout(120000); // Allow time for first-time binary download
    await setupTestDb();
  });

  after(async function () {
    this.timeout(30000);
    await teardownTestDb();
  });

  beforeEach(async function () {
    await clearTestDb();
  });

  describe('Session Model', () => {
    it('creates a session with default values', async () => {
      const session = new Session({
        sessionId: 'sess_test_1',
        entries: ['Entry A', 'Entry B']
      });
      const saved = await session.save();

      expect(saved.sessionId).to.equal('sess_test_1');
      expect(saved.title).to.equal('');
      expect(saved.status).to.equal('pending');
      expect(saved.winner).to.be.null;
      expect(saved.entries).to.deep.equal(['Entry A', 'Entry B']);
      expect(saved.createdAt).to.be.an.instanceOf(Date);
      expect(saved.updatedAt).to.be.an.instanceOf(Date);
      expect(saved.completedAt).to.be.null;
      expect(saved.archivedAt).to.be.null;
    });

    it('requires sessionId', async () => {
      const session = new Session({
        entries: ['Entry A', 'Entry B']
      });

      let err = null;
      try {
        await session.save();
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.errors.sessionId).to.exist;
    });

    it('requires entries', async () => {
      const session = new Session({
        sessionId: 'sess_no_entries'
      });

      let err = null;
      try {
        await session.save();
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.errors.entries).to.exist;
    });

    it('enforces status enum constraints', async () => {
      const session = new Session({
        sessionId: 'sess_bad_status',
        entries: ['A', 'B'],
        status: 'invalid_status'
      });

      let err = null;
      try {
        await session.save();
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.errors.status).to.exist;
    });

    it('allows valid status values: pending, open, completed, archived', async () => {
      for (const st of ['pending', 'open', 'completed', 'archived']) {
        const session = new Session({
          sessionId: `sess_status_${st}`,
          entries: ['A', 'B'],
          status: st
        });
        const saved = await session.save();
        expect(saved.status).to.equal(st);
      }
    });

    it('enforces unique sessionId index', async () => {
      await Session.init(); // Ensure indexes are built
      const session1 = new Session({
        sessionId: 'sess_duplicate',
        entries: ['A', 'B']
      });
      await session1.save();

      const session2 = new Session({
        sessionId: 'sess_duplicate',
        entries: ['C', 'D']
      });

      let err = null;
      try {
        await session2.save();
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.code).to.equal(11000);
    });
  });

  describe('Result Model', () => {
    it('creates an immutable completed result document', async () => {
      const result = new Result({
        sessionId: 'sess_res_1',
        title: 'Championship',
        entries: ['Team A', 'Team B', 'Team C'],
        winner: 'Team A'
      });
      const saved = await result.save();

      expect(saved.sessionId).to.equal('sess_res_1');
      expect(saved.title).to.equal('Championship');
      expect(saved.entries).to.deep.equal(['Team A', 'Team B', 'Team C']);
      expect(saved.winner).to.equal('Team A');
      expect(saved.completedAt).to.be.an.instanceOf(Date);
    });

    it('requires sessionId, entries, and winner', async () => {
      const result = new Result({});

      let err = null;
      try {
        await result.save();
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.errors.sessionId).to.exist;
      expect(err.errors.entries).to.exist;
      expect(err.errors.winner).to.exist;
    });

    it('defaults title to empty string if omitted', async () => {
      const result = new Result({
        sessionId: 'sess_res_notitle',
        entries: ['A', 'B'],
        winner: 'B'
      });
      const saved = await result.save();
      expect(saved.title).to.equal('');
    });
  });
});
