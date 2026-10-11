/**
 * Voter identity drops end to end: the real client helper re-handshakes against
 * the real server.
 *
 * The guard this mirrors lives in secured_sessions_regression_spec.js under
 * "9. Socket identity comes from the cookie only, never the payload (AC-15)".
 * There a raw socket.io client proves the server drops the identity when it
 * re-handshakes without the vs_voter cookie. That test hand rolls its own
 * socket, so it stays green even if the shipped client never actually
 * re-handshakes on logout. This file closes that gap from the other side: it
 * loads the real client helpers (voting-client/src/services/socket.js and
 * auth.js) into the server's own process and drives the actual logout path, so
 * "after voter logout the socket re-handshakes and the server then treats the
 * voter as anonymous" is proven as one end to end flow rather than in halves.
 *
 * The client helper is ESM in the sibling package, so it is loaded through
 * Node's own ESM loader after VITE_SERVER_URL has been pointed at this suite's
 * ephemeral port. See importClientModule for why the load is not left to babel,
 * and setVoterCookieOnHandshake for how the browser cookie is represented.
 *
 *   1. The real client helper adopts the vs_voter cookie on a re-handshake, and
 *      the server identifies the voter from it.
 *   2. After voter logout the socket re-handshakes and the server drops the
 *      identity, so the same secured join is then refused as anonymous.
 *   3. Control: the identical re-handshake with no cookie is anonymous, so the
 *      cookie, not the re-handshake alone, is what carries the identity.
 */
import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { io as Client } from 'socket.io-client';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import User from '../src/db/models/User.js';
import SessionAllowlistEntry from '../src/db/models/SessionAllowlistEntry.js';
import SessionJoinRequest from '../src/db/models/SessionJoinRequest.js';
import { generateAdminToken } from '../src/auth/admin.js';
import { generateVoterToken, buildVoterCookieHeader } from '../src/auth/voterCookie.js';
import { clearVoters } from '../src/auth/voter.js';
import startServer from '../src/server.js';
import makeStore from '../src/store.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The spec is compiled to CommonJS by @babel/register, which would rewrite a
// plain import() into a require of the client package and load it as CJS. The
// client helper is real ESM, so the call is hidden behind new Function: the
// compiler never sees the import, and Node's own ESM loader resolves it.
const importClientModule = new Function('specifier', 'return import(specifier);');

const CLIENT_MODULE_URLS = {
  socket: pathToFileURL(
    path.resolve(__dirname, '..', '..', 'voting-client', 'src', 'services', 'socket.js')
  ).href,
  auth: pathToFileURL(
    path.resolve(__dirname, '..', '..', 'voting-client', 'src', 'services', 'auth.js')
  ).href
};

