import { useEffect, useMemo, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Link } from 'react-router-dom';
import { Trophy, RefreshCw, AlertCircle, Calendar, Users, ArrowRight, Home, Lock, EyeOff, Globe } from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import {
  loadHistory,
  selectHistoryItems,
  selectHistoryLoading,
  selectHistoryError
} from '../redux/historySlice';
import './History.css';

/**
 * A result the archive shows only to the session's participants and the admin:
 * a secured result the admin has not published. Everything else in the list is
 * public to everyone, whether it is a public session's result or a secured one
 * that has been published. A row with no publish flag is read as unpublished,
 * the same default the server applies.
 *
 * @param {Object} item A history row
 * @returns {boolean}
 */
function isPrivateResult(item) {
  return item.type === 'secured' && item.publishResultsPublicly !== true;
}

/**
 * Sort choices for the archive. Each one carries a single sensible direction,
 * so the control stays one choice rather than a key plus a direction toggle:
 * newest first by completion, champions A to Z, most candidates first.
 */
const SORT_OPTIONS = [
  { value: 'date', label: 'Newest first' },
  { value: 'champion', label: 'Champion A to Z' },
  { value: 'candidates', label: 'Most candidates' }
];

/**
 * Completion time as a number. A row with no completion date sorts last under
 * the newest first default instead of jumping to the top.
 *
 * @param {Object} item A history row
 * @returns {number}
 */
function completionTime(item) {
  const time = item.completedAt ? new Date(item.completedAt).getTime() : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}

/**
 * The champion name to sort on, lowercased, or null when the session ended with
 * no official champion. Null sorts last, so an outcome that named nobody never
 * crowds the top of a name ordering.
 *
 * @param {Object} item A history row
 * @returns {string|null}
 */
function championSortKey(item) {
  return typeof item.winner === 'string' && item.winner.trim() !== ''
    ? item.winner.trim().toLowerCase()
    : null;
}

/**
 * Candidate count to sort on; a row with no entries array counts as zero.
 *
 * @param {Object} item A history row
 * @returns {number}
 */
function candidateCount(item) {
  return Array.isArray(item.entries) ? item.entries.length : 0;
}

/**
 * Results History Page
 * Displays concluded tournament outcomes from MongoDB.
 * Read only, and scoped to the caller by the server: it lists public results
 * for everyone plus the caller's own private ones, which the filter below can
 * separate.
 */
function History() {
  const dispatch = useDispatch();
  const items = useSelector(selectHistoryItems);
  const loading = useSelector(selectHistoryLoading);
  const error = useSelector(selectHistoryError);

  useEffect(() => {
    dispatch(loadHistory());
  }, [dispatch]);

  // The viewer's lens on the list. It narrows what the server already sent, so
  // it never widens visibility: a private row is only ever present here when
  // the server decided this caller may see it.
  const [filter, setFilter] = useState('all');

  // Ordering is independent of the filter, so a viewer can both narrow the list
  // and reorder what is left. Newest first is the server's own order and the
  // default.
  const [sort, setSort] = useState('date');

  const { privateItems, publishedItems } = useMemo(() => {
    const priv = [];
    const pub = [];
    for (const item of items) {
      (isPrivateResult(item) ? priv : pub).push(item);
    }
    return { privateItems: priv, publishedItems: pub };
  }, [items]);

  // Offer the filter only when the archive actually holds both kinds of row, so
  // a visitor with nothing to narrow never meets dead chips.
  const showFilter = privateItems.length > 0 && publishedItems.length > 0;
  const activeFilter = showFilter ? filter : 'all';
  const visibleItems = activeFilter === 'private'
    ? privateItems
    : activeFilter === 'published'
      ? publishedItems
      : items;

  const filterOptions = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'private', label: 'Private', count: privateItems.length },
    { key: 'published', label: 'Published', count: publishedItems.length }
  ];

  const sortedItems = useMemo(() => {
    const rows = [...visibleItems];
    rows.sort((a, b) => {
      if (sort === 'champion') {
        const nameA = championSortKey(a);
        const nameB = championSortKey(b);
        if (nameA === null && nameB === null) return completionTime(b) - completionTime(a);
        if (nameA === null) return 1;
        if (nameB === null) return -1;
        if (nameA !== nameB) return nameA < nameB ? -1 : 1;
      } else if (sort === 'candidates') {
        const byCount = candidateCount(b) - candidateCount(a);
        if (byCount !== 0) return byCount;
      }
      // The default ordering, and every tie: newest first.
      return completionTime(b) - completionTime(a);
    });
    return rows;
  }, [visibleItems, sort]);

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

          {/* State 4: Success / Controls + History List */}
          {!loading && !error && items.length > 0 && (
            <>
              {items.length > 1 && (
                <div className="history-controls">
                  <div className="history-toolbar">
                    {showFilter && (
                      <div className="history-filter" role="group" aria-label="Filter results by visibility">
                        {filterOptions.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            className={`history-filter-btn${activeFilter === option.key ? ' history-filter-btn--active' : ''}`}
                            aria-pressed={activeFilter === option.key}
                            aria-label={`${option.label} (${option.count})`}
                            onClick={() => setFilter(option.key)}
                          >
                            <span>{option.label}</span>
                            <span className="history-filter-count">{option.count}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="history-sort">
                      <label className="history-sort-label" htmlFor="history-sort">Sort</label>
                      <select
                        id="history-sort"
                        className="history-sort-select"
                        value={sort}
                        onChange={(event) => setSort(event.target.value)}
                      >
                        {SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {showFilter && (
                    <p className="history-filter-hint">
                      Private results are visible only to the session&apos;s participants. Published results are visible to everyone.
                    </p>
                  )}
                </div>
              )}

              <div className="history-grid">
              {sortedItems.map((item) => {
                const formattedDate = item.completedAt
                  ? new Date(item.completedAt).toLocaleString()
                  : 'Recently concluded';

                const entriesCount = Array.isArray(item.entries) ? item.entries.length : 0;

                // A session can complete with no official winner (spec 0008
                // AC-5 lists it like any other completed result), so the banner
                // names that outcome instead of rendering an empty champion.
                const hasWinner = typeof item.winner === 'string' && item.winner.trim() !== '';

                // Spec 0008 AC-9: the archive listing carries the session type,
                // so a secured result reads as secured here and not only on its
                // own result page. Anything the server did not mark as secured
                // is public, the same default the server applies.
                const isSecured = item.type === 'secured';

                // Participant result visibility is separate from public
                // publication. The server lists an unpublished secured result
                // only for its participants and the admin, so a viewer holding
                // one is looking at their own private outcome. The listing now
                // carries the publish flag, which is what lets the card say a
                // private result apart from one the admin has published to
                // everyone. A row with no flag is read as unpublished, the
                // same default the server applies.
                const isPublished = item.publishResultsPublicly === true;

                return (
                  <article key={item.sessionId || item._id} className="history-item-card">
                    <div className="history-item-header">
                      <h2 className="history-item-title" data-testid="history-item-title">
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
                        {isSecured && (
                          <span
                            className={`history-item-visibility-badge${isPublished ? ' history-item-visibility-badge--published' : ''}`}
                            data-testid="history-visibility-badge"
                          >
                            {isPublished
                              ? (<><Globe size={12} aria-hidden="true" /><span>Published</span></>)
                              : (<><EyeOff size={12} aria-hidden="true" /><span>Participants only</span></>)}
                          </span>
                        )}
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default History;
