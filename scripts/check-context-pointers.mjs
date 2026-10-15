// Fails when a context file points at a path that does not exist, so a dead
// pointer surfaces in CI rather than in a later audit. Run it directly:
//
//   node scripts/check-context-pointers.mjs
//
// It reads every AGENTS.md and CLAUDE.md in the tree, collects the markdown
// links and the backticked path references in each one, and resolves them
// against the repository root for a reference that starts with a top level
// directory, and against the referencing file's own directory and its `src/`
// otherwise, since these docs also name a module as `services/auth.js`.
// A reference with no slash, such as `store.js`, counts as resolved when a file
// of that name exists anywhere in the tree, because prose names a module by its
// basename.
//
// A reference that resolves nowhere fails the run, with one exception: a target
// inside a gitignored tree (the installed Agent skills live in .agents/ and
// .claude/) cannot be verified from a fresh checkout, so it is reported as a
// notice and does not fail the build. Everything else fails closed. If git
// cannot answer the ignore question at all, the missing reference counts as a
// failure.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

const CONTEXT_FILE = /^(AGENTS|CLAUDE)\.md$/;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const EXTENSIONS = [
  '.md', '.js', '.jsx', '.cjs', '.mjs', '.json', '.css', '.html',
  '.yml', '.yaml', '.ps1', '.ts', '.tsx', '.env', '.example'
];
// Documented shape patterns rather than real paths: the spec directory naming
// rule, and the Vitest file suffix. Add a line here when a context file cites a
// new documented pattern, and nowhere else.
const TEMPLATE_TOKENS = new Set(['docs/specs/NNNN-title.md', 'docs/specs/NNNN-title/', '.test.jsx']);

const LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const TICKED = /`([^`\n]+)`/g;

/** Every path in the tree, relative to the repository root, with `/` separators. */
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    acc.push(path.relative(ROOT, abs).split(path.sep).join('/'));
    if (entry.isDirectory()) walk(abs, acc);
  }
  return acc;
}

const ALL_PATHS = walk(ROOT);
const EXISTING = new Set(ALL_PATHS);
const TOP_LEVEL = new Set(ALL_PATHS.filter((p) => !p.includes('/')));
const BASENAMES = new Set(ALL_PATHS.map((p) => p.split('/').pop()));
const CONTEXT_FILES = ALL_PATHS
  .filter((p) => CONTEXT_FILE.test(p.split('/').pop()))
  .sort();

/** A reference is path-like when it can only be naming something in this repository. */
function looksLikePath(token, fileDir) {
  if (!token) return false;
  // Globs, shell metacharacters, placeholders and quoting are all non-paths.
  if (/[\s*?<>{}|$`'"]/.test(token)) return false;
  if (token.includes(':') || token.includes('#')) return false;
  // App routes (/join), home-relative paths (~/.x) and the `node:` prefix.
  if (token.startsWith('/') || token.startsWith('~')) return false;
  if (token === '.' || token === '..') return false;
  if (TEMPLATE_TOKENS.has(token)) return false;

  const hasSlash = token.includes('/');
  const hasExtension = EXTENSIONS.includes(path.extname(token).toLowerCase());
  if (!hasSlash && !hasExtension) return false;
  if (hasSlash && !hasExtension && !token.endsWith('/')) {
    // A registry source such as `owner/repo` names no path here.
    const [first] = token.split('/');
    const known = TOP_LEVEL.has(first)
      || fs.existsSync(path.resolve(fileDir, token))
      || fs.existsSync(path.resolve(ROOT, token));
    if (!known) return false;
  }
  return true;
}

/** The root-relative path a reference is most likely naming, for reporting. */
function intendedPath(token, file) {
  const fileDir = path.dirname(path.resolve(ROOT, file));
  const [first] = token.split('/');
  // A top level entry, and a dot directory such as .agents or .claude, is
  // named from the repository root. A `..` step and anything else is named
  // from the file, which is how a nested doc reaches ../.agents/skills/<x>/.
  const fromRoot = TOP_LEVEL.has(first) || (first.startsWith('.') && first !== '..');
  const base = fromRoot ? ROOT : fileDir;
  return path.relative(ROOT, path.resolve(base, token)).split(path.sep).join('/').replace(/\/$/, '');
}

