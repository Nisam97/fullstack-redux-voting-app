import { expect } from 'chai';
import { fromJS, List } from 'immutable';
import http from 'http';
import reducer from '../src/reducer.js';
import { deriveRoundSnapshot } from '../src/roundManager.js';
import { serializeSessionState } from '../src/server.js';
import * as repository from '../src/db/repository.js';
import { persistCompletedResult, recoverSessionsFromDb } from '../src/db/persistence.js';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import makeStore from '../src/store.js';
import startServer from '../src/server.js';
import Result from '../src/db/models/Result.js';

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

describe('Round History and Full Results Backend Specs', function () {
  this.timeout(15000);

  describe('Reducer: APPEND_ROUND_RESULT', () => {
    it('appends a round snapshot to session rounds list', () => {
      const initialState = fromJS({
        sessions: {
          s1: {
            id: 's1',
            status: 'open',
            rounds: []
          }
        }
      });

      const roundSnapshot = {
        roundIndex: 0,
        kind: 'PAIRWISE',
        candidates: ['Alpha', 'Beta'],
        tally: { Alpha: 3, Beta: 1 },
        totalVotes: 4,
        closedAt: new Date().toISOString(),
        resolution: 'WINNER',
        advanced: ['Alpha']
      };

      const nextState = reducer(initialState, {
        type: 'APPEND_ROUND_RESULT',
        sessionId: 's1',
        roundSnapshot
      });

      const rounds = nextState.getIn(['sessions', 's1', 'rounds']);
      expect(rounds.size).to.equal(1);
      expect(rounds.get(0).get('roundIndex')).to.equal(0);
      expect(rounds.get(0).get('resolution')).to.equal('WINNER');
    });

    it('is idempotent and does not append duplicate roundIndex', () => {
      const initialState = fromJS({
        sessions: {
          s1: {
            id: 's1',
            status: 'open',
            rounds: [
              {
                roundIndex: 0,
                candidates: ['Alpha', 'Beta'],
                resolution: 'WINNER'
              }
            ]
          }
        }
      });

      const duplicateSnapshot = {
        roundIndex: 0,
        candidates: ['Alpha', 'Beta'],
        resolution: 'WINNER'
      };

      const nextState = reducer(initialState, {
        type: 'APPEND_ROUND_RESULT',
        sessionId: 's1',
        roundSnapshot: duplicateSnapshot
      });

      const rounds = nextState.getIn(['sessions', 's1', 'rounds']);
      expect(rounds.size).to.equal(1);
    });

    it('returns state unchanged if session does not exist', () => {
      const initialState = fromJS({
        sessions: {}
      });

      const nextState = reducer(initialState, {
        type: 'APPEND_ROUND_RESULT',
        sessionId: 'nonexistent',
        roundSnapshot: { roundIndex: 0 }
      });

      expect(nextState).to.equal(initialState);
    });
  });

  describe('Round Manager: deriveRoundSnapshot', () => {
    it('derives winner resolution when one candidate has higher tally', () => {
      const vote = {
        pair: ['Alpha', 'Beta'],
        tally: { Alpha: 5, Beta: 2 }
      };

      const snapshot = deriveRoundSnapshot(null, { roundIndex: 1 }, vote, { postNextWinner: null });
      expect(snapshot.roundIndex).to.equal(1);
      expect(snapshot.kind).to.equal('pairwise');
      expect(snapshot.candidates).to.deep.equal(['Alpha', 'Beta']);
      expect(snapshot.tally).to.deep.equal({ Alpha: 5, Beta: 2 });
      expect(snapshot.totalVotes).to.equal(7);
      expect(snapshot.resolution).to.equal('majority_win');
      expect(snapshot.advanced).to.deep.equal(['Alpha']);
      expect(snapshot.closedAt).to.be.an.instanceOf(Date);
    });

    it('derives tie resolution when tallies are equal', () => {
      const vote = {
        pair: ['Alpha', 'Beta'],
        tally: { Alpha: 3, Beta: 3 }
      };

      const snapshot = deriveRoundSnapshot(null, { roundIndex: 0 }, vote, { postNextWinner: null });
      expect(snapshot.resolution).to.equal('tie_advance');
      expect(snapshot.advanced).to.deep.equal(['Alpha', 'Beta']);
      expect(snapshot.totalVotes).to.equal(6);
    });

    it('regression: final round closure records advanced as null when NEXT sets a winner (spec 0003)', () => {
      const vote = {
        pair: ['Alpha', 'Beta'],
        tally: { Alpha: 4, Beta: 2 }
      };

      const snapshot = deriveRoundSnapshot(null, { roundIndex: 3 }, vote, { postNextWinner: 'Alpha' });
      expect(snapshot.resolution).to.equal('majority_win');
      expect(snapshot.advanced).to.be.null;
    });

    it('regression: final round tie does not conclude the tournament, both candidates advance (spec 0003)', () => {
      const vote = {
        pair: ['Alpha', 'Beta'],
        tally: { Alpha: 3, Beta: 3 }
      };

      // A tie never sets a winner: core.getWinners returns both candidates,
      // the entries list regrows, and the tournament continues. NEXT cannot
      // produce a winner from a tie, so postNextWinner stays null and the
      // snapshot must record both candidates as advanced, not null.
      const snapshot = deriveRoundSnapshot(null, { roundIndex: 3 }, vote, { postNextWinner: null });
      expect(snapshot.resolution).to.equal('tie_advance');
      expect(snapshot.advanced).to.deep.equal(['Alpha', 'Beta']);
    });

    it('regression: winner signal in the session beats the tally when deriving without options', () => {
      const vote = {
        pair: ['Alpha', 'Beta'],
        tally: { Alpha: 4, Beta: 2 }
      };

      const session = fromJS({ winner: 'Alpha', entries: [] });
      const snapshot = deriveRoundSnapshot(session, { roundIndex: 3 }, vote);
      expect(snapshot.advanced).to.be.null;
    });
  });

  describe('Serialization Guard: serializeSessionState', () => {
    const baseSession = {
      id: 's1',
      status: 'open',
      roundLifecycle: 'VOTING',
      rounds: [
        { roundIndex: 0, candidates: ['A', 'B'], totalVotes: 5 }
      ]
    };

    it('strips rounds during active VOTING when status is not completed', () => {
      const serialized = serializeSessionState({ ...baseSession });
      expect(serialized.rounds).to.be.undefined;
    });

    it('retains finalVote and strips rounds during ROUND_CLOSED', () => {
      const serialized = serializeSessionState({
        ...baseSession,
        roundLifecycle: 'ROUND_CLOSED'
      });
      // AC-9: ROUND_CLOSED is not the reveal window, so the frozen rounds list
      // stays hidden until RESULTS_REVEALED. finalVote is retained so the
      // server side reveal flow can still read the frozen pair if needed.
      expect(serialized.rounds).to.be.undefined;
    });

    it('strips finalVote during active VOTING', () => {
      const serialized = serializeSessionState({
        ...baseSession,
        finalVote: { pair: ['A', 'B'], tally: { A: 2, B: 1 } }
      });
      // AC-9: the frozen tally must never ship while a round is live.
      expect(serialized.finalVote).to.be.undefined;
    });

    it('retains finalVote during RESULTS_REVEALED', () => {
      const serialized = serializeSessionState({
        ...baseSession,
        roundLifecycle: 'RESULTS_REVEALED',
        finalVote: { pair: ['A', 'B'], tally: { A: 2, B: 1 } }
      });
      expect(serialized.finalVote).to.deep.equal({ pair: ['A', 'B'], tally: { A: 2, B: 1 } });
    });

    it('retains rounds during RESULTS_REVEALED', () => {
      const serialized = serializeSessionState({
        ...baseSession,
        roundLifecycle: 'RESULTS_REVEALED'
      });
      expect(serialized.rounds).to.be.an('array').with.lengthOf(1);
    });

    it('retains rounds when status is completed regardless of roundLifecycle', () => {
      const serialized = serializeSessionState({
        ...baseSession,
        status: 'completed',
        roundLifecycle: 'VOTING'
      });
      expect(serialized.rounds).to.be.an('array').with.lengthOf(1);
    });
  });

  describe('Database & REST Endpoint: pushRoundToResult & GET /api/sessions/:sessionId/rounds', () => {
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
      await clearTestDb();
      store = makeStore();
      port = 9200 + Math.floor(Math.random() * 500);
      server = startServer(store, { port, autoRecover: false });
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    afterEach(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('persists round snapshots incrementally via repository.pushRoundToResult', async () => {
      const round0 = {
        roundIndex: 0,
        kind: 'pairwise',
        candidates: ['Trainspotting', '28 Days Later'],
        tally: { Trainspotting: 4, '28 Days Later': 1 },
        totalVotes: 5,
        closedAt: new Date(),
        resolution: 'majority_win',
        advanced: ['Trainspotting']
      };

      await repository.pushRoundToResult('sess_db_test', round0, { title: 'Movies Tournament' });

      const doc = await Result.findOne({ sessionId: 'sess_db_test' });
      expect(doc).to.not.be.null;
      expect(doc.rounds).to.have.lengthOf(1);
      expect(doc.rounds[0].roundIndex).to.equal(0);
      expect(doc.winner).to.be.null;

      // Duplicate push is idempotent
      await repository.pushRoundToResult('sess_db_test', round0, { title: 'Movies Tournament' });
      const docAfterDup = await Result.findOne({ sessionId: 'sess_db_test' });
      expect(docAfterDup.rounds).to.have.lengthOf(1);

      // Pushing round 1
      const round1 = {
        roundIndex: 1,
        kind: 'pairwise',
        candidates: ['Trainspotting', 'Sunshine'],
        tally: { Trainspotting: 3, Sunshine: 0 },
        totalVotes: 3,
        closedAt: new Date(),
        resolution: 'majority_win',
        advanced: ['Trainspotting']
      };
      await repository.pushRoundToResult('sess_db_test', round1, { title: 'Movies Tournament' });
      const docAfterR1 = await Result.findOne({ sessionId: 'sess_db_test' });
      expect(docAfterR1.rounds).to.have.lengthOf(2);
    });

    it('serves GET /api/sessions/:sessionId/rounds from store if active', async () => {
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_active',
        title: 'Active Session',
        entries: ['A', 'B']
      });

      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_active' });

      store.dispatch({
        type: 'SET_ROUND_LIFECYCLE',
        sessionId: 'sess_active',
        lifecycle: 'RESULTS_REVEALED',
        roundId: 'sess_active:::r1'
      });

      store.dispatch({
        type: 'APPEND_ROUND_RESULT',
        sessionId: 'sess_active',
        roundSnapshot: {
          roundIndex: 0,
          kind: 'pairwise',
          candidates: ['A', 'B'],
          tally: { A: 2, B: 1 },
          totalVotes: 3,
          closedAt: new Date().toISOString(),
          resolution: 'majority_win',
          advanced: ['A']
        }
      });

      const res = await requestHttp(`http://localhost:${port}/api/sessions/sess_active/rounds`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.sessionId).to.equal('sess_active');
      expect(res.body.rounds).to.have.lengthOf(1);
      expect(res.body.rounds[0].roundIndex).to.equal(0);
    });

    it('serves GET /api/sessions/:sessionId/rounds from database if session is in DB', async () => {
      const roundSnapshot = {
        roundIndex: 0,
        kind: 'pairwise',
        candidates: ['Candidate 1', 'Candidate 2'],
        tally: { 'Candidate 1': 10, 'Candidate 2': 2 },
        totalVotes: 12,
        closedAt: new Date(),
        resolution: 'majority_win',
        advanced: ['Candidate 1']
      };

      await repository.pushRoundToResult('sess_archived', roundSnapshot, { title: 'Archived Session' });

      const res = await requestHttp(`http://localhost:${port}/api/sessions/sess_archived/rounds`);
      expect(res.statusCode).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.sessionId).to.equal('sess_archived');
      expect(res.body.rounds).to.have.lengthOf(1);
      expect(res.body.rounds[0].candidates).to.deep.equal(['Candidate 1', 'Candidate 2']);
    });

    it('returns 404 for unknown session', async () => {
      const res = await requestHttp(`http://localhost:${port}/api/sessions/sess_unknown/rounds`);
      expect(res.statusCode).to.equal(404);
      expect(res.body.success).to.be.false;
    });

    it('covers AC-2: persistCompletedResult updates existing Result document without overwriting rounds', async () => {
      const roundSnapshot = {
        roundIndex: 0,
        kind: 'pairwise',
        candidates: ['Alpha', 'Beta'],
        tally: { Alpha: 4, Beta: 1 },
        totalVotes: 5,
        closedAt: new Date(),
        resolution: 'majority_win',
        advanced: ['Alpha']
      };

      await repository.saveSession({
        sessionId: 'sess_complete_test',
        title: 'Championship Tournament',
        entries: ['Alpha', 'Beta'],
        status: 'open'
      });

      // Partial Result doc created at first round close
      await repository.pushRoundToResult('sess_complete_test', roundSnapshot, { title: 'Championship Tournament' });
      const partialDoc = await Result.findOne({ sessionId: 'sess_complete_test' });
      expect(partialDoc).to.not.be.null;
      expect(partialDoc.winner).to.be.null;
      expect(partialDoc.rounds).to.have.lengthOf(1);

      // Tournament completes and persistCompletedResult is called
      const fakeSession = fromJS({
        title: 'Championship Tournament',
        entries: ['Alpha', 'Beta'],
        winner: 'Alpha'
      });
      await persistCompletedResult('sess_complete_test', fakeSession);

      // Verify winner and completedAt are set while rounds[] is preserved
      const completedDoc = await Result.findOne({ sessionId: 'sess_complete_test' });
      expect(completedDoc.winner).to.equal('Alpha');
      expect(completedDoc.completedAt).to.be.an.instanceOf(Date);
      expect(completedDoc.rounds).to.have.lengthOf(1);
      expect(completedDoc.rounds[0].roundIndex).to.equal(0);
    });

    it('covers AC-8: recoverSessionsFromDb loads rounds[] into Redux store on recovery', async () => {
      const round0 = {
        roundIndex: 0,
        kind: 'pairwise',
        candidates: ['Candidate X', 'Candidate Y'],
        tally: { 'Candidate X': 3, 'Candidate Y': 1 },
        totalVotes: 4,
        closedAt: new Date(),
        resolution: 'majority_win',
        advanced: ['Candidate X']
      };

      await repository.saveSession({
        sessionId: 'sess_recover_test',
        title: 'Recoverable Session',
        entries: ['Candidate X', 'Candidate Y'],
        status: 'open'
      });

      await repository.pushRoundToResult('sess_recover_test', round0, { title: 'Recoverable Session' });

      const freshStore = makeStore();
      const recoveredCount = await recoverSessionsFromDb(freshStore);
      expect(recoveredCount).to.equal(1);

      const recoveredSession = freshStore.getState().getIn(['sessions', 'sess_recover_test']);
      expect(recoveredSession).to.not.be.undefined;
      const rounds = recoveredSession.get('rounds');
      expect(rounds.size).to.equal(1);
      expect(rounds.getIn([0, 'roundIndex'])).to.equal(0);
      expect(rounds.getIn([0, 'candidates']).toJS()).to.deep.equal(['Candidate X', 'Candidate Y']);
      expect(rounds.getIn([0, 'resolution'])).to.equal('majority_win');
    });
  });
});
