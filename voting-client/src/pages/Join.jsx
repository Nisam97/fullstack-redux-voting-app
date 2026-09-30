import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Navbar from "../components/layout/Navbar";
import Footer from "../components/layout/Footer";
import { SERVER_URL } from "../services/socket";
import { KeyRound, ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import "./Join.css";

function Join() {
  const { code: urlCode } = useParams();
  const navigate = useNavigate();

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
      const response = await fetch(`${SERVER_URL}/api/join/${encodeURIComponent(normalized)}`);
      const data = await response.json().catch(() => ({}));

      if (response.ok && data && data.sessionId) {
        navigate(`/sessions/${encodeURIComponent(data.sessionId)}/lobby`);
      } else if (response.status === 429) {
        setError(data.error || "Too many requests, please wait.");
      } else if (response.status === 503) {
        setError(data.error || "Service temporarily unavailable.");
      } else {
        setError(data.error || "Code not found or no longer active.");
      }
    } catch {
      setError("Unable to reach voting server. Please check your connection.");
    } finally {
      setIsResolving(false);
    }
  }, [navigate]);

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
