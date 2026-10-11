import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Standing audit for spec 0007 AC-15 and spec 0008 AC-15: voter identity rides
// the HttpOnly vs_voter cookie, and a browser only sends it when the request
// asks for credentials. A single fetch that forgot `credentials: 'include'`
// silently looked anonymous server side, which is how the socket handshake and
// the lobby read were broken before.
//
// Every own-server request now goes through the one helper in services/api.js,
// which sets `credentials: 'include'`, the admin Bearer header, and the
// transport error handling. So the invariant moved: it is no longer "each of
// the dozen call sites remembers credentials" but "there is exactly one fetch,
// it is the helper, and it is correct".
//
// Which endpoints must be reached this way is not hardcoded here. It comes from
// the shared contract at ../contracts/cookie-gated-endpoints.json, which the
// server rejection spec reads too, so the client and server halves of the
// cookie contract cannot drift apart.
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');
const API_MODULE = 'services/api.js';

const CONTRACT = JSON.parse(
  fs.readFileSync(path.resolve(here, '../../contracts/cookie-gated-endpoints.json'), 'utf8')
);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Returns the exact argument text of every `fetch(...)` call in a file, found
 * by balancing parentheses so multi line option objects are captured whole.
 * Each entry carries the 1 based line number for a readable failure.
 */
function findFetchCalls(source) {
  const calls = [];
  const needle = 'fetch(';
  let from = 0;
  while (true) {
    const start = source.indexOf(needle, from);
    if (start === -1) break;
    const openParen = start + 'fetch'.length;
    let i = openParen + 1;
    let depth = 1;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    calls.push({
      args: source.slice(openParen + 1, i - 1),
      line: source.slice(0, start).split('\n').length
    });
    from = i;
  }
  return calls;
}

/**
 * Turns a contract path template into a pattern that matches the client source
 * that calls it. A `:param` segment becomes a wildcard that spans the
 * `${encodeURIComponent(...)}` interpolation the client uses.
 */
function endpointPattern(endpointPath) {
  const escaped = endpointPath
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) return '[^`\\n]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(escaped);
}

const rel = (file) => path.relative(SRC, file).split(path.sep).join('/');

const sourceFiles = walk(SRC).map((file) => ({
  file,
  rel: rel(file),
  source: fs.readFileSync(file, 'utf8')
}));
const fetchedFiles = sourceFiles
  .map((entry) => ({ ...entry, calls: findFetchCalls(entry.source) }))
  .filter((entry) => entry.calls.length > 0);

describe('Every client request to the voting server goes through services/api.js', () => {
  test('1. exactly one fetch exists in src/, and it is the helper', () => {
    const offenders = fetchedFiles.map((entry) => ({ rel: entry.rel, count: entry.calls.length }));

    assert.deepStrictEqual(
      offenders,
      [{ rel: API_MODULE, count: 1 }],
      `all own-server requests must go through ${API_MODULE}; found raw fetch calls in:\n` +
        offenders.map((o) => `${o.rel}:${o.count}`).join('\n')
    );
  });

  test("2. the helper sets credentials: 'include' and targets this app's own server", () => {
    const helper = fetchedFiles.find((entry) => entry.rel === API_MODULE);
    assert.ok(helper, `${API_MODULE} should own the single fetch`);

    for (const call of helper.calls) {
      assert.match(
        call.args,
        /credentials\s*:\s*['"]include['"]/,
        `${API_MODULE}:${call.line} must set credentials: 'include' so the vs_voter cookie travels`
      );
    }

    // Credentials must only ever go to the voting server, never a third party.
    assert.ok(helper.source.includes('SERVER_URL'), `${API_MODULE} must build its URL from SERVER_URL`);
  });

  test('3. any module that names an /api/ path routes through the helper', () => {
    // List free: whatever file builds a server path must use apiRequest, so a
    // newly added module cannot quietly use its own request mechanism.
    const offenders = sourceFiles
      .filter((entry) => entry.source.includes('/api/') && !entry.source.includes('apiRequest'))
      .map((entry) => entry.rel);

    assert.deepStrictEqual(offenders, [], `these modules name an /api/ path without using the helper:\n${offenders.join('\n')}`);
  });

  test('4. every endpoint in the shared contract is reached by its declared client module', () => {
    assert.ok(Array.isArray(CONTRACT.endpoints) && CONTRACT.endpoints.length > 0, 'the shared contract must list endpoints');

    for (const endpoint of CONTRACT.endpoints) {
      const modulePath = path.join(SRC, endpoint.clientModule);
      assert.ok(fs.existsSync(modulePath), `${endpoint.id}: ${endpoint.clientModule} should exist`);
      const source = fs.readFileSync(modulePath, 'utf8');
      assert.ok(
        source.includes('apiRequest'),
        `${endpoint.id}: ${endpoint.clientModule} must call the helper, not fetch directly`
      );
      assert.match(
        source,
        endpointPattern(endpoint.path),
        `${endpoint.id}: ${endpoint.clientModule} must call ${endpoint.method} ${endpoint.path}`
      );
    }
  });

  test('5. the scanner and the contract reader really work, so the tests above are not vacuous', () => {
    const all = fetchedFiles.flatMap((entry) => entry.calls);
    assert.strictEqual(all.length, 1, `the scanner must find exactly the helper fetch, found ${all.length}`);
    // Prove the templated path matcher matches a real interpolation shape.
    assert.ok(
      endpointPattern('/api/sessions/:sessionId/lobby').test('/api/sessions/${encodeURIComponent(id)}/lobby'),
      'the path matcher must match an interpolated client call'
    );
    // Confirm the contract was actually loaded, not silently empty.
    assert.ok(CONTRACT.endpoints.length >= 1, 'the contract should not be empty');
  });
});
