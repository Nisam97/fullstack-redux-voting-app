import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import "./Navbar.css";
function Navbar() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const checkLogin = async () => {
      try {
        const response = await fetch(
          "http://localhost:5000/api/auth/me",
          {
            credentials: "include",
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (isMounted) {
            setUser(data.user);
          }
        }
      } catch (error) {
        console.error("Navbar authentication check failed:", error);
      }
    };

    checkLogin();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch(
        "http://localhost:5000/api/auth/logout",
        {
          method: "POST",
          credentials: "include",
        }
      );
    } catch (error) {
      console.error("Logout error:", error);
    }

    setUser(null);
    navigate("/");
  };

  return (
    <nav className="main-navbar">
      <div className="navbar-brand">
        <Link to="/">
          <span className="navbar-logo">V</span>

          <div>
            <strong>VoteSphere</strong>
            <small>Secure Digital Voting</small>
          </div>
        </Link>
      </div>

      <div className="navbar-links">
        <Link to="/">Home</Link>

        <Link to="/about">About</Link>

        {user && (
          <Link to="/profile">
            Profile
          </Link>
        )}

        {!user ? (
          <Link
            to="/login"
            className="navbar-login"
          >
            Login
          </Link>
        ) : (
          <button
            type="button"
            className="navbar-logout"
            onClick={handleLogout}
          >
            Logout
          </button>
        )}
      </div>
    </nav>
  );
}

export default Navbar;