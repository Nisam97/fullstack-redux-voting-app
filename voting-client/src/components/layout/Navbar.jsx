import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { isAdminLoggedIn, logoutAdmin, getAdminUser, logoutVoter } from "../../services/auth";
import { selectCurrentVoter, selectIsVoterLoggedIn, clearVoterAuth } from "../../redux/voterAuthSlice";
import { LogOut, User, Shield } from "lucide-react";
import "./Navbar.css";

function Navbar() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [isAdmin, setIsAdmin] = useState(() => isAdminLoggedIn());
  const [adminUser, setAdminUser] = useState(() => getAdminUser());
  const [voterLogoutError, setVoterLogoutError] = useState(null);
  const [voterLogoutPending, setVoterLogoutPending] = useState(false);

  const currentVoter = useSelector(selectCurrentVoter);
  const isVoterLoggedIn = useSelector(selectIsVoterLoggedIn);

  useEffect(() => {
    // Sync on window storage event for admin
    const handleStorage = () => {
      setIsAdmin(isAdminLoggedIn());
      setAdminUser(getAdminUser());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const handleAdminLogout = () => {
    logoutAdmin();
    setIsAdmin(false);
    setAdminUser(null);
    navigate("/login");
  };

  const handleVoterLogout = async () => {
    // A sign out is not idempotent while it is in flight: a second click would
    // POST again and race the first response, so a slow server could be hit
    // twice. The disabled button below is the visible guard; this early return
    // covers a programmatic or keyboard activation that slips through before
    // React re-renders the disabled state.
    if (voterLogoutPending) return;
    setVoterLogoutPending(true);
    setVoterLogoutError(null);
    try {
      const res = await logoutVoter();

      // The server owns the session, so only its confirmation may clear local
      // voter state. A refusal means the vs_voter cookie is most likely still
      // live, and clearing here would show an anonymous navbar over a session the
      // server still honours. A 401 is the exception: the server has answered
      // that there is no valid voter session left, so keeping the local greeting
      // would show a signed in voter the server treats as anonymous.
      const serverHasNoSession = res && res.status === 401;
      if (!res?.success && !serverHasNoSession) {
        setVoterLogoutError(
          res?.message || 'Sign out failed, so you are still signed in. Please try again.'
        );
        return;
      }

      dispatch(clearVoterAuth());
      navigate("/");
    } finally {
      // Released on every path. On success the component unmounts when the route
      // changes, so this only matters for the failure path, where the button
      // must become clickable again to retry.
      setVoterLogoutPending(false);
    }
  };

  return (
    <header className="navbar">
      <div className="logo">
        <Link to="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          🗳 <span>VoteSphere</span>
        </Link>
      </div>

      <nav className="nav-links">
        <Link to="/">Home</Link>
        <Link to="/join">Join</Link>
        <Link to="/history">History</Link>
        {isAdmin && <Link to="/admin">Admin</Link>}
      </nav>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {isAdmin ? (
          <>
            <span
              style={{
                fontSize: "0.8rem",
                color: "#818cf8",
                background: "rgba(99, 102, 241, 0.15)",
                padding: "0.25rem 0.6rem",
                borderRadius: "9999px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "0.3rem"
              }}
            >
              <Shield size={14} /> Admin: {adminUser?.username || "admin"}
            </span>
            <button
              onClick={handleAdminLogout}
              className="login-btn"
              style={{ background: "rgba(239, 68, 68, 0.2)", color: "#fca5a5", border: "1px solid rgba(239, 68, 68, 0.4)" }}
            >
              Logout
            </button>
          </>
        ) : isVoterLoggedIn ? (
          <>
            <span
              style={{
                fontSize: "0.85rem",
                color: "#38bdf8",
                background: "rgba(56, 189, 248, 0.12)",
                padding: "0.3rem 0.75rem",
                borderRadius: "9999px",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "0.35rem"
              }}
            >
              <User size={14} /> Hi, {currentVoter?.name || currentVoter?.username || "Voter"}
            </span>
            <button
              onClick={handleVoterLogout}
              className="login-btn"
              data-testid="logout-btn"
              // Disabled while the request is in flight, so a slow server cannot
              // be double clicked into two sign out requests. aria-busy tells an
              // assistive tech user the control is working, not broken.
              disabled={voterLogoutPending}
              aria-busy={voterLogoutPending}
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                color: "#fca5a5",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                cursor: voterLogoutPending ? "progress" : "pointer",
                opacity: voterLogoutPending ? 0.7 : 1
              }}
            >
              <LogOut size={14} /> {voterLogoutPending ? "Signing out\u2026" : "Log out"}
            </button>
            {voterLogoutError && (
              // Positioned below the bar rather than inline: the navbar is
              // fixed and its height is relied on by every page's top offset,
              // so an error must not be able to grow it.
              <p
                role="alert"
                data-testid="voter-logout-error"
                style={{
                  position: "absolute",
                  top: "100%",
                  right: "8%",
                  margin: "0.5rem 0 0 0",
                  maxWidth: "min(340px, 80vw)",
                  padding: "0.5rem 0.75rem",
                  background: "rgba(15, 23, 42, 0.95)",
                  border: "1px solid rgba(239, 68, 68, 0.45)",
                  borderRadius: "8px",
                  color: "#fca5a5",
                  fontSize: "0.8rem",
                  lineHeight: 1.35,
                  boxShadow: "0 10px 24px rgba(0, 0, 0, 0.45)"
                }}
              >
                {voterLogoutError}
              </p>
            )}
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {/* A button wrapped in a link nests two interactive controls: the
                link and the button are both exposed, so the same control is
                announced and focused twice. One link styled as the button is
                the whole control. */}
            <Link
              to="/login"
              className="login-btn"
              style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
            >
              Sign in
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

export default Navbar;