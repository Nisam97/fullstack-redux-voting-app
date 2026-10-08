import { useState, useEffect, useRef } from "react";
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
  selectRevealTimer,
  selectSessionRounds,
  selectTurnout,
  selectAdminSessionExpired,
  setPublishResults,
  setPublishResultsLocal
} from "../redux/voteSlice";
import {
  subscribeSession,
  unsubscribeSession,
  subscribeTurnout,
  unsubscribeTurnout
} from "../services/socket";
import { isAdminLoggedIn } from "../services/auth";
import { fetchSessionResult, fetchSessionRounds } from "../services/history";
import { getGuardedResultsPresentation, buildTurnoutCsv, turnoutCsvFilename } from "../components/results/resultsUtils";
import RoundTimeline from "../components/results/RoundTimeline";
import TotalsPanel from "../components/results/TotalsPanel";
import "./Results.css";

// Spec 0008 AC-3: how long to wait for the server's acknowledgement of a
// publish before giving up on the answer and telling the admin it never came.
// Generous, because it is only a guard against a dropped connection: the
// acknowledgement itself ends the wait as soon as it arrives.
const PUBLISH_ACK_TIMEOUT_MS = 10000;

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
  const sessionRounds = useSelector((state) => selectSessionRounds(state, routeSessionId));
  const turnout = useSelector((state) => selectTurnout(state, routeSessionId));
  // The server refused the stored admin JWT, so admin only reads are dead even
  // though the token has not expired locally. Say that instead of implying the
  // session has no rounds.
  const adminSessionExpired = useSelector(selectAdminSessionExpired);
  const isAdmin = isAdminLoggedIn();

  const pair = voteState?.pair || [];
  const tally = voteState?.tally || {};

  const [historicalResult, setHistoricalResult] = useState(null);
  const [historicalRounds, setHistoricalRounds] = useState([]);
  // Spec 0008 AC-12: a neutral unavailable state when the result read is gated.
  const [gated, setGated] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  // Spec 0008 AC-3, AC-12: the toggle is not flipped on click. The server
  // acknowledges SET_PUBLISH_RESULTS and its answer is the only thing that
  // moves the control, so the admin can never read a visibility state the
  // server did not apply. Tagged with its session so a late answer cannot
  // describe a session that is no longer on screen.
  const [publishError, setPublishError] = useState(null);
  const publishTimeoutRef = useRef(null);
  // Read by the acknowledgement and the timeout when they fire, which is after
  // render, so the current route is synced in an effect rather than assigned
  // during render.
  const routeSessionRef = useRef(routeSessionId);
  useEffect(() => {
    routeSessionRef.current = routeSessionId;
  }, [routeSessionId]);

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
      if (!isMounted) return;
      if (res.success && res.result) {
        setHistoricalResult(res.result);
        setGated(false);
      } else {
        setGated(true);
      }
    });

    fetchSessionRounds(routeSessionId).then((res) => {
      if (isMounted && res.success && Array.isArray(res.rounds)) {
        setHistoricalRounds(res.rounds);
      }
    });

    return () => {
      isMounted = false;
      unsubscribeSession(routeSessionId);
    };
  }, [routeSessionId, dispatch]);

  // Spec 0008 AC-7: the admin per round turnout view is admin only. Subscribe
  // on mount so a fresh round arrives live as each round closes.
  useEffect(() => {
    if (!routeSessionId || !isAdmin) return undefined;
    subscribeTurnout(routeSessionId);
    return () => unsubscribeTurnout(routeSessionId);
  }, [routeSessionId, isAdmin]);

  // Spec 0008 AC-3, AC-12: clear the safety timer on unmount so a pending
  // timeout cannot touch a component that is gone.
  useEffect(() => () => {
    if (publishTimeoutRef.current) {
      clearTimeout(publishTimeoutRef.current);
      publishTimeoutRef.current = null;
    }
  }, []);

  const effectiveWinner = winner || historicalResult?.winner;
  const isConcluded = Boolean(effectiveWinner);
  const displayTitle = session?.title || historicalResult?.title || routeSessionId;

  // Spec 0008 AC-12: publish controls apply to a secured session after it ends.
  const sessionType = session?.type || historicalResult?.type || 'public';
  const isSecured = sessionType === 'secured';
  const sessionStatus = session?.status || (historicalResult ? 'completed' : null);
  const canTogglePublish = isAdmin && isSecured && (sessionStatus === 'completed' || sessionStatus === 'archived');
  const publishedFlag = historicalResult?.publishResultsPublicly !== undefined
    ? Boolean(historicalResult.publishResultsPublicly)
    : Boolean(session?.publishResultsPublicly);
  // Derived, not cleared in an effect: the refusal is only shown while its own
  // session is on screen.
  const visiblePublishError = publishError && publishError.sessionId === routeSessionId
    ? publishError.message
    : null;

  // The turnout export is built in the browser from the payload the admin has
