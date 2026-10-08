import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, Award, Users } from 'lucide-react';
import ResultsChart from './ResultsChart';
import { formatResolution, transformTallyToChartData } from './resultsUtils';
import './RoundTimeline.css';

/**
 * RoundTimeline Component (AC-4, AC-6)
 *
 * Renders an expandable accordion timeline of tournament rounds.
 * Each round header displays: "Round N: Candidate A vs Candidate B" and a resolution badge.
 * Expanding reveals the Recharts ResultsChart and per-candidate vote breakdown.
 *
 * @param {object} props
 * @param {Array<object>} props.rounds - Array of frozen round snapshots
 * @param {string|null} [props.winner] - Tournament winner, when one was declared.
 *   `advanced: null` only means the round was the last one, not that someone won,
 *   so the final round notice needs to know whether a winner actually exists.
 */
function RoundTimeline({ rounds = [], winner = null }) {
  // Default first or last round open, or track expanded round indices
  const [expandedIndex, setExpandedIndex] = useState(rounds.length > 0 ? rounds[rounds.length - 1].roundIndex : null);

  if (!Array.isArray(rounds) || rounds.length === 0) {
    return null;
  }

  const toggleRound = (roundIndex) => {
    setExpandedIndex((prev) => (prev === roundIndex ? null : roundIndex));
  };

  return (
    <section className="round-timeline" aria-label="Tournament Round Breakdown">
      <div className="round-timeline-header">
        <h2 className="round-timeline-title">
          <span>Tournament Round Breakdown</span>
          <span className="round-timeline-count">
            {rounds.length} {rounds.length === 1 ? 'Round' : 'Rounds'}
          </span>
        </h2>
        <p className="round-timeline-subtitle">
          Review matchups, settlement resolutions, and vote distributions round by round.
        </p>
      </div>

      <div className="round-timeline-list" role="region" aria-label="Round by Round Accordion">
        {rounds.map((round) => {
          const isExpanded = expandedIndex === round.roundIndex;
          const candidates = Array.isArray(round.candidates) ? round.candidates : [];
          const vsText = candidates.length >= 2
            ? (round.kind === 'single_ballot' ? candidates.join(', ') : `${candidates[0]} vs ${candidates[1]}`)
            : 'Matchup';
          const chartData = transformTallyToChartData(round.candidates, round.tally);
          const resolutionLabel = formatResolution(round.resolution);
          const roundKeyId = `round-accordion-${round.roundIndex}`;

          return (
            <div
              key={round.roundIndex}
              className={`round-accordion-item ${isExpanded ? 'is-expanded' : ''}`}
            >
              <button
                type="button"
                className="round-accordion-trigger"
                onClick={() => toggleRound(round.roundIndex)}
                aria-expanded={isExpanded}
                aria-controls={`panel-${roundKeyId}`}
                id={`trigger-${roundKeyId}`}
              >
                <div className="round-accordion-meta">
                  <span className="round-number-badge">Round {round.roundIndex}</span>
                  <span className="round-matchup-title">{vsText}</span>
                </div>

                <div className="round-accordion-right">
                  <span className={`resolution-badge resolution-${round.resolution || 'default'}`}>
                    {resolutionLabel}
                  </span>
                  <span className="round-accordion-chevron" aria-hidden="true">
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div
                  id={`panel-${roundKeyId}`}
                  role="region"
                  aria-labelledby={`trigger-${roundKeyId}`}
                  className="round-accordion-panel"
                >
                  <div className="round-panel-summary">
                    <div className="round-panel-metric">
                      <Users size={15} aria-hidden="true" />
                      <span>Total Votes Cast: <strong>{round.totalVotes ?? 0}</strong></span>
                    </div>
                    {round.closedAt && (
                      <span className="round-panel-timestamp">
                        Concluded: {new Date(round.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    )}
                  </div>

                  {/* Visual Recharts Bar Chart */}
                  <div className="round-panel-chart">
                    <ResultsChart
                      data={chartData}
                      totalVotes={round.totalVotes}
                      title={`Round ${round.roundIndex} Distribution`}
                    />
                  </div>

                  {/* Candidate Vote Share Cards */}
                  <div className="round-candidates-grid">
                    {chartData.map((cand, idx) => {
                      const isAdvanced = Array.isArray(round.advanced) && round.advanced.includes(cand.candidate);
                      return (
                        <div key={cand.candidate} className={`round-candidate-card ${isAdvanced ? 'advanced' : ''}`}>
                          <div className="round-candidate-top">
                            <span className="round-candidate-name">{cand.candidate}</span>
                            {isAdvanced && (
                              <span className="round-advanced-tag">
                                <CheckCircle size={13} aria-hidden="true" />
                                <span>Advanced</span>
                              </span>
                            )}
                          </div>
                          <div className="round-candidate-stats">
                            <span className="round-candidate-votes">
                              <strong>{cand.votes.toLocaleString()}</strong> votes
                            </span>
                            <span className="round-candidate-pct">{cand.percentage}%</span>
                          </div>
                          <div className="round-candidate-bar-bg" aria-hidden="true">
                            <div
                              className="round-candidate-bar-fill"
                              style={{
                                width: `${cand.percentage}%`,
                                backgroundColor: cand.fill || (idx === 0 ? '#6366f1' : '#ec4899')
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {round.advanced === null && (
                    <div className="round-championship-notice">
                      <Award size={16} aria-hidden="true" />
                      <span>{winner
                        ? 'Championship Round — Winner crowned tournament champion'
                        : 'Final Round — No winner declared'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default RoundTimeline;
