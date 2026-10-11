// Renders the shared cookie-gated endpoint contract into the markdown table
// that docs/API_CONTRACT.md embeds. Both the generator script and the sync test
// import this module, so the human-readable doc and the machine-readable
// contract are produced and checked by the same code and cannot drift.

export const MARKER_BEGIN = '<!-- BEGIN GENERATED: cookie-gated-endpoints -->';
export const MARKER_END = '<!-- END GENERATED: cookie-gated-endpoints -->';

/** One sentence describing how an endpoint refuses a caller without the cookie. */
function describeRejection(rejection) {
  if (!rejection) return '';
  if (rejection.error) return `${rejection.status} \`${rejection.error}\``;
  if (rejection.neutral) return `${rejection.status} (byte-identical to an unknown id)`;
  return String(rejection.status);
}

/**
 * Renders the table body (no leading or trailing newline) for a contract.
 *
 * @param {{ endpoints: Array<Object> }} contract
 * @returns {string}
 */
export function renderCookieGatedTable(contract) {
  const rows = (contract.endpoints || []).map((endpoint) =>
    `| \`${endpoint.method}\` | \`${endpoint.path}\` | \`${endpoint.clientModule}\` | ${describeRejection(endpoint.rejection)} |`
  );
  return [
    '| Method | Path | Client module | Rejection without the cookie |',
    '| --- | --- | --- | --- |',
    ...rows
  ].join('\n');
}

/** Returns the text currently between the markers, or null when they are absent. */
export function extractTable(docText) {
  const begin = docText.indexOf(MARKER_BEGIN);
  const end = docText.indexOf(MARKER_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  return docText.slice(begin + MARKER_BEGIN.length, end);
}

/**
 * Rebuilds the document with the table placed between the markers, preserving
 * the file's existing newline style so a regeneration does not rewrite the
 * whole file.
 *
 * @param {string} docText
 * @param {string} tableMarkdown
 * @returns {{ ok: boolean, reason?: string, text?: string }}
 */
export function applyTableToMarkdown(docText, tableMarkdown) {
  const begin = docText.indexOf(MARKER_BEGIN);
  const end = docText.indexOf(MARKER_END);
  if (begin === -1 || end === -1 || end < begin) {
    return { ok: false, reason: 'markers missing' };
  }
  const eol = docText.includes('\r\n') ? '\r\n' : '\n';
  const before = docText.slice(0, begin + MARKER_BEGIN.length);
  const after = docText.slice(end);
  return {
    ok: true,
    text: `${before}${eol}${tableMarkdown.replace(/\n/g, eol)}${eol}${after}`
  };
}
