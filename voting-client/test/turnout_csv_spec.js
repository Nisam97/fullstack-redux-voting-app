import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnoutCsv, turnoutCsvFilename } from '../src/components/results/resultsUtils.js';

// The admin per round turnout export (spec 0008 follow up). The CSV is built in
// the browser from the payload the admin already has, so these tests are the
// only thing standing between a display name and a spreadsheet formula.

const TURNOUT = [
  {
    roundIndex: 1,
    roundId: 'sess_x:::r1',
    voters: [
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' }
    ]
  },
  { roundIndex: 2, roundId: 'sess_x:::r2', voters: [] }
];

const lines = (csv) => csv.split('\r\n');

describe('Turnout CSV export', () => {
  it('writes a header and one row per signed in voter', () => {
    const rows = lines(buildTurnoutCsv(TURNOUT));

    assert.strictEqual(rows[0], 'roundIndex,roundId,voterCount,voterName,email');
    assert.strictEqual(rows[1], '1,sess_x:::r1,2,Alice,alice@example.com');
    assert.strictEqual(rows[2], '1,sess_x:::r1,2,Bob,bob@example.com');
  });

  it('keeps a zero turnout round instead of dropping it', () => {
    const rows = lines(buildTurnoutCsv(TURNOUT));

    // AC-7 promises every round appears, empty list included. A round that
    // vanishes from the export is a round an admin cannot audit.
    assert.strictEqual(rows.length, 4);
    assert.strictEqual(rows[3], '2,sess_x:::r2,0,,');
  });

  it('never carries a vote choice, only who voted', () => {
    // AC-7 and AC-10: turnout records who voted in a round and never what they
    // chose. The column names are compared exactly, because "voterName" and
    // "voterCount" legitimately contain the letters of "vote".
    const columns = lines(buildTurnoutCsv(TURNOUT))[0].split(',');

    assert.deepStrictEqual(columns, [
      'roundIndex', 'roundId', 'voterCount', 'voterName', 'email'
    ]);

    for (const banned of ['vote', 'choice', 'winner', 'tally', 'pair', 'selected', 'entry']) {
      assert.ok(
        !columns.includes(banned),
        `the export must not carry a "${banned}" column, found ${columns.join(',')}`
      );
    }
  });

  it('quotes a cell holding a comma, a quote, or a line break', () => {
    const csv = buildTurnoutCsv([
      {
        roundIndex: 1,
        roundId: 'sess_x:::r1',
        voters: [{ name: 'Smith, Alice "Al"', email: 'a@example.com' }]
      }
    ]);

    assert.ok(csv.includes('"Smith, Alice ""Al"""'), `comma and quote must be escaped: ${csv}`);
  });

  it('neutralises a display name that would be read as a spreadsheet formula', () => {
    // Voter names are attacker controlled and this file is opened in Excel by
    // an admin, so a leading = + - or @ is prefixed with an apostrophe rather
    // than evaluated on open.
    for (const name of ['=1+1', '+1', '-1+1', '@SUM(A1)']) {
      const csv = buildTurnoutCsv([
        { roundIndex: 1, roundId: 'r1', voters: [{ name, email: 'a@example.com' }] }
      ]);
      assert.ok(
        csv.includes(`,'${name},`),
        `${name} must carry the leading apostrophe guard, got: ${csv}`
      );
    }

    // A name with no leading metacharacter is left exactly as it was.
    const plain = buildTurnoutCsv([
      { roundIndex: 1, roundId: 'r1', voters: [{ name: 'Alice', email: 'a@example.com' }] }
    ]);
    assert.ok(plain.includes(',Alice,'), `a plain name must not be altered: ${plain}`);
  });

  it('returns just a header for no rounds, and never throws on bad input', () => {
    assert.strictEqual(buildTurnoutCsv([]), 'roundIndex,roundId,voterCount,voterName,email');
    assert.strictEqual(buildTurnoutCsv(undefined), 'roundIndex,roundId,voterCount,voterName,email');
    assert.strictEqual(buildTurnoutCsv(null), 'roundIndex,roundId,voterCount,voterName,email');
    assert.strictEqual(buildTurnoutCsv('nonsense'), 'roundIndex,roundId,voterCount,voterName,email');

    // A round with no voters array is treated as zero turnout, not a crash.
    const rows = lines(buildTurnoutCsv([{ roundIndex: 3, roundId: 'r3' }]));
    assert.strictEqual(rows[1], '3,r3,0,,');
  });

  it('falls back to a blank name when the voter has none', () => {
    const csv = buildTurnoutCsv([
      { roundIndex: 1, roundId: 'r1', voters: [{ email: 'a@example.com' }] }
    ]);

    // The row must still hold five columns, so a nameless voter does not shift
    // the email one place to the left.
    const row = lines(csv)[1];
    assert.strictEqual(row.split(',').length, 5, `a missing name must not shift the columns: ${row}`);
    assert.strictEqual(row, '1,r1,1,,a@example.com');
  });

  it('preserves the order the server sent rather than re-sorting', () => {
    const csv = buildTurnoutCsv([
      { roundIndex: 2, roundId: 'b', voters: [] },
      { roundIndex: 1, roundId: 'a', voters: [] }
    ]);
    const rows = lines(csv);

    assert.strictEqual(rows[1], '2,b,0,,');
    assert.strictEqual(rows[2], '1,a,0,,');
  });

  it('builds a filename that cannot escape the downloads folder', () => {
    assert.strictEqual(turnoutCsvFilename('sess_x'), 'turnout-sess_x.csv');
    assert.strictEqual(
      turnoutCsvFilename('../../etc/passwd'),
      'turnout-etc-passwd.csv',
      'path separators must not survive into the filename'
    );
    assert.strictEqual(turnoutCsvFilename(''), 'turnout-session.csv');
    assert.strictEqual(turnoutCsvFilename(undefined), 'turnout-session.csv');
  });
});