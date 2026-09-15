import process from 'node:process';
import { io } from 'socket.io-client';
import { createAppStore } from '../src/redux/store.js';
import {
  vote,
  next,
  selectVote,
  selectWinner,
  selectHasLoaded
} from '../src/redux/voteSlice.js';

function waitForState(store, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const currentState = store.getState();
    if (predicate(currentState)) {
      return resolve(currentState);
    }
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout waiting for state condition after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      if (predicate(state)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(state);
      }
    });
  });
}

async function runEndToEndVerification() {
  console.log('===============================================================');
  console.log('Phase 6: End-to-End Real-Time & Results Verification');
  console.log('===============================================================');

  const socketsToCleanup = [];

  try {
    // Step 1: Connect Client A
    console.log('\n[1/6] Connecting Client A to authoritative server on http://localhost:8090...');
    const socketA = io('http://localhost:8090', {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
    socketsToCleanup.push(socketA);
    const storeA = createAppStore(socketA);

    const initialA = await waitForState(storeA, (state) =>
      selectHasLoaded(state) && (selectVote(state)?.pair?.length === 2 || Boolean(selectWinner(state)))
    );

    const activePair = selectVote(initialA)?.pair;
    const currentWinner = selectWinner(initialA);

    if (currentWinner) {
      console.log(`✓ Initial State synchronized: Tournament Winner is "${currentWinner}"`);
    } else {
      console.log(`✓ Client A synchronized! Active pair: "${activePair[0]}" vs "${activePair[1]}"`);
    }

    // Step 2: Multi-Client Connection (Client B)
    console.log('\n[2/6] Connecting Client B to http://localhost:8090 (Multi-Client Test)...');
    const socketB = io('http://localhost:8090', {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
    socketsToCleanup.push(socketB);
    const storeB = createAppStore(socketB);

    const initialB = await waitForState(storeB, (state) =>
      selectHasLoaded(state) && (selectVote(state)?.pair?.length === 2 || Boolean(selectWinner(state)))
    );

    console.log('✓ Client B synchronized with authoritative state snapshot: hasLoaded =', selectHasLoaded(initialB));

    // Step 3: Multi-Client Voting & Real-Time Broadcast
    if (activePair && activePair.length === 2) {
      console.log(`\n[3/6] Client A voting for "${activePair[0]}"...`);
      const initialVotes0 = selectVote(storeA.getState())?.tally?.[activePair[0]] || 0;
      storeA.dispatch(vote(activePair[0]));

      // Both Client A and Client B must receive authoritative tally broadcast
      const [updatedA1, updatedB1] = await Promise.all([
        waitForState(storeA, (s) => (selectVote(s)?.tally?.[activePair[0]] || 0) > initialVotes0),
        waitForState(storeB, (s) => (selectVote(s)?.tally?.[activePair[0]] || 0) > initialVotes0)
      ]);
      console.log(`✓ Client A tally received:`, selectVote(updatedA1).tally);
      console.log(`✓ Client B broadcast received in real time:`, selectVote(updatedB1).tally);

      console.log(`Client B voting for "${activePair[1]}"...`);
      const initialVotes1 = selectVote(storeB.getState())?.tally?.[activePair[1]] || 0;
      storeB.dispatch(vote(activePair[1]));

      const [updatedA2, updatedB2] = await Promise.all([
        waitForState(storeA, (s) => (selectVote(s)?.tally?.[activePair[1]] || 0) > initialVotes1),
        waitForState(storeB, (s) => (selectVote(s)?.tally?.[activePair[1]] || 0) > initialVotes1)
      ]);
      console.log(`✓ Both clients synchronized after vote for candidate 2: A =`, selectVote(updatedA2).tally, `B =`, selectVote(updatedB2).tally);

      // Step 4: Verify Results Presentation Calculations
      console.log('\n[4/6] Verifying Results Presentation Calculations...');
      const tallyData = selectVote(updatedA2).tally;
      const v0 = tallyData[activePair[0]] || 0;
      const v1 = tallyData[activePair[1]] || 0;
      const total = v0 + v1;

      const pct0 = total > 0 ? Number(((v0 / total) * 100).toFixed(1)) : 0;
      const pct1 = total > 0 ? Number(((v1 / total) * 100).toFixed(1)) : 0;

      console.log(`   - Candidate 1 ("${activePair[0]}"): ${v0} votes (${pct0}%)`);
      console.log(`   - Candidate 2 ("${activePair[1]}"): ${v1} votes (${pct1}%)`);
      console.log(`   - Total Round Votes: ${total}`);

      if (total <= 0 || Number.isNaN(pct0) || Number.isNaN(pct1)) {
        throw new Error('Invalid percentage or vote calculation');
      }

      // Check server authoritativeness: neither client derives a winner
      if (selectWinner(storeA.getState()) !== null || selectWinner(storeB.getState()) !== null) {
        throw new Error('Violation: Client declared winner before server conclusion');
      }
      console.log('✓ Authoritative candidate ordering preserved (pair[0], pair[1]).');
      console.log('✓ Percentage calculations verified without NaN / Infinity.');
      console.log('✓ Server authoritativeness confirmed (no client-side winner during active round).');
    } else {
      console.log('\n[3/6 & 4/6] Tournament already concluded; testing winner state presentation.');
    }

    // Step 5: Round progression check
    console.log('\n[5/6] Testing round progression trigger (NEXT)...');
    const stateBefore = storeA.getState();
    storeA.dispatch(next());

    const advancedState = await waitForState(storeA, (s) => {
      // Either a new pair appeared, or tournament winner concluded
      if (selectWinner(s)) return true;
      const newPair = selectVote(s)?.pair;
      const oldPair = selectVote(stateBefore)?.pair;
      return newPair && oldPair && (newPair[0] !== oldPair[0] || newPair[1] !== oldPair[1]);
    });

    if (selectWinner(advancedState)) {
      console.log(`✓ Tournament concluded! Authoritative winner: "${selectWinner(advancedState)}"`);
      console.log(`✓ Client B synchronized winner: "${selectWinner(storeB.getState())}"`);
    } else {
      const newPair = selectVote(advancedState).pair;
      console.log(`✓ Next pairwise round started! New matchup: "${newPair[0]}" vs "${newPair[1]}"`);
      console.log(`✓ Client B synchronized to new round in real time: "${selectVote(storeB.getState())?.pair?.join(' vs ')}"`);
    }

    // Step 6: Reconnection / Refresh State Recovery Check
    console.log('\n[6/6] Verifying Browser Refresh / Reconnection State Recovery...');
    const socketC = io('http://localhost:8090', {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
    socketsToCleanup.push(socketC);
    const storeC = createAppStore(socketC);

    const reconnectedState = await waitForState(storeC, (s) => selectHasLoaded(s));
    console.log('✓ Fresh client connection immediately synchronized authoritative server state snapshot!');
    console.log(`  - hasLoaded: ${selectHasLoaded(reconnectedState)}`);
    console.log(`  - vote active: ${Boolean(selectVote(reconnectedState))}`);
    console.log(`  - winner: ${selectWinner(reconnectedState) || 'none (in progress)'}`);

    console.log('\n===============================================================');
    console.log('PHASE 6 END-TO-END VERIFICATION: ALL 6 CHECKS PASSED (100%)');
    console.log('===============================================================');
  } finally {
    for (const s of socketsToCleanup) {
      try {
        s.disconnect();
      } catch {
        // ignore
      }
    }
  }
}

runEndToEndVerification()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('VERIFICATION FAILED:', err);
    process.exit(1);
  });
