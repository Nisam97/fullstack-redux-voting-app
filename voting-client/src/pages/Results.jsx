import { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useParams, Link } from "react-router-dom";
import { Trophy, RefreshCw, AlertCircle, Vote, Home, Lock } from "lucide-react";
import Navbar from "../components/layout/Navbar";
import ResultCard from "../components/results/ResultCard";
import ResultsChart from "../components/results/ResultsChart";
import CountdownTimer from "../components/CountdownTimer";
import {
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
} from "../redux/voteSlice";
import {
  subscribeSession,
  unsubscribeSession
} from "../services/socket";
import { fetchSessionResult } from "../services/history";
import { getGuardedResultsPresentation } from "../components/results/resultsUtils";
import "./Results.css";

/**
 * Results Page Component
 * Route-aware: reads session ID from /sessions/:id/results URL parameter.
 * Subscribes to the session room and displays only that session's results.
 *
 * Strictly adheres to SERVER IS AUTHORITATIVE & STAGE B RESULTS VISIBILITY:
 * - State A (Voting In Progress): When round is actively running, tallies,
 *   percentages, progress bars, and the ResultsChart are hidden from the DOM.
 * - State B (Round Results Revealed): Once server round has closed, authoritative
 *   tallies are revealed through ResultsChart and ResultCard with zero duplication.
 * - State C (Tournament Concluded): Preserves official winner presentation.
 * - Never determines, fabricates, or dispatches round progression on the client.
 */
