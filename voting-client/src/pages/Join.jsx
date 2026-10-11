import { useState, useEffect, useCallback } from "react";
import { useDispatch } from "react-redux";
import { useParams, useNavigate } from "react-router-dom";
import Navbar from "../components/layout/Navbar";
import Footer from "../components/layout/Footer";
import { apiRequest } from "../services/api";
import { lobbyUpdate } from "../redux/voteSlice";
import { KeyRound, ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import "./Join.css";

function Join() {
  const { code: urlCode } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [code, setCode] = useState(() => {
    if (urlCode && typeof urlCode === "string") {
      return urlCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    }
    return "";
  });

  const [error, setError] = useState(null);
  const [isResolving, setIsResolving] = useState(false);

  const resolveCode = useCallback(async (codeToResolve) => {
    const normalized = (codeToResolve || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (normalized.length !== 6) {
      setError("Please enter a valid 6-character code.");
      return;
    }

    setIsResolving(true);
    setError(null);

    try {
      // apiRequest owns credentials, the admin header, and transport error
      // handling for every own-server call. The resolver is public, so it needs
      // no body and no special headers.
      const res = await apiRequest(`/api/join/${encodeURIComponent(normalized)}`);
      const data = res.data || {};

      if (!res.networkError && res.ok && data.sessionId) {
        // A secured session's lobby read is gated on the server (spec 0008
        // AC-14), so a signed in voter who is not an approved participant yet
        // gets a `404` and the lobby renders its neutral not available state.
        // The join code is the capability the admin hands out, so the resolver
        // metadata is the seed the lobby needs to render the secured sign in
        // wall and join form. Without it an approval mode voter can never file
        // the request the admin is waiting for, and an allowlisted voter never
        // reaches the join form either.
        if (data.sessionType === "secured") {
          dispatch(lobbyUpdate({
            sessionId: data.sessionId,
            title: data.name || "",
            status: data.status,
            sessionType: "secured",
            type: "secured",
            // Resolver responses from before this field existed omit it, and
            // the lobby's own fallback is the allowlist, so match it here.
            whoCanJoin: data.whoCanJoin || "allowlist"
          }));
        }
        navigate(`/sessions/${encodeURIComponent(data.sessionId)}/lobby`);
      } else if (res.status === 429) {
        setError(data.error || "Too many requests, please wait.");
      } else if (res.status === 503) {
        setError(data.error || "Service temporarily unavailable.");
      } else if (res.networkError) {
        // A transport failure is not a verdict on the code, so it keeps its own
        // honest message rather than borrowing "code not found".
        setError("Unable to reach voting server. Please check your connection.");
      } else {
        setError(data.error || "Code not found or no longer active.");
      }
    } catch {
      setError("Unable to reach voting server. Please check your connection.");
    } finally {
      setIsResolving(false);
    }
  }, [navigate, dispatch]);

  // Auto-resolve when accessed via /join/:code
  useEffect(() => {
    if (urlCode && typeof urlCode === "string") {
      const sanitized = urlCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (sanitized.length === 6) {
        const timer = setTimeout(() => {
          resolveCode(sanitized);
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [urlCode, resolveCode]);

  const handleInputChange = (e) => {
    const rawValue = e.target.value || "";
    const sanitized = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    setCode(sanitized);
    if (error) {
      setError(null);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (code.length === 6 && !isResolving) {
      resolveCode(code);
    }
  };

  const isSubmitDisabled = code.length !== 6 || isResolving;

  return (
    <div className="join-page">
      <Navbar />

      <main className="join-main">
        <div className="join-card">
          <div className="join-header">
            <div className="join-badge">
              <KeyRound size={16} /> Voter Access
            </div>
            <h1>Join Voting Session</h1>
            <p>Enter the 6-character join code or scan a QR code to enter the waiting room lobby.</p>
          </div>

          <form onSubmit={handleSubmit} className="join-form" data-testid="join-form">
            <div className="join-input-wrapper">
              <label htmlFor="join-code-input">Session Join Code</label>
              <input
                id="join-code-input"
                type="text"
                className="join-code-field"
                placeholder="ABC123"
                value={code}
                onChange={handleInputChange}
                maxLength={6}
                autoFocus
                autoComplete="off"
                spellCheck="false"
                disabled={isResolving}
                data-testid="join-code-input"
              />
            </div>

            {error && (
              <div className="join-error-box" role="alert" data-testid="join-error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              id="join-btn"
              className="join-btn"
              disabled={isSubmitDisabled}
              data-testid="join-btn"
            >
              {isResolving ? (
                <>
                  <Loader2 size={18} className="join-spinner" /> Joining...
                </>
              ) : (
                <>
                  Enter Lobby <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="join-footer-hint">
            Received a link? Paste it in your browser address bar to join automatically.
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Join;
