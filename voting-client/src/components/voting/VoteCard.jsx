import { Vote, CheckCircle2 } from 'lucide-react';
import './VoteCard.css';

/**
 * VoteCard Component
 * Displays an individual candidate in the pairwise voting matchup
 * and provides an accessible button to cast a vote.
 *
 * @param {object} props
 * @param {string} props.entry - Name of the candidate
 * @param {function} props.onVote - Callback fired when this candidate is selected
 * @param {boolean} [props.disabled=false] - Whether voting is currently disabled
 * @param {boolean} [props.hasVoted=false] - Whether the user voted for this candidate
 * @param {number} [props.tally] - Optional current vote tally from server state
 */
function VoteCard({
  entry,
  onVote,
  disabled = false,
  hasVoted = false,
  tally
}) {
  const handleClick = () => {
    if (!disabled && typeof onVote === 'function') {
      onVote(entry);
    }
  };

  // Generate monogram/initials for avatar display
  const initials = entry
    ? entry
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('')
    : '?';

  const cardClasses = [
    'vote-card',
    hasVoted ? 'vote-card-voted' : '',
    disabled && !hasVoted ? 'vote-card-inactive' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={cardClasses} aria-label={`Candidate: ${entry}`}>
      <div className="vote-card-avatar" aria-hidden="true">
        <span>{initials}</span>
      </div>

      <div className="vote-card-content">
        <h2 className="vote-card-title">{entry}</h2>

        {typeof tally === 'number' && (
          <div className="vote-card-tally" aria-label={`Current votes: ${tally}`}>
            <span className="tally-count">{tally}</span>
            <span className="tally-label">{tally === 1 ? 'vote' : 'votes'}</span>
          </div>
        )}
      </div>

      <div className="vote-card-action">
        <button
          type="button"
          className={`vote-btn ${hasVoted ? 'vote-btn-voted' : ''}`}
          onClick={handleClick}
          disabled={disabled}
          aria-label={hasVoted ? `Voted for ${entry}` : `Vote for ${entry}`}
          aria-pressed={hasVoted}
        >
          {hasVoted ? (
            <>
              <CheckCircle2 size={18} className="vote-btn-icon" aria-hidden="true" />
              <span>Voted</span>
            </>
          ) : (
            <>
              <Vote size={18} className="vote-btn-icon" aria-hidden="true" />
              <span>{disabled ? 'Vote Closed' : 'Vote for this'}</span>
            </>
          )}
        </button>
      </div>
    </article>
  );
}

export default VoteCard;
