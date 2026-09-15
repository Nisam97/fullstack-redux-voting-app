import process from 'node:process';
import { io } from 'socket.io-client';
import { createAppStore } from '../src/redux/store.js';
import {
  vote,
  selectVote,
  selectHasLoaded
} from '../src/redux/voteSlice.js';

async function verifyClient() {
  console.log('Connecting client to running server on http://localhost:8090...');
  const clientSocket = io('http://localhost:8090', {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });

  const clientStore = createAppStore(clientSocket);

  // 1. Initial State
  const initialState = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on initial state')), 5000);
    const unsubscribe = clientStore.subscribe(() => {
      const state = clientStore.getState();
      if (selectHasLoaded(state) && selectVote(state)?.pair?.length === 2) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });
  });

  const pair = selectVote(initialState).pair;
  console.log(`✓ Initial pair received: "${pair[0]}" vs "${pair[1]}"`);

  // 2. Dispatch vote for pair[0]
  console.log(`Dispatching vote for "${pair[0]}"...`);
  const state1 = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on vote 1')), 5000);
    const unsubscribe = clientStore.subscribe(() => {
      const state = clientStore.getState();
      const voteData = selectVote(state);
      if (voteData?.tally?.[pair[0]] >= 1) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });
    clientStore.dispatch(vote(pair[0]));
  });

  console.log(`✓ Updated tally:`, selectVote(state1).tally);

  // 3. Dispatch vote for pair[1]
  console.log(`Dispatching vote for "${pair[1]}"...`);
  const state2 = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout on vote 2')), 5000);
    const unsubscribe = clientStore.subscribe(() => {
      const state = clientStore.getState();
      const voteData = selectVote(state);
      if (voteData?.tally?.[pair[1]] >= 1) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });
    clientStore.dispatch(vote(pair[1]));
  });

  console.log(`✓ Updated tally after second candidate vote:`, selectVote(state2).tally);

  clientSocket.disconnect();
  console.log('SUCCESS: Live socket verification passed completely!');
  process.exit(0);
}

verifyClient().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
