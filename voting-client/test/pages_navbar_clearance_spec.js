import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The same fixed-navbar failure the admin page had (see
// admin_navbar_clearance_spec.js) exists on every page that renders a bare
// `<Navbar />`: the bar is `position: fixed`, so it takes no space in the
// document flow and covers the top of `<main>`. Lobby, Results and Voting all
// reserved only 40-60px of top padding, less than the bar is tall, so their
// first block (the lobby card, the results header, the voting header) was laid
// out underneath it. It is not merely hidden: clicks in that strip hit-test to
// the navbar, and the bar's translucent background lets the clipped content
// show through, so the failure reads as overlapping text rather than missing
// padding. This pins the clearance budget on all three pages at once.
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');

// Measured in the running app with the admin chip in the bar: the navbar's auto
// height is a constant 92px, because its content never wraps. `padding: 20px
// 8%` plus a 52px content box. Admin.css and its spec share this number.
const NAVBAR_HEIGHT_PX = 92;

function ruleBody(css, selector) {
  const match = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{`).exec(css);
  if (!match) return null;
  const open = match.index + match[0].length;
  const close = css.indexOf('}', open);
  if (close === -1) return null;
  return css.slice(open, close);
}

function paddingTopPx(body) {
  const shorthand = /(?:^|[;{\s])padding\s*:\s*([^;]+);/.exec(body);
  if (shorthand) {
    return toPx(shorthand[1].trim().split(/\s+/)[0]);
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

const PAGES = [
  {
    name: 'Lobby',
    cssPath: 'pages/Lobby.css',
    jsxPath: 'pages/Lobby.jsx',
    selector: '.lobby-main',
    mainClass: 'lobby-main',
    firstContent: 'className="lobby-card"'
  },
  {
    name: 'Results',
    cssPath: 'pages/Results.css',
    jsxPath: 'pages/Results.jsx',
    selector: '.results-main',
    mainClass: 'results-main',
    firstContent: 'className="results-container"'
  },
  {
    name: 'Voting',
    cssPath: 'pages/Voting.css',
    jsxPath: 'pages/Voting.jsx',
    selector: '.voting-main',
    mainClass: 'voting-main',
    firstContent: 'className="voting-container"'
  }
];

const NAVBAR_CSS = fs.readFileSync(path.join(SRC, 'components/layout/Navbar.css'), 'utf8');

describe('Fixed navbar clearance: a shared contract', () => {
  test('the navbar really is out of flow, which is why every page needs an offset', () => {
    const body = ruleBody(NAVBAR_CSS, '.navbar');
    assert.ok(body, 'Navbar.css should define a .navbar rule');
    assert.match(
      body,
      /position\s*:\s*fixed/,
      'the navbar is expected to be fixed; if it returns to the flow these offsets can be revisited'
    );
  });
});

for (const page of PAGES) {
  describe(`${page.name} page clears the fixed navbar`, () => {
    const css = fs.readFileSync(path.join(SRC, page.cssPath), 'utf8');
    const jsx = fs.readFileSync(path.join(SRC, page.jsxPath), 'utf8');

    test(`.${page.mainClass} reserves at least the navbar height above its first block`, () => {
      const body = ruleBody(css, page.selector);
      assert.ok(body, `${page.cssPath} should define a ${page.selector} rule`);
      const top = paddingTopPx(body);
      assert.ok(top !== null, `${page.selector} must declare a numeric top padding`);
      assert.ok(
        top >= NAVBAR_HEIGHT_PX,
        `${page.selector} top padding ${top}px does not clear the ${NAVBAR_HEIGHT_PX}px navbar, so the first block renders underneath it`
      );
    });

    test('the page renders that main and the first block inside it', () => {
      const mainIndex = jsx.indexOf(`className="${page.mainClass}"`);
      assert.ok(mainIndex !== -1, `${page.jsxPath} should render <main className="${page.mainClass}">`);
      assert.ok(
        jsx.includes('<Navbar />'),
        `${page.jsxPath} must render the fixed navbar it is reserving space for`
      );
      const contentIndex = jsx.indexOf(page.firstContent);
      assert.ok(
        contentIndex !== -1 && contentIndex > mainIndex,
        `${page.firstContent} must render inside main.${page.mainClass}, otherwise no page padding can lift it off the navbar`
      );
    });
  });
}
