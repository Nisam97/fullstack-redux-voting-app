import { expect } from 'chai';
import http from 'http';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store';
import startServer from '../src/server';
import { clearAdmin, seedAdmin, generateAdminToken } from '../src/auth/admin';
import { registerVoter, clearVoters, getVoterCount } from '../src/auth/voter';
import { resetAuthConfig } from '../src/auth/config';

describe('Feature 3 — Stage A: Backend Headcount, Lobby & Session Discovery', () => {
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

  function httpGet(url) {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, body: data, headers: res.headers });
          }
        });
      }).on('error', reject);
    });
  }

  function httpPost(url, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, body: data, headers: res.headers });
          }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
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

    // Create default session (pending)
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_default',
      title: 'Danny Boyle Film Tournament',
      entries: ['Trainspotting', '28 Days Later', 'Sunshine', 'Slumdog Millionaire']
    });

    // Create horror session (pending)
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId: 'sess_horror',
      title: 'Horror Classics',
      entries: ['The Shining', 'Psycho', 'Alien', 'The Thing']
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

  describe('1. Session Voter Headcount Tracking', () => {
    it('initializes with 0 voters for newly created sessions', () => {
      expect(getVoterCount('sess_default')).to.equal(0);
      expect(getVoterCount('sess_horror')).to.equal(0);
    });

    it('increments headcount when a voter registers', () => {
      const result = registerVoter({
        sessionId: 'sess_default',
        displayName: 'Alice',
        store
      });
      expect(result.success).to.be.true;
      expect(getVoterCount('sess_default')).to.equal(1);
    });

    it('correctly tracks multiple voters in the same session', () => {
      registerVoter({ sessionId: 'sess_default', displayName: 'Alice', store });
      registerVoter({ sessionId: 'sess_default', displayName: 'Bob', store });
      registerVoter({ sessionId: 'sess_default', displayName: 'Charlie', store });

      expect(getVoterCount('sess_default')).to.equal(3);
    });

    it('allows duplicate display names and increments headcount for each unique voter', () => {
      const v1 = registerVoter({ sessionId: 'sess_default', displayName: 'Alex', store });
      const v2 = registerVoter({ sessionId: 'sess_default', displayName: 'Alex', store });

      expect(v1.voter.sessionToken).to.not.equal(v2.voter.sessionToken);
      expect(getVoterCount('sess_default')).to.equal(2);
    });

    it('enforces strict session isolation between different sessions', () => {
      // Add 3 voters to sess_default
      registerVoter({ sessionId: 'sess_default', displayName: 'User1', store });
      registerVoter({ sessionId: 'sess_default', displayName: 'User2', store });
      registerVoter({ sessionId: 'sess_default', displayName: 'User3', store });

      // Add 1 voter to sess_horror
      registerVoter({ sessionId: 'sess_horror', displayName: 'HorrorFan', store });

      expect(getVoterCount('sess_default')).to.equal(3);
      expect(getVoterCount('sess_horror')).to.equal(1);
    });

    it('does not increment headcount on failed or rejected joins', () => {
      // Missing display name
      const fail1 = registerVoter({ sessionId: 'sess_default', displayName: '', store });
      expect(fail1.success).to.be.false;
      expect(getVoterCount('sess_default')).to.equal(0);

      // Non-existent session
      const fail2 = registerVoter({ sessionId: 'sess_nonexistent', displayName: 'Ghost', store });
      expect(fail2.success).to.be.false;
      expect(getVoterCount('sess_nonexistent')).to.equal(0);

      // Archived session
      store.dispatch({ type: 'ARCHIVE_SESSION', sessionId: 'sess_default' });
      const fail3 = registerVoter({ sessionId: 'sess_default', displayName: 'LateUser', store });
      expect(fail3.success).to.be.false;
      expect(fail3.error).to.equal('SESSION_ARCHIVED');
      expect(getVoterCount('sess_default')).to.equal(0);
    });

    it('handles invalid or empty session IDs safely', () => {
      expect(getVoterCount('')).to.equal(0);
      expect(getVoterCount(null)).to.equal(0);
      expect(getVoterCount(undefined)).to.equal(0);
      expect(getVoterCount(123)).to.equal(0);
    });

    it('clears session headcounts when clearVoters is called', () => {
      registerVoter({ sessionId: 'sess_default', displayName: 'Alice', store });
      expect(getVoterCount('sess_default')).to.equal(1);

      clearVoters();
      expect(getVoterCount('sess_default')).to.equal(0);
    });
  });

  describe('2. Public Waiting Room / Lobby API (GET /api/sessions/:id/lobby)', () => {
    it('returns 200 with lobby metadata and zero voter count for a pending session', async () => {
      const res = await httpGet(`http://localhost:${port}/api/sessions/sess_default/lobby`);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.sessionId).to.equal('sess_default');
      expect(res.body.title).to.equal('Danny Boyle Film Tournament');
      expect(res.body.status).to.equal('pending');
      expect(res.body.voterCount).to.equal(0);
      expect(res.body.entryCount).to.equal(4);
      expect(res.body.votingStarted).to.be.false;
      expect(res.body.isArchived).to.be.false;
    });

    it('reflects incremented voter count after voters join via REST', async () => {
      // Join via HTTP REST
      const joinRes = await httpPost(`http://localhost:${port}/api/sessions/sess_default/join`, {
        displayName: 'VoterOne'
      });
      expect(joinRes.status).to.equal(200);
      expect(joinRes.body.voterCount).to.equal(1);

      // Query lobby
      const lobbyRes = await httpGet(`http://localhost:${port}/api/sessions/sess_default/lobby`);
      expect(lobbyRes.status).to.equal(200);
      expect(lobbyRes.body.voterCount).to.equal(1);
    });

    it('reflects tournament open status after START_SESSION is dispatched', async () => {
      store.dispatch({ type: 'START_SESSION', sessionId: 'sess_default' });

      const res = await httpGet(`http://localhost:${port}/api/sessions/sess_default/lobby`);
      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('open');
      expect(res.body.votingStarted).to.be.true;
    });

    it('returns 404 SESSION_NOT_FOUND for an unknown session ID', async () => {
      const res = await httpGet(`http://localhost:${port}/api/sessions/sess_unknown/lobby`);

      expect(res.status).to.equal(404);
      expect(res.body.success).to.be.false;
      expect(res.body.error).to.equal('SESSION_NOT_FOUND');
    });

    it('clearly communicates archived status for an archived session', async () => {
      store.dispatch({ type: 'ARCHIVE_SESSION', sessionId: 'sess_default' });

      const res = await httpGet(`http://localhost:${port}/api/sessions/sess_default/lobby`);
      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('archived');
      expect(res.body.isArchived).to.be.true;
    });

    it('never exposes sensitive authentication data in lobby response', async () => {
      registerVoter({ sessionId: 'sess_default', displayName: 'SecretVoter', store });

      const res = await httpGet(`http://localhost:${port}/api/sessions/sess_default/lobby`);
      expect(res.body).to.not.have.property('voterToken');
      expect(res.body).to.not.have.property('tokens');
      expect(res.body).to.not.have.property('password');
      expect(res.body).to.not.have.property('passwordHash');
      expect(res.body).to.not.have.property('_id');
      expect(res.body).to.not.have.property('__v');
    });
  });

  describe('3. Session Discovery API (GET /api/sessions)', () => {
    it('returns 200 with summary array of all registered sessions', async () => {
      const res = await httpGet(`http://localhost:${port}/api/sessions`);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.sessions).to.be.an('array');
      expect(res.body.sessions.length).to.equal(2);
      expect(res.body.count).to.equal(2);
    });

    it('includes safe fields and accurate voter counts for each session', async () => {
      // Add 2 voters to sess_default and 1 to sess_horror
      registerVoter({ sessionId: 'sess_default', displayName: 'V1', store });
      registerVoter({ sessionId: 'sess_default', displayName: 'V2', store });
      registerVoter({ sessionId: 'sess_horror', displayName: 'H1', store });

      const res = await httpGet(`http://localhost:${port}/api/sessions`);
      expect(res.status).to.equal(200);

      const sessDefault = res.body.sessions.find(s => s.id === 'sess_default');
      const sessHorror = res.body.sessions.find(s => s.id === 'sess_horror');

      expect(sessDefault).to.exist;
      expect(sessDefault.sessionId).to.equal('sess_default');
      expect(sessDefault.title).to.equal('Danny Boyle Film Tournament');
      expect(sessDefault.status).to.equal('pending');
      expect(sessDefault.entryCount).to.equal(4);
      expect(sessDefault.voterCount).to.equal(2);

      expect(sessHorror).to.exist;
      expect(sessHorror.sessionId).to.equal('sess_horror');
      expect(sessHorror.title).to.equal('Horror Classics');
      expect(sessHorror.status).to.equal('pending');
      expect(sessHorror.entryCount).to.equal(4);
      expect(sessHorror.voterCount).to.equal(1);
    });

    it('is publicly accessible without requiring JWT authentication', async () => {
      const res = await httpGet(`http://localhost:${port}/api/sessions`);
      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
    });
  });

  function subscribeClient(socket, sessionId) {
    return new Promise((resolve) => {
      socket.once('session_state', (state) => {
        resolve(state);
      });
      socket.emit('subscribe_session', sessionId);
    });
  }

  describe('4. Socket.io Real-Time Lobby Updates & Room Isolation', () => {
    it('broadcasts lobby_update to room subscribers when a voter joins via socket', async () => {
      const client = createClientSocket();
      await subscribeClient(client, 'sess_default');

      const updatePromise = new Promise((resolve) => {
        client.on('lobby_update', (update) => resolve(update));
      });

      // Another client joins sess_default
      const voterClient = createClientSocket();
      voterClient.emit('join_session', { sessionId: 'sess_default', displayName: 'LiveVoter' });

      const update = await updatePromise;
      expect(update.sessionId).to.equal('sess_default');
      expect(update.voterCount).to.equal(1);
    });

    it('returns voterCount in join_session socket callback', (done) => {
      const client = createClientSocket();

      client.emit('join_session', { sessionId: 'sess_default', displayName: 'SocketUser' }, (res) => {
        expect(res.success).to.be.true;
        expect(res.sessionId).to.equal('sess_default');
        expect(res.displayName).to.equal('SocketUser');
        expect(res.voterToken).to.be.ok;
        expect(res.voterCount).to.equal(1);
        done();
      });
    });

    it('broadcasts lobby_update to room subscribers when voter joins via HTTP POST', async () => {
      const client = createClientSocket();
      await subscribeClient(client, 'sess_default');

      const updatePromise = new Promise((resolve) => {
        client.on('lobby_update', (update) => resolve(update));
      });

      const joinRes = await httpPost(`http://localhost:${port}/api/sessions/sess_default/join`, {
        displayName: 'HttpVoter'
      });
      expect(joinRes.status).to.equal(200);

      const update = await updatePromise;
      expect(update.sessionId).to.equal('sess_default');
      expect(update.voterCount).to.equal(1);
    });

    it('strictly isolates lobby_update events so other session rooms do not receive them', async () => {
      const defaultSubscriber = createClientSocket();
      const horrorSubscriber = createClientSocket();

      await subscribeClient(defaultSubscriber, 'sess_default');
      await subscribeClient(horrorSubscriber, 'sess_horror');

      let horrorReceivedUpdate = false;
      horrorSubscriber.on('lobby_update', () => {
        horrorReceivedUpdate = true;
      });

      const updatePromise = new Promise((resolve) => {
        defaultSubscriber.on('lobby_update', (update) => resolve(update));
      });

      // Voter joins sess_default
      const joinRes = await httpPost(`http://localhost:${port}/api/sessions/sess_default/join`, {
        displayName: 'IsolatedVoter'
      });
      expect(joinRes.status).to.equal(200);

      const update = await updatePromise;
      expect(update.sessionId).to.equal('sess_default');
      expect(update.voterCount).to.equal(1);

      // Verify horror subscriber didn't receive default's update
      await new Promise(r => setTimeout(r, 100));
      expect(horrorReceivedUpdate).to.be.false;
    });
  });
});
