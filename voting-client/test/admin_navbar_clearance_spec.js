import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The navbar is `position: fixed`, so it takes no space in the document flow.
// The admin page's first block is the header holding the "Create New Session"
// button, and when `.admin-main` reserved less top padding than the bar is tall
// that button was laid out underneath the navbar. The failure was invisible:
// the bar's translucent background let the button show through, but every click
// in that area hit-tests to the navbar instead, and the button's rectangle
// overlaps Logout, so the button signed the admin out. This pins the clearance
// budget and the DOM placement that make the offset apply.
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');

const ADMIN_CSS = fs.readFileSync(path.join(SRC, 'pages/Admin.css'), 'utf8');
const NAVBAR_CSS = fs.readFileSync(path.join(SRC, 'components/layout/Navbar.css'), 'utf8');
const ADMIN_JSX = fs.readFileSync(path.join(SRC, 'pages/Admin.jsx'), 'utf8');

// Measured in the running app at 1440/1200/1024/820/600/400 CSS px with the
// admin chip in the bar: the navbar's auto height is a constant 92px, because
// its content never wraps. `padding: 20px 8%` plus a 52px content box.
const NAVBAR_HEIGHT_PX = 92;

/**
 * Returns the declaration block for a selector, or null when the stylesheet has
 * no such rule. Only the top level rules in these two files are needed, and
 * neither selector is nested, so the body ends at the first closing brace.
 */
function ruleBody(css, selector) {
  const match = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{`).exec(css);
  if (!match) return null;
  const open = match.index + match[0].length;
  const close = css.indexOf('}', open);
  if (close === -1) return null;
  return css.slice(open, close);
}

/** Resolves the first (top) value of a `padding` shorthand to pixels. */
function paddingTopPx(body) {
  const shorthand = /(?:^|[;{\s])padding\s*:\s*([^;]+);/.exec(body);
  if (shorthand) {
    const tokens = shorthand[1].trim().split(/\s+/);
    if (tokens.length === 1) return toPx(tokens[0]);
    return toPx(tokens[0]);
  }
  const top = /(?:^|[;{\s])padding-top\s*:\s*([^;]+);/.exec(body);
  return top ? toPx(top[1].trim()) : null;
}

function toPx(value) {
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return null;
  if (value.endsWith('rem')) return num * 16;
  if (value.endsWith('em')) return num * 16;
  if (value.endsWith('px')) return num;
  return num;
}

describe('Admin page clears the fixed navbar', () => {
  test('1. the navbar really is out of flow, which is why an offset is needed', () => {
    const body = ruleBody(NAVBAR_CSS, '.navbar');
    assert.ok(body, 'Navbar.css should define a .navbar rule');
    assert.match(
      body,
      /position\s*:\s*fixed/,
      'the navbar is expected to be fixed; if it returns to the flow this offset can be revisited'
    );
  });

  test('2. .admin-main reserves at least the navbar height above the header', () => {
    const body = ruleBody(ADMIN_CSS, '.admin-main');
    assert.ok(body, 'Admin.css should define a .admin-main rule');
    const top = paddingTopPx(body);
    assert.ok(top !== null, 'admin-main must declare a numeric top padding');
    assert.ok(
      top >= NAVBAR_HEIGHT_PX,
      `admin-main top padding ${top}px does not clear the ${NAVBAR_HEIGHT_PX}px navbar, so the header create button renders underneath it`
    );
  });

  test('3. the header create button is inside main.admin-main, so the offset governs it', () => {
    const mainIndex = ADMIN_JSX.indexOf('className="admin-main"');
    assert.ok(mainIndex !== -1, 'Admin.jsx should render <main className="admin-main">');
    const buttonIndex = ADMIN_JSX.indexOf('data-testid="admin-create-session-btn"');
    assert.ok(buttonIndex !== -1, 'Admin.jsx should render the header create button');
    assert.ok(
      buttonIndex > mainIndex,
      'the header create button must render after main.admin-main opens, otherwise no page padding can lift it off the navbar'
    );

    // The button sits in the header row, which only wraps below the navbar when
    // the viewport is narrow. Above the wrap point both share one row, which is
    // the case the clearance budget above is for.
    const headerIndex = ADMIN_JSX.indexOf('className="admin-header"');
    assert.ok(headerIndex !== -1 && headerIndex < buttonIndex, 'the create button belongs to the admin header row');
  });
});
