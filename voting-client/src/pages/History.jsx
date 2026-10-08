import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Link } from 'react-router-dom';
import { Trophy, RefreshCw, AlertCircle, Calendar, Users, ArrowRight, Home, Lock } from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import {
  loadHistory,
  selectHistoryItems,
  selectHistoryLoading,
  selectHistoryError
} from '../redux/historySlice';
import './History.css';

/**
 * Results History Page
 * Displays concluded tournament outcomes from MongoDB.
 * Purely public and read-only.
 */
function History() {
  const dispatch = useDispatch();
  const items = useSelector(selectHistoryItems);
  const loading = useSelector(selectHistoryLoading);
  const error = useSelector(selectHistoryError);

  useEffect(() => {
    dispatch(loadHistory());
  }, [dispatch]);

  const handleRetry = () => {
    dispatch(loadHistory());
  };

  return (
    <div className="history-page">
      <Navbar />

      <main className="history-main">
        <div className="history-container">
          <header className="history-header">
            <span className="history-badge">Results Archive</span>
            <h1 className="history-title">Tournament History</h1>
            <p className="history-subtitle">
              Browse authoritative outcomes and champions of completed voting tournaments.
            </p>
          </header>

          {/* State 1: Loading */}
          {loading && (
            <section className="history-status-card" aria-live="polite">
              <div className="history-status-icon">
                <RefreshCw size={44} className="history-spinner" aria-hidden="true" />
              </div>
              <h2 className="history-card-title">Loading Tournament History...</h2>
              <p className="history-card-desc">
                Retrieving completed tournament records from the persistent archive.
              </p>
            </section>
          )}

          {/* State 2: Error */}
          {!loading && error && (
            <section className="history-status-card" aria-live="assertive">
              <div className="history-status-icon">
                <AlertCircle size={44} style={{ color: '#ef4444' }} aria-hidden="true" />
              </div>
              <h2 className="history-card-title">Failed to Load History</h2>
              <p className="history-card-desc">
                {error}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="history-btn history-btn-primary"
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>Try Again</span>
              </button>
            </section>
          )}

          {/* State 3: Empty State */}
          {!loading && !error && items.length === 0 && (
            <section className="history-status-card" aria-live="polite">
              <div className="history-status-icon">
                <AlertCircle size={44} style={{ color: '#94a3b8' }} aria-hidden="true" />
              </div>
              <h2 className="history-card-title">No Completed Tournaments Yet</h2>
              <p className="history-card-desc">
                Once pairwise voting sessions complete and an official winner is declared, their full tournament outcomes will be archived here.
              </p>
              <Link to="/sessions" className="history-btn history-btn-primary">
                <Home size={16} aria-hidden="true" />
                <span>View Active Sessions</span>
              </Link>
            </section>
          )}

          {/* State 4: Success / History List */}
          {!loading && !error && items.length > 0 && (
            <div className="history-grid">
              {items.map((item) => {
                const formattedDate = item.completedAt
                  ? new Date(item.completedAt).toLocaleString()
                  : 'Recently concluded';

                const entriesCount = Array.isArray(item.entries) ? item.entries.length : 0;

                // A session can complete with no official winner (spec 0008
                // AC-5 lists it like any other completed result), so the banner
                // names that outcome instead of rendering an empty champion.
                const hasWinner = typeof item.winner === 'string' && item.winner.trim() !== '';

                // Spec 0008 AC-9: the archive listing carries the session type,
                // so a published secured result reads as secured here and not
                // only on its own result page. Anything the server did not mark
                // as secured is public, the same default the server applies.
                const isSecured = item.type === 'secured';

                return (
                  <article key={item.sessionId || item._id} className="history-item-card">
                    <div className="history-item-header">
                      <h2 className="history-item-title">
                        {item.title || item.sessionId}
                      </h2>
                      <div className="history-item-badges">
                        <span className="history-item-status-badge">Completed</span>
                        <span
                          className={`history-item-type-badge${isSecured ? ' history-item-type-badge--secured' : ''}`}
                          data-testid="history-type-badge"
                        >
                          {isSecured
                            ? (<><Lock size={12} aria-hidden="true" /><span>Secured</span></>)
                            : 'Public'}
                        </span>
                      </div>
                    </div>

                    <div className="history-item-body">
                      <div className="history-winner-banner" data-testid="history-outcome">
                        {hasWinner ? (
                          <Trophy size={20} className="history-trophy-icon" aria-hidden="true" />
                        ) : (
                          <AlertCircle size={20} className="history-trophy-icon" aria-hidden="true" />
                        )}
                        <div>
                          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#eab308', display: 'block', fontWeight: 600 }}>
                            {hasWinner ? 'Official Champion' : 'Outcome'}
                          </span>
                          <span className="history-winner-text" data-testid="history-winner-text">
                            {hasWinner ? item.winner : 'No official champion was declared.'}
                          </span>
                        </div>
                      </div>

                      <div className="history-item-meta">
                        <div className="history-meta-entry">
                          <Calendar size={15} aria-hidden="true" />
                          <span>{formattedDate}</span>
                        </div>
                        {entriesCount > 0 && (
                          <div className="history-meta-entry">
                            <Users size={15} aria-hidden="true" />
                            <span>{entriesCount} Tournament Candidates</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="history-item-actions">
                      <Link
                        to={`/sessions/${item.sessionId}/results`}
                        className="history-btn history-btn-secondary"
                      >
                        <span>View Result Details</span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default History;
