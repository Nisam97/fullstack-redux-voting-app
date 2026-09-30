import { Trophy, Hash, Users } from 'lucide-react';
import { deriveTotals } from './resultsUtils';
import './TotalsPanel.css';

/**
 * TotalsPanel Component (AC-5)
 *
 * Displays cumulative tournament totals below the round timeline accordion:
 * - Total votes per candidate across all completed rounds
 * - Number of rounds played
 * - Overall tournament vote distribution and rankings
 *
 * @param {object} props
 * @param {Array<object>} props.rounds - Array of frozen round snapshots
 */
function TotalsPanel({ rounds = [] }) {
  const {
    totalVotesAllRounds,
    roundsPlayed,
    sortedCandidates
  } = deriveTotals(rounds);

  if (!roundsPlayed || sortedCandidates.length === 0) {
    return null;
  }

  return (
    <section className="totals-panel" aria-label="Tournament Cumulative Totals">
      <div className="totals-panel-header">
        <div className="totals-panel-title-group">
          <div className="totals-panel-icon-wrap" aria-hidden="true">
            <Trophy size={20} className="totals-panel-trophy" />
          </div>
          <div>
            <h2 className="totals-panel-title">Cumulative Tournament Totals</h2>
            <p className="totals-panel-subtitle">
              Aggregate voting metrics across all {roundsPlayed} completed {roundsPlayed === 1 ? 'round' : 'rounds'}.
            </p>
          </div>
        </div>

        <div className="totals-panel-badges">
          <div className="totals-stat-pill">
            <Hash size={14} aria-hidden="true" />
            <span>Rounds Played: <strong>{roundsPlayed}</strong></span>
          </div>
          <div className="totals-stat-pill">
            <Users size={14} aria-hidden="true" />
            <span>Total Votes: <strong>{totalVotesAllRounds.toLocaleString()}</strong></span>
          </div>
        </div>
      </div>

      <div className="totals-leaderboard" role="table" aria-label="Tournament Candidate Standings">
        <div className="totals-table-header" role="row">
          <span className="totals-col-rank" role="columnheader">Rank</span>
          <span className="totals-col-candidate" role="columnheader">Candidate</span>
          <span className="totals-col-votes" role="columnheader">Total Votes</span>
          <span className="totals-col-share" role="columnheader">Vote Share</span>
        </div>

        <div className="totals-table-body" role="rowgroup">
          {sortedCandidates.map((candidate, index) => {
            const isLeader = index === 0;
            return (
              <div
                key={candidate.candidate}
                className={`totals-table-row ${isLeader ? 'is-leader' : ''}`}
                role="row"
              >
                <div className="totals-col-rank" role="cell">
                  <span className={`rank-badge ${index < 3 ? `rank-${index + 1}` : ''}`}>
                    #{index + 1}
                  </span>
                </div>

                <div className="totals-col-candidate" role="cell">
                  <div className="totals-candidate-meta">
                    <span className="totals-candidate-name">{candidate.name}</span>
                    {isLeader && <span className="leader-pill">Overall Leader</span>}
                  </div>
                </div>

                <div className="totals-col-votes" role="cell">
                  <strong>{candidate.votes.toLocaleString()}</strong>
                </div>

                <div className="totals-col-share" role="cell">
                  <div className="totals-share-wrapper">
                    <span className="totals-share-text">{candidate.percentage}%</span>
                    <div className="totals-bar-track" aria-hidden="true">
                      <div
                        className="totals-bar-fill"
                        style={{
                          width: `${candidate.percentage}%`,
                          backgroundColor: candidate.fill
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default TotalsPanel;
