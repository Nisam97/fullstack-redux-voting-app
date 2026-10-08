import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useDispatch } from "react-redux";
import { setVoterAuth } from "../redux/voterAuthSlice";
import { setAdminSessionExpired } from "../redux/voteSlice";
import { requestOtp, verifyOtp, loginAdmin } from "../services/auth";
import { Mail, KeyRound, ArrowRight, Shield, AlertCircle, CheckCircle2, RotateCw } from "lucide-react";
import Navbar from "../components/layout/Navbar";
import Footer from "../components/layout/Footer";
import "./Login.css";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  // Mode: "voter" (passwordless OTP) vs "admin" (credentials)
  const [mode, setMode] = useState("voter");

  // Voter OTP state
  const [step, setStep] = useState(1); // 1: email, 2: OTP
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  // Admin credentials state
  const [adminIdentifier, setAdminIdentifier] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const handleVoterRequestOtp = async (e) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);
    const res = await requestOtp({ email: cleanEmail });
    setLoading(false);

    if (!res.success) {
      if (res.error === "COOLDOWN_ACTIVE") {
        setError(res.message || "Please wait before requesting a new code.");
        if (res.retryAfterSeconds) setCooldownSeconds(res.retryAfterSeconds);
      } else {
        setError(res.message || "Failed to send verification code.");
      }
      return;
    }

    setInfoMessage("If your account exists or can be created, a code was sent to your email.");
    setCooldownSeconds(60);
    setStep(2);
  };

  const handleVoterVerifyOtp = async (e) => {
    e.preventDefault();
    setError(null);

    const cleanCode = code.trim();
    if (!cleanCode || cleanCode.length !== 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    setLoading(true);
    const res = await verifyOtp({
      email: email.trim(),
      code: cleanCode
    });
    setLoading(false);

    if (!res.success) {
      if (res.error === "CHALLENGE_LOCKED") {
        setError("This code is locked due to too many failed attempts. Please request a new code.");
      } else if (res.error === "INVALID_CODE") {
        setError(`Incorrect code. ${res.remainingAttempts !== undefined ? `${res.remainingAttempts} attempts remaining.` : ""}`);
      } else {
        setError(res.message || "Verification failed. Please try again.");
      }
      return;
    }

    // Success! Update Redux voter state
    dispatch(setVoterAuth({ user: res.user }));
    const dest = location.state?.from?.pathname || "/";
    navigate(dest, { replace: true });
  };

  const handleAdminSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!adminIdentifier.trim() || !adminPassword.trim()) {
      setError("Please enter your administrator username and password.");
      return;
    }

    setLoading(true);
    const res = await loginAdmin({
      username: adminIdentifier.trim(),
      password: adminPassword
    });
    setLoading(false);

    if (!res.success) {
      setError(res.message || "Invalid administrator credentials.");
      return;
    }

    const dest = location.state?.from?.pathname || "/admin";
    // A fresh credential clears the "your admin session is no longer valid"
    // state that a rejected token set, so admin panels render normally again.
    dispatch(setAdminSessionExpired(false));
    navigate(dest, { replace: true });
  };

  const handleResend = async () => {
    if (cooldownSeconds > 0) return;
    setError(null);
    setInfoMessage(null);
    setLoading(true);
    const res = await requestOtp({ email: email.trim() });
    setLoading(false);

    if (!res.success) {
      if (res.error === "COOLDOWN_ACTIVE" && res.retryAfterSeconds) {
        setCooldownSeconds(res.retryAfterSeconds);
      }
      setError(res.message || "Failed to resend code.");
    } else {
      setInfoMessage("A new verification code was sent to your email.");
      setCooldownSeconds(60);
    }
  };

  return (
    <div className="login-page" style={{ flexDirection: "column", minHeight: "100vh", padding: 0 }}>
      <Navbar />

      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div className="login-card">
          <div className="login-header">
            <h1 style={{ fontSize: "1.8rem" }}>
              {mode === "voter" ? "Voter Sign In" : "Administrator Portal"}
            </h1>
            <p>
              {mode === "voter"
                ? "Passwordless authentication via 6-digit email code"
                : "Single administrator credential access"}
            </p>
          </div>

          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#fca5a5",
                fontSize: "0.85rem",
                marginBottom: "1.25rem"
              }}
              role="alert"
            >
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {infoMessage && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                background: "rgba(16, 185, 129, 0.15)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                color: "#6ee7b7",
                fontSize: "0.85rem",
                marginBottom: "1.25rem"
              }}
            >
              <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
              <span>{infoMessage}</span>
            </div>
          )}

          {mode === "voter" ? (
            step === 1 ? (
              <form onSubmit={handleVoterRequestOtp}>
                <div className="input-group">
                  <label htmlFor="voter-email" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <Mail size={16} /> Email Address
                  </label>
                  <input
                    id="voter-email"
                    type="email"
                    placeholder="voter@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    required
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  className="login-btn"
                  disabled={loading || cooldownSeconds > 0}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
                >
                  {loading ? "Sending Code..." : cooldownSeconds > 0 ? `Please wait (${cooldownSeconds}s)` : (
                    <>
                      Send Login Code <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVoterVerifyOtp}>
                <div style={{ textAlign: "center", marginBottom: "1.5rem", color: "#cbd5e1", fontSize: "0.9rem" }}>
                  Enter the 6-digit code sent to <strong style={{ color: "#38bdf8" }}>{email}</strong>
                </div>

                <div className="input-group">
                  <label htmlFor="voter-code" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <KeyRound size={16} /> 6-Digit Code
                  </label>
                  <input
                    id="voter-code"
                    type="text"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    disabled={loading}
                    maxLength={6}
                    style={{ textAlign: "center", fontSize: "1.5rem", letterSpacing: "8px", fontWeight: "bold" }}
                    required
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  className="login-btn"
                  disabled={loading || code.trim().length !== 6}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
                >
                  {loading ? "Verifying..." : "Verify & Sign In"}
                </button>

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
                  <button
                    type="button"
                    onClick={() => { setStep(1); setError(null); setInfoMessage(null); }}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem" }}
                  >
                    Change email
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={loading || cooldownSeconds > 0}
                    style={{
                      background: "none",
                      border: "none",
                      color: cooldownSeconds > 0 ? "#64748b" : "#38bdf8",
                      cursor: cooldownSeconds > 0 ? "default" : "pointer",
                      fontSize: "0.85rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.25rem"
                    }}
                  >
                    <RotateCw size={14} /> {cooldownSeconds > 0 ? `Resend code (${cooldownSeconds}s)` : "Resend code"}
                  </button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={handleAdminSubmit}>
              <div className="input-group">
                <label htmlFor="admin-id">Administrator Username or Email</label>
                <input
                  id="admin-id"
                  type="text"
                  placeholder="admin"
                  value={adminIdentifier}
                  onChange={(e) => setAdminIdentifier(e.target.value)}
                  disabled={loading}
                  required
                  autoFocus
                />
              </div>

              <div className="input-group">
                <label htmlFor="admin-pw">Password</label>
                <input
                  id="admin-pw"
                  type="password"
                  placeholder="Enter admin password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              <button
                type="submit"
                className="login-btn"
                disabled={loading}
                style={{ width: "100%", marginTop: "0.5rem" }}
              >
                {loading ? "Authenticating..." : "Admin Login"}
              </button>
            </form>
          )}

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: "1.5rem", paddingTop: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem" }}>
            {mode === "voter" ? (
              <>
                <Link to="/register" style={{ color: "#38bdf8", textDecoration: "none", fontWeight: 500 }}>
                  Need an account? Sign up
                </Link>
                <button
                  type="button"
                  onClick={() => { setMode("admin"); setError(null); setInfoMessage(null); }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#94a3b8",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.3rem"
                  }}
                >
                  <Shield size={14} /> Admin Portal
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => { setMode("voter"); setError(null); setInfoMessage(null); }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#38bdf8",
                    cursor: "pointer",
                    fontWeight: 500
                  }}
                >
                  ← Back to Voter Sign In
                </button>
                <span style={{ color: "#64748b" }}>Admin Access</span>
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Login;