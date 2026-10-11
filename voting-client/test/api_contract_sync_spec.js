import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderCookieGatedTable,
  applyTableToMarkdown,
  extractTable,
  MARKER_BEGIN,
  MARKER_END
} from '../../scripts/api-contract-table.mjs';

// The shared contract is the machine-readable list both the client credentials
// audit and the server rejection spec read. This spec guards its human-readable
// mirror: docs/API_CONTRACT.md must carry exactly the table the contract
// generates. Editing the contract without regenerating the doc fails here, so
// humans and tests read the same list.
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const CONTRACT_PATH = path.join(ROOT, 'contracts', 'cookie-gated-endpoints.json');
const DOC_PATH = path.join(ROOT, 'docs', 'API_CONTRACT.md');

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const doc = fs.readFileSync(DOC_PATH, 'utf8');

describe('docs/API_CONTRACT.md mirrors the shared cookie-gated contract', () => {
  test('1. the doc carries the generated table block', () => {
    assert.ok(doc.includes(MARKER_BEGIN), 'the doc needs the BEGIN marker');
    assert.ok(doc.includes(MARKER_END), 'the doc needs the END marker');
    const current = extractTable(doc);
    assert.ok(current !== null, 'the markers must surround a table body');
    assert.match(current, /\| Method \| Path \| Client module \|/, 'the block should hold the table header');
  });

  test('2. the embedded table is exactly what the contract generates', () => {
    const expected = applyTableToMarkdown(doc, renderCookieGatedTable(contract));
    assert.ok(expected.ok, expected.reason);
    assert.strictEqual(
      expected.text,
      doc,
      'docs/API_CONTRACT.md is stale; run: node scripts/generate-api-contract-table.mjs'
    );
  });

  test('3. the guard is not vacuous: the table lists every contract endpoint', () => {
    const table = extractTable(doc);
    for (const endpoint of contract.endpoints) {
      assert.ok(table.includes(`\`${endpoint.path}\``), `the table should list ${endpoint.path}`);
    }
    const rows = table.split('\n').filter((line) => line.startsWith('| `'));
    assert.strictEqual(rows.length, contract.endpoints.length, 'the table must have one row per contract endpoint');
  });
});