function Results() {
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

  const pair = voteState?.pair || [];
  const tally = voteState?.tally || {};

  const [historicalResult, setHistoricalResult] = useState(null);

  // Periodic clock tick while timer is running to detect expiry without drift
  const isTimerRunning = timer?.status === 'running' && typeof timer?.expiresAt === 'number' && timer?.expiresAt > 0;
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!isTimerRunning) return undefined;

    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => clearInterval(intervalId);
  }, [isTimerRunning, timer?.expiresAt]);

  // Synchronize active session and socket subscription with route parameter
  useEffect(() => {
    if (!routeSessionId) return;

    dispatch(setActiveSession(routeSessionId));
    subscribeSession(routeSessionId);

    let isMounted = true;
    fetchSessionResult(routeSessionId).then((res) => {
      if (isMounted && res.success && res.result) {
        setHistoricalResult(res.result);
      }
    });

    return () => {
      isMounted = false;
      unsubscribeSession(routeSessionId);
    };
  }, [routeSessionId, dispatch]);

  const effectiveWinner = winner || historicalResult?.winner;
  const isConcluded = Boolean(effectiveWinner);
  const displayTitle = session?.title || historicalResult?.title || routeSessionId;

  // Single source of truth for results presentation guarding
  const presentation = getGuardedResultsPresentation({
    hasLoaded,
    winner: effectiveWinner,
    pair,
    tally,
    timer,
    now,
    roundLifecycle,
    finalVote,
    revealTimer
  });

  const displayPair = presentation.effectivePair || (roundLifecycle === 'RESULTS_REVEALED' && finalVote?.pair ? finalVote.pair : pair);
  const roundKey = getSessionPairLockKey(routeSessionId, displayPair) || presentation.roundKey || 'round-initial';

  return (
    <div className="results-page">
      <Navbar />

      <main className="results-main">
        <div className="results-container">
          {/* Session title header */}
          {(session || historicalResult) && (
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
              }}>{isConcluded ? 'Completed' : (session?.status || 'Session')}</span>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0.25rem 0' }}>
                {displayTitle}
              </h2>
            </div>
          )}

          {/* State 1: Initial Loading from Server */}
          {presentation.visibilityState === 'LOADING' && !isConcluded && (
            <section className="results-status-card" aria-live="polite">
              <div className="results-spinner-wrapper">
                <RefreshCw size={42} className="results-spinner" aria-hidden="true" />
              </div>
              <h1 className="results-status-title">Loading Results...</h1>
              <p className="results-status-desc">
                Connecting to real-time voting server and synchronizing state.
              </p>
            </section>
          )}

          {/* State 2 (State C): Tournament Winner Concluded */}
          {isConcluded && (
            <section className="results-status-card results-winner-card" aria-live="polite">
              <div className="winner-icon-badge" aria-hidden="true">
                <Trophy size={48} className="winner-trophy" />
              </div>
              <span className="winner-eyebrow">TOURNAMENT CONCLUDED</span>
              <h1 className="results-status-title">We Have a Winner!</h1>
              <div className="winner-name-display">
                <h2>{effectiveWinner}</h2>
              </div>
              <p className="results-status-desc">
                All pairwise rounds have concluded. <strong>{effectiveWinner}</strong> has won the tournament by authoritative server decision!
              </p>
              {historicalResult?.completedAt && (
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '0.25rem 0 1rem' }}>
                  Concluded: {new Date(historicalResult.completedAt).toLocaleString()}
                </p>
              )}

              <div className="winner-card-wrapper">
                <ResultCard
                  candidate={effectiveWinner}
                  party="Tournament Champion"
                  votes="Winner"
                  percentage={100}
                  position={1}
                  totalVotes="Final"
                  isWinner={true}
                  winnerLabel="🏆 Official Winner"
                />
              </div>

              <div className="results-actions">
                <Link to="/sessions" className="results-btn results-btn-primary">
                  <Home size={16} aria-hidden="true" />
                  <span>All Sessions</span>
                </Link>
                <Link to="/history" className="results-btn results-btn-secondary">
                  <Trophy size={16} aria-hidden="true" />
                  <span>History Archive</span>
                </Link>
                {routeSessionId && !isConcluded && (
                  <Link to={`/sessions/${routeSessionId}/vote`} className="results-btn results-btn-secondary">
                    <Vote size={16} aria-hidden="true" />
                    <span>Voting Arena</span>
                  </Link>
                )}
              </div>
            </section>
          )}

          {/* State 3: Loaded but No Active Round and No Winner */}
          {presentation.visibilityState === 'EMPTY' && (
            <section className="results-status-card" aria-live="polite">
              <div className="status-icon-badge" aria-hidden="true">
                <AlertCircle size={44} />
              </div>
              <h1 className="results-status-title">No Results Available Yet</h1>
              <p className="results-status-desc">
                There is currently no active voting round and no tournament winner declared.
              </p>
              <div className="results-actions">
                {routeSessionId && (
                  <Link to={`/sessions/${routeSessionId}/vote`} className="results-btn results-btn-primary">
                    <Vote size={16} aria-hidden="true" />
                    <span>Go to Voting Arena</span>
                  </Link>
                )}
                <Link to="/sessions" className="results-btn results-btn-secondary">
                  <Home size={16} aria-hidden="true" />
                  <span>All Sessions</span>
                </Link>
              </div>
            </section>
          )}

          {/* State 4A (State A): Active Round — Voting In Progress (Results Guarded) */}
          {presentation.visibilityState === 'VOTING_IN_PROGRESS' && (
            <section className="results-arena results-arena-active" key={roundKey}>
              <header className="results-header">
                <div className="results-header-badges">
                  <span className="results-badge results-badge-active">ROUND IN PROGRESS</span>
                  <div className="results-live-indicator">
                    <span className="results-live-dot" aria-hidden="true" />
                    <span>Live Voting</span>
                  </div>
                </div>
                <h1 className="results-title">Voting in Progress</h1>
                <p className="results-subtitle">
                  Results will be revealed when this round ends.
                </p>
                {timer && (
                  <div className="results-timer-wrapper" style={{ marginTop: '1.25rem' }}>
                    <CountdownTimer timer={timer} />
                  </div>
                )}
              </header>

              <div className="results-active-notice" role="status" aria-live="polite">
                <Lock size={18} className="results-active-notice-icon" aria-hidden="true" />
                <span>
                  Pairwise tallies and chart visualizations are guarded while voting is active.
                </span>
              </div>

              {/* Contenders Grid with Statistics Strictly Hidden */}
              <div className="results-grid">
                <ResultCard
                  key={`${roundKey}:::${pair[0]}`}
                  candidate={pair[0]}
                  party="Contender 1"
                  position={1}
                  hideStats={true}
                />
                <ResultCard
                  key={`${roundKey}:::${pair[1]}`}
                  candidate={pair[1]}
                  party="Contender 2"
                  position={2}
                  hideStats={true}
                />
              </div>

              {/* Active Summary Footer without tally numbers */}
              <footer className="results-footer-bar">
                <div className="results-totals">
                  <span className="results-totals-label">Round Status:</span>
                  <span className="results-totals-value" style={{ fontSize: '1rem', color: '#38bdf8' }}>
                    Voting Active
                  </span>
                </div>
                <div className="results-actions">
                  {routeSessionId && (
                    <Link to={`/sessions/${routeSessionId}/vote`} className="results-btn results-btn-primary">
                      <Vote size={16} aria-hidden="true" />
                      <span>Cast Your Vote</span>
                    </Link>
                  )}
                  <Link to="/sessions" className="results-btn results-btn-secondary">
                    <Home size={16} aria-hidden="true" />
                    <span>All Sessions</span>
                  </Link>
                </div>
              </footer>
            </section>
          )}

          {/* State 4B (State B): Round Results Revealed with ResultsChart */}
          {presentation.visibilityState === 'RESULTS_REVEALED' && (
            <section className="results-arena" key={roundKey}>
              <header className="results-header">
                <div className="results-header-badges">
                  <span className="results-badge">ROUND RESULTS</span>
                  <div className="results-live-indicator results-closed-indicator">
                    <span>Round Closed</span>
                  </div>
                </div>
                <h1 className="results-title">Round Results</h1>
                <p className="results-subtitle">
                  Authoritative vote distribution for the concluded round.
                </p>
                {revealTimer && (
                  <div className="results-timer-wrapper" style={{ marginTop: '1.25rem' }}>
                    <CountdownTimer timer={revealTimer} label="NEXT ROUND IN" />
                  </div>
                )}
              </header>

              {/* Stage A ResultsChart Visualization */}
              <div className="results-chart-section">
                <ResultsChart
                  key={roundKey}
                  data={presentation.chartData}
                  totalVotes={presentation.totalVotes}
                  title="Pairwise Vote Distribution"
                />
              </div>

              {/* Matchup Results Grid preserving server order (displayPair[0], displayPair[1]) */}
              <div className="results-grid">
                <ResultCard
                  key={`${roundKey}:::${displayPair[0]}`}
                  candidate={displayPair[0]}
                  party="Contender 1"
                  votes={presentation.candidateResults?.[0]?.votes ?? 0}
                  percentage={presentation.candidateResults?.[0]?.percentage ?? 0}
                  position={1}
                  totalVotes={presentation.totalVotes}
                  isWinner={false}
                  hideStats={false}
                />
                <ResultCard
                  key={`${roundKey}:::${displayPair[1]}`}
                  candidate={displayPair[1]}
                  party="Contender 2"
                  votes={presentation.candidateResults?.[1]?.votes ?? 0}
                  percentage={presentation.candidateResults?.[1]?.percentage ?? 0}
                  position={2}
                  totalVotes={presentation.totalVotes}
                  isWinner={false}
                  hideStats={false}
                />
              </div>

              {/* Summary Footer with Authoritative Total */}
              <footer className="results-footer-bar">
                <div className="results-totals">
                  <span className="results-totals-label">Total Round Votes:</span>
                  <span className="results-totals-value">{presentation.totalVotes}</span>
                </div>
                <div className="results-actions">
                  {routeSessionId && (
                    <Link to={`/sessions/${routeSessionId}/vote`} className="results-btn results-btn-primary">
                      <Vote size={16} aria-hidden="true" />
                      <span>Voting Arena</span>
                    </Link>
                  )}
                  <Link to="/sessions" className="results-btn results-btn-secondary">
                    <Home size={16} aria-hidden="true" />
                    <span>All Sessions</span>
                  </Link>
                </div>
              </footer>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default Results;