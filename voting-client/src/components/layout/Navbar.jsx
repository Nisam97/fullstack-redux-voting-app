import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { isAdminLoggedIn, logoutAdmin, getAdminUser, logoutVoter } from "../../services/auth";
import { selectCurrentVoter, selectIsVoterLoggedIn, clearVoterAuth } from "../../redux/voterAuthSlice";
import { getTheme, toggleTheme, subscribeTheme } from "../../services/theme";
import { LogOut, Moon, Sun, Shield, User, Vote } from "lucide-react";
import "./Navbar.css";

function Navbar() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [isAdmin, setIsAdmin] = useState(() => isAdminLoggedIn());
  const [adminUser, setAdminUser] = useState(() => getAdminUser());
  const [voterLogoutError, setVoterLogoutError] = useState(null);
  const [voterLogoutPending, setVoterLogoutPending] = useState(false);
  const [theme, setThemeState] = useState(() => getTheme());

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

  // Keep the toggle in step with the document, wherever the change came from.
  useEffect(() => subscribeTheme(setThemeState), []);

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

  const isLight = theme === "light";

  return (
    <header className="navbar">
      <div className="logo">
        <Link to="/" className="logo-link">
          <Vote size={22} aria-hidden="true" /> <span>VoteSphere</span>
        </Link>
      </div>

      <nav className="nav-links">
        <Link to="/">Home</Link>
        <Link to="/join">Join</Link>
        <Link to="/history">History</Link>
        {isAdmin && <Link to="/admin">Admin</Link>}
      </nav>

      <div className="navbar-actions">
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
          title={isLight ? "Switch to dark theme" : "Switch to light theme"}
        >
          {isLight ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
        </button>

        {isAdmin ? (
          <>
            <span className="navbar-chip navbar-chip-admin">
              <Shield size={14} aria-hidden="true" /> Admin: {adminUser?.username || "admin"}
            </span>
            <button
              onClick={handleAdminLogout}
              className="login-btn logout-btn logout-btn-admin"
            >
              Logout
            </button>
          </>
        ) : isVoterLoggedIn ? (
          <>
            <span className="navbar-chip navbar-chip-voter">
              <User size={14} aria-hidden="true" /> Hi, {currentVoter?.name || currentVoter?.username || "Voter"}
            </span>
            <button
              onClick={handleVoterLogout}
              className="login-btn logout-btn logout-btn-voter"
              data-testid="logout-btn"
              // Disabled while the request is in flight, so a slow server cannot
              // be double clicked into two sign out requests. aria-busy tells an
              // assistive tech user the control is working, not broken.
              disabled={voterLogoutPending}
              aria-busy={voterLogoutPending}
            >
              <LogOut size={14} aria-hidden="true" />
              {voterLogoutPending ? "Signing out\u2026" : "Log out"}
            </button>
            {voterLogoutError && (
              // Positioned below the bar rather than inline: the navbar is
              // fixed and its height is relied on by every page's top offset,
              // so an error must not be able to grow it.
              <p
                role="alert"
                data-testid="voter-logout-error"
                className="navbar-error"
              >
                {voterLogoutError}
              </p>
            )}
          </>
        ) : (
          // A button wrapped in a link nests two interactive controls: the
          // link and the button are both exposed, so the same control is
          // announced and focused twice. One link styled as the button is
          // the whole control.
          <Link to="/login" className="login-btn">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

export default Navbar;
