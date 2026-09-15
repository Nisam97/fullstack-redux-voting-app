import { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  Users,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Clock,
  Trophy,
  UserCheck,
  LogIn,
  Layers,
  CheckCircle2,
  ShieldCheck,
  Radio
} from "lucide-react";
import Navbar from "../components/layout/Navbar";
import {
  setActiveSession,
  selectSessionById,
  selectVoterCount,
  selectHasLoaded,
  lobbyUpdate
} from "../redux/voteSlice";
import {
  subscribeSession,
  unsubscribeSession,
  SERVER_URL
} from "../services/socket";
import {
  hasJoinedSession,
  getVoterDisplayName,
  joinVoterSession
} from "../services/auth";
import "./Lobby.css";

/**
 * Waiting Room Lobby UI & Live Headcount Component for Stage E.
 * 
 * Provides participant-facing Waiting Room experience:
 * - Session identification and metadata (title, status, voterCount)
 * - Display-name entry & join flow with session-scoped voter token storage
 * - Live headcount updates reactive to Socket.io lobby_update broadcasts
 * - Lifecycle state handling:
 *     * pending: waiting screen with participant headcount
 *     * open: auto or guided transition to /sessions/:id/vote
 *     * completed: announcement of winner and link to /sessions/:id/results
 *     * archived: clear archive state notice
 *     * does-not-exist: gracefully rendered not-found state without crashing
 * - Multi-session isolation: isolated by route parameter :id
 */
