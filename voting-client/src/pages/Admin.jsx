import { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import {
  ShieldCheck,
  PlusCircle,
  Play,
  SkipForward,
  Archive,
  Share2,
  Copy,
  Check,
  X,
  ExternalLink,
  Users,
  Trophy,
  Layers,
  Clock,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Vote,
  Sliders
} from "lucide-react";
import Navbar from "../components/layout/Navbar";
import {
  selectSessionList,
  createSession,
  startSession,
  archiveSession,
  next,
  selectTimerBySessionId
} from "../redux/voteSlice";
import { getSocket, subscribeSession, unsubscribeSession } from "../services/socket";
import CountdownTimer from "../components/CountdownTimer";
import { validateTimerDuration, DEFAULT_TIMER_DURATION } from "../utils/timerUtils";
import "./Admin.css";

/**
 * Admin Panel Page Component
 * Feature 6 — Stage B: Admin Session Creation & Session Management Workflow
 *
 * Provides complete administrator workflow:
 * Create Session -> See Session -> Manage Session -> Start / Advance / Archive -> Open Lobby / Vote / Results
 *
 * Uses authoritative Socket.io action pipeline:
 * - CREATE_SESSION
 * - START_SESSION
 * - NEXT
 * - ARCHIVE_SESSION
 */
function Admin() {
  const dispatch = useDispatch();
  const sessions = useSelector(selectSessionList);
  const bySessionId = useSelector((state) => state.sessions?.bySessionId || {});

  // Form State (Modal)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSessionId, setNewSessionId] = useState("");
  const [newEntriesText, setNewEntriesText] = useState("");
  const [newTimerDuration, setNewTimerDuration] = useState(String(DEFAULT_TIMER_DURATION));
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  // Manage Session Modal State
  const [managingSessionId, setManagingSessionId] = useState(null);

  // In-flight action tracking: { [sessionId]: 'start' | 'next' | 'archive' }
  const [pendingActions, setPendingActions] = useState({});

  // Socket action errors
  const [serverError, setServerError] = useState(null);

  // Sharing & QR Code Modal
  const [qrModalSession, setQrModalSession] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [hasCopied, setHasCopied] = useState(false);

  // Confirmation modal for archiving
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState(null);

  // Metric computations
  const totalSessions = sessions.length;
  const openSessions = sessions.filter((s) => s.status === "open").length;
  const pendingSessions = sessions.filter((s) => s.status === "pending").length;
  const completedSessions = sessions.filter((s) => s.status === "completed").length;
  const archivedSessions = sessions.filter((s) => s.status === "archived").length;
  const totalVoters = sessions.reduce((sum, s) => sum + (s.voterCount || 0), 0);

  // Keyboard accessibility: Close top-most active modal on 'Escape'
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (confirmArchiveSessionId) {
          setConfirmArchiveSessionId(null);
        } else if (qrModalSession) {
          setQrModalSession(null);
        } else if (managingSessionId) {
          setManagingSessionId(null);
        } else if (showCreateModal) {
          setShowCreateModal(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmArchiveSessionId, qrModalSession, managingSessionId, showCreateModal]);

  // Socket error listener
  useEffect(() => {
    const socket = getSocket();
    if (!socket || typeof socket.on !== "function") return;

    const handleActionError = (errorPayload) => {
      const msg = errorPayload?.message ||
        `Action "${errorPayload?.action}" failed: ${errorPayload?.error || "Unauthorized or invalid."}`;
      setServerError(msg);
      // Clear all in-flight button locks upon error
      setPendingActions({});
      setIsCreating(false);
    };

    socket.on("action_error", handleActionError);
    return () => {
      if (typeof socket.off === "function") {
        socket.off("action_error", handleActionError);
      }
    };
  }, []);

  // Live room subscription for open sessions to receive authoritative timer_state & session_state
  useEffect(() => {
    const openSessions = sessions.filter((s) => s.status === "open");
    openSessions.forEach((s) => subscribeSession(s.id));

    return () => {
      openSessions.forEach((s) => unsubscribeSession(s.id));
    };
  }, [sessions]);

  // Generate QR code when a session is selected for sharing
  useEffect(() => {
    if (!qrModalSession) return;

    let isMounted = true;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const lobbyUrl = `${origin}/sessions/${encodeURIComponent(qrModalSession.id)}/lobby`;

    QRCode.toDataURL(lobbyUrl, {
      width: 260,
      margin: 2,
      color: {
        dark: "#0f172a",
        light: "#ffffff"
      }
    })
      .then((url) => {
        if (isMounted) setQrDataUrl(url);
      })
      .catch((err) => console.error("Failed to generate QR code:", err));

    return () => {
      isMounted = false;
    };
  }, [qrModalSession]);

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setShowCreateModal(true);
    setFormError(null);
    setServerError(null);
  };

  // Close Create Modal
  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
    setFormError(null);
  };

  // Form Submission
  const handleCreateSession = (e) => {
    e.preventDefault();
    setFormError(null);
    setServerError(null);
    setFormSuccess(null);

    const title = newTitle.trim();
    if (!title) {
      setFormError("Session title is required.");
      return;
    }

    // Validate timer duration
    const durationValidation = validateTimerDuration(newTimerDuration);
    if (!durationValidation.valid) {
      setFormError(durationValidation.error);
      return;
    }

    // Parse and sanitize entries (newline or comma-separated)
    const rawEntries = newEntriesText
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    // Deduplicate entries preserving order
    const entries = Array.from(new Set(rawEntries));

    if (entries.length < 2) {
      setFormError("At least 2 distinct entries are required for pairwise voting tournament.");
      return;
    }

    // Generate clean session ID if omitted
    const cleanId = (newSessionId.trim() || `sess_${Date.now()}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");

    // Check for collision in current list
    if (sessions.some((s) => s.id === cleanId)) {
      setFormError(`A session with ID "${cleanId}" already exists. Please choose a unique ID.`);
      return;
    }

    setIsCreating(true);

    // Dispatch CREATE_SESSION via socket remote action middleware
    dispatch(createSession({
      sessionId: cleanId,
      title,
      entries,
      timerDuration: durationValidation.value
    }));

    setTimeout(() => {
      setIsCreating(false);
      setFormSuccess(`Session "${title}" created successfully!`);
      setNewTitle("");
      setNewSessionId("");
      setNewEntriesText("");
      setNewTimerDuration(String(DEFAULT_TIMER_DURATION));
      setShowCreateModal(false);
    }, 400);
  };

  // Lifecycle Action Handlers
  const handleStart = (sessionId) => {
    if (pendingActions[sessionId]) return;
    setServerError(null);
    setPendingActions((prev) => ({ ...prev, [sessionId]: "start" }));

    subscribeSession(sessionId);
    dispatch(startSession(sessionId));

    // Release lock after short debounce for server round-trip
    setTimeout(() => {
      setPendingActions((prev) => {
        const nextState = { ...prev };
        delete nextState[sessionId];
        return nextState;
      });
    }, 600);
  };

  const handleNext = (sessionId) => {
    if (pendingActions[sessionId]) return;
    setServerError(null);
    setPendingActions((prev) => ({ ...prev, [sessionId]: "next" }));

    dispatch(next(sessionId));

    setTimeout(() => {
      setPendingActions((prev) => {
        const nextState = { ...prev };
        delete nextState[sessionId];
        return nextState;
      });
    }, 600);
  };

  const handleArchive = (sessionId) => {
    setConfirmArchiveSessionId(sessionId);
  };

  const confirmArchive = () => {
    const sessionId = confirmArchiveSessionId;
    if (!sessionId) return;
    setConfirmArchiveSessionId(null);

    setServerError(null);
    setPendingActions((prev) => ({ ...prev, [sessionId]: "archive" }));

    unsubscribeSession(sessionId);
    dispatch(archiveSession(sessionId));

    setTimeout(() => {
      setPendingActions((prev) => {
        const nextState = { ...prev };
        delete nextState[sessionId];
        return nextState;
      });
    }, 600);
  };

  const copyShareLink = (sessionId) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/sessions/${encodeURIComponent(sessionId)}/lobby`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setHasCopied(true);
        setTimeout(() => setHasCopied(false), 2000);
      });
    }
  };

  // Currently managed session details
  const managingSession = managingSessionId
    ? sessions.find((s) => s.id === managingSessionId)
    : null;
  const managingDetailed = managingSessionId ? (bySessionId[managingSessionId] || {}) : {};
  const managingStatus = managingSession?.status || managingDetailed?.status || "pending";
  const isManagingPending = managingStatus === "pending";
  const isManagingOpen = managingStatus === "open";
  const isManagingCompleted = managingStatus === "completed";
  const isManagingArchived = managingStatus === "archived" || managingSession?.isArchived;

  const managingVote = managingDetailed?.vote;
  const managingPair = managingVote?.pair || [];
  const managingTally = managingVote?.tally || {};
  const managingWinner = managingSession?.winner || managingDetailed?.winner;
  const managingVoterCount = managingSession?.voterCount !== undefined
    ? managingSession.voterCount
    : (managingDetailed.voterCount || 0);
  const managingEntryCount = managingSession?.entryCount !== undefined
    ? managingSession.entryCount
    : (managingDetailed.entryCount || 0);
  const managingDuration = managingSession?.timerDuration !== undefined
    ? managingSession.timerDuration
    : (managingDetailed.timerDuration !== undefined ? managingDetailed.timerDuration : 30);
  const managingTimer = managingSessionId
    ? (selectTimerBySessionId({ sessions: { bySessionId } }, managingSessionId) || managingDetailed.timer || null)
    : null;
  const managingAction = managingSessionId ? pendingActions[managingSessionId] : null;

  return (
    <div className="admin-page">
      <Navbar />

      <main className="admin-main">
        {/* Header with Prominent Create Action */}
        <header className="admin-header">
          <div className="admin-title-area">
            <h1>
              <ShieldCheck size={32} style={{ color: "#818cf8" }} />
              Admin Panel
            </h1>
            <p className="admin-subtitle">
              Authoritative tournament lifecycle management &amp; room supervision
            </p>
          </div>

          <button
            onClick={handleOpenCreateModal}
            className="admin-btn admin-btn-primary admin-btn-create-header"
            aria-haspopup="dialog"
            data-testid="admin-create-session-btn"
          >
            <PlusCircle size={18} />
            + Create New Session
          </button>
        </header>

        {/* Global Server Error Banner */}
        {serverError && (
          <div className="admin-alert admin-alert-error" role="alert" data-testid="admin-server-error-banner">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <AlertCircle size={20} />
              <span>{serverError}</span>
            </div>
            <button
              onClick={() => setServerError(null)}
              className="admin-btn admin-btn-outline"
              style={{ padding: "0.2rem 0.5rem", border: "none", color: "inherit" }}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Success Toast */}
        {formSuccess && (
          <div className="admin-alert admin-alert-success" role="status" data-testid="admin-success-toast">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <CheckCircle2 size={20} />
              <span>{formSuccess}</span>
            </div>
            <button
              onClick={() => setFormSuccess(null)}
              className="admin-btn admin-btn-outline"
              style={{ padding: "0.2rem 0.5rem", border: "none", color: "inherit" }}
              aria-label="Dismiss message"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Metric Stats Cards */}
        <section className="admin-stats-grid" aria-label="System Metrics">
          <div className="admin-stat-card">
            <span className="admin-stat-label">
              <Layers size={14} /> Total Sessions
            </span>
            <span className="admin-stat-val">{totalSessions}</span>
          </div>

          <div className="admin-stat-card">
            <span className="admin-stat-label" style={{ color: "#4ade80" }}>
              <Play size={14} /> Live / Open
            </span>
            <span className="admin-stat-val" style={{ color: "#4ade80" }}>
              {openSessions}
            </span>
          </div>

          <div className="admin-stat-card">
            <span className="admin-stat-label" style={{ color: "#fbbf24" }}>
              <Clock size={14} /> Pending
            </span>
            <span className="admin-stat-val" style={{ color: "#fbbf24" }}>
              {pendingSessions}
            </span>
          </div>

          <div className="admin-stat-card">
            <span className="admin-stat-label" style={{ color: "#c084fc" }}>
              <Trophy size={14} /> Completed
            </span>
            <span className="admin-stat-val" style={{ color: "#c084fc" }}>
              {completedSessions}
            </span>
          </div>

          <div className="admin-stat-card">
            <span className="admin-stat-label" style={{ color: "#38bdf8" }}>
              <Users size={14} /> Active Voters
            </span>
            <span className="admin-stat-val" style={{ color: "#38bdf8" }}>
              {totalVoters}
            </span>
          </div>

          <div className="admin-stat-card">
            <span className="admin-stat-label" style={{ color: "#94a3b8" }}>
              <Archive size={14} /> Archived
            </span>
            <span className="admin-stat-val" style={{ color: "#94a3b8" }}>
              {archivedSessions}
            </span>
          </div>
        </section>

        {/* Sessions Section */}
        <section aria-label="Managed Sessions">
          <div className="admin-sessions-section-header">
            <h2 className="admin-sessions-heading">
              All Registered Sessions ({sessions.length})
            </h2>
            {sessions.length > 0 && (
              <button
                onClick={handleOpenCreateModal}
                className="admin-btn admin-btn-primary admin-btn-sm"
                data-testid="admin-section-create-btn"
              >
                <PlusCircle size={15} />
                + Create New Session
              </button>
            )}
          </div>

          {sessions.length === 0 ? (
            <div
              className="admin-card admin-empty-card"
              data-testid="admin-empty-sessions"
            >
              <AlertCircle size={44} style={{ marginBottom: "1rem", color: "#64748b" }} />
              <h3 style={{ color: "#f8fafc", margin: "0 0 0.5rem 0", fontSize: "1.3rem" }}>
                No sessions yet.
              </h3>
              <p style={{ margin: "0 0 1.5rem 0", color: "#94a3b8", maxWidth: "420px" }}>
                There are currently no voting sessions registered. Click below to initialize your first tournament.
              </p>
              <button
                onClick={handleOpenCreateModal}
                className="admin-btn admin-btn-primary admin-btn-lg"
                data-testid="admin-empty-create-btn"
              >
                <PlusCircle size={18} />
                + Create New Session
              </button>
            </div>
          ) : (
            <div className="admin-sessions-list">
              {sessions.map((session) => {
                const detailedSession = bySessionId[session.id] || {};
                const currentStatus = session.status || detailedSession.status || "pending";
                const isPending = currentStatus === "pending";
                const isOpen = currentStatus === "open";
                const isCompleted = currentStatus === "completed";
                const isArchived = currentStatus === "archived" || session.isArchived;

                const activeVote = detailedSession.vote;
                const activePair = activeVote?.pair || [];
                const tally = activeVote?.tally || {};
                const winner = session.winner || detailedSession.winner;
                const voterCount = session.voterCount !== undefined
                  ? session.voterCount
                  : (detailedSession.voterCount || 0);
                const entryCount = session.entryCount !== undefined
                  ? session.entryCount
                  : (detailedSession.entryCount || 0);

                const configuredDuration = session.timerDuration !== undefined
                  ? session.timerDuration
                  : (detailedSession.timerDuration !== undefined ? detailedSession.timerDuration : 30);
                const timer = selectTimerBySessionId({ sessions: { bySessionId } }, session.id) || detailedSession.timer || null;

                return (
                  <article key={session.id} className="admin-session-item" data-testid={`session-row-${session.id}`}>
                    {/* Header */}
                    <div className="admin-session-header">
                      <div>
                        <h3 className="admin-session-title">
                          {session.title || detailedSession.title || session.id}
                        </h3>
                        <div className="admin-session-id">
                          ID: <code>{session.id}</code>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                        <span className={`admin-status-badge admin-badge-${currentStatus}`} data-testid={`session-status-badge-${session.id}`}>
                          <span className="admin-status-dot" />
                          {currentStatus}
                        </span>

                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            fontSize: "0.85rem",
                            color: "#38bdf8",
                            fontWeight: 600
                          }}
                          data-testid={`session-voters-${session.id}`}
                        >
                          <Users size={16} />
                          {voterCount} {voterCount === 1 ? "voter" : "voters"}
                        </span>

                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            fontSize: "0.85rem",
                            color: "#a5b4fc",
                            fontWeight: 500
                          }}
                          data-testid={`session-timer-duration-${session.id}`}
                          title={`Configured voting round duration: ${configuredDuration} seconds`}
                        >
                          <Clock size={15} />
                          {configuredDuration}s
                        </span>
                      </div>
                    </div>

                    {/* Active Countdown Timer for Open Session */}
                    {isOpen && (
                      <div className="admin-active-timer" data-testid={`admin-timer-${session.id}`}>
                        <CountdownTimer timer={timer} />
                      </div>
                    )}

                    {/* Metadata & Round Preview */}
                    <div className="admin-round-preview">
                      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ color: "#94a3b8" }}>
                          Total Entries: <strong style={{ color: "#f8fafc" }}>{entryCount}</strong>
                        </span>

                        <span
                          style={{ color: "#94a3b8", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                          data-testid={`admin-duration-${session.id}`}
                        >
                          <Clock size={14} /> Voting time: <strong style={{ color: "#f8fafc" }}>{configuredDuration} seconds</strong>
                        </span>

                        {/* Live Pair Matchup Preview for Open Sessions */}
                        {isOpen && activePair.length >= 2 && (
                          <div className="admin-pair-matchup">
                            <span style={{ color: "#94a3b8" }}>Active Pair:</span>
                            <span className="admin-candidate-chip">
                              {activePair[0]} ({tally[activePair[0]] || 0})
                            </span>
                            <span className="admin-vs">VS</span>
                            <span className="admin-candidate-chip">
                              {activePair[1]} ({tally[activePair[1]] || 0})
                            </span>
                          </div>
                        )}

                        {/* Winner Announcement for Completed Sessions */}
                        {isCompleted && winner && (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "#f59e0b" }}>
                            <Trophy size={16} />
                            <span>Winner: <strong style={{ color: "#fbbf24" }}>{winner}</strong></span>
                          </div>
                        )}

                        {isPending && (
                          <span style={{ color: "#fbbf24" }}>
                            Lobby waiting for administrator to start tournament.
                          </span>
                        )}

                        {isArchived && (
                          <span style={{ color: "#94a3b8" }}>
                            Archived session. Tournament is closed.
                          </span>
                        )}
                      </div>

                      {session.createdAt && (
                        <span style={{ color: "#64748b", fontSize: "0.75rem" }}>
                          Created: {new Date(session.createdAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {/* Streamlined Session Controls Toolbar */}
                    <div className="admin-session-controls">
                      {/* Left side: Navigation quick-links */}
                      <div className="admin-controls-group">
                        <Link
                          to={`/sessions/${session.id}/lobby`}
                          className="admin-btn admin-btn-outline"
                          title="View Participant Waiting Room"
                          data-testid={`quick-lobby-${session.id}`}
                        >
                          <ExternalLink size={14} /> Lobby
                        </Link>

                        {isOpen && (
                          <Link
                            to={`/sessions/${session.id}/vote`}
                            className="admin-btn admin-btn-outline"
                            title="Open Participant Voting Screen"
                            data-testid={`quick-vote-${session.id}`}
                          >
                            <Vote size={14} /> Vote View
                          </Link>
                        )}

                        {(isOpen || isCompleted) && (
                          <Link
                            to={`/sessions/${session.id}/results`}
                            className="admin-btn admin-btn-outline"
                            title="Open Live Results View"
                            data-testid={`quick-results-${session.id}`}
                          >
                            <Trophy size={14} /> Results
                          </Link>
                        )}

                        <button
                          type="button"
                          onClick={() => setQrModalSession(session)}
                          className="admin-btn admin-btn-sky"
                          title="Share Link & QR Code"
                          data-testid={`quick-share-${session.id}`}
                        >
                          <Share2 size={14} /> Share / QR
                        </button>
                      </div>

                      {/* Right side: Focused Manage Button */}
                      <div className="admin-controls-group">
                        <button
                          type="button"
                          onClick={() => {
                            setServerError(null);
                            setManagingSessionId(session.id);
                          }}
                          className="admin-btn admin-btn-manage"
                          data-testid={`manage-session-${session.id}`}
                        >
                          <Sliders size={15} />
                          [Manage]
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}

              {/* Add Session Card at end of list */}
              <button
                type="button"
                onClick={handleOpenCreateModal}
                className="admin-session-add-card"
                data-testid="admin-add-session-bottom-btn"
              >
                <PlusCircle size={18} />
                + Create Another Voting Session
              </button>
            </div>
          )}
        </section>
      </main>

      {/* ========================================================================= */}
      {/* Dedicated Session Creation Modal */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div
          className="admin-modal-overlay"
          onClick={handleCloseCreateModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-session-modal-title"
          data-testid="create-session-modal"
        >
          <div
            className="admin-modal-box admin-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header">
              <h2 id="create-session-modal-title" className="admin-modal-title">
                <PlusCircle size={22} style={{ color: "#6366f1" }} />
                Create New Tournament Session
              </h2>
              <button
                type="button"
                onClick={handleCloseCreateModal}
                className="admin-btn admin-btn-outline"
                style={{ padding: "0.25rem 0.5rem", border: "none" }}
                aria-label="Close dialog"
                data-testid="create-modal-close-btn"
              >
                <X size={18} />
              </button>
            </div>

            {/* Error alerts inside modal */}
            {formError && (
              <div className="admin-alert admin-alert-error" style={{ marginBottom: "1rem" }} data-testid="create-form-error">
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <AlertCircle size={18} />
                  <span>{formError}</span>
                </div>
              </div>
            )}

            {serverError && (
              <div className="admin-alert admin-alert-error" style={{ marginBottom: "1rem" }} data-testid="create-server-error">
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <AlertCircle size={18} />
                  <span>{serverError}</span>
                </div>
              </div>
            )}

            <form onSubmit={handleCreateSession} data-testid="create-session-form">
              <div className="admin-form-grid">
                <div className="admin-form-group">
                  <label htmlFor="session-title">Session Title *</label>
                  <input
                    id="session-title"
                    type="text"
                    className="admin-input"
                    placeholder="e.g. Best Film of 2026"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    disabled={isCreating}
                    required
                    data-testid="create-session-title-input"
                  />
                  <span className="admin-help-text">
                    Human-readable tournament name displayed to voters.
                  </span>
                </div>

                <div className="admin-form-group">
                  <label htmlFor="session-id">Custom Session ID (Optional)</label>
                  <input
                    id="session-id"
                    type="text"
                    className="admin-input"
                    placeholder="e.g. oscars-2026 (auto-generated if blank)"
                    value={newSessionId}
                    onChange={(e) => setNewSessionId(e.target.value)}
                    disabled={isCreating}
                    data-testid="create-session-id-input"
                  />
                  <span className="admin-help-text">
                    Unique slug for session URL and room identification.
                  </span>
                </div>

                <div className="admin-form-group">
                  <label htmlFor="timer-duration">Voting Timer Duration *</label>
                  <div className="admin-timer-input-row">
                    <input
                      id="timer-duration"
                      name="timerDuration"
                      type="number"
                      min="5"
                      max="300"
                      step="1"
                      className="admin-input"
                      placeholder="30"
                      value={newTimerDuration}
                      onChange={(e) => setNewTimerDuration(e.target.value)}
                      disabled={isCreating}
                      required
                      aria-label="Voting Timer Duration"
                      aria-describedby="timer-duration-help"
                      data-testid="create-session-timer-input"
                    />
                    <span className="admin-timer-unit">seconds</span>
                  </div>
                  <span id="timer-duration-help" className="admin-help-text">
                    Duration per voting round (5–300 seconds, default: 30).
                  </span>
                </div>
              </div>

              <div className="admin-form-group" style={{ marginBottom: "1.25rem" }}>
                <label htmlFor="session-entries">
                  Tournament Entries * (One per line or comma-separated)
                </label>
                <textarea
                  id="session-entries"
                  className="admin-textarea"
                  rows={5}
                  placeholder={`Dune: Part Two\nOppenheimer\nPoor Things\nThe Zone of Interest`}
                  value={newEntriesText}
                  onChange={(e) => setNewEntriesText(e.target.value)}
                  disabled={isCreating}
                  required
                  data-testid="create-session-entries-input"
                />
                <span className="admin-help-text">
                  Provide at least 2 entries. Entries will be paired authoritatively by the tournament engine.
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", borderTop: "1px solid rgba(148, 163, 184, 0.15)", paddingTop: "1rem" }}>
                <button
                  type="button"
                  onClick={handleCloseCreateModal}
                  className="admin-btn admin-btn-outline"
                  disabled={isCreating}
                  data-testid="create-session-cancel-btn"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-btn admin-btn-success"
                  disabled={isCreating}
                  data-testid="create-session-submit-btn"
                >
                  {isCreating ? (
                    <>
                      <RefreshCw size={16} className="voting-spinner" /> Creating...
                    </>
                  ) : (
                    <>
                      <PlusCircle size={16} /> Create Session
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* Dedicated Session Management Modal [Manage] */}
      {/* ========================================================================= */}
      {managingSession && (
        <div
          className="admin-modal-overlay"
          onClick={() => setManagingSessionId(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-session-modal-title"
          data-testid="manage-session-modal"
        >
          <div
            className="admin-modal-box admin-modal-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="admin-modal-header">
              <div>
                <h2 id="manage-session-modal-title" className="admin-modal-title">
                  <Sliders size={20} style={{ color: "#818cf8" }} />
                  Manage: {managingSession.title || managingDetailed.title || managingSession.id}
                </h2>
                <div style={{ fontSize: "0.8rem", color: "#94a3b8", fontFamily: "monospace", marginTop: "0.2rem" }}>
                  ID: <code>{managingSession.id}</code>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManagingSessionId(null)}
                className="admin-btn admin-btn-outline"
                style={{ padding: "0.25rem 0.5rem", border: "none" }}
                aria-label="Close dialog"
                data-testid="manage-modal-close-btn"
              >
                <X size={18} />
              </button>
            </div>

            {/* Error inside modal */}
            {serverError && (
              <div className="admin-alert admin-alert-error" style={{ marginBottom: "1rem" }} data-testid="manage-server-error">
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <AlertCircle size={18} />
                  <span>{serverError}</span>
                </div>
              </div>
            )}

            {/* Session Stats Grid */}
            <div className="admin-manage-grid">
              <div className="admin-manage-stat">
                <span className="admin-manage-stat-label">Lifecycle Status</span>
                <span className={`admin-status-badge admin-badge-${managingStatus}`} data-testid="manage-status-badge">
                  <span className="admin-status-dot" />
                  {managingStatus}
                </span>
              </div>

              <div className="admin-manage-stat">
                <span className="admin-manage-stat-label">Round Timer</span>
                <span className="admin-manage-stat-val" style={{ color: "#a5b4fc" }}>
                  {managingDuration}s
                </span>
              </div>

              <div className="admin-manage-stat">
                <span className="admin-manage-stat-label">Total Entries</span>
                <span className="admin-manage-stat-val">
                  {managingEntryCount}
                </span>
              </div>

              <div className="admin-manage-stat">
                <span className="admin-manage-stat-label">Active Voters</span>
                <span className="admin-manage-stat-val" style={{ color: "#38bdf8" }}>
                  {managingVoterCount}
                </span>
              </div>
            </div>

            {/* Live Round Details (if open) */}
            {isManagingOpen && (
              <div className="admin-manage-section" data-testid="manage-live-section">
                <h4 className="admin-manage-section-title">
                  <Play size={15} style={{ color: "#4ade80" }} /> Live Round Status
                </h4>
                {managingTimer && (
                  <div style={{ marginBottom: "0.75rem" }}>
                    <CountdownTimer timer={managingTimer} />
                  </div>
                )}
                {managingPair.length >= 2 ? (
                  <div className="admin-pair-matchup" style={{ marginTop: "0.5rem" }}>
                    <span style={{ color: "#94a3b8" }}>Active Pair:</span>
                    <span className="admin-candidate-chip">
                      {managingPair[0]} ({managingTally[managingPair[0]] || 0} votes)
                    </span>
                    <span className="admin-vs">VS</span>
                    <span className="admin-candidate-chip">
                      {managingPair[1]} ({managingTally[managingPair[1]] || 0} votes)
                    </span>
                  </div>
                ) : (
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>
                    Round is active. Voters are currently participating.
                  </p>
                )}
              </div>
            )}

            {/* Completed Winner Details */}
            {isManagingCompleted && (
              <div className="admin-manage-section" style={{ background: "rgba(245, 158, 11, 0.1)", borderColor: "rgba(245, 158, 11, 0.25)" }} data-testid="manage-completed-section">
                <h4 className="admin-manage-section-title" style={{ color: "#fbbf24" }}>
                  <Trophy size={16} /> Tournament Complete
                </h4>
                <p style={{ margin: 0, color: "#f8fafc", fontSize: "0.95rem" }}>
                  Decisive Winner: <strong style={{ color: "#fbbf24", fontSize: "1.1rem" }}>{managingWinner || "Determined"}</strong>
                </p>
              </div>
            )}

            {/* Archived Notice */}
            {isManagingArchived && (
              <div className="admin-manage-section" style={{ background: "rgba(148, 163, 184, 0.1)", borderColor: "rgba(148, 163, 184, 0.2)" }} data-testid="manage-archived-section">
                <h4 className="admin-manage-section-title" style={{ color: "#94a3b8" }}>
                  <Archive size={16} /> Session Archived
                </h4>
                <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.85rem" }}>
                  This session is permanently archived. Live voting is closed and records are retained for historical reference.
                </p>
              </div>
            )}

            {/* Lifecycle Mutation Controls Section */}
            <div className="admin-manage-section">
              <h4 className="admin-manage-section-title">
                Authoritative Lifecycle Actions
              </h4>

              <div className="admin-manage-actions-row">
                {/* Pending State Controls */}
                {isManagingPending && (
                  <button
                    type="button"
                    onClick={() => handleStart(managingSession.id)}
                    disabled={Boolean(managingAction)}
                    className="admin-btn admin-btn-success"
                    data-testid="manage-start-btn"
                  >
                    {managingAction === "start" ? (
                      <>
                        <RefreshCw size={15} className="voting-spinner" /> Starting Tournament...
                      </>
                    ) : (
                      <>
                        <Play size={15} /> Start Tournament
                      </>
                    )}
                  </button>
                )}

                {/* Open State Controls */}
                {isManagingOpen && (
                  <button
                    type="button"
                    onClick={() => handleNext(managingSession.id)}
                    disabled={Boolean(managingAction)}
                    className="admin-btn admin-btn-warning"
                    data-testid="manage-next-btn"
                  >
                    {managingAction === "next" ? (
                      <>
                        <RefreshCw size={15} className="voting-spinner" /> Advancing...
                      </>
                    ) : (
                      <>
                        <SkipForward size={15} /> Next Pair
                      </>
                    )}
                  </button>
                )}

                {/* Archive Button (Pending, Open, Completed — NOT Archived) */}
                {!isManagingArchived && (
                  <button
                    type="button"
                    onClick={() => handleArchive(managingSession.id)}
                    disabled={Boolean(managingAction)}
                    className="admin-btn admin-btn-danger"
                    data-testid="manage-archive-btn"
                  >
                    {managingAction === "archive" ? (
                      <>
                        <RefreshCw size={15} className="voting-spinner" /> Archiving...
                      </>
                    ) : (
                      <>
                        <Archive size={15} /> Archive Session
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Navigation & Sharing Shortcuts */}
            <div className="admin-manage-section">
              <h4 className="admin-manage-section-title">
                Session Navigation &amp; Room Links
              </h4>

              <div className="admin-manage-actions-row">
                <Link
                  to={`/sessions/${managingSession.id}/lobby`}
                  className="admin-btn admin-btn-outline"
                  data-testid="manage-nav-lobby"
                >
                  <ExternalLink size={14} /> Open Lobby
                </Link>

                {isManagingOpen && (
                  <Link
                    to={`/sessions/${managingSession.id}/vote`}
                    className="admin-btn admin-btn-outline"
                    data-testid="manage-nav-vote"
                  >
                    <Vote size={14} /> Vote View
                  </Link>
                )}

                {(isManagingOpen || isManagingCompleted || isManagingArchived) && (
                  <Link
                    to={`/sessions/${managingSession.id}/results`}
                    className="admin-btn admin-btn-outline"
                    data-testid="manage-nav-results"
                  >
                    <Trophy size={14} /> View Results
                  </Link>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setQrModalSession(managingSession);
                  }}
                  className="admin-btn admin-btn-sky"
                  data-testid="manage-nav-share"
                >
                  <Share2 size={14} /> Share Link / QR
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid rgba(148, 163, 184, 0.15)", paddingTop: "1rem" }}>
              <button
                type="button"
                onClick={() => setManagingSessionId(null)}
                className="admin-btn admin-btn-outline"
                style={{ minWidth: "100px" }}
                data-testid="manage-close-btn"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* QR Code & Share Modal */}
      {/* ========================================================================= */}
      {qrModalSession && (
        <div
          className="admin-modal-overlay"
          onClick={() => setQrModalSession(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-modal-title"
          data-testid="qr-modal"
        >
          <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 id="qr-modal-title" style={{ margin: 0, fontSize: "1.25rem", color: "#f8fafc" }}>
                Session Share &amp; QR
              </h3>
              <button
                onClick={() => setQrModalSession(null)}
                className="admin-btn admin-btn-outline"
                style={{ padding: "0.25rem 0.5rem", border: "none" }}
                aria-label="Close dialog"
                data-testid="qr-close-btn"
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ color: "#94a3b8", fontSize: "0.9rem", margin: 0 }}>
              Scan with a mobile camera to join the waiting room lobby:
            </p>
            <div style={{ fontWeight: 600, color: "#818cf8", margin: "0.25rem 0 1rem 0" }}>
              {qrModalSession.title || qrModalSession.id}
            </div>

            {qrDataUrl ? (
              <div className="admin-qr-wrapper">
                <img src={qrDataUrl} alt={`QR Code for ${qrModalSession.id}`} width={240} height={240} />
              </div>
            ) : (
              <div style={{ padding: "3rem 1rem", color: "#94a3b8" }}>
                <RefreshCw size={32} className="voting-spinner" />
                <p>Generating QR Code...</p>
              </div>
            )}

            <div className="admin-share-input-group">
              <input
                type="text"
                readOnly
                className="admin-share-input"
                value={`${typeof window !== "undefined" ? window.location.origin : ""}/sessions/${encodeURIComponent(qrModalSession.id)}/lobby`}
                data-testid="qr-share-url-input"
              />
              <button
                type="button"
                onClick={() => copyShareLink(qrModalSession.id)}
                className="admin-btn admin-btn-primary"
                style={{ padding: "0.5rem 0.9rem" }}
                data-testid="qr-copy-btn"
              >
                {hasCopied ? <Check size={16} /> : <Copy size={16} />}
                {hasCopied ? "Copied" : "Copy"}
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                onClick={() => setQrModalSession(null)}
                className="admin-btn admin-btn-outline"
                style={{ width: "100%" }}
                data-testid="qr-done-btn"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* Confirmation Modal for Archiving */}
      {/* ========================================================================= */}
      {confirmArchiveSessionId && (
        <div
          className="admin-modal-overlay"
          onClick={() => setConfirmArchiveSessionId(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-modal-title"
          data-testid="confirm-archive-modal"
        >
          <div className="admin-modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              <Archive size={44} style={{ color: "#ef4444", marginBottom: "0.75rem" }} />
              <h3 id="archive-modal-title" style={{ margin: "0 0 0.5rem 0", fontSize: "1.3rem", color: "#f8fafc" }}>
                Confirm Session Archival
              </h3>
              <p style={{ color: "#94a3b8", fontSize: "0.9rem", margin: 0 }}>
                Are you sure you want to archive session <strong>{confirmArchiveSessionId}</strong>?
                This closes all live voting and moves the session to read-only historical state.
              </p>
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={() => setConfirmArchiveSessionId(null)}
                className="admin-btn admin-btn-outline"
                style={{ flex: 1 }}
                data-testid="archive-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmArchive}
                className="admin-btn admin-btn-danger"
                style={{ flex: 1 }}
                data-testid="archive-confirm-btn"
              >
                Yes, Archive Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Admin;
