// Regenerates the cookie-gated endpoint table in docs/API_CONTRACT.md from the
// shared contract. Run it after editing contracts/cookie-gated-endpoints.json:
//
//   node scripts/generate-api-contract-table.mjs
//   node scripts/generate-api-contract-table.mjs --check   # exit 1 if stale
//
// The sync test in voting-client/test/api_contract_sync_spec.js performs the
// same comparison, so a stale doc fails the suite, not only this command.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCookieGatedTable, applyTableToMarkdown } from './api-contract-table.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const CONTRACT_PATH = path.join(ROOT, 'contracts', 'cookie-gated-endpoints.json');
const DOC_PATH = path.join(ROOT, 'docs', 'API_CONTRACT.md');

const checkOnly = process.argv.includes('--check');

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const doc = fs.readFileSync(DOC_PATH, 'utf8');

const result = applyTableToMarkdown(doc, renderCookieGatedTable(contract));
if (!result.ok) {
  console.error(`Could not find the generated table markers in ${DOC_PATH}: ${result.reason}`);
  process.exit(1);
}

if (result.text === doc) {
  console.log(`Cookie-gated endpoint table is up to date (${contract.endpoints.length} endpoints).`);
  process.exit(0);
}

if (checkOnly) {
  console.error('Cookie-gated endpoint table is out of date. Run: node scripts/generate-api-contract-table.mjs');
  process.exit(1);
}

fs.writeFileSync(DOC_PATH, result.text);
console.log(`Updated the cookie-gated endpoint table in ${path.relative(ROOT, DOC_PATH)} (${contract.endpoints.length} endpoints).`);