/** True when the reference resolves near the file, under its src/, at the root, or by basename. */
function resolves(token, file) {
  if (!token.includes('/')) return BASENAMES.has(token);
  const fileDir = path.dirname(path.resolve(ROOT, file));
  for (const base of [fileDir, path.join(fileDir, 'src'), ROOT]) {
    const rel = path.relative(ROOT, path.resolve(base, token)).split(path.sep).join('/');
    if (EXISTING.has(rel) || EXISTING.has(rel.replace(/\/$/, ''))) return true;
  }
  return false;
}

/** The subset of these root-relative paths that git ignores, or null if unknown. */
function ignoredByGit(paths) {
  if (paths.length === 0) return new Set();
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: ROOT,
      input: `${paths.join('\n')}\n`,
      encoding: 'utf8',
      // git's own complaint is replaced by the warning this script prints.
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return new Set(out.split('\n').map((line) => line.trim()).filter(Boolean));
  } catch (error) {
    // Exit 1 means "nothing here is ignored", which is a real answer.
    return error.status === 1 ? new Set() : null;
  }
}

let checked = 0;
const missing = [];
for (const file of CONTEXT_FILES) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const fileDir = path.dirname(path.resolve(ROOT, file));
  for (const pattern of [LINK, TICKED]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const token = match[1].trim();
      if (!looksLikePath(token, fileDir)) continue;
      checked += 1;
      if (resolves(token, file)) continue;
      missing.push({
        file,
        line: text.slice(0, match.index).split('\n').length,
        token,
        target: intendedPath(token, file)
      });
    }
  }
}

// A target that climbs out of the repository cannot be checked at all, and it
// never reaches git: one such path makes git refuse the whole batch.
const escaped = missing.filter((item) => item.target.startsWith('..'));
const inRoot = missing.filter((item) => !item.target.startsWith('..'));
const ignored = ignoredByGit([...new Set(inRoot.map((item) => item.target))]);
const unverifiable = ignored instanceof Set ? inRoot.filter((item) => ignored.has(item.target)) : [];
const failed = [...escaped, ...inRoot.filter((item) => !unverifiable.includes(item))];

const summary = `Context pointers: ${CONTEXT_FILES.length} files, ${checked} references checked`;
if (ignored === null) {
  console.error('warning: git could not report ignored paths, so a gitignored target counts as a failure');
}
// A gitignored reference is worth reading when its tree is present and the
// subpath is gone, which is real drift. When the whole tree is absent, as it is
// in a fresh checkout, the references are collapsed into one line so they do
// not bury the run.
const drifted = unverifiable.filter((item) => fs.existsSync(path.join(ROOT, item.target.split('/')[0])));
const absent = unverifiable.filter((item) => !drifted.includes(item));
for (const item of drifted) {
  console.log(`notice: ${item.file}:${item.line} -> ${item.token} (${item.target} is gitignored and missing here)`);
}
if (absent.length > 0) {
  const roots = [...new Set(absent.map((item) => item.target.split('/')[0]))].sort();
  console.log(`note: ${absent.length} references point into ${roots.map((r) => `${r}/`).join(' or ')}, which a fresh checkout does not carry.`);
}
if (failed.length === 0) {
  console.log(`${summary}, every one of them resolves.`);
  process.exit(0);
}

console.error(`${summary}, ${failed.length} do not resolve:`);
for (const item of failed) {
  const why = item.target.startsWith('..')
    ? `${item.target} points outside the repository`
    : `${item.target} does not exist`;
  console.error(`  ${item.file}:${item.line} -> ${item.token} (${why})`);
}
console.error('Fix the pointer, or add a documented shape pattern to TEMPLATE_TOKENS in this script.');
process.exit(1);
