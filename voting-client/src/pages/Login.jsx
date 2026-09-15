import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { loginAdmin } from "../services/auth";
import "./Login.css";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!identifier.trim() || !password.trim()) {
      setError("Please enter your administrator username/email and password.");
      return;
    }

    setLoading(true);
    const result = await loginAdmin({ username: identifier.trim(), password });
    setLoading(false);

    if (!result.success) {
      setError(result.message || "Invalid administrator credentials.");
      return;
    }

    const destination = location.state?.from?.pathname || "/admin";
    navigate(destination, { replace: true });
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1>🗳 VoteSphere</h1>
          <p>Administrator Portal Login</p>
        </div>

        {error && (
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#fca5a5",
              fontSize: "0.85rem",
              marginBottom: "1rem"
            }}
            role="alert"
            aria-live="polite"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="admin-identifier">Username or Email</label>
            <input
              id="admin-identifier"
              type="text"
              placeholder="Enter admin username or email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              placeholder="Enter admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button
            type="submit"
            className="login-btn"
            disabled={loading}
            style={{ width: "100%", marginTop: "1rem" }}
          >
            {loading ? "Authenticating..." : "Login"}
          </button>
        </form>

        <p className="signup-text" style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
          VoteSphere single administrator access. Credentials managed via system configuration.
        </p>
      </div>
    </div>
  );
}

export default Login;