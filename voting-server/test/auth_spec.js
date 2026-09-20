import { expect } from 'chai';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import http from 'http';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store';
import startServer from '../src/server';
import {
  seedAdmin,
  getAdminProfile,
  clearAdmin,
  verifyAdminCredentials,
  generateAdminToken,
  verifyAdminToken
} from '../src/auth/admin';
import {
  registerVoter,
  validateVoterToken,
  canCastVote,
  recordVote,
  clearVoters,
  getVoterCount
} from '../src/auth/voter';
import { configureAuth, resetAuthConfig } from '../src/auth/config';

describe('Feature 1: Two-Tier Authentication', () => {
  describe('Admin Account & Password Hashing', () => {
    beforeEach(() => {
      clearAdmin();
      resetAuthConfig();
    });

    it('1. hashes admin password using bcrypt and never stores plaintext password', () => {
      const profile = seedAdmin({
        username: 'test_admin',
        email: 'test_admin@votesphere.local',
        password: 'SuperSecretPassword123!'
      });

      expect(profile).to.be.ok;
      expect(profile.username).to.equal('test_admin');
      expect(profile.email).to.equal('test_admin@votesphere.local');
      expect(profile).to.not.have.property('password');
      expect(profile).to.not.have.property('passwordHash');

      // Attempting to verify credentials succeeds with correct plaintext
      const valid = verifyAdminCredentials('test_admin', 'SuperSecretPassword123!');
      expect(valid.valid).to.be.true;
    });

    it('2. re-seeding updates the single admin without creating multiple accounts', () => {
      seedAdmin({
        username: 'initial_admin',
        email: 'initial@votesphere.local',
        password: 'Password1!'
      });

      seedAdmin({
        username: 'updated_admin',
        email: 'updated@votesphere.local',
        password: 'Password2!'
      });

      const oldCheck = verifyAdminCredentials('initial_admin', 'Password1!');
      expect(oldCheck.valid).to.be.false;

      const newCheck = verifyAdminCredentials('updated_admin', 'Password2!');
      expect(newCheck.valid).to.be.true;
    });
  });

  describe('Admin Login & JWT Issuance', () => {
    beforeEach(() => {
      clearAdmin();
      resetAuthConfig();
      seedAdmin({
        username: 'admin',
        email: 'admin@votesphere.local',
        password: 'ValidPassword123!'
      });
    });

    it('3. valid login succeeds with username or email', () => {
      const byUser = verifyAdminCredentials('admin', 'ValidPassword123!');
      expect(byUser.valid).to.be.true;
      expect(byUser.admin.username).to.equal('admin');

      const byEmail = verifyAdminCredentials('admin@votesphere.local', 'ValidPassword123!');
      expect(byEmail.valid).to.be.true;
      expect(byEmail.admin.email).to.equal('admin@votesphere.local');
    });

    it('4. invalid password fails with generic machine-readable error', () => {
      const result = verifyAdminCredentials('admin', 'WrongPassword!');
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('INVALID_CREDENTIALS');
    });

    it('5. invalid username or email fails with generic machine-readable error', () => {
      const result = verifyAdminCredentials('nonexistent_user', 'ValidPassword123!');
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('INVALID_CREDENTIALS');
    });

    it('6. valid JWT verifies correctly and contains role and identity without sensitive fields', () => {
      const auth = verifyAdminCredentials('admin', 'ValidPassword123!');
      const token = generateAdminToken(auth.admin);

      expect(token).to.be.a('string');
      const decoded = jwt.decode(token);
      expect(decoded.role).to.equal('admin');
      expect(decoded.username).to.equal('admin');
      expect(decoded).to.not.have.property('password');
      expect(decoded).to.not.have.property('passwordHash');

      const verified = verifyAdminToken(token);
      expect(verified.valid).to.be.true;
      expect(verified.admin.role).to.equal('admin');
    });

    it('7. missing JWT fails verification', () => {
      const empty = verifyAdminToken('');
      expect(empty.valid).to.be.false;
      expect(empty.error).to.equal('UNAUTHORIZED');

      const nil = verifyAdminToken(null);
      expect(nil.valid).to.be.false;
      expect(nil.error).to.equal('UNAUTHORIZED');
    });

    it('8. expired JWT fails verification', () => {
      const auth = verifyAdminCredentials('admin', 'ValidPassword123!');
      const expiredToken = generateAdminToken(auth.admin, { expiresIn: '-1s' });

      const verified = verifyAdminToken(expiredToken);
      expect(verified.valid).to.be.false;
      expect(verified.error).to.equal('INVALID_TOKEN');
      expect(verified.message).to.include('expired');
    });

    it('9. tampered JWT fails verification', () => {
      const auth = verifyAdminCredentials('admin', 'ValidPassword123!');
      const token = generateAdminToken(auth.admin);
      const tamperedToken = token.slice(0, -4) + 'abcd';

      const verified = verifyAdminToken(tamperedToken);
      expect(verified.valid).to.be.false;
      expect(verified.error).to.equal('INVALID_TOKEN');
    });

    it('10. malformed JWT fails verification', () => {
      const verified = verifyAdminToken('not.a.valid.jwt.string');
      expect(verified.valid).to.be.false;
      expect(verified.error).to.equal('INVALID_TOKEN');
    });
  });

  describe('Voter Session Join & Token Scoping', () => {
    let store;

    beforeEach(() => {
      clearVoters();
      store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_default',
        title: 'Movie Tournament',
        entries: ['A', 'B', 'C']
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_default'
      });

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_horror',
        title: 'Horror Classics',
        entries: ['Alien', 'The Shining']
      });
    });

    it('11. voter can join session with only a display name', () => {
      const join = registerVoter({
        sessionId: 'sess_default',
        displayName: 'Alice',
        store
      });

      expect(join.success).to.be.true;
      expect(join.voter).to.be.ok;
      expect(join.voter.sessionId).to.equal('sess_default');
      expect(join.voter.displayName).to.equal('Alice');
      expect(join.voter.sessionToken).to.be.a('string');
      expect(join.voter.sessionToken.length).to.be.greaterThan(10);
    });

    it('12. duplicate display names within the same session are allowed and produce unique tokens', () => {
      const voter1 = registerVoter({
        sessionId: 'sess_default',
        displayName: 'Alex',
        store
      });
      const voter2 = registerVoter({
        sessionId: 'sess_default',
        displayName: 'Alex',
        store
      });

      expect(voter1.success).to.be.true;
      expect(voter2.success).to.be.true;
      expect(voter1.voter.displayName).to.equal('Alex');
      expect(voter2.voter.displayName).to.equal('Alex');
      expect(voter1.voter.sessionToken).to.not.equal(voter2.voter.sessionToken);
    });

    it('13. missing display name is rejected', () => {
      const empty = registerVoter({
        sessionId: 'sess_default',
        displayName: '',
        store
      });
      expect(empty.success).to.be.false;
      expect(empty.error).to.equal('INVALID_DISPLAY_NAME');
    });

    it('14. joining a non-existent session is rejected', () => {
      const missing = registerVoter({
        sessionId: 'sess_nonexistent',
        displayName: 'Bob',
        store
      });
      expect(missing.success).to.be.false;
      expect(missing.error).to.equal('SESSION_NOT_FOUND');
    });

    it('15. voter token is strictly session-scoped', () => {
      const join = registerVoter({
        sessionId: 'sess_default',
        displayName: 'Charlie',
        store
      });

      const validDefault = validateVoterToken(join.voter.sessionToken, 'sess_default');
      expect(validDefault.valid).to.be.true;

      const invalidHorror = validateVoterToken(join.voter.sessionToken, 'sess_horror');
      expect(invalidHorror.valid).to.be.false;
      expect(invalidHorror.error).to.equal('SESSION_MISMATCH');
    });

    it('16. single join call registers exactly one voter (regression: no phantom duplicates)', () => {
      expect(getVoterCount('sess_default')).to.equal(0);

      registerVoter({
        sessionId: 'sess_default',
        displayName: 'SoloJoiner',
        store
      });

      expect(getVoterCount('sess_default')).to.equal(1);
    });
  });

  describe('Server-Side Duplicate Vote Protection', () => {
    let store;
    const pair = ['Movie A', 'Movie B'];

    beforeEach(() => {
      clearVoters();
      store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_default',
        title: 'Movie Tournament',
        entries: ['Movie A', 'Movie B', 'Movie C']
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_default'
      });
    });

    it('17. missing voter token is rejected', () => {
      const check = canCastVote({
        sessionToken: null,
        sessionId: 'sess_default',
        pair
      });
      expect(check.allowed).to.be.false;
      expect(check.error).to.equal('VOTER_TOKEN_REQUIRED');
    });

    it('18. invalid voter token is rejected', () => {
      const check = canCastVote({
        sessionToken: 'invalid-token-12345',
        sessionId: 'sess_default',
        pair
      });
      expect(check.allowed).to.be.false;
      expect(check.error).to.equal('INVALID_TOKEN');
    });

    it('19. authenticated voter can cast vote and second vote in same pair is rejected server-side', () => {
      const join = registerVoter({
        sessionId: 'sess_default',
        displayName: 'Dana',
        store
      });
      const token = join.voter.sessionToken;

      const firstCheck = canCastVote({
        sessionToken: token,
        sessionId: 'sess_default',
        pair
      });
      expect(firstCheck.allowed).to.be.true;
      recordVote(firstCheck.voteKey);

      // Attempting second vote in same round/pair must be rejected
      const secondCheck = canCastVote({
        sessionToken: token,
        sessionId: 'sess_default',
        pair
      });
      expect(secondCheck.allowed).to.be.false;
      expect(secondCheck.error).to.equal('DUPLICATE_VOTE');
    });

    it('20. separate voters with identical display names can vote independently', () => {
      const voter1 = registerVoter({ sessionId: 'sess_default', displayName: 'Alex', store });
      const voter2 = registerVoter({ sessionId: 'sess_default', displayName: 'Alex', store });

      const check1 = canCastVote({ sessionToken: voter1.voter.sessionToken, sessionId: 'sess_default', pair });
      expect(check1.allowed).to.be.true;
      recordVote(check1.voteKey);

      const check2 = canCastVote({ sessionToken: voter2.voter.sessionToken, sessionId: 'sess_default', pair });
      expect(check2.allowed).to.be.true;
    });

    it('21. advancing round allows the same voter to vote in the new pair', () => {
      const voter = registerVoter({ sessionId: 'sess_default', displayName: 'Eve', store });
      const token = voter.voter.sessionToken;

      const round1Pair = ['Movie A', 'Movie B'];
      const checkRound1 = canCastVote({ sessionToken: token, sessionId: 'sess_default', pair: round1Pair });
      expect(checkRound1.allowed).to.be.true;
      recordVote(checkRound1.voteKey);

      // New pair in Round 2
      const round2Pair = ['Movie C', 'Movie A'];
      const checkRound2 = canCastVote({ sessionToken: token, sessionId: 'sess_default', pair: round2Pair });
      expect(checkRound2.allowed).to.be.true;
    });
  });

  describe('Socket.io Server Integration & Server-Side Authorization', () => {
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
        ...options
      });
      clients.push(socket);
      return socket;
    }

    beforeEach((done) => {
      clearAdmin();
      clearVoters();
      resetAuthConfig();
      seedAdmin({
        username: 'admin',
        email: 'admin@votesphere.local',
        password: 'Password123!'
      });

      const auth = verifyAdminCredentials('admin', 'Password123!');
      adminToken = generateAdminToken(auth.admin);

      store = makeStore();
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

    it('22. unauthenticated client cannot execute CREATE_SESSION', (done) => {
      const socket = createClientSocket();
      socket.on('action_error', (errorPayload) => {
        expect(errorPayload.action).to.equal('CREATE_SESSION');
        expect(errorPayload.error).to.equal('UNAUTHORIZED');
        expect(store.getState().hasIn(['sessions', 'unauthorized_session'])).to.be.false;
        done();
      });

      socket.emit('action', {
        type: 'CREATE_SESSION',
        sessionId: 'unauthorized_session',
        title: 'Hacked Session'
      });
    });

    it('23. client with invalid or expired JWT is rejected for NEXT', (done) => {
      const socket = createClientSocket();
      socket.on('action_error', (errorPayload) => {
        expect(errorPayload.action).to.equal('NEXT');
        expect(errorPayload.error).to.equal('INVALID_TOKEN');
        done();
      });

      socket.emit('action', {
        type: 'NEXT',
        sessionId: 'sess_default',
        token: 'invalid_tampered_token'
      });
    });

    it('24. authenticated admin can execute NEXT with valid token', (done) => {
      const socket = createClientSocket();

      socket.emit('subscribe_session', 'sess_default');
      socket.once('session_state', () => {
        socket.once('session_state', (updatedState) => {
          expect(updatedState.id).to.equal('sess_default');
          expect(updatedState.vote.pair).to.deep.equal(['Sunshine', 'Trainspotting']);
          done();
        });

        socket.emit('action', {
          type: 'NEXT',
          sessionId: 'sess_default',
          token: adminToken
        });
      });
    });

    it('25. anonymous VOTE is rejected server-side without modifying state', (done) => {
      const socket = createClientSocket();

      socket.on('action_error', (err) => {
        expect(err.action).to.equal('VOTE');
        expect(err.error).to.equal('VOTER_TOKEN_REQUIRED');
        expect(store.getState().getIn(['sessions', 'sess_default', 'vote', 'tally', 'Trainspotting'])).to.be.undefined;
        done();
      });

      // Attempt anonymous vote
      socket.emit('action', {
        type: 'VOTE',
        sessionId: 'sess_default',
        entry: 'Trainspotting'
      });
    });

    it('26. authenticated voter can VOTE and duplicate vote is rejected server-side', (done) => {
      const socket = createClientSocket();

      // Join session over socket
      socket.emit('join_session', { sessionId: 'sess_default', displayName: 'Frank' }, (joinRes) => {
        expect(joinRes.success).to.be.true;
        const voterToken = joinRes.voterToken;
        expect(voterToken).to.be.ok;

        socket.emit('subscribe_session', 'sess_default');

        // First vote
        socket.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_default',
          entry: 'Trainspotting',
          voterToken
        });

        setTimeout(() => {
          expect(store.getState().getIn(['sessions', 'sess_default', 'vote', 'tally', 'Trainspotting'])).to.equal(1);

          // Second vote attempt with same voter token must be rejected
          socket.once('action_error', (err) => {
            expect(err.action).to.equal('VOTE');
            expect(err.error).to.equal('DUPLICATE_VOTE');
            // Tally should still be 1, not 2
            expect(store.getState().getIn(['sessions', 'sess_default', 'vote', 'tally', 'Trainspotting'])).to.equal(1);
            done();
          });

          socket.emit('action', {
            type: 'VOTE',
            sessionId: 'sess_default',
            entry: 'Trainspotting',
            voterToken
          });
        }, 80);
      });
    });

    it('27. voter token from another session is rejected when voting', (done) => {
      const socket = createClientSocket();

      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_horror',
        title: 'Horror',
        entries: ['Alien', 'Psycho']
      });
      store.dispatch({
        type: 'START_SESSION',
        sessionId: 'sess_horror'
      });

      // Join horror session
      socket.emit('join_session', { sessionId: 'sess_horror', displayName: 'Grace' }, (joinRes) => {
        const horrorToken = joinRes.voterToken;

        socket.on('action_error', (err) => {
          expect(err.action).to.equal('VOTE');
          expect(err.error).to.equal('SESSION_MISMATCH');
          done();
        });

        // Attempt to vote in default session using horror token
        socket.emit('action', {
          type: 'VOTE',
          sessionId: 'sess_default',
          entry: 'Trainspotting',
          voterToken: horrorToken
        });
      });
    });

    it('28. single join_session emit registers exactly one voter via callback voterCount', (done) => {
      const socket = createClientSocket();

      socket.emit('join_session', { sessionId: 'sess_default', displayName: 'SoleVoter' }, (joinRes) => {
        expect(joinRes.success).to.be.true;
        expect(joinRes.voterToken).to.be.a('string');
        expect(joinRes.voterCount).to.equal(1);
        done();
      });
    });
  });

  describe('HTTP REST API Endpoints', () => {
    let io;
    let store;
    let port;

    beforeEach((done) => {
      clearAdmin();
      clearVoters();
      resetAuthConfig();
      seedAdmin({
        username: 'admin',
        email: 'admin@votesphere.local',
        password: 'Password123!'
      });

      store = makeStore();
      store.dispatch({
        type: 'CREATE_SESSION',
        sessionId: 'sess_default',
        title: '90s Cult Movies',
        entries: ['Trainspotting', '28 Days Later']
      });

      io = startServer(store, 0);
      port = io.httpServer.address().port;
      done();
    });

    afterEach((done) => {
      if (io) {
        io.close(() => done());
      } else {
        done();
      }
    });

    it('29. POST /api/admin/login validates credentials and issues JWT', (done) => {
      const payload = JSON.stringify({
        username: 'admin',
        password: 'Password123!'
      });

      const req = http.request(`http://localhost:${port}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        expect(res.statusCode).to.equal(200);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const body = JSON.parse(data);
          expect(body.success).to.be.true;
          expect(body.token).to.be.a('string');
          expect(body.user.username).to.equal('admin');
          done();
        });
      });

      req.write(payload);
      req.end();
    });

    it('30. POST /api/sessions/:id/join issues session-scoped voter token and sets cookie', (done) => {
      const payload = JSON.stringify({
        displayName: 'Harry'
      });

      const req = http.request(`http://localhost:${port}/api/sessions/sess_default/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        expect(res.statusCode).to.equal(200);
        const setCookie = res.headers['set-cookie'];
        expect(setCookie).to.be.ok;
        expect(setCookie[0]).to.include('voter_token_sess_default=');

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const body = JSON.parse(data);
          expect(body.success).to.be.true;
          expect(body.sessionId).to.equal('sess_default');
          expect(body.displayName).to.equal('Harry');
          expect(body.voterToken).to.be.ok;
          done();
        });
      });

      req.write(payload);
      req.end();
    });

    it('31. single POST /api/sessions/:id/join increments voterCount to exactly 1 (regression)', (done) => {
      const payload = JSON.stringify({
        displayName: 'SoloREST'
      });

      const req = http.request(`http://localhost:${port}/api/sessions/sess_default/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        expect(res.statusCode).to.equal(200);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const body = JSON.parse(data);
          expect(body.success).to.be.true;
          expect(body.voterCount).to.equal(1);
          done();
        });
      });

      req.write(payload);
      req.end();
    });
  });
});
