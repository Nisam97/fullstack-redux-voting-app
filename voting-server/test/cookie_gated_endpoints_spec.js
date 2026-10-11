import http from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'chai';
import { setupTestDb, teardownTestDb, clearTestDb } from './db_test_helper.js';
import startServer from '../src/server.js';
import makeStore from '../src/store.js';
import * as repository from '../src/db/repository.js';
import { generateVoterToken } from '../src/auth/voterCookie.js';
import { clearVoters } from '../src/auth/voter.js';
import User from '../src/db/models/User.js';
import Session from '../src/db/models/Session.js';
import SessionAllowlistEntry from '../src/db/models/SessionAllowlistEntry.js';

// The list of endpoints this spec exercises is not written here. It comes from
// the shared contract at ../contracts/cookie-gated-endpoints.json, which the
// client credentials audit reads too, so the two cannot drift: the server half
// proves every listed endpoint refuses a request that omits the `vs_voter`
// cookie, and the client half proves every listed endpoint is only reached
// through services/api.js, which always sends that cookie.
const CONTRACT = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../contracts/cookie-gated-endpoints.json'), 'utf8')
);

function httpRequest(options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(rawData);
        } catch {
          parsed = rawData;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (bodyData !== null) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

describe('Cookie gated endpoints reject a request that omits the vs_voter cookie', function () {
  this.timeout(15000);

  let io;
  let port;
  let store;

  function send(method, requestPath, headers = {}, body = {}) {
    return httpRequest({
      hostname: 'localhost',
      port,
      path: requestPath,
      method,
      headers
    }, method === 'POST' ? body : null);
  }

  function createStoreSession(sessionId, { type = 'public', whoCanJoin = 'public' } = {}) {
    store.dispatch({
      type: 'CREATE_SESSION',
      sessionId,
      title: sessionId,
      entries: ['Alpha', 'Beta'],
      sessionType: type,
      whoCanJoin
    });
  }

  async function makeUser(email, name) {
    // Username must be 3 to 20 alphanumeric/underscore characters.
    const local = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
    const username = `u_${local}`.slice(0, 20).padEnd(3, '0');
    return await User.create({ email, username, name });
  }

  async function createDbSession(sessionId, { type = 'public', whoCanJoin = 'public', status = 'completed', winner = null, publish = false } = {}) {
    return await Session.create({
      sessionId,
      title: sessionId,
      entries: ['Alpha', 'Beta'],
      status,
      type,
      whoCanJoin,
      winner,
      publishResultsPublicly: publish
    });
  }

  async function saveCompletedResult(sessionId, { type, publish, winner = 'Alpha', rounds = [] }) {
    return await repository.saveResult({
      sessionId,
      title: sessionId,
      entries: ['Alpha', 'Beta'],
      winner,
      completedAt: new Date(),
      type,
      publishResultsPublicly: publish,
      rounds
    });
  }

  // Each fixture returns the session id the path template needs (null when the
  // path has no :sessionId) and the cookie a legitimate caller would present,
  // so the positive control and the rejection share one setup.
  const FIXTURES = {
    async account(uniqueId) {
      const user = await makeUser(`${uniqueId}@example.com`, `Cookie ${uniqueId}`);
      return { sessionId: null, cookie: `vs_voter=${generateVoterToken(user)}` };
    },
    async 'secured-lobby'(uniqueId) {
      const sessionId = `cg_${uniqueId}`;
      await createDbSession(sessionId, { type: 'secured', whoCanJoin: 'allowlist', status: 'completed', winner: 'Alpha' });
      await SessionAllowlistEntry.create({ sessionId, email: `${uniqueId}@example.com` });
      const user = await makeUser(`${uniqueId}@example.com`, `Cookie ${uniqueId}`);
      return { sessionId, cookie: `vs_voter=${generateVoterToken(user)}` };
    },
    async 'secured-result'(uniqueId) {
      const sessionId = `cg_${uniqueId}`;
      await createDbSession(sessionId, { type: 'secured', whoCanJoin: 'allowlist', status: 'completed' });
      await saveCompletedResult(sessionId, { type: 'secured', publish: false, winner: 'Beta', rounds: [] });
      await SessionAllowlistEntry.create({ sessionId, email: `${uniqueId}@example.com` });
      const user = await makeUser(`${uniqueId}@example.com`, `Cookie ${uniqueId}`);
      return { sessionId, cookie: `vs_voter=${generateVoterToken(user)}` };
    },
    async 'secured-join'(uniqueId) {
      const sessionId = `cg_${uniqueId}`;
      // registerVoter checks the in-memory store, so the join fixture must
      // create a store session rather than only a database row.
      createStoreSession(sessionId, { type: 'secured', whoCanJoin: 'allowlist' });
      await SessionAllowlistEntry.create({ sessionId, email: `${uniqueId}@example.com` });
      const user = await makeUser(`${uniqueId}@example.com`, `Cookie ${uniqueId}`);
      return { sessionId, cookie: `vs_voter=${generateVoterToken(user)}` };
    }
  };

  /**
   * The three ways a caller can present a cookie that is not a live credential:
   * a token that never verified, a real token whose signature was altered, and
   * an empty value. Each must be refused exactly as firmly as no cookie at all.
   */
  function badCookieVariants(validCookie) {
    const value = validCookie.replace(/^vs_voter=/, '');
    // Flip the last characters of the signature: a token that parses but cannot
    // verify.
    const tampered = `${value.slice(0, -3)}abc`;
    return [
      { label: 'forged', header: 'vs_voter=not.a.real.token' },
      { label: 'tampered', header: `vs_voter=${tampered}` },
      { label: 'empty', header: 'vs_voter=' }
    ];
  }

  /** Asserts a response carries the endpoint's declared rejection. */
  function expectRejection(endpoint, res) {
    expect(res.statusCode).to.equal(endpoint.rejection.status);
    expect(res.body.success, 'a refusal must not report success').to.equal(false);
    if (endpoint.rejection.error) {
      expect(res.body.error).to.equal(endpoint.rejection.error);
    }
  }

  before(async () => {
    await setupTestDb();
    await User.init();
    await Session.init();
    await SessionAllowlistEntry.init();

    store = makeStore();
    io = startServer(store, 0);
    const addr = io.httpServer ? io.httpServer.address() : null;
    port = addr ? addr.port : 8090;
  });

  after(async () => {
    if (io) {
      await new Promise((resolve) => io.close(resolve));
    }
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    clearVoters();
  });

  // Guards the shared file itself: a malformed entry or a fixture name the
  // spec does not implement must fail loudly here rather than as a confusing
  // TypeError deep inside a generated test.
  describe('0. the shared contract is well formed', () => {
    it('lists endpoints that only use known fixtures and supported methods', () => {
      expect(CONTRACT.endpoints, 'endpoints must be a non empty array').to.be.an('array').that.is.not.empty;
      const knownFixtures = Object.keys(FIXTURES);
      for (const endpoint of CONTRACT.endpoints) {
        expect(endpoint.id, 'every endpoint needs an id').to.be.a('string').that.is.not.empty;
        expect(['GET', 'POST']).to.include(endpoint.method, `${endpoint.id} has an unsupported method`);
        expect(endpoint.path.startsWith('/api/'), `${endpoint.id} path must start with /api/`).to.equal(true);
        expect(knownFixtures).to.include(endpoint.fixture, `${endpoint.id} uses unknown fixture ${endpoint.fixture}`);
        expect(endpoint.rejection && endpoint.rejection.status, `${endpoint.id} needs a rejection status`).to.be.a('number');
        expect(endpoint.clientModule, `${endpoint.id} needs a clientModule`).to.be.a('string').that.is.not.empty;
      }
    });
  });

  for (const endpoint of CONTRACT.endpoints) {
    const requestBody = endpoint.clientBody || {};
    const buildPath = (sessionId) => endpoint.path.replace(':sessionId', sessionId || '');

    describe(`${endpoint.method} ${endpoint.path}`, () => {
      it('rejects a request that omits the vs_voter cookie', async () => {
        // A per test id keeps the store session (the join fixture) from
        // colliding with the positive control's session in the same file.
        const fixture = await FIXTURES[endpoint.fixture](`${endpoint.id}-denied`);
        const res = await send(endpoint.method, buildPath(fixture.sessionId), {}, requestBody);

        expectRejection(endpoint, res);
        if (endpoint.rejection.neutral) {
          // A gated secured read must be byte identical to an unknown id, so
          // holding the id cannot confirm the session exists (spec 0008 AC-14).
          const unknown = await send(endpoint.method, endpoint.path.replace(':sessionId', 'cg_unknown_session'), {}, requestBody);
          expect(res.body).to.deep.equal(unknown.body);
        }
      });

      it('refuses forged, tampered and empty cookies as firmly as an omitted one', async () => {
        // The gate must fail closed on a bad credential, not only on a missing
        // one. A forged or altered token must never be a way in, and for a
        // gated read it must answer byte for byte like an anonymous caller so it
        // cannot be used to probe whether a session exists.
        const fixture = await FIXTURES[endpoint.fixture](`${endpoint.id}-badcookie`);
        const requestPath = buildPath(fixture.sessionId);

        const baseline = await send(endpoint.method, requestPath, {}, requestBody);
        expectRejection(endpoint, baseline);

        const variants = badCookieVariants(fixture.cookie);
        // Pin the matrix itself: an accidentally empty list would make this
        // test pass while checking nothing.
        expect(variants.map((v) => v.label)).to.deep.equal(['forged', 'tampered', 'empty']);

        for (const variant of variants) {
          const res = await send(endpoint.method, requestPath, { Cookie: variant.header }, requestBody);
          expect(res.statusCode, `${variant.label} cookie must be refused`).to.equal(baseline.statusCode);
          expect(res.body.success, `${variant.label} cookie must not report success`).to.equal(false);
          if (endpoint.rejection.error) {
            // join names the missing credential, so a bad one carries the same code.
            expect(res.body.error, `${variant.label} cookie error`).to.equal(endpoint.rejection.error);
          }
          if (endpoint.rejection.neutral) {
            // Byte identical to the omitted-cookie answer, not merely a 404.
            expect(res.body, `${variant.label} cookie body`).to.deep.equal(baseline.body);
          }
        }
      });

      it('serves the endpoint when the cookie is present', async () => {
        const fixture = await FIXTURES[endpoint.fixture](`${endpoint.id}-allowed`);
        const res = await send(endpoint.method, buildPath(fixture.sessionId), { Cookie: fixture.cookie }, requestBody);

        expect(res.statusCode).to.equal(200);
        expect(res.body.success).to.equal(true);
      });
    });
  }
});
