import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SINGLE_BALLOT_MAX } from '../src/constants.js';

describe('Phase 1: Admin Create Form Live Mode Note (AC-5)', () => {
  it('exports SINGLE_BALLOT_MAX equal to 6', () => {
    assert.equal(SINGLE_BALLOT_MAX, 6);
  });

  function deriveModeNote(entriesText) {
    const candidateCount = Array.from(
      new Set(
        entriesText
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      )
    ).length;

    return candidateCount > SINGLE_BALLOT_MAX
      ? '7 or more candidates: Tournament'
      : '2 to 6 candidates: Single Ballot';
  }

  it('displays "2 to 6 candidates: Single Ballot" for 2 to 6 candidates', () => {
    assert.equal(deriveModeNote('Alpha\nBeta'), '2 to 6 candidates: Single Ballot');
    assert.equal(deriveModeNote('Alpha, Beta, Gamma'), '2 to 6 candidates: Single Ballot');
    assert.equal(deriveModeNote('1\n2\n3\n4\n5\n6'), '2 to 6 candidates: Single Ballot');
  });

  it('displays "7 or more candidates: Tournament" for 7 or more candidates', () => {
    assert.equal(deriveModeNote('1\n2\n3\n4\n5\n6\n7'), '7 or more candidates: Tournament');
    assert.equal(deriveModeNote('A, B, C, D, E, F, G, H, I, J'), '7 or more candidates: Tournament');
  });

  it('deduplicates entries when deriving candidate count', () => {
    // 7 raw lines but only 3 unique entries -> Single Ballot
    const textWithDuplicates = 'Alpha\nBeta\nGamma\nAlpha\nBeta\nGamma\nAlpha';
    assert.equal(deriveModeNote(textWithDuplicates), '2 to 6 candidates: Single Ballot');
  });

  it('handles empty lines and whitespace padding correctly', () => {
    const paddedText = '   \n  Alpha   \n\n  Beta  \n  \n';
    assert.equal(deriveModeNote(paddedText), '2 to 6 candidates: Single Ballot');
  });

  it('properly transitions mode note at the 6 to 7 boundary', () => {
    const sixCandidates = '1, 2, 3, 4, 5, 6';
    const sevenCandidates = '1, 2, 3, 4, 5, 6, 7';
    assert.equal(deriveModeNote(sixCandidates), '2 to 6 candidates: Single Ballot');
    assert.equal(deriveModeNote(sevenCandidates), '7 or more candidates: Tournament');
  });
});
