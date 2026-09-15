import test from 'node:test';
import assert from 'node:assert/strict';
import voteReducer, {
  setStateAction,
  selectVote,
  selectWinner,
  selectHasLoaded,
  initialState
} from '../src/redux/voteSlice.js';
import socket from '../src/services/socket.js';

test.after(() => {
  socket.close();
});

test('Phase 6 - Results State, Presentation & Authoritativeness Contract', async (t) => {
  await t.test('1. Initial Loading State: hasLoaded is false prior to server synchronization', () => {
    assert.strictEqual(selectHasLoaded(initialState), false);
    assert.strictEqual(selectVote(initialState), null);
    assert.strictEqual(selectWinner(initialState), null);
  });

  await t.test('2. No Results / Empty State: correctly identified when loaded without active pair or winner', () => {
    const emptyServerState = {
      vote: null,
      entries: [],
      winner: null
    };

    const state = voteReducer(initialState, setStateAction(emptyServerState));
    assert.strictEqual(selectHasLoaded(state), true);
    assert.strictEqual(selectWinner(state), null);
    assert.strictEqual(selectVote(state), null);

    const pair = selectVote(state)?.pair || [];
    assert.strictEqual(pair.length < 2, true);
  });

  await t.test('3. Active Round Tally & Safe Percentage Calculation', () => {
    const activeRoundState = {
      vote: {
        pair: ['Trainspotting', '28 Days Later'],
        tally: {
          Trainspotting: 6,
          '28 Days Later': 4
        }
      },
      winner: null
    };

    const state = voteReducer(initialState, setStateAction(activeRoundState));
    const voteData = selectVote(state);
    const pair = voteData.pair;
    const tally = voteData.tally;

    const votes0 = tally[pair[0]] || 0;
    const votes1 = tally[pair[1]] || 0;
    const totalVotes = votes0 + votes1;

    assert.strictEqual(totalVotes, 10);

    const pct0 = totalVotes > 0 ? Number(((votes0 / totalVotes) * 100).toFixed(1)) : 0;
    const pct1 = totalVotes > 0 ? Number(((votes1 / totalVotes) * 100).toFixed(1)) : 0;

    assert.strictEqual(pct0, 60);
    assert.strictEqual(pct1, 40);
  });

  await t.test('4. Zero Votes Protection: handles totalVotes === 0 without NaN or Infinity', () => {
    const zeroVotesState = {
      vote: {
        pair: ['Trainspotting', '28 Days Later'],
        tally: {}
      },
      winner: null
    };

    const state = voteReducer(initialState, setStateAction(zeroVotesState));
    const voteData = selectVote(state);
    const pair = voteData.pair;
    const tally = voteData.tally || {};

    const votes0 = typeof tally[pair[0]] === 'number' ? tally[pair[0]] : 0;
    const votes1 = typeof tally[pair[1]] === 'number' ? tally[pair[1]] : 0;
    const totalVotes = votes0 + votes1;

    assert.strictEqual(totalVotes, 0);

    const pct0 = totalVotes > 0 ? Number(((votes0 / totalVotes) * 100).toFixed(1)) : 0;
    const pct1 = totalVotes > 0 ? Number(((votes1 / totalVotes) * 100).toFixed(1)) : 0;

    assert.strictEqual(pct0, 0);
    assert.strictEqual(pct1, 0);
    assert.strictEqual(Number.isNaN(pct0), false);
    assert.strictEqual(Number.isNaN(pct1), false);
    assert.strictEqual(Number.isFinite(pct0), true);
    assert.strictEqual(Number.isFinite(pct1), true);
  });

  await t.test('5. Server Authoritativeness: Client does not declare winner during active voting regardless of tally lead', () => {
    const leadState = {
      vote: {
        pair: ['Trainspotting', '28 Days Later'],
        tally: {
          Trainspotting: 10,
          '28 Days Later': 1
        }
      },
      winner: null
    };

    const state = voteReducer(initialState, setStateAction(leadState));
    // Server has not declared a winner; selectWinner MUST return null
    assert.strictEqual(selectWinner(state), null);
    // Preserves server order: pair[0] remains Trainspotting, pair[1] remains 28 Days Later
    assert.strictEqual(selectVote(state).pair[0], 'Trainspotting');
    assert.strictEqual(selectVote(state).pair[1], '28 Days Later');
  });

  await t.test('6. Authoritative Winner Announcement: renders server-supplied winner upon tournament conclusion', () => {
    const tournamentWinnerState = {
      winner: 'Trainspotting'
    };

    const state = voteReducer(initialState, setStateAction(tournamentWinnerState));
    assert.strictEqual(selectHasLoaded(state), true);
    assert.strictEqual(selectWinner(state), 'Trainspotting');
    assert.strictEqual(selectVote(state), null);
  });

  await t.test('7. Real-time State Transition: results update reactively as Redux receives server broadcasts', () => {
    // Step A: Round start without votes
    const stepA = voteReducer(initialState, setStateAction({
      vote: { pair: ['A', 'B'] }
    }));
    assert.strictEqual(selectVote(stepA).pair[0], 'A');
    assert.strictEqual(selectVote(stepA).tally, undefined);

    // Step B: First vote arrives for 'A'
    const stepB = voteReducer(stepA, setStateAction({
      vote: { pair: ['A', 'B'], tally: { A: 1 } }
    }));
    assert.strictEqual(selectVote(stepB).tally.A, 1);

    // Step C: Second vote arrives for 'B'
    const stepC = voteReducer(stepB, setStateAction({
      vote: { pair: ['A', 'B'], tally: { A: 1, B: 1 } }
    }));
    assert.strictEqual(selectVote(stepC).tally.B, 1);

    // Step D: Tournament completes with winner
    const stepD = voteReducer(stepC, setStateAction({
      winner: 'A'
    }));
    assert.strictEqual(selectWinner(stepD), 'A');
    assert.strictEqual(selectVote(stepD), null);
  });
});
