/*
 * Loads the repo-root .env into process.env (values already present in the
 * real environment win). Imported first in index.js so every later module
 * reads a complete environment. No dependency, works on Node 18+, and a
 * missing .env is simply skipped.
 *
 * .env lookup order relative to THIS file:
 *   voting-server/.env  (package-local, if present)
 *   .env                (repo root, the documented location)
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(envPath) {
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return false;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

const here = path.join(__dirname, '..');
// Upward search stops at the filesystem root so the server also works when
// installed or copied into a deeper layout.
let dir = here;
for (;;) {
  if (loadEnvFile(path.join(dir, '.env'))) {
    if (dir !== here) {
      // A repo-root file only fills in what the package-local file omitted.
      loadEnvFile(path.join(here, '.env'));
    }
    break;
  }
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