// already been sent. No new endpoint and no second fetch of the same data, and
// the export can only ever contain what this admin was already shown.
const handleDownloadTurnout = () => {
  if (!isAdmin || !routeSessionId || turnout.length === 0) return;
  const csv = buildTurnoutCsv(turnout);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = turnoutCsvFilename(routeSessionId);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const handleTogglePublish = () => {
    if (publishBusy || !routeSessionId) return;
    const sessionId = routeSessionId;
    const requested = !publishedFlag;

    setPublishBusy(true);
    setPublishError(null);

    // Safety net only. The acknowledgement below is what normally ends the
    // busy state; this covers the one case it cannot, a connection that drops
    // so the answer never arrives. Nothing is applied optimistically, so the
    // control is still showing the server's stored value when this fires.
    if (publishTimeoutRef.current) clearTimeout(publishTimeoutRef.current);
    publishTimeoutRef.current = setTimeout(() => {
      publishTimeoutRef.current = null;
      if (routeSessionRef.current !== sessionId) return;
      setPublishBusy(false);
      setPublishError({
        sessionId,
        message: 'The server did not answer, so nothing was changed. Check your connection and try again.'
      });
    }, PUBLISH_ACK_TIMEOUT_MS);

    dispatch(setPublishResults(sessionId, requested, (response) => {
      if (publishTimeoutRef.current) {
        clearTimeout(publishTimeoutRef.current);
        publishTimeoutRef.current = null;
      }
      // The admin may have navigated while the answer was in flight.
      if (routeSessionRef.current !== sessionId) return;

      setPublishBusy(false);

      if (!response || response.success !== true) {
        setPublishError({
          sessionId,
          message: (response && response.message)
            || 'The server did not accept this change, so nothing was updated.'
        });
        return;
      }

      // The server's own value drives the toggle, not the requested one.
      const applied = typeof response.publishResultsPublicly === 'boolean'
        ? response.publishResultsPublicly
        : requested;
      setHistoricalResult((prev) => (prev ? { ...prev, publishResultsPublicly: applied } : prev));
      dispatch(setPublishResultsLocal(sessionId, applied));
    }));
  };

  const effectiveRounds = (sessionRounds && sessionRounds.length > 0)
    ? sessionRounds
    : (historicalRounds.length > 0
        ? historicalRounds
        : (historicalResult?.rounds || []));

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

  // Spec 0003 AC-4, AC-5, AC-9: the round history belongs to any session that
  // has closed a round, so it is gated on rounds existing rather than on a
  // winner existing. A `no_result` completion has rounds and no winner, and
  // nesting the history inside the winner and reveal branches hid it there.
  // Tallies stay guarded (AC-9): the history is withheld until the server has
  // confirmed the lifecycle and while a round is live, and it fails closed on
  // a gated read (spec 0008) exactly like every other surface here.
  const historyGuarded = gated
    || presentation.visibilityState === 'LOADING'
    || presentation.visibilityState === 'VOTING_IN_PROGRESS';
  const showRoundHistory = effectiveRounds.length > 0 && !historyGuarded;

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

          {/* Admin result controls: publish toggle and per round turnout (spec 0008 AC-7, AC-12) */}
          {isAdmin && (session || historicalResult) && (
            <section className="results-admin-panel" aria-label="Admin result controls">
              <div className="results-admin-row">
                <div>
                  <span className="results-admin-eyebrow">Result visibility</span>
                  {isSecured ? (
                    <p className="results-admin-hint">
                      {canTogglePublish
                        ? (publishedFlag
                          ? 'Published: anyone with the session id can view this result.'
                          : 'Private: only approved participants and you can view this result.')
                        : 'Publishing becomes available once the session has ended.'}
                    </p>
                  ) : (
                    <p className="results-admin-hint">Public session: results are always visible.</p>
                  )}
                  {visiblePublishError && (
                    <p className="results-admin-error" role="alert" data-testid="publish-results-error">
                      {visiblePublishError}
                    </p>
                  )}
                </div>
                {canTogglePublish && (
                  <button
                    type="button"
                    className={publishedFlag ? 'results-btn results-btn-secondary' : 'results-btn results-btn-primary'}
                    onClick={handleTogglePublish}
                    disabled={publishBusy}
                    data-testid="publish-results-toggle"
                  >
                    {publishedFlag ? 'Unpublish result' : 'Publish result'}
                  </button>
                )}
              </div>

              <div className="results-turnout">
                <div className="results-turnout-head">
                  <h3 className="results-turnout-title">Per round turnout</h3>
                  <button
                    type="button"
                    className="results-btn results-btn-secondary"
                    onClick={handleDownloadTurnout}
                    disabled={turnout.length === 0}
                    data-testid="turnout-export"
                  >
                    Download CSV
                  </button>
                </div>
                {turnout.length === 0 ? (
                  <p className="results-admin-hint">
                    No rounds recorded yet. Signed in voters appear here as each round closes.
                  </p>
                ) : (
                  <ol className="results-turnout-list">
                    {turnout.map((round) => (
                      <li key={round.roundId || round.roundIndex} className="results-turnout-round">
                        <div className="results-turnout-round-head">
                          <span className="results-turnout-round-label">Round {round.roundIndex}</span>
                          <span className="results-turnout-count">
                            {round.voters.length} {round.voters.length === 1 ? 'voter' : 'voters'}
                          </span>
                        </div>
                        {round.voters.length === 0 ? (
                          <p className="results-turnout-empty">No signed in voters in this round.</p>
                        ) : (
                          <ul className="results-turnout-voters">
                            {round.voters.map((voter) => (
                              <li key={`${round.roundId}-${voter.email}`} className="results-turnout-voter">
                                <span className="results-turnout-name">{voter.name || 'Voter'}</span>
                                <span className="results-turnout-email">{voter.email}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          )}

          {/* Spec 0008 AC-12: gated secured result, neutral unavailable state */}
          {gated && !session && (
            <section className="results-status-card" aria-live="polite">
              <div className="status-icon-badge" aria-hidden="true">
                <Lock size={44} />
              </div>
              <h1 className="results-status-title">Results are not available</h1>
              <p className="results-status-desc">
                This result is private to the session's approved participants. If you were invited, sign in with the email the organizer used, then open this page again.
              </p>
              <div className="results-actions">
                <Link to="/login" className="results-btn results-btn-primary">Sign in</Link>
                <Link to="/sessions" className="results-btn results-btn-secondary">
                  <Home size={16} aria-hidden="true" />
                  <span>All Sessions</span>
                </Link>
              </div>
            </section>
          )}

          {/* Spec 0008 AC-7: the server refused the stored admin JWT, so the dead
              credential was dropped and the admin panel above is gone. Say why,
              because an empty panel that vanished with no explanation reads as a
              bug in the session rather than an expired sign in. */}
          {!isAdmin && adminSessionExpired && (session || historicalResult) && (
            <p className="results-admin-hint" data-testid="admin-session-expired">
              Your admin session is no longer valid. Admin controls, including per round
              turnout, are hidden until you{' '}
              <Link to="/login">sign in again</Link>.
            </p>
          )}

          {/* State 1: Initial Loading from Server */}
          {presentation.visibilityState === 'LOADING' && !isConcluded && !gated && (
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
          {presentation.visibilityState === 'EMPTY' && !gated && (
            <section className="results-status-card" aria-live="polite">
              <div className="status-icon-badge" aria-hidden="true">
                <AlertCircle size={44} />
              </div>
              <h1 className="results-status-title">
                {showRoundHistory ? 'No Winner Declared' : 'No Results Available Yet'}
              </h1>
              <p className="results-status-desc">
                {showRoundHistory
                  ? 'This session finished without a tournament winner. Every round that was played is listed below.'
                  : 'There is currently no active voting round and no tournament winner declared.'}
              </p>
              <div className="results-actions">
                {routeSessionId && !showRoundHistory && (
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

          {/* State 5 (spec 0003 AC-4, AC-5, AC-9): the round timeline and totals
              panel, shown for every session that has closed a round. Sits
              outside the state cards above because a completion with no winner
              (`no_result`) reaches none of them yet still has a full history. */}
          {showRoundHistory && (
            <div className="results-history-section" style={{ width: '100%', marginTop: '2rem' }}>
              <TotalsPanel rounds={effectiveRounds} />
              <RoundTimeline rounds={effectiveRounds} winner={effectiveWinner} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default Results;