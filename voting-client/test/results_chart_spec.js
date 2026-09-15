import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePercentage,
  transformTallyToChartData,
  getPairwiseSummary,
  CONTENDER_COLORS
} from '../src/components/results/resultsUtils.js';

describe('Feature 5 — Stage A: Results Chart Data Transformation & Architecture', () => {

  describe('1. Pure Results Data Transformation (transformTallyToChartData)', () => {

    it('Test 1 — Normal Pair: converts tally to chart data with exact counts and percentages', () => {
      const pair = ['Trainspotting', '28 Days Later'];
      const tally = {
        Trainspotting: 10,
        '28 Days Later': 5
      };

      const chartData = transformTallyToChartData(pair, tally);

      assert.strictEqual(chartData.length, 2);

      // Candidate 0: Trainspotting
      assert.strictEqual(chartData[0].candidate, 'Trainspotting');
      assert.strictEqual(chartData[0].name, 'Trainspotting');
      assert.strictEqual(chartData[0].votes, 10);
      assert.strictEqual(chartData[0].percentage, 66.7);
      assert.strictEqual(chartData[0].fill, CONTENDER_COLORS[0]);

      // Candidate 1: 28 Days Later
      assert.strictEqual(chartData[1].candidate, '28 Days Later');
      assert.strictEqual(chartData[1].name, '28 Days Later');
      assert.strictEqual(chartData[1].votes, 5);
      assert.strictEqual(chartData[1].percentage, 33.3);
      assert.strictEqual(chartData[1].fill, CONTENDER_COLORS[1]);
    });

    it('Test 2 — Zero Votes: handles 0 votes safely returning 0% without NaN or Infinity', () => {
      const pair = ['Trainspotting', '28 Days Later'];
      const tally = {
        Trainspotting: 0,
        '28 Days Later': 0
      };

      const chartData = transformTallyToChartData(pair, tally);

      assert.strictEqual(chartData.length, 2);

      assert.strictEqual(chartData[0].votes, 0);
      assert.strictEqual(chartData[0].percentage, 0);
      assert.strictEqual(Number.isNaN(chartData[0].percentage), false);
      assert.strictEqual(Number.isFinite(chartData[0].percentage), true);

      assert.strictEqual(chartData[1].votes, 0);
      assert.strictEqual(chartData[1].percentage, 0);
      assert.strictEqual(Number.isNaN(chartData[1].percentage), false);
      assert.strictEqual(Number.isFinite(chartData[1].percentage), true);
    });

    it('Test 3 — Numerical Fidelity: preserves authoritative server tally without mutation or drift', () => {
      const pair = ['Candidate Alpha', 'Candidate Beta'];
      const serverTally = {
        'Candidate Alpha': 7,
        'Candidate Beta': 3
      };

      const chartData = transformTallyToChartData(pair, serverTally);

      // Verify exact counts match server values
      assert.strictEqual(chartData[0].votes, serverTally['Candidate Alpha']);
      assert.strictEqual(chartData[1].votes, serverTally['Candidate Beta']);

      // Verify exact percentages: 7/10 = 70.0%, 3/10 = 30.0%
      assert.strictEqual(chartData[0].percentage, 70.0);
      assert.strictEqual(chartData[1].percentage, 30.0);

      // Verify server tally object was not mutated
      assert.strictEqual(serverTally['Candidate Alpha'], 7);
      assert.strictEqual(serverTally['Candidate Beta'], 3);
    });

    it('Test 4 — Candidate Names: preserves candidate names and ordering exactly', () => {
      const complexPair = [
        'Dr. Strangelove (or: How I Learned to Stop Worrying)',
        '2001: A Space Odyssey'
      ];
      const tally = {
        'Dr. Strangelove (or: How I Learned to Stop Worrying)': 14,
        '2001: A Space Odyssey': 22
      };

      const chartData = transformTallyToChartData(complexPair, tally);

      assert.strictEqual(chartData[0].candidate, complexPair[0]);
      assert.strictEqual(chartData[0].name, complexPair[0]);
      assert.strictEqual(chartData[1].candidate, complexPair[1]);
      assert.strictEqual(chartData[1].name, complexPair[1]);
    });

    it('Single vote scenario: handles 1 total vote resulting in 100% and 0%', () => {
      const pair = ['A', 'B'];
      const tally = { A: 1, B: 0 };

      const chartData = transformTallyToChartData(pair, tally);

      assert.strictEqual(chartData[0].votes, 1);
      assert.strictEqual(chartData[0].percentage, 100);
      assert.strictEqual(chartData[1].votes, 0);
      assert.strictEqual(chartData[1].percentage, 0);
    });

    it('Tied votes scenario: handles equal votes with 50.0% split', () => {
      const pair = ['A', 'B'];
      const tally = { A: 4, B: 4 };

      const chartData = transformTallyToChartData(pair, tally);

      assert.strictEqual(chartData[0].votes, 4);
      assert.strictEqual(chartData[0].percentage, 50.0);
      assert.strictEqual(chartData[1].votes, 4);
      assert.strictEqual(chartData[1].percentage, 50.0);
    });

    it('Missing candidate in tally: defaults missing count to 0', () => {
      const pair = ['A', 'B'];
      const tally = { A: 5 }; // B omitted from tally

      const chartData = transformTallyToChartData(pair, tally);

      assert.strictEqual(chartData[0].votes, 5);
      assert.strictEqual(chartData[0].percentage, 100);
      assert.strictEqual(chartData[1].votes, 0);
      assert.strictEqual(chartData[1].percentage, 0);
    });

    it('Empty and invalid inputs: safely returns empty array', () => {
      assert.deepStrictEqual(transformTallyToChartData([], {}), []);
      assert.deepStrictEqual(transformTallyToChartData(null, {}), []);
      assert.deepStrictEqual(transformTallyToChartData(undefined, {}), []);
      assert.deepStrictEqual(transformTallyToChartData(['A', 'B'], null), [
        { candidate: 'A', name: 'A', votes: 0, percentage: 0, fill: CONTENDER_COLORS[0] },
        { candidate: 'B', name: 'B', votes: 0, percentage: 0, fill: CONTENDER_COLORS[1] }
      ]);
    });
  });

  describe('2. Percentage Arithmetic Utility (calculatePercentage)', () => {
    it('calculates rounded 1-decimal percentage accurately', () => {
      assert.strictEqual(calculatePercentage(2, 3), 66.7);
      assert.strictEqual(calculatePercentage(1, 3), 33.3);
      assert.strictEqual(calculatePercentage(1, 2), 50.0);
      assert.strictEqual(calculatePercentage(3, 4), 75.0);
    });

    it('returns 0 for zero or negative total votes', () => {
      assert.strictEqual(calculatePercentage(0, 0), 0);
      assert.strictEqual(calculatePercentage(5, 0), 0);
      assert.strictEqual(calculatePercentage(5, -10), 0);
      assert.strictEqual(calculatePercentage(-1, 10), 0);
    });

    it('returns 0 for NaN or non-number inputs', () => {
      assert.strictEqual(calculatePercentage(NaN, 10), 0);
      assert.strictEqual(calculatePercentage(5, NaN), 0);
      assert.strictEqual(calculatePercentage('5', 10), 0);
      assert.strictEqual(calculatePercentage(null, undefined), 0);
    });
  });

  describe('3. Pairwise Summary Metrics (getPairwiseSummary)', () => {
    it('identifies leader, margin, and totalVotes correctly', () => {
      const summary = getPairwiseSummary(['Alpha', 'Beta'], { Alpha: 12, Beta: 8 });
      assert.strictEqual(summary.totalVotes, 20);
      assert.strictEqual(summary.isTie, false);
      assert.strictEqual(summary.leader, 'Alpha');
      assert.strictEqual(summary.margin, 4);
      assert.strictEqual(summary.chartData.length, 2);
    });

    it('identifies ties correctly with leader null and margin 0', () => {
      const summary = getPairwiseSummary(['Alpha', 'Beta'], { Alpha: 6, Beta: 6 });
      assert.strictEqual(summary.totalVotes, 12);
      assert.strictEqual(summary.isTie, true);
      assert.strictEqual(summary.leader, null);
      assert.strictEqual(summary.margin, 0);
    });

    it('handles single candidate or empty array gracefully', () => {
      const single = getPairwiseSummary(['Solo'], { Solo: 3 });
      assert.strictEqual(single.totalVotes, 3);
      assert.strictEqual(single.leader, 'Solo');
      assert.strictEqual(single.isTie, false);

      const empty = getPairwiseSummary([], {});
      assert.strictEqual(empty.totalVotes, 0);
      assert.strictEqual(empty.leader, null);
      assert.strictEqual(empty.isTie, false);
    });
  });

  describe('4. Chart Component Props Contract', () => {
    it('Test 5 — verifies that chart data items satisfy the presentation contract expected by ResultsChart', () => {
      const pair = ['Trainspotting', '28 Days Later'];
      const tally = { Trainspotting: 9, '28 Days Later': 3 };

      const chartData = transformTallyToChartData(pair, tally);

      // Verify every chart data item has the exact schema required by ResultsChart
      chartData.forEach((item) => {
        assert.strictEqual(typeof item.candidate, 'string');
        assert.strictEqual(typeof item.name, 'string');
        assert.strictEqual(typeof item.votes, 'number');
        assert.strictEqual(typeof item.percentage, 'number');
        assert.strictEqual(typeof item.fill, 'string');
        assert.ok(item.fill.startsWith('#'), 'Color fill must be a valid hex color string');
      });

      const totalVotes = chartData.reduce((sum, item) => sum + item.votes, 0);
      assert.strictEqual(totalVotes, 12);
      assert.strictEqual(chartData[0].percentage, 75.0);
      assert.strictEqual(chartData[1].percentage, 25.0);
    });
  });

});