function Lobby() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { id: routeSessionId } = useParams();

  // Route parameter is authoritative
  const session = useSelector((state) => selectSessionById(state, routeSessionId));
  const voterCount = useSelector((state) => selectVoterCount(state, routeSessionId));
  const hasLoaded = useSelector((state) => selectHasLoaded(state, routeSessionId));

  // Local component states
  const [fetchError, setFetchError] = useState(null);
  const [isLoading, setIsLoading] = useState(!session);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);

  // Local override state for instant reactivity upon successful join
  const [hasJoinedOverride, setHasJoinedOverride] = useState(null);
  const [customVoterName, setCustomVoterName] = useState("");
  const [lastRouteSessionId, setLastRouteSessionId] = useState(routeSessionId);

  // Reset local join override if route changes
  if (lastRouteSessionId !== routeSessionId) {
    setLastRouteSessionId(routeSessionId);
    setHasJoinedOverride(null);
    setCustomVoterName("");
    setJoinError(null);
    setFetchError(null);
  }

  // Voter membership status
  const isJoined = hasJoinedOverride !== null
    ? hasJoinedOverride
    : hasJoinedSession(routeSessionId);

  const storedDisplayName = customVoterName || getVoterDisplayName(routeSessionId) || "";

  // Subscribe to room and fetch initial lobby metadata for instant hydration (e.g. from QR scan)
  useEffect(() => {
    if (!routeSessionId) return;

    dispatch(setActiveSession(routeSessionId));
    subscribeSession(routeSessionId);

    let isMounted = true;
    fetch(`${SERVER_URL}/api/sessions/${encodeURIComponent(routeSessionId)}/lobby`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error("SESSION_NOT_FOUND");
          }
          throw new Error("LOBBY_FETCH_FAILED");
        }
        return res.json();
      })
      .then((data) => {
        if (isMounted) {
          setIsLoading(false);
          if (data && data.success) {
            // Dispatch lobbyUpdate to hydrate Redux store immediately
            dispatch(lobbyUpdate({
              sessionId: routeSessionId,
              title: data.title,
              status: data.status,
              voterCount: data.voterCount,
              entryCount: data.entryCount,
              isArchived: data.isArchived,
              votingStarted: data.votingStarted
            }));
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          setIsLoading(false);
          if (err.message === "SESSION_NOT_FOUND") {
            setFetchError("Session not found.");
          } else {
            setFetchError("Unable to load session lobby.");
          }
        }
      });

    return () => {
      isMounted = false;
      unsubscribeSession(routeSessionId);
    };
  }, [routeSessionId, dispatch]);

  const status = session?.status || "pending";
  const title = session?.title || (hasLoaded ? "Untitled Session" : routeSessionId);
  const isArchived = session?.isArchived || status === "archived";
  const winner = session?.winner || null;
  const entryCount = session?.entryCount !== undefined
    ? session.entryCount
    : (Array.isArray(session?.entries) ? session.entries.length : 0);

  // Automatic transition: When session becomes open and participant has already joined, navigate to vote
  useEffect(() => {
    if (status === "open" && isJoined && routeSessionId) {
      navigate(`/sessions/${routeSessionId}/vote`);
    }
  }, [status, isJoined, routeSessionId, navigate]);

  // Handle participant join submission
  const handleJoinSubmit = async (e) => {
    e.preventDefault();
    const trimmed = displayNameInput.trim();

    if (!trimmed) {
      setJoinError("Please enter a display name to join.");
      return;
    }

    setJoinError(null);
    setIsJoining(true);

    try {
      const res = await joinVoterSession({
        sessionId: routeSessionId,
        displayName: trimmed
      });

      if (!res.success) {
        setJoinError(res.message || "Failed to join session. Please try again.");
        setIsJoining(false);
        return;
      }

      // Success
      setHasJoinedOverride(true);
      setCustomVoterName(res.displayName || trimmed);
      setIsJoining(false);

      // If headcount returned in response, update Redux store immediately
      if (typeof res.voterCount === "number") {
        dispatch(lobbyUpdate({
          sessionId: routeSessionId,
          voterCount: res.voterCount
        }));
      }

      // Case B: If session is already open upon join, redirect directly to voting
      if (status === "open") {
        navigate(`/sessions/${routeSessionId}/vote`);
      }
    } catch {
      setJoinError("Network error. Unable to join session.");
      setIsJoining(false);
    }
  };

  return (
    <div className="lobby-page">
      <Navbar />

      <main className="lobby-main">
        {fetchError && !session ? (
          <div className="lobby-card" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
            <AlertCircle size={48} style={{ color: "#ef4444", margin: "0 auto 1rem auto" }} />
            <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 0.5rem 0" }}>
              Session Not Found
            </h1>
            <p style={{ color: "#94a3b8", fontSize: "0.95rem", marginBottom: "1.5rem" }}>
              The requested session <code>{routeSessionId}</code> does not exist or has been removed.
            </p>
            <Link to="/sessions" className="lobby-action-btn lobby-btn-primary">
              Browse Available Sessions
            </Link>
          </div>
        ) : isLoading && !session ? (
          <div className="lobby-card" style={{ textAlign: "center", padding: "3.5rem 1.5rem" }}>
            <RefreshCw
              size={36}
              className="voting-spinner"
              style={{ color: "#38bdf8", margin: "0 auto 1.25rem auto" }}
            />
            <h2 style={{ fontSize: "1.3rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>
              Connecting to Waiting Room...
            </h2>
            <p style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
              Subscribing to session <code>{routeSessionId}</code>
            </p>
          </div>
        ) : (
          <article className="lobby-card">
            {/* Header / Session Metadata */}
            <div className="lobby-header">
              <span
                className={`lobby-badge ${
                  isArchived
                    ? "lobby-badge-archived"
                    : status === "open"
                    ? "lobby-badge-open"
                    : status === "completed"
                    ? "lobby-badge-completed"
                    : "lobby-badge-pending"
                }`}
              >
                <span className="lobby-badge-dot" />
                {isArchived ? "Archived" : status}
              </span>

              <div className="lobby-pulse-indicator">
                <span className="lobby-pulse-circle" />
                <span>Live Waiting Room</span>
              </div>
            </div>

            <h1 className="lobby-title">{title}</h1>

            <div className="lobby-session-meta">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                <Clock size={15} /> Session ID: <code>{routeSessionId}</code>
              </span>
              {entryCount > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                  <Layers size={15} /> {entryCount} {entryCount === 1 ? "entry" : "entries"}
                </span>
              )}
              {winner && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", color: "#fbbf24" }}>
                  <Trophy size={15} /> Winner: <strong>{winner}</strong>
                </span>
              )}
            </div>

            {/* Live Headcount Banner */}
            <div className="lobby-headcount-box">
              <div className="lobby-headcount-left">
                <div className="lobby-headcount-icon">
                  <Users size={24} />
                </div>
                <div className="lobby-headcount-text">
                  <h3>
                    {voterCount} {voterCount === 1 ? "Participant" : "Participants"} Waiting
                  </h3>
                  <p>Authoritative live headcount updated in real time</p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "#38bdf8", fontSize: "0.85rem", fontWeight: 500 }}>
                <Radio size={16} /> Room Connected
              </div>
            </div>

            {/* Voter Status / Join Form Section */}
            {isArchived ? (
              <div className="lobby-status-banner lobby-status-archived">
                <AlertCircle size={20} style={{ color: "#94a3b8", flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>Session Archived</strong>
                  <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.9rem" }}>
                    This voting session has been archived by the administrator. Joining and voting are closed.
                  </p>
                </div>
              </div>
            ) : isJoined ? (
              <div className="lobby-voter-card">
                <div className="lobby-voter-info">
                  <div className="lobby-voter-avatar">
                    {storedDisplayName ? storedDisplayName[0].toUpperCase() : "V"}
                  </div>
                  <div className="lobby-voter-details">
                    <h4>{storedDisplayName || "Participant"}</h4>
                    <p>
                      <UserCheck size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                      Joined to this session
                    </p>
                  </div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", color: "#4ade80", fontSize: "0.85rem", fontWeight: 600 }}>
                  <ShieldCheck size={16} /> Session-Scoped Pass Active
                </div>
              </div>
            ) : (
              <section className="lobby-join-section">
                <h3 className="lobby-join-title">
                  <LogIn size={20} style={{ color: "#38bdf8" }} />
                  Join this Voting Session
                </h3>
                <p className="lobby-join-desc">
                  Enter a display name to participate. No email or password required. You will be automatically admitted to voting once the host starts the tournament.
                </p>

                {joinError && (
                  <div className="lobby-alert-error" role="alert">
                    <AlertCircle size={18} />
                    <span>{joinError}</span>
                  </div>
                )}

                <form onSubmit={handleJoinSubmit} className="lobby-join-form">
                  <div className="lobby-input-group">
                    <label htmlFor="displayName">Display Name</label>
                    <input
                      id="displayName"
                      type="text"
                      className="lobby-input"
                      placeholder="e.g. Alex, Maya, Voter123"
                      value={displayNameInput}
                      onChange={(e) => setDisplayNameInput(e.target.value)}
                      disabled={isJoining}
                      autoComplete="off"
                      maxLength={50}
                    />
                  </div>

                  <button
                    type="submit"
                    className="lobby-action-btn lobby-btn-primary"
                    disabled={isJoining || !displayNameInput.trim()}
                    style={{ alignSelf: "flex-start" }}
                  >
                    {isJoining ? (
                      <>
                        <RefreshCw size={16} className="voting-spinner" /> Joining...
                      </>
                    ) : (
                      <>
                        Join Session <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </form>
              </section>
            )}

            {/* Lifecycle Status Messaging */}
            {status === "pending" && !isArchived && (
              <div className="lobby-status-banner lobby-status-pending">
                <Clock size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ fontSize: "1rem" }}>Waiting for the tournament to start</strong>
                  <p style={{ margin: "0.3rem 0 0 0", fontSize: "0.9rem" }}>
                    The session administrator has not started voting yet. Once the session opens, you will be automatically redirected to the voting round.
                  </p>
                </div>
              </div>
            )}

            {status === "open" && (
              <div className="lobby-status-banner lobby-status-open">
                <CheckCircle2 size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ fontSize: "1rem" }}>Voting is Live!</strong>
                  <p style={{ margin: "0.3rem 0 0 0", fontSize: "0.9rem" }}>
                    The tournament is currently underway. Proceed to the voting arena to cast your ballot.
                  </p>
                </div>
              </div>
            )}

            {status === "completed" && (
              <div className="lobby-status-banner lobby-status-completed">
                <Trophy size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ fontSize: "1rem" }}>Tournament Completed</strong>
                  <p style={{ margin: "0.3rem 0 0 0", fontSize: "0.9rem" }}>
                    Voting has finished for this session. The community selected{" "}
                    <strong>{winner || "the final winner"}</strong>.
                  </p>
                </div>
              </div>
            )}

            {/* Navigation Controls */}
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1.75rem" }}>
              {status === "open" && (
                <Link
                  to={`/sessions/${routeSessionId}/vote`}
                  className="lobby-action-btn lobby-btn-success"
                >
                  Enter Voting Room <ArrowRight size={18} />
                </Link>
              )}

              {(status === "completed" || status === "open") && (
                <Link
                  to={`/sessions/${routeSessionId}/results`}
                  className="lobby-action-btn lobby-btn-outline"
                >
                  <Trophy size={16} /> View Results
                </Link>
              )}

              <Link
                to="/sessions"
                className="lobby-action-btn lobby-btn-outline"
              >
                All Sessions
              </Link>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}

export default Lobby;
