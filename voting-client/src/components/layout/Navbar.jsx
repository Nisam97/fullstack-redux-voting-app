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
    await logoutVoter();
    dispatch(clearVoterAuth());
    navigate("/");
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
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                color: "#fca5a5",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                cursor: "pointer"
              }}
            >
              <LogOut size={14} /> Log out
            </button>
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