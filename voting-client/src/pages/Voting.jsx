import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams, Link } from 'react-router-dom';
import { Trophy, RefreshCw, AlertCircle, CheckCircle, User, Clock } from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import VoteCard from '../components/voting/VoteCard';
import CountdownTimer from '../components/CountdownTimer';
import { isTimerExpired } from '../utils/timerUtils';
import {
  vote,
  setActiveSession,
  selectSessionById,
  selectVote,
  selectWinner,
  selectHasLoaded,
  selectTimerBySessionId,
  getSessionPairLockKey,
  selectRoundLifecycle,
  selectFinalVote,
  selectRevealTimer
} from '../redux/voteSlice';
import { getPairwiseSummary } from '../components/results/resultsUtils';
import {
  subscribeSession,
  unsubscribeSession,
  getSocket
} from '../services/socket';
import {
  hasJoinedSession,
  getVoterDisplayName,
  joinVoterSession
} from '../services/auth';
import './Voting.css';

/**
 * Voting Page Component
 * Route-aware: reads session ID from /sessions/:id/vote URL parameter.
 * Enforces session-scoped voter join (display name only, no password/email)
 * before enabling pairwise voting.
 */
function Voting() {
  const dispatch = useDispatch();
  const { id: routeSessionId } = useParams();

  // Route parameter is authoritative — use it to query session-specific state
  const session = useSelector((state) => selectSessionById(state, routeSessionId));
  const voteState = useSelector((state) => selectVote(state, routeSessionId));
  const winner = useSelector((state) => selectWinner(state, routeSessionId));
  const hasLoaded = useSelector((state) => selectHasLoaded(state, routeSessionId));
  const timer = useSelector((state) => selectTimerBySessionId(state, routeSessionId));
  const roundLifecycle = useSelector((state) => selectRoundLifecycle(state, routeSessionId));
  const finalVote = useSelector((state) => selectFinalVote(state, routeSessionId));
  const revealTimer = useSelector((state) => selectRevealTimer(state, routeSessionId));

  // Voter identity state
  const [sessionJoinedOverride, setSessionJoinedOverride] = useState(null);
  const [customDisplayName, setCustomDisplayName] = useState('');
  const [lastRouteSessionId, setLastRouteSessionId] = useState(routeSessionId);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [joinError, setJoinError] = useState(null);
  const [isJoining, setIsJoining] = useState(false);
  const [serverError, setServerError] = useState(null);

  if (lastRouteSessionId !== routeSessionId) {
    setLastRouteSessionId(routeSessionId);
    setSessionJoinedOverride(null);
    setCustomDisplayName('');
    setServerError(null);
  }

  const joined = sessionJoinedOverride !== null
    ? sessionJoinedOverride
    : hasJoinedSession(routeSessionId);
  const currentDisplayName = customDisplayName || getVoterDisplayName(routeSessionId) || '';

  const pair = voteState?.pair || [];
  const lockKey = getSessionPairLockKey(routeSessionId, pair);

  // Clear server errors when candidate pair advances to a new round
  const [prevLockKey, setPrevLockKey] = useState(lockKey);
  if (prevLockKey !== lockKey) {
    setPrevLockKey(lockKey);
    setServerError(null);
  }

  // Periodic time tick while timer is running to detect expiry without drift
  const isTimerRunning = timer?.status === 'running' && typeof timer?.expiresAt === 'number' && timer?.expiresAt > 0;
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!isTimerRunning) return undefined;

    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => clearInterval(intervalId);
  }, [isTimerRunning, timer?.expiresAt]);

  const isExpired = isTimerExpired(timer, now);

  // Track user selections keyed to session-specific pair locks: `${sessionId}:::${pair}`
  const [votesByLockKey, setVotesByLockKey] = useState({});

  const isRoundClosed = roundLifecycle === 'ROUND_CLOSED' || roundLifecycle === 'RESULTS_REVEALED';
  const hasVotedForCurrentPair = Boolean(lockKey && votesByLockKey[lockKey]);
  const votedEntry = lockKey ? (votesByLockKey[lockKey] || null) : null;
  const isVoteDisabled = hasVotedForCurrentPair || isExpired || isRoundClosed;

  const finalPair = (finalVote && Array.isArray(finalVote.pair) && finalVote.pair.length >= 2)
    ? finalVote.pair
    : pair;
  const finalTally = (finalVote && typeof finalVote.tally === 'object')
    ? finalVote.tally
    : (voteState?.tally || {});
  const roundSummary = getPairwiseSummary(finalPair, finalTally);

  // Synchronize active session and socket subscription with route parameter
  useEffect(() => {
    if (!routeSessionId) return;

    dispatch(setActiveSession(routeSessionId));
    subscribeSession(routeSessionId);

    const socket = getSocket();
    const handleActionError = (errorPayload) => {
      if (errorPayload?.action === 'VOTE') {
        if (errorPayload.error === 'ROUND_CLOSED') {
          setServerError('Voting is closed for this round.');
        } else if (errorPayload.error === 'DUPLICATE_VOTE') {
          setServerError('Duplicate vote rejected: You have already cast a vote in this round.');
        } else if (errorPayload.error === 'VOTER_TOKEN_REQUIRED') {
          setServerError('Authentication error: Voter token is required. Please re-join the session.');
          setSessionJoinedOverride(false);
          if (lockKey) {
            setVotesByLockKey((prev) => {
              const nextLocks = { ...prev };
              delete nextLocks[lockKey];
              return nextLocks;
            });
          }
        } else {
          setServerError(errorPayload.message || 'Vote was rejected by the server.');
          if (lockKey) {
            setVotesByLockKey((prev) => {
              const nextLocks = { ...prev };
              delete nextLocks[lockKey];
              return nextLocks;
            });
          }
        }
      }
    };

    if (socket && typeof socket.on === 'function') {
      socket.on('action_error', handleActionError);
    }

    return () => {
      unsubscribeSession(routeSessionId);
      if (socket && typeof socket.off === 'function') {
        socket.off('action_error', handleActionError);
      }
    };
  }, [routeSessionId, dispatch, lockKey]);

  const handleJoinSession = async (e) => {
    e.preventDefault();
    setJoinError(null);

    if (!displayNameInput.trim()) {
      setJoinError('Please enter a display name to join.');
      return;
    }

    setIsJoining(true);
    const result = await joinVoterSession({
      sessionId: routeSessionId,
      displayName: displayNameInput.trim()
    });
    setIsJoining(false);

    if (!result.success) {
      setJoinError(result.message || 'Failed to join session. Please try again.');
      return;
    }

    setSessionJoinedOverride(true);
    setCustomDisplayName(result.displayName);
    setDisplayNameInput('');
  };

  const handleVote = (entry) => {
    if (isVoteDisabled) return;
    setServerError(null);

    if (lockKey) {
      setVotesByLockKey((prev) => ({ ...prev, [lockKey]: entry }));
    }
    dispatch(vote(routeSessionId, entry));
  };

  // Invalid / unknown session ID
  if (routeSessionId && hasLoaded === false && !session) {
    return (
      <div className="voting-page">
        <Navbar />
        <main className="voting-main">
          <div className="voting-container">
            <section className="voting-status-card" aria-live="polite">
              <div className="voting-spinner-wrapper">
                <RefreshCw size={42} className="voting-spinner" aria-hidden="true" />
              </div>
              <h1 className="voting-status-title">Loading Session...</h1>
              <p className="voting-status-desc">
                Connecting to session <strong>{routeSessionId}</strong>.
              </p>
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="voting-page">
      <Navbar />

      <main className="voting-main">
        <div className="voting-container">
          {/* Session title header */}
          {session && (
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <span style={{
                display: 'inline-block',
                padding: '0.2rem 0.6rem',
                borderRadius: '9999px',
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                background: 'rgba(99,102,241,0.15)',
                color: '#818cf8',
                marginBottom: '0.5rem'
              }}>{session.status || 'Session'}</span>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0.25rem 0' }}>
                {session.title || routeSessionId}
              </h2>
              {joined && currentDisplayName && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                  <User size={14} />
                  <span>Voting as: <strong style={{ color: '#f8fafc' }}>{currentDisplayName}</strong></span>
                </div>
              )}
            </div>
          )}

          {/* State 1: Initial Loading from Server */}
          {!hasLoaded && (
            <section className="voting-status-card" aria-live="polite">
              <div className="voting-spinner-wrapper">
                <RefreshCw size={42} className="voting-spinner" aria-hidden="true" />
              </div>
              <h1 className="voting-status-title">Loading Voting Session...</h1>
              <p className="voting-status-desc">
                Connecting to real-time voting server and synchronizing state.
              </p>
            </section>
          )}

          {/* State 2: Tournament Winner Concluded */}
          {hasLoaded && Boolean(winner) && (
            <section className="voting-status-card voting-winner-card" aria-live="polite">
              <div className="winner-icon-badge" aria-hidden="true">
                <Trophy size={48} className="winner-trophy" />
              </div>
              <span className="winner-eyebrow">TOURNAMENT CONCLUDED</span>
              <h1 className="voting-status-title">We Have a Winner!</h1>
              <div className="winner-name-display">
                <h2>{winner}</h2>
              </div>
              <p className="voting-status-desc">
                All pairwise rounds have ended. Thank you for casting your votes!
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
                <Link to={`/sessions/${routeSessionId}/results`} className="results-btn results-btn-primary" style={{ textDecoration: 'none' }}>
                  View Results
                </Link>
                <Link to="/sessions" className="results-btn results-btn-secondary" style={{ textDecoration: 'none' }}>
                  All Sessions
                </Link>
              </div>
            </section>
          )}

          {/* State 3: Voter has not joined session yet (Display Name prompt) */}
          {hasLoaded && !winner && !joined && (
            <section className="voting-status-card" aria-live="polite" style={{ maxWidth: '440px', margin: '0 auto' }}>
              <div className="empty-icon-badge" aria-hidden="true">
                <User size={44} />
              </div>
              <h1 className="voting-status-title">Join Voting Session</h1>
              <p className="voting-status-desc">
                Enter your display name to join this pairwise voting tournament.
                No password or email required.
              </p>

              {joinError && (
                <div style={{
                  padding: '0.6rem 0.8rem',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#fca5a5',
                  fontSize: '0.85rem',
                  marginBottom: '1rem'
                }}>
                  {joinError}
                </div>
              )}

              <form onSubmit={handleJoinSession} style={{ width: '100%' }}>
                <div style={{ marginBottom: '1rem', textAlign: 'left' }}>
                  <label htmlFor="display-name" style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
                    Display Name
                  </label>
                  <input
                    id="display-name"
                    type="text"
                    placeholder="Enter your name (e.g. Alex)"
                    value={displayNameInput}
                    onChange={(e) => setDisplayNameInput(e.target.value)}
                    disabled={isJoining}
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '8px',
                      color: '#ffffff',
                      fontSize: '0.95rem'
                    }}
                  />
                </div>
                <button
                  type="submit"
                  className="results-btn results-btn-primary"
                  disabled={isJoining}
                  style={{ width: '100%', padding: '0.75rem', fontSize: '0.95rem' }}
                >
                  {isJoining ? 'Joining Session...' : 'Join and Start Voting'}
                </button>
              </form>
            </section>
          )}

          {/* State 4: Loaded and Joined — Round Closed Transition */}
          {hasLoaded && !winner && joined && roundLifecycle === 'ROUND_CLOSED' && (
            <section className="voting-status-card" aria-live="polite">
              <div className="empty-icon-badge" aria-hidden="true">
                <Clock size={44} />
              </div>
              <span className="pairwise-badge" style={{ marginBottom: '0.75rem', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}>
                ROUND CLOSED
              </span>
              <h1 className="voting-status-title">Round Closed</h1>
              <p className="voting-status-desc">
                Voting has ended for this round. Preparing authoritative results...
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                <Link to={`/sessions/${routeSessionId}/results`} style={{ color: '#4ade80', textDecoration: 'none', fontSize: '0.85rem' }}>
                  View Results →
                </Link>
                <Link to="/sessions" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '0.85rem' }}>
                  All Sessions
                </Link>
              </div>
            </section>
          )}

          {/* State 5: Loaded and Joined — Results Revealed Presentation */}
          {hasLoaded && !winner && joined && roundLifecycle === 'RESULTS_REVEALED' && (
            <section className="pairwise-arena">
              <header className="pairwise-header">
                <span className="pairwise-badge" style={{ background: 'rgba(234, 179, 8, 0.2)', color: '#facc15' }}>
                  ROUND RESULTS REVEALED
                </span>
                <h1 className="pairwise-title">Round Concluded</h1>
                <p className="pairwise-subtitle">
                  Voting is closed. Authoritative round results are shown below.
                </p>
                {revealTimer && (
                  <CountdownTimer timer={revealTimer} label="NEXT ROUND IN" />
                )}
              </header>

              <div className="matchup-arena">
                <VoteCard
                  entry={finalPair[0]}
                  disabled={true}
                  hasVoted={votedEntry === finalPair[0]}
                  tally={finalTally[finalPair[0]] ?? 0}
                />

                <div className="matchup-divider" aria-hidden="true">
                  <div className="vs-circle">
                    <span>VS</span>
                  </div>
                </div>

                <VoteCard
                  entry={finalPair[1]}
                  disabled={true}
                  hasVoted={votedEntry === finalPair[1]}
                  tally={finalTally[finalPair[1]] ?? 0}
                />
              </div>

              {/* Feedback and instructions */}
              <div className="pairwise-feedback" aria-live="polite">
                <div className="feedback-banner feedback-expired" role="status" aria-live="polite">
                  <Clock size={20} className="feedback-icon" aria-hidden="true" />
                  <span>
                    {roundSummary.isTie
                      ? `Round ended in a tie (${roundSummary.totalVotes} total votes).`
                      : roundSummary.leader
                        ? `${roundSummary.leader} led with ${finalTally[roundSummary.leader] ?? 0} votes (${roundSummary.totalVotes} total).`
                        : `Voting closed (${roundSummary.totalVotes} total votes).`} Waiting for server to advance round...
                  </span>
                </div>
              </div>

              {/* Navigation */}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                <Link to={`/sessions/${routeSessionId}/results`} style={{ color: '#4ade80', textDecoration: 'none', fontSize: '0.85rem' }}>
                  Detailed Results Chart →
                </Link>
                <Link to="/sessions" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '0.85rem' }}>
                  All Sessions
                </Link>
              </div>
            </section>
          )}

          {/* State 6: Loaded and Joined but No Active Pair */}
          {hasLoaded && !winner && joined && (!roundLifecycle || roundLifecycle === 'VOTING') && pair.length < 2 && (
            <section className="voting-status-card" aria-live="polite">
              <div className="empty-icon-badge" aria-hidden="true">
                <AlertCircle size={44} />
              </div>
              <h1 className="voting-status-title">No Active Voting Round</h1>
              <p className="voting-status-desc">
                The voting session is currently waiting for the administrator to start the round.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
                <Link to="/sessions" style={{ color: '#818cf8', textDecoration: 'none', fontSize: '0.9rem' }}>
                  ← Back to Sessions
                </Link>
              </div>
            </section>
          )}

          {/* State 7: Active Pairwise Matchup for Joined Voter */}
          {hasLoaded && !winner && joined && (!roundLifecycle || roundLifecycle === 'VOTING') && pair.length >= 2 && (
            <section className="pairwise-arena">
              <header className="pairwise-header">
                <span className="pairwise-badge">PAIRWISE COMPARISON</span>
                <h1 className="pairwise-title">Choose Your Favorite</h1>
                <p className="pairwise-subtitle">
                  Cast your vote for the candidate you want to advance to the next round.
                </p>
                <CountdownTimer timer={timer} />
              </header>

              {serverError && (
                <div style={{
                  maxWidth: '600px',
                  margin: '0 auto 1.5rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#fca5a5',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.9rem'
                }} role="alert">
                  <AlertCircle size={18} />
                  <span>{serverError}</span>
                </div>
              )}

              <div className="matchup-arena">
                <VoteCard
                  entry={pair[0]}
                  onVote={handleVote}
                  disabled={isVoteDisabled}
                  hasVoted={votedEntry === pair[0]}
                  tally={voteState?.tally?.[pair[0]]}
                />

                <div className="matchup-divider" aria-hidden="true">
                  <div className="vs-circle">
                    <span>VS</span>
                  </div>
                </div>

                <VoteCard
                  entry={pair[1]}
                  onVote={handleVote}
                  disabled={isVoteDisabled}
                  hasVoted={votedEntry === pair[1]}
                  tally={voteState?.tally?.[pair[1]]}
                />
              </div>

              {/* Feedback and instructions */}
              <div className="pairwise-feedback" aria-live="polite">
                {votedEntry ? (
                  <div className="feedback-banner feedback-voted">
                    <CheckCircle size={20} className="feedback-icon" aria-hidden="true" />
                    <span>
                      Vote recorded for <strong>{votedEntry}</strong>. Waiting for next round...
                    </span>
                  </div>
                ) : isExpired ? (
                  <div className="feedback-banner feedback-expired" role="status" aria-live="polite">
                    <Clock size={20} className="feedback-icon" aria-hidden="true" />
                    <span>
                      Voting time expired. Waiting for server to advance round...
                    </span>
                  </div>
                ) : (
                  <div className="feedback-banner feedback-prompt">
                    <span>Select a candidate card above to submit your vote.</span>
                  </div>
                )}
              </div>

              {/* Navigation */}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                <Link to={`/sessions/${routeSessionId}/results`} style={{ color: '#4ade80', textDecoration: 'none', fontSize: '0.85rem' }}>
                  View Results →
                </Link>
                <Link to="/sessions" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '0.85rem' }}>
                  All Sessions
                </Link>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default Voting;