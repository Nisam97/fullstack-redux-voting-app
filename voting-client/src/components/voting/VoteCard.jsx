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

        {/**
         * No aria-label on the tally badge: aria-label is prohibited on a plain
         * div, because no role supports naming it, so browsers drop the label
         * and axe reports `aria-prohibited-attr`. The visible text already
         * reads "2 votes", which is the same information.
         */}
        {typeof tally === 'number' && (
          <div className="vote-card-tally">
            <span className="tally-count">{tally}</span>
            <span className="tally-label">{tally === 1 ? 'vote' : 'votes'}</span>
          </div>
        )}
      </div>

      {/*
        The visible label names the candidate and that same text is the
        button's accessible name, so the two can never diverge. An
        `aria-label` like `Vote for ${entry}` sitting next to the visible
        `Vote for this` failed WCAG 2.1 SC 2.5.3 (Label in Name, Level A),
        because the accessible name must contain the text shown on screen.
      */}
      <div className="vote-card-action">
        <button
          type="button"
          className={`vote-btn ${hasVoted ? 'vote-btn-voted' : ''}`}
          onClick={handleClick}
          disabled={disabled}
          aria-pressed={hasVoted}
        >
          {hasVoted ? (
            <>
              <CheckCircle2 size={18} className="vote-btn-icon" aria-hidden="true" />
              <span>Voted for {entry}</span>
            </>
          ) : (
            <>
              <Vote size={18} className="vote-btn-icon" aria-hidden="true" />
              <span>{disabled ? 'Vote Closed' : `Vote for ${entry}`}</span>
            </>
          )}
        </button>
      </div>
    </article>
  );
}

export default VoteCard;
