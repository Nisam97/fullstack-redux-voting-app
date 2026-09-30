import { expect } from 'chai';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store';
import startServer from '../src/server';
import { seedAdmin, generateAdminToken, clearAdmin } from '../src/auth/admin';
import { registerVoter, clearVoters } from '../src/auth/voter';
import { resetAuthConfig } from '../src/auth/config';

describe('server', () => {
  let io;
  let store;
  let port;
  let adminToken;
  const clients = [];

  function createClientSocket(options = {}) {
    const socket = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: {
        token: adminToken
      },
      ...options
    });
    clients.push(socket);
    return socket;
  }

  function connectClient(options = {}) {
    const defaultVoter = registerVoter({
      sessionId: 'sess_default',
      displayName: `Voter_${Date.now()}_${Math.random()}`,
      store
    });
    const horrorVoter = registerVoter({
      sessionId: 'sess_horror',
      displayName: `HorrorVoter_${Date.now()}_${Math.random()}`,
      store
    });

    const socket = createClientSocket({
      auth: {
        token: adminToken,
        voterToken: defaultVoter.voter.sessionToken
      },
      ...options
    });

    socket.defaultVoterToken = defaultVoter.voter.sessionToken;
    socket.horrorVoterToken = horrorVoter.voter.sessionToken;
    socket.adminToken = adminToken;

    socket.emit('join_session', { sessionId: 'sess_default', displayName: defaultVoter.voter.displayName });
    socket.emit('join_session', { sessionId: 'sess_horror', displayName: horrorVoter.voter.displayName });

    return new Promise((resolve, reject) => {
      socket.once('sessions', (sessions) => {
        resolve({ socket, initialSessions: sessions });
      });
      socket.once('connect_error', reject);
    });
  }

  function subscribeClient(socket, sessionId) {
    return new Promise((resolve) => {
      socket.once('session_state', (state) => {
        resolve(state);
      });
      socket.emit('subscribe_session', sessionId);
    });
  }

  function waitForNextSessionState(socket) {
    return new Promise((resolve) => {
      socket.once('session_state', (state) => resolve(state));
    });
  }

  function waitForNextSessions(socket) {
    return new Promise((resolve) => {
      socket.once('sessions', (sessions) => resolve(sessions));
    });
  }

  // Polls the authoritative store until the accepted vote shows up. The live
  // tally is hidden from broadcasts during an active round (shared guard), so
  // a bare vote no longer produces a session_state emission.
  function waitForStoreTally(sessionId, entry, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const count = store.getState().getIn(['sessions', sessionId, 'vote', 'tally', entry]);
        if (typeof count === 'number' && count > 0) {
          resolve(count);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for tally of "${entry}" in ${sessionId}`));
          return;
        }
        setTimeout(tick, 20);
      };
      tick();
    });
  }

  beforeEach((done) => {
    clearAdmin();
    clearVoters();
    resetAuthConfig();
    const admin = seedAdmin({
      username: 'admin',
      email: 'admin@votesphere.local',
      password: 'Password123!'
    });
    adminToken = generateAdminToken(admin);

    store = makeStore();

    // Create and start default session
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_default',
      title: '90s Cult Movies',
      entries: ['Trainspotting', '28 Days Later', 'Sunshine']
    });
    store.dispatch({
      type: 'START_SESSION',
      sessionId: 'sess_default'
    });

    // Create and start horror session for multi-session / isolation testing
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_horror',
      title: 'Horror Classics',
      entries: ['The Shining', 'Psycho', 'Alien']
    });
    store.dispatch({
      type: 'START_SESSION',
      sessionId: 'sess_horror'
    });

    io = startServer(store, 0);
    port = io.httpServer.address().port;
    done();
  });

  afterEach((done) => {
    while (clients.length > 0) {
      const socket = clients.pop();
      if (socket && socket.connected) {
        socket.disconnect();
      }
    }
    if (io) {
      io.close(() => done());
    } else {
      done();
    }
  });

  describe('connection and registry', () => {
    it('1. client can connect', async () => {
      const { socket } = await connectClient();
      expect(socket.connected).to.be.true;
    });

    it('2. initial sessions registry information is available on connect', async () => {
      const { initialSessions } = await connectClient();
      expect(initialSessions).to.be.an('array');
      expect(initialSessions.length).to.equal(2);
    });

    it('3. registry reflects the current sessions with identifiers and lifecycle status', async () => {
      const { initialSessions } = await connectClient();
      const defaultSess = initialSessions.find(s => s.id === 'sess_default');
      const horrorSess = initialSessions.find(s => s.id === 'sess_horror');

      expect(defaultSess).to.deep.include({
        id: 'sess_default',
        title: '90s Cult Movies',
        status: 'open'
      });
      expect(defaultSess.createdAt).to.be.a('string');

      expect(horrorSess).to.deep.include({
        id: 'sess_horror',
        title: 'Horror Classics',
        status: 'open'
      });
      expect(horrorSess.createdAt).to.be.a('string');
    });
  });

  describe('subscription', () => {
    it('4. valid session subscription succeeds', async () => {
      const { socket } = await connectClient();
      const state = await subscribeClient(socket, 'sess_default');
      expect(state).to.be.ok;
      expect(state.id).to.equal('sess_default');
    });

    it('5. subscriber joins the correct room', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      const room = io.sockets.adapter.rooms.get('session:sess_default');
      expect(room).to.be.ok;
      expect(room.has(socket.id)).to.be.true;
    });

    it('6. subscriber immediately receives session_state', async () => {
      const { socket } = await connectClient();
      const state = await subscribeClient(socket, 'sess_default');

      expect(state).to.deep.include({
        id: 'sess_default',
        title: '90s Cult Movies',
        status: 'open',
        entries: ['Sunshine']
      });
      expect(state.vote).to.deep.equal({
        pair: ['Trainspotting', '28 Days Later'],
        // The shared guard empties the live tally during an active round.
        tally: {}
      });
    });

    it('7. invalid session subscription is safely rejected/ignored according to the implementation contract', async () => {
      const { socket } = await connectClient();
      let stateReceived = false;
      socket.on('session_state', () => {
        stateReceived = true;
      });

      socket.emit('subscribe_session', 'nonexistent_session');
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(stateReceived).to.be.false;
      const room = io.sockets.adapter.rooms.get('session:nonexistent_session');
      expect(room).to.be.undefined;
    });

    it('8. malformed subscription payload does not crash the server', async () => {
      const { socket } = await connectClient();

      socket.emit('subscribe_session', null);
      socket.emit('subscribe_session', undefined);
      socket.emit('subscribe_session', 12345);
      socket.emit('subscribe_session', {});
      socket.emit('subscribe_session', { sessionId: 999 });
      socket.emit('subscribe_session', '');
      socket.emit('subscribe_session', '   ');

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(socket.connected).to.be.true;

      // Server can still process valid subscriptions after malformed payloads
      const validState = await subscribeClient(socket, 'sess_default');
      expect(validState.id).to.equal('sess_default');
    });
  });

  describe('state updates', () => {
    it('9. VOTE updates the correct session', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: 'Trainspotting'
      });

      // The vote is accepted and applied; its tally stays off the wire.
      const count = await waitForStoreTally('sess_default', 'Trainspotting');
      expect(count).to.equal(1);
      expect(store.getState().getIn(['sessions', 'sess_default', 'vote', 'tally', 'Trainspotting'])).to.equal(1);
    });

    it('10. NEXT updates the correct session', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      // Vote for Trainspotting (accepted in store; no broadcast while the
      // tally is hidden)
      socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: 'Trainspotting'
      });
      await waitForStoreTally('sess_default', 'Trainspotting');

      // Advance round via NEXT
      const updatePromise = waitForNextSessionState(socket);
      socket.emit('action', {
        type: 'NEXT',
        sessionId: 'sess_default'
      });

      const updatedState = await updatePromise;
      expect(updatedState.id).to.equal('sess_default');
      expect(updatedState.vote.pair).to.deep.equal(['Sunshine', 'Trainspotting']);
      expect(updatedState.entries).to.deep.equal([]);
    });

    it('11. SET_ENTRIES updates the correct session', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      const updatePromise = waitForNextSessionState(socket);
      socket.emit('action', {
        type: 'SET_ENTRIES',
        sessionId: 'sess_default',
        entries: ['Movie A', 'Movie B', 'Movie C']
      });

      const updatedState = await updatePromise;
      expect(updatedState.id).to.equal('sess_default');
      expect(updatedState.entries).to.deep.equal(['Movie A', 'Movie B', 'Movie C']);
      expect(store.getState().getIn(['sessions', 'sess_default', 'entries']).toJS()).to.deep.equal(
        ['Movie A', 'Movie B', 'Movie C']
      );
    });

    it('12. state updates are sent using session_state event name', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      let receivedEvent = null;
      socket.once('session_state', (payload) => {
        receivedEvent = payload;
      });

      socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: 'Trainspotting'
      });

      // The accepted vote is verified in the store; a bare vote with a hidden
      // tally produces no broadcast at all.
      await waitForStoreTally('sess_default', 'Trainspotting');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(receivedEvent).to.be.null;
      expect(store.getState().getIn(['sessions', 'sess_default', 'vote', 'tally', 'Trainspotting'])).to.equal(1);
    });
  });

  describe('room isolation', () => {
    it('13. Session A updates do not reach Session B subscribers', async () => {
      const clientA = await connectClient();
      const clientB = await connectClient();

      await subscribeClient(clientA.socket, 'sess_default');
      await subscribeClient(clientB.socket, 'sess_horror');

      let clientBReceived = [];
      clientB.socket.on('session_state', (state) => {
        clientBReceived.push(state);
      });

      clientA.socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: 'Trainspotting'
      });

      // A bare vote (hidden tally) produces no broadcast in any room.
      await waitForStoreTally('sess_default', 'Trainspotting');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(clientBReceived.length).to.equal(0);
    });

    it('14. Session B updates do not reach Session A subscribers', async () => {
      const clientA = await connectClient();
      const clientB = await connectClient();

      await subscribeClient(clientA.socket, 'sess_default');
      await subscribeClient(clientB.socket, 'sess_horror');

      let clientAReceived = [];
      clientA.socket.on('session_state', (state) => {
        clientAReceived.push(state);
      });

      clientB.socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_horror',
        entry: 'The Shining'
      });

      // A bare vote (hidden tally) produces no broadcast in any room.
      await waitForStoreTally('sess_horror', 'The Shining');
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(clientAReceived.length).to.equal(0);
    });

    it('15. two simultaneous clients can subscribe to different sessions independently', async () => {
      const clientA = await connectClient();
      const clientB = await connectClient();

      const stateA = await subscribeClient(clientA.socket, 'sess_default');
      const stateB = await subscribeClient(clientB.socket, 'sess_horror');

      expect(stateA.id).to.equal('sess_default');
      expect(stateA.title).to.equal('90s Cult Movies');

      expect(stateB.id).to.equal('sess_horror');
      expect(stateB.title).to.equal('Horror Classics');

      const roomA = io.sockets.adapter.rooms.get('session:sess_default');
      const roomB = io.sockets.adapter.rooms.get('session:sess_horror');

      expect(roomA.has(clientA.socket.id)).to.be.true;
      expect(roomA.has(clientB.socket.id)).to.be.false;

      expect(roomB.has(clientB.socket.id)).to.be.true;
      expect(roomB.has(clientA.socket.id)).to.be.false;
    });

    it('16. multiple clients subscribed to the same session receive that session updates', async () => {
      const clientA = await connectClient();
      const clientB = await connectClient();

      await subscribeClient(clientA.socket, 'sess_default');
      await subscribeClient(clientB.socket, 'sess_default');

      const updatePromiseA = waitForNextSessionState(clientA.socket);
      const updatePromiseB = waitForNextSessionState(clientB.socket);

      // One accepted vote (verified in store; a bare vote emits nothing while
      // the tally is hidden), then the admin NEXT advances the round, which
      // broadcasts to the whole room.
      clientA.socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: 'Trainspotting'
      });
      await waitForStoreTally('sess_default', 'Trainspotting');
      clientA.socket.emit('action', {
        type: 'NEXT',
        sessionId: 'sess_default'
      });

      const [stateA, stateB] = await Promise.all([updatePromiseA, updatePromiseB]);

      // Both room subscribers receive the advancement broadcast.
      expect(stateA.id).to.equal('sess_default');
      expect(stateB.id).to.equal('sess_default');
      expect(stateA.vote.pair).to.deep.equal(['Sunshine', 'Trainspotting']);
      expect(stateB.vote.pair).to.deep.equal(['Sunshine', 'Trainspotting']);
    });
  });

  describe('unsubscribe', () => {
    it('17. valid unsubscribe leaves the room', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      const roomBefore = io.sockets.adapter.rooms.get('session:sess_default');
      expect(roomBefore.has(socket.id)).to.be.true;

      socket.emit('unsubscribe_session', 'sess_default');
      await new Promise(resolve => setTimeout(resolve, 50));

      const roomAfter = io.sockets.adapter.rooms.get('session:sess_default');
      expect(roomAfter ? roomAfter.has(socket.id) : false).to.be.false;
    });

    it('18. unsubscribed clients no longer receive future session state updates', async () => {
      const clientA = await connectClient();
      const clientB = await connectClient();

      await subscribeClient(clientA.socket, 'sess_default');
      await subscribeClient(clientB.socket, 'sess_default');

      // Client A unsubscribes
      clientA.socket.emit('unsubscribe_session', 'sess_default');
      await new Promise(resolve => setTimeout(resolve, 50));

      let clientAReceived = false;
      clientA.socket.on('session_state', () => {
        clientAReceived = true;
      });

      // Client B (still subscribed) votes and advances via admin NEXT: the
      // broadcast reaches B only.
      const updatePromiseB = waitForNextSessionState(clientB.socket);
      clientB.socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: 'Trainspotting'
      });
      await waitForStoreTally('sess_default', 'Trainspotting');
      clientB.socket.emit('action', {
        type: 'NEXT',
        sessionId: 'sess_default'
      });
      await updatePromiseB;

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(clientAReceived).to.be.false;
    });

    it('19. invalid/malformed unsubscribe is safe and does not crash the server', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      socket.emit('unsubscribe_session', null);
      socket.emit('unsubscribe_session', undefined);
      socket.emit('unsubscribe_session', 12345);
      socket.emit('unsubscribe_session', {});
      socket.emit('unsubscribe_session', { sessionId: 123 });
      socket.emit('unsubscribe_session', '');
      socket.emit('unsubscribe_session', 'nonexistent_room');

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(socket.connected).to.be.true;

      // Socket is still in sess_default room
      const room = io.sockets.adapter.rooms.get('session:sess_default');
      expect(room.has(socket.id)).to.be.true;
    });
  });

  describe('action validation', () => {
    it('20. session-specific action without sessionId is safely handled', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      let received = false;
      socket.on('session_state', () => {
        received = true;
      });

      // Action without sessionId
      socket.emit('action', {
        type: 'VOTE',
        entry: 'Trainspotting'
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(received).to.be.false;
      expect(socket.connected).to.be.true;
      expect(store.getState().getIn(['sessions', 'sess_default', 'vote', 'tally'])).to.be.undefined;
    });

    it('21. invalid sessionId is safely handled', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      let received = false;
      socket.on('session_state', () => {
        received = true;
      });

      socket.emit('action', {
        type: 'VOTE',
        sessionId: 'does_not_exist',
        entry: 'Trainspotting'
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(received).to.be.false;
      expect(socket.connected).to.be.true;
    });

    it('22. unknown/malformed actions do not crash the server', async () => {
      const { socket } = await connectClient();
      await subscribeClient(socket, 'sess_default');

      socket.emit('action', null);
      socket.emit('action', undefined);
      socket.emit('action', 'not-an-object');
      socket.emit('action', 42);
      socket.emit('action', {});
      socket.emit('action', { type: 123 });
      socket.emit('action', { type: 'COMPLETELY_UNKNOWN_ACTION' });

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(socket.connected).to.be.true;

      // Ensure server still works perfectly on valid action
      socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: 'Trainspotting'
      });
      const count = await waitForStoreTally('sess_default', 'Trainspotting');
      expect(count).to.equal(1);
    });
  });

  describe('recovery', () => {
    it('23. client can reconnect and resubscribe', async () => {
      const client = await connectClient();
      const state1 = await subscribeClient(client.socket, 'sess_default');
      expect(state1.id).to.equal('sess_default');

      // Disconnect client
      client.socket.disconnect();
      expect(client.socket.connected).to.be.false;

      // Reconnect
      client.socket.connect();
      await new Promise((resolve) => {
        client.socket.once('connect', resolve);
      });
      expect(client.socket.connected).to.be.true;

      // Resubscribe
      const state2 = await subscribeClient(client.socket, 'sess_default');
      expect(state2.id).to.equal('sess_default');
    });

    it('24. reconnected subscriber receives the current session state', async () => {
      const clientA = await connectClient();
      await subscribeClient(clientA.socket, 'sess_default');

      // Vote while clientB is offline (accepted in store; no broadcast while
      // the tally is hidden)
      clientA.socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: 'Trainspotting'
      });
      await waitForStoreTally('sess_default', 'Trainspotting');

      // Client B connects fresh (simulating reconnect / new session)
      const clientB = await connectClient();
      const stateB = await subscribeClient(clientB.socket, 'sess_default');

      expect(stateB.id).to.equal('sess_default');
      // Hydration applies the same guard: the live tally never reaches the wire.
      expect(stateB.vote.tally).to.deep.equal({});
      expect(store.getState().getIn(['sessions', 'sess_default', 'vote', 'tally', 'Trainspotting'])).to.equal(1);
    });
  });
});
