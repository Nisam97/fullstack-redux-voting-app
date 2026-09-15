import { Lock } from "lucide-react";
import "./ResultCard.css";

/**
 * ResultCard Component
 * Displays candidate result metrics: vote count, percentage, progress bar,
 * and optional authoritative winner badge.
 * Presentation-only: does not compute or derive authoritative winners independently.
 *
 * Supports hideStats prop for State A (Voting in progress) to prevent premature tally exposure.
 */
function ResultCard({
  candidate = "",
  party = "",
  votes = 0,
  percentage = 0,
  position = 1,
  totalVotes = 0,
  isWinner = false,
  winnerLabel = "🏆 Winner",
  hideStats = false,
}) {
  const initials = candidate
    ? candidate
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join("")
    : "?";

  const formattedVotes = typeof votes === "number" && votes.toLocaleString ? votes.toLocaleString() : votes;
  const numericPct = typeof percentage === "number" && !Number.isNaN(percentage) ? percentage : 0;
  const clampedPct = Math.min(Math.max(numericPct, 0), 100);

  return (
    <article className={`result-card ${isWinner ? "winner-card" : ""}`} aria-label={`Results for ${candidate}`}>
      {isWinner && (
        <div className="winner-badge" role="status">
          {winnerLabel}
        </div>
      )}

      <div className="result-header">
        <div className="candidate-profile">
          <div className="candidate-avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="candidate-details">
            <h3>{candidate}</h3>
            {party ? <span>{party}</span> : null}
          </div>
        </div>
        <div className="candidate-position" aria-label={`Position ${position}`}>
          #{position}
        </div>
      </div>

      {hideStats ? (
        <div className="result-stats-locked" aria-label="Tallies hidden during voting">
          <div className="result-locked-badge">
            <Lock size={16} aria-hidden="true" />
            <span>Tallies Hidden</span>
          </div>
          <p className="result-locked-hint">Results revealed when round ends</p>
        </div>
      ) : (
        <>
          <div className="result-statistics">
            <div className="vote-count">
              <span>Total Votes</span>
              <strong>{formattedVotes}</strong>
            </div>
            <div className="vote-percentage">
              <span>Vote Share</span>
              <strong>{numericPct}%</strong>
            </div>
          </div>

          <div className="result-progress">
            <div className="progress-label">
              <span>Progress</span>
              <span>{formattedVotes} of {totalVotes}</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={numericPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${candidate}: ${numericPct}% of total votes (${formattedVotes} of ${totalVotes})`}
            >
              <div
                className={`progress-value ${isWinner ? "winner-progress" : ""}`}
                style={{ width: `${clampedPct}%` }}
              />
            </div>
          </div>
        </>
      )}

      <div className="result-footer">
        <span>{hideStats ? "Voting in progress" : "Real-time tally"}</span>
        <div className="live-indicator">
          <span className="live-dot" aria-hidden="true" />
          Live
        </div>
      </div>
    </article>
  );
}

export default ResultCard;