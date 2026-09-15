import { expect } from 'chai';
import http from 'http';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import * as repository from '../src/db/repository.js';
import { persistCompletedResult } from '../src/db/persistence.js';
import Result from '../src/db/models/Result.js';
import Session from '../src/db/models/Session.js';
import { disconnectMongo, connectMongo } from '../src/db/connection.js';

function requestHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body;
        try {
          body = JSON.parse(data);
        } catch {
          body = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

describe('Stage C: Results Persistence & History API', function () {
  this.timeout(15000);

  let mongoUri;
  let server;
  let port;
  let store;

  before(async () => {
    mongoUri = await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    if (!mongoUri) {
      mongoUri = await setupTestDb();
    } else {
      await clearTestDb();
    }
    store = makeStore();
    server = startServer(store, 0);
    port = server.httpServer.address().port;
  });

  afterEach((done) => {
    if (server && server.httpServer) {
      server.close(() => done());
    } else {
      done();
    }
  });

  describe('1. Result Persistence on Tournament Completion', () => {
    it('persists completed session result when winner is determined via NEXT action', async () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_tourney_1',
        title: 'Sci-Fi Film Showdown',
        entries: ['Solaris', 'Stalker']
      });

      // Wait briefly for create persistence
      await new Promise(r => setTimeout(r, 80));

      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_tourney_1'
      });

      store.dispatch({
        type: 'VOTE',
        sessionId: 'sess_tourney_1',
        entry: 'Stalker'
      });

      // Advance tournament -> winner is Stalker
      store.dispatch({
        type: 'NEXT',
        sessionId: 'sess_tourney_1'
      });

      // Verify Redux state
      const state = store.getState();
      const session = state.getIn(['sessions', 'sess_tourney_1']);
      expect(session.get('status')).to.equal('completed');
      expect(session.get('winner')).to.equal('Stalker');

      // Wait for async persistence
      await new Promise(r => setTimeout(r, 150));

      // Verify Session document in MongoDB
      const sessionDoc = await repository.getSessionBySessionId('sess_tourney_1');
      expect(sessionDoc).to.be.ok;
      expect(sessionDoc.status).to.equal('completed');
      expect(sessionDoc.winner).to.equal('Stalker');
      expect(sessionDoc.completedAt).to.be.an.instanceOf(Date);

      // Verify Result document in MongoDB
      const resultDoc = await repository.getResultBySessionId('sess_tourney_1');
      expect(resultDoc).to.be.ok;
      expect(resultDoc.sessionId).to.equal('sess_tourney_1');
      expect(resultDoc.title).to.equal('Sci-Fi Film Showdown');
      expect(resultDoc.winner).to.equal('Stalker');
      expect(resultDoc.entries).to.deep.equal(['Solaris', 'Stalker']);
      expect(resultDoc.completedAt).to.be.an.instanceOf(Date);
    });

    it('preserves initial full entries list from MongoDB Session document even though core.next clears entries', async () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_tourney_entries',
        title: 'Trilogy Battle',
        entries: ['Part 1', 'Part 2', 'Part 3']
      });

      await new Promise(r => setTimeout(r, 80));

      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_tourney_entries'
      });

      // Round 1
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_entries', entry: 'Part 1' });
      store.dispatch({ type: 'NEXT', sessionId: 'sess_tourney_entries' });

      // Round 2 (Final)
      store.dispatch({ type: 'VOTE', sessionId: 'sess_tourney_entries', entry: 'Part 1' });
      store.dispatch({ type: 'NEXT', sessionId: 'sess_tourney_entries' });

      await new Promise(r => setTimeout(r, 150));

      const result = await repository.getResultBySessionId('sess_tourney_entries');
      expect(result).to.be.ok;
      expect(result.winner).to.equal('Part 1');
      expect(result.entries).to.deep.equal(['Part 1', 'Part 2', 'Part 3']);
    });
  });

  describe('2. Idempotency & Duplicate Prevention', () => {
    it('repeated completion actions do NOT create duplicate Result records', async () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_idempotent_1',
        title: 'Single Match',
        entries: ['A', 'B']
      });

      await new Promise(r => setTimeout(r, 80));

      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_idempotent_1' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_idempotent_1', entry: 'A' });
      store.dispatch({ type: 'NEXT', sessionId: 'sess_idempotent_1' });

      await new Promise(r => setTimeout(r, 150));

      // Attempt repeated NEXT dispatch
      store.dispatch({ type: 'NEXT', sessionId: 'sess_idempotent_1' });
      await new Promise(r => setTimeout(r, 80));

      // Direct call to persistCompletedResult
      const sessionMap = store.getState().getIn(['sessions', 'sess_idempotent_1']);
      await persistCompletedResult('sess_idempotent_1', sessionMap);

      const count = await Result.countDocuments({ sessionId: 'sess_idempotent_1' });
      expect(count).to.equal(1);
    });

    it('repository.saveResult is idempotent and returns existing result without duplicating', async () => {
      const first = await repository.saveResult({
        sessionId: 'sess_repo_idemp',
        title: 'Test',
        entries: ['X', 'Y'],
        winner: 'X'
      });

      const second = await repository.saveResult({
        sessionId: 'sess_repo_idemp',
        title: 'Test Duplicate',
        entries: ['X', 'Y'],
        winner: 'X'
      });

      expect(first._id.toString()).to.equal(second._id.toString());
      const count = await Result.countDocuments({ sessionId: 'sess_repo_idemp' });
      expect(count).to.equal(1);
    });
  });

  describe('3. Multi-Session Result Isolation', () => {
    it('distinct sessions maintain strictly isolated result records', async () => {
      // Session Alpha
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_alpha',
        title: 'Alpha Tournament',
        entries: ['Alpha 1', 'Alpha 2']
      });

      // Session Beta
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_beta',
        title: 'Beta Tournament',
        entries: ['Beta 1', 'Beta 2']
      });

      await new Promise(r => setTimeout(r, 80));

      // Complete Alpha with Alpha 1 winning
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_alpha' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_alpha', entry: 'Alpha 1' });
      store.dispatch({ type: 'NEXT', sessionId: 'sess_alpha' });

      // Complete Beta with Beta 2 winning
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_beta' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_beta', entry: 'Beta 2' });
      store.dispatch({ type: 'NEXT', sessionId: 'sess_beta' });

      await new Promise(r => setTimeout(r, 150));

      const resAlpha = await repository.getResultBySessionId('sess_alpha');
      const resBeta = await repository.getResultBySessionId('sess_beta');

      expect(resAlpha).to.be.ok;
      expect(resAlpha.sessionId).to.equal('sess_alpha');
      expect(resAlpha.winner).to.equal('Alpha 1');
      expect(resAlpha.entries).to.deep.equal(['Alpha 1', 'Alpha 2']);

      expect(resBeta).to.be.ok;
      expect(resBeta.sessionId).to.equal('sess_beta');
      expect(resBeta.winner).to.equal('Beta 2');
      expect(resBeta.entries).to.deep.equal(['Beta 1', 'Beta 2']);
    });
  });

  describe('4. GET /api/sessions/history Endpoint', () => {
    it('returns empty results array when no completed sessions exist', async () => {
      const response = await requestHttp(`http://localhost:${port}/api/sessions/history`);
      expect(response.statusCode).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.results).to.be.an('array').that.is.empty;
      expect(response.body.count).to.equal(0);
    });

    it('returns completed results ordered by completedAt descending', async () => {
      const now = Date.now();
      await repository.saveResult({
        sessionId: 'sess_hist_1',
        title: 'First Comp',
        entries: ['A', 'B'],
        winner: 'A',
        completedAt: new Date(now - 2000)
      });
      await repository.saveResult({
        sessionId: 'sess_hist_2',
        title: 'Second Comp',
        entries: ['C', 'D'],
        winner: 'D',
        completedAt: new Date(now - 1000)
      });

      const response = await requestHttp(`http://localhost:${port}/api/sessions/history`);
      expect(response.statusCode).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.count).to.equal(2);
      expect(response.body.results).to.have.lengthOf(2);

      // Most recent first
      expect(response.body.results[0].sessionId).to.equal('sess_hist_2');
      expect(response.body.results[0].winner).to.equal('D');
      expect(response.body.results[1].sessionId).to.equal('sess_hist_1');
      expect(response.body.results[1].winner).to.equal('A');
    });

    it('respects limit query parameter', async () => {
      for (let i = 1; i <= 5; i++) {
        await repository.saveResult({
          sessionId: `sess_lim_${i}`,
          title: `Limit Test ${i}`,
          entries: ['1', '2'],
          winner: '1',
          completedAt: new Date(Date.now() + i * 100)
        });
      }

      const response = await requestHttp(`http://localhost:${port}/api/sessions/history?limit=2`);
      expect(response.statusCode).to.equal(200);
      expect(response.body.count).to.equal(2);
      expect(response.body.results).to.have.lengthOf(2);
    });

    it('excludes pending or open sessions that have no completed results', async () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_incomplete_pending',
        title: 'Pending Tourney',
        entries: ['X', 'Y']
      });

      await new Promise(r => setTimeout(r, 80));

      const response = await requestHttp(`http://localhost:${port}/api/sessions/history`);
      expect(response.statusCode).to.equal(200);
      expect(response.body.count).to.equal(0);
      expect(response.body.results).to.be.empty;
    });
  });

  describe('5. GET /api/sessions/:sessionId/result Endpoint', () => {
    it('returns result for a completed session', async () => {
      await repository.saveResult({
        sessionId: 'sess_specific_get',
        title: 'Specific Championship',
        entries: ['Gladiator', 'Spartacus'],
        winner: 'Gladiator'
      });

      const response = await requestHttp(`http://localhost:${port}/api/sessions/sess_specific_get/result`);
      expect(response.statusCode).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.result).to.be.ok;
      expect(response.body.result.sessionId).to.equal('sess_specific_get');
      expect(response.body.result.title).to.equal('Specific Championship');
      expect(response.body.result.winner).to.equal('Gladiator');
      expect(response.body.result.entries).to.deep.equal(['Gladiator', 'Spartacus']);
      expect(response.body.result.completedAt).to.be.ok;
    });

    it('returns 404 for a non-existent session ID', async () => {
      const response = await requestHttp(`http://localhost:${port}/api/sessions/sess_ghost_id/result`);
      expect(response.statusCode).to.equal(404);
      expect(response.body.success).to.be.false;
      expect(response.body.error).to.equal('RESULT_NOT_FOUND');
    });

    it('returns 404 for an existing session that is not yet completed', async () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_ongoing',
        title: 'Ongoing Match',
        entries: ['P', 'Q']
      });

      await new Promise(r => setTimeout(r, 80));

      const response = await requestHttp(`http://localhost:${port}/api/sessions/sess_ongoing/result`);
      expect(response.statusCode).to.equal(404);
      expect(response.body.success).to.be.false;
      expect(response.body.error).to.equal('RESULT_NOT_FOUND');
    });

    it('supports GET /api/sessions/:sessionId/history as route alias', async () => {
      await repository.saveResult({
        sessionId: 'sess_alias_test',
        title: 'Alias Test',
        entries: ['M', 'N'],
        winner: 'M'
      });

      const response = await requestHttp(`http://localhost:${port}/api/sessions/sess_alias_test/history`);
      expect(response.statusCode).to.equal(200);
      expect(response.body.success).to.be.true;
      expect(response.body.result.winner).to.equal('M');
    });
  });

  describe('6. Security & Clean Response Contract', () => {
    it('history endpoints are publicly readable without requiring JWT authentication', async () => {
      // Request with no Authorization header
      const res1 = await requestHttp(`http://localhost:${port}/api/sessions/history`);
      expect(res1.statusCode).to.equal(200);
    });

    it('history responses never expose MongoDB internal fields (_id, __v), tokens, or secrets', async () => {
      await repository.saveResult({
        sessionId: 'sess_contract_check',
        title: 'Clean Contract',
        entries: ['Red', 'Blue'],
        winner: 'Blue'
      });

      const response = await requestHttp(`http://localhost:${port}/api/sessions/sess_contract_check/result`);
      expect(response.statusCode).to.equal(200);
      const resObj = response.body.result;

      expect(resObj).to.not.have.property('_id');
      expect(resObj).to.not.have.property('__v');
      expect(resObj).to.not.have.property('password');
      expect(resObj).to.not.have.property('jwtSecret');
      expect(resObj).to.not.have.property('voterTokens');
      expect(resObj).to.not.have.property('socket');

      // Verify exact shape
      expect(Object.keys(resObj).sort()).to.deep.equal([
        'completedAt',
        'entries',
        'sessionId',
        'title',
        'winner'
      ]);
    });
  });

  describe('7. Error Handling & Database Failures', () => {
    it('GET /api/sessions/history returns 500 DATABASE_ERROR when MongoDB is disconnected', async () => {
      await disconnectMongo();

      const response = await requestHttp(`http://localhost:${port}/api/sessions/history`);
      expect(response.statusCode).to.equal(500);
      expect(response.body.success).to.be.false;
      expect(response.body.error).to.equal('DATABASE_ERROR');

      // Reconnect for subsequent tests
      await connectMongo(mongoUri);
    });

    it('GET /api/sessions/:sessionId/result returns 500 DATABASE_ERROR when MongoDB is disconnected', async () => {
      await disconnectMongo();

      const response = await requestHttp(`http://localhost:${port}/api/sessions/sess_any/result`);
      expect(response.statusCode).to.equal(500);
      expect(response.body.success).to.be.false;
      expect(response.body.error).to.equal('DATABASE_ERROR');

      await connectMongo(mongoUri);
    });

    it('tournament completion does not crash server when MongoDB is disconnected', async () => {
      await disconnectMongo();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_offline_tourney',
        title: 'Offline Match',
        entries: ['A', 'B']
      });
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_offline_tourney' });
      store.dispatch({ type: 'VOTE', sessionId: 'sess_offline_tourney', entry: 'A' });

      // Should complete in Redux without crashing server
      expect(() => {
        store.dispatch({ type: 'NEXT', sessionId: 'sess_offline_tourney' });
      }).to.not.throw();

      const session = store.getState().getIn(['sessions', 'sess_offline_tourney']);
      expect(session.get('status')).to.equal('completed');
      expect(session.get('winner')).to.equal('A');

      await connectMongo(mongoUri);
    });
  });
});
