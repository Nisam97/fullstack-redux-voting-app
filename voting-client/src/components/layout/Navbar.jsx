import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isAdminLoggedIn, logoutAdmin, getAdminUser } from "../../services/auth";
import "./Navbar.css";

function Navbar() {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(() => isAdminLoggedIn());
  const [adminUser, setAdminUser] = useState(() => getAdminUser());

  useEffect(() => {
    // Sync on window storage event
    const handleStorage = () => {
      setIsAdmin(isAdminLoggedIn());
      setAdminUser(getAdminUser());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const handleLogout = () => {
    logoutAdmin();
    setIsAdmin(false);
    setAdminUser(null);
    navigate("/login");
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
        <Link to="/sessions">Sessions</Link>
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
                fontWeight: 600
              }}
            >
              Admin: {adminUser?.username || "admin"}
            </span>
            <button
              onClick={handleLogout}
              className="login-btn"
              style={{ background: "rgba(239, 68, 68, 0.2)", color: "#fca5a5", border: "1px solid rgba(239, 68, 68, 0.4)" }}
            >
              Logout
            </button>
          </>
        ) : (
          <Link to="/login">
            <button className="login-btn">
              Login
            </button>
          </Link>
        )}
      </div>
    </header>
  );
}

export default Navbar;