describe('Voter identity drops end to end (real client helper, real server)', function () {
  this.timeout(20000);

  let io;
  let port;
  let adminToken;
  let clientSocket;
  let clientSocketModule;
  let clientAuthModule;
  const clients = [];
  const realFetch = globalThis.fetch;

  function createSocketClient(options = {}) {
    const socket = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      ...options
    });
    clients.push(socket);
    return socket;
  }

  function waitForEvent(socket, eventName, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for "${eventName}"`));
      }, timeoutMs);
      socket.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  // Attached before the re-handshake is triggered, so the connect event cannot
  // be missed. Mirrors the ordering the regression spec needs for the same
  // reason.
  function onceConnect(socket, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for the socket to re-handshake'));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  function emitWithAck(socket, action, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ack of "${action.type}"`));
      }, timeoutMs);
      socket.emit('action', action, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  function joinSession(socket, payload, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for join_session ack')), timeoutMs);
      socket.emit('join_session', payload, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  /**
   * Points the client socket's next handshake at a voter cookie, or at none.
   *
   * In a browser the cookie rides along on its own: the browser attaches the
   * HttpOnly `vs_voter` cookie to the WebSocket handshake, and the client's
   * `withCredentials` covers the polling fallback. Node has no browser cookie
   * store, and the Node build of engine.io-client reacts to `withCredentials`
   * by opening an internal cookie jar that it only ever fills from polling
   * responses. That jar then writes an empty `cookie` header, which displaces an
   * explicitly supplied one, so the cookie never reaches the server (verified
   * against the installed engine.io-client). The jar is therefore switched off
   * for this suite and the cookie is supplied as the handshake header a browser
   * would attach: the same credential on the same handshake. The client helpers
   * under test are not touched.
   */
  function setVoterCookieOnHandshake(cookie) {
    clientSocket.io.opts.withCredentials = false;
    clientSocket.io.opts.extraHeaders = cookie ? { Cookie: cookie } : {};
  }

  async function createSecuredSession(sessionId) {
    const socket = createSocketClient();
    await waitForEvent(socket, 'connect');
    socket.emit('action', {
      type: 'CREATE_SESSION',
      sessionId,
      title: `Re-handshake ${sessionId}`,
      entries: ['Option 1', 'Option 2'],
      sessionType: 'secured',
      whoCanJoin: 'allowlist',
      token: adminToken
    });
    // CREATE_SESSION dispatches without acking; the store is the only truth.
    await delay(250);
    return socket;
  }

  // A secured allowlist session with exactly one seeded voter, plus the cookie
  // that voter's browser would hold. The voter's identity on a socket is derived
  // from that cookie, so this is the identity the tests adopt and then drop.
  async function seedAllowlistedVoter(sessionId, email, username, name) {
    const adminSocket = await createSecuredSession(sessionId);
    const ack = await emitWithAck(adminSocket, {
      type: 'SET_ALLOWLIST',
      sessionId,
      emails: email,
      token: adminToken
    });
    expect(ack.success, 'the allowlist must accept the seeded voter').to.be.true;

    const user = await User.create({ email, username, name });
    return { adminSocket, user, cookie: buildVoterCookieHeader(generateVoterToken(user)) };
  }

  before(async () => {
    await setupTestDb();
    await User.init();
    await SessionAllowlistEntry.init();
    await SessionJoinRequest.init();

    adminToken = generateAdminToken({ username: 'admin', email: 'admin@example.com' });

    io = startServer(makeStore(), 0);
    port = io.httpServer.address().port;

    // The client helper resolves its server URL at module load. Inside Node,
    // neither window nor import.meta.env exists, so it falls through to
    // process.env.VITE_SERVER_URL, which has to be set before the import runs.
    process.env.VITE_SERVER_URL = `http://localhost:${port}`;

    clientSocketModule = await importClientModule(CLIENT_MODULE_URLS.socket);
    clientAuthModule = await importClientModule(CLIENT_MODULE_URLS.auth);
    clientSocket = clientSocketModule.socket;

    // The helper auto-connects on import; the event may already have fired.
    if (!clientSocket.connected) {
      await waitForEvent(clientSocket, 'connect');
    }
  });

  after(async () => {
    globalThis.fetch = realFetch;
    try {
      clientSocket.close();
    } catch {
      // already closed
    }
    while (clients.length > 0) {
      const s = clients.pop();
      if (s.connected) s.disconnect();
    }
    if (io) {
      await new Promise((resolve) => io.close(resolve));
    }
    await teardownTestDb();
    delete process.env.VITE_SERVER_URL;
  });

  beforeEach(async () => {
    await clearTestDb();
    clearVoters();
    globalThis.fetch = realFetch;
    // The live connection keeps whatever identity it handshook with until it
    // re-handshakes, so resetting the header alone changes nothing; every test
    // drives a fresh handshake through the real helper before it asserts.
    setVoterCookieOnHandshake(null);
  });

  describe('1. the real client helper adopts the cookie', () => {
    it('re-handshakes with the vs_voter cookie and the server identifies the voter', async () => {
      // covers: AC-15, and the client half of the regression spec's case 9.
      const sessionId = 'rehandshake_helper_adopts';
      const { user, cookie } = await seedAllowlistedVoter(
        sessionId,
        'helper.adopts@example.com',
        'helperadopts',
        'Helper Adopts'
      );

      setVoterCookieOnHandshake(cookie);

      const idBefore = clientSocket.id;
      const reconnected = onceConnect(clientSocket);
      const triggered = clientSocketModule.reattachVoterIdentityToSocket();
      expect(triggered, 'the helper must report that it reconnected').to.be.true;
      await reconnected;

      expect(clientSocket.id, 'a re-handshake must issue a fresh socket id').to.not.equal(idBefore);

      const ack = await joinSession(clientSocket, { sessionId });
      expect(ack.success, 'the cookie holder must be admitted after the helper re-handshakes').to.be.true;
      expect(ack.voterToken, 'the server must derive the identity from the cookie').to.equal(`user:${user._id}`);
    });
  });

  describe('2. logout then re-handshake drops the identity end to end', () => {
    it('the server stops identifying the voter after the real logout path re-handshakes', async () => {
      // covers: AC-15 and the logout re-handshake contract. This is the
      // end-to-end counterpart of the regression spec's case 9: the same drop,
      // reached by driving the shipped logout code against the shipped server.
      const sessionId = 'rehandshake_after_logout';
      const { user, cookie } = await seedAllowlistedVoter(
        sessionId,
        'helper.logout@example.com',
        'helperlogout',
        'Helper Logout'
      );

      // Adopt the cookie first, so the drop below is a real change of identity
      // and not a socket that was never identified to begin with.
      setVoterCookieOnHandshake(cookie);
      const adopted = onceConnect(clientSocket);
      clientSocketModule.reattachVoterIdentityToSocket();
      await adopted;

      const before = await joinSession(clientSocket, { sessionId });
      expect(before.success, 'the signed in voter must be identified before logout').to.be.true;
      expect(before.voterToken, 'the pre-logout join must carry the cookie identity').to.equal(`user:${user._id}`);

      // In a browser the cookie rides automatically and the logout response
      // clears it, so the socket's next handshake carries none. Node has no
      // cookie jar to clear: the logout request carries the cookie explicitly
      // and, the instant the server has cleared it, the socket's handshake
      // header is emptied, which is what a browser's jar would do on its own.
      globalThis.fetch = async (url, options = {}) => {
        const response = await realFetch(url, {
          ...options,
          headers: { ...(options.headers || {}), Cookie: cookie }
        });
        if (String(url).includes('/api/auth/logout')) {
          setVoterCookieOnHandshake(null);
        }
        return response;
      };

      const idBeforeLogout = clientSocket.id;
      const reconnected = onceConnect(clientSocket);
      const result = await clientAuthModule.logoutVoter();
      expect(result.success, 'the real server must accept the logout').to.be.true;
      await reconnected;

      expect(clientSocket.id, 'logout must force a fresh handshake').to.not.equal(idBeforeLogout);

      const after = await joinSession(clientSocket, { sessionId });
      expect(after.success, 'a logged out voter must not stay identified on the socket').to.be.false;
      expect(after.error, 'the cookie less handshake is anonymous').to.equal('AUTHENTICATION_REQUIRED');
    });
  });

  describe('3. control: the cookie is what carries the identity', () => {
    it('the identical re-handshake with no cookie is anonymous', async () => {
      // Without this control, test 1 could pass on a socket that was never
      // anonymous, and test 2 on one that never dropped anything. Here the same
      // allowlisted voter is seeded but no cookie is sent, so the refusal is the
      // absence of the credential rather than the gate being shut.
      const sessionId = 'rehandshake_no_cookie';
      await seedAllowlistedVoter(sessionId, 'helper.anon@example.com', 'helperanon', 'Helper Anon');

      setVoterCookieOnHandshake(null);
      const reconnected = onceConnect(clientSocket);
      clientSocketModule.reattachVoterIdentityToSocket();
      await reconnected;

      const ack = await joinSession(clientSocket, { sessionId });
      expect(ack.success, 'no cookie means no identity, even for an allowlisted voter').to.be.false;
      expect(ack.error).to.equal('AUTHENTICATION_REQUIRED');
    });
  });
});
