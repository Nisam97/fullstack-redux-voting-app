import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useDispatch } from "react-redux";
import { setVoterAuth } from "../redux/voterAuthSlice";
import { setAdminSessionExpired } from "../redux/voteSlice";
import { requestOtp, verifyOtp, loginAdmin } from "../services/auth";
import { reattachVoterIdentityToSocket } from "../services/socket";
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
    // The socket handshook at app load, before the server set the vs_voter
    // cookie, so its identity is still anonymous. Force a fresh handshake now
    // that the cookie exists, or the server cannot recognise this voter on the
    // socket until a page reload.
    reattachVoterIdentityToSocket();
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
    <div className="login-page login-page--stacked">
      <Navbar />

      <main className="login-main">
        <div className="login-card">
          <div className="login-header">
            <h1>
              {mode === "voter" ? "Voter Sign In" : "Administrator Portal"}
            </h1>
            <p>
              {mode === "voter"
                ? "Passwordless authentication via 6-digit email code"
                : "Single administrator credential access"}
            </p>
          </div>

          {error && (
            <div className="auth-alert auth-alert-error" role="alert">
              <AlertCircle size={18} className="auth-alert-icon" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {infoMessage && (
            <div className="auth-alert auth-alert-success">
              <CheckCircle2 size={18} className="auth-alert-icon" aria-hidden="true" />
              <span>{infoMessage}</span>
            </div>
          )}

          {mode === "voter" ? (
            step === 1 ? (
              <form onSubmit={handleVoterRequestOtp}>
                <div className="input-group">
                  <label htmlFor="voter-email" className="input-label-with-icon">
                    <Mail size={16} aria-hidden="true" /> Email Address
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
                >
                  {loading ? "Sending Code..." : cooldownSeconds > 0 ? `Please wait (${cooldownSeconds}s)` : (
                    <>
                      Send Login Code <ArrowRight size={18} aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVoterVerifyOtp}>
                <div className="otp-hint">
                  Enter the 6-digit code sent to <strong className="otp-email">{email}</strong>
                </div>

                <div className="input-group">
                  <label htmlFor="voter-code" className="input-label-with-icon">
                    <KeyRound size={16} aria-hidden="true" /> 6-Digit Code
                  </label>
                  <input
                    id="voter-code"
                    type="text"
                    className="otp-code-input"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    disabled={loading}
                    maxLength={6}
                    required
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  className="login-btn"
                  disabled={loading || code.trim().length !== 6}
                >
                  {loading ? "Verifying..." : "Verify & Sign In"}
                </button>

                <div className="login-actions-row">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => { setStep(1); setError(null); setInfoMessage(null); }}
                  >
                    Change email
                  </button>
                  <button
                    type="button"
                    className="link-btn link-btn-accent"
                    onClick={handleResend}
                    disabled={loading || cooldownSeconds > 0}
                  >
                    <RotateCw size={14} aria-hidden="true" /> {cooldownSeconds > 0 ? `Resend code (${cooldownSeconds}s)` : "Resend code"}
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
                className="login-btn login-btn--spaced"
                disabled={loading}
              >
                {loading ? "Authenticating..." : "Admin Login"}
              </button>
            </form>
          )}

          <div className="login-footer">
            {mode === "voter" ? (
              <>
                <Link to="/register" className="login-link">
                  Need an account? Sign up
                </Link>
                <button
                  type="button"
                  className="link-btn link-btn-accent"
                  onClick={() => { setMode("admin"); setError(null); setInfoMessage(null); }}
                >
                  <Shield size={14} aria-hidden="true" /> Admin Portal
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="link-btn link-btn-accent"
                  onClick={() => { setMode("voter"); setError(null); setInfoMessage(null); }}
                >
                  ← Back to Voter Sign In
                </button>
                <span className="login-footer-note">Admin Access</span>
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
