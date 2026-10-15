import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { setVoterAuth } from "../redux/voterAuthSlice";
import { requestOtp, verifyOtp } from "../services/auth";
import { reattachVoterIdentityToSocket } from "../services/socket";
import { Mail, User, AtSign, KeyRound, ArrowRight, RotateCw, AlertCircle, CheckCircle2 } from "lucide-react";
import Navbar from "../components/layout/Navbar";
import Footer from "../components/layout/Footer";
import "./Register.css";

function Register() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [step, setStep] = useState(1); // 1: details, 2: OTP
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");

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

  const handleRequestOtp = async (e) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const cleanEmail = email.trim();
    const cleanName = name.trim();
    const cleanUsername = username.trim();

    if (!cleanEmail || !cleanName || !cleanUsername) {
      setError("Please fill in email, display name, and username.");
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
      setError("Username must be 3 to 20 alphanumeric characters or underscores.");
      return;
    }

    setLoading(true);
    const res = await requestOtp({
      email: cleanEmail,
      name: cleanName,
      username: cleanUsername
    });
    setLoading(false);

    if (!res.success) {
      if (res.error === "USERNAME_TAKEN") {
        setError("This username is already taken. Please pick another.");
      } else if (res.error === "COOLDOWN_ACTIVE") {
        setError(res.message || "Please wait before requesting a new code.");
        if (res.retryAfterSeconds) setCooldownSeconds(res.retryAfterSeconds);
      } else {
        setError(res.message || "Failed to send verification code.");
      }
      return;
    }

    setInfoMessage("A 6-digit verification code was sent to your email.");
    setCooldownSeconds(60);
    setStep(2);
  };

  const handleVerifyOtp = async (e) => {
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
        setError("This code has been locked due to too many failed attempts. Please request a new code.");
      } else if (res.error === "INVALID_CODE") {
        setError(`Incorrect code. ${res.remainingAttempts !== undefined ? `${res.remainingAttempts} attempts remaining.` : ""}`);
      } else {
        setError(res.message || "Verification failed. Please try again.");
      }
      return;
    }

    // Success! Update Redux voter auth state
    dispatch(setVoterAuth({ user: res.user }));
    // The socket handshook at app load, before the server set the vs_voter
    // cookie, so re-handshake now that it exists. Without this the server keeps
    // treating this freshly signed in voter as anonymous until a page reload.
    reattachVoterIdentityToSocket();
    navigate("/");
  };

  const handleResend = async () => {
    if (cooldownSeconds > 0) return;
    setError(null);
    setInfoMessage(null);
    setLoading(true);
    const res = await requestOtp({
      email: email.trim(),
      name: name.trim(),
      username: username.trim()
    });
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
    <div className="register-page register-page--stacked">
      <Navbar />

      <main className="register-main">
        <div className="register-card">
          <div className="register-header">
            <h1>Create Voter Account</h1>
            <p>Passwordless voting identity with email verification</p>
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

          {step === 1 ? (
            <form onSubmit={handleRequestOtp}>
              <div className="input-group">
                <label htmlFor="reg-email" className="input-label-with-icon">
                  <Mail size={16} aria-hidden="true" /> Email Address
                </label>
                <input
                  id="reg-email"
                  type="email"
                  placeholder="voter@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  required
                  autoFocus
                />
              </div>

              <div className="input-group">
                <label htmlFor="reg-name" className="input-label-with-icon">
                  <User size={16} aria-hidden="true" /> Display Name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  placeholder="e.g. Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  maxLength={80}
                  required
                />
              </div>

              <div className="input-group">
                <label htmlFor="reg-username" className="input-label-with-icon">
                  <AtSign size={16} aria-hidden="true" /> Username
                </label>
                <input
                  id="reg-username"
                  type="text"
                  placeholder="e.g. jane_voter"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  disabled={loading}
                  minLength={3}
                  maxLength={20}
                  required
                />
                <span className="field-hint">
                  3-20 characters: letters, numbers, underscores
                </span>
              </div>

              <button
                type="submit"
                className="register-btn"
                disabled={loading || cooldownSeconds > 0}
              >
                {loading ? "Sending Code..." : cooldownSeconds > 0 ? `Please wait (${cooldownSeconds}s)` : (
                  <>
                    Send Verification Code <ArrowRight size={18} aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <div className="otp-hint">
                Enter the 6-digit code sent to <strong className="otp-email">{email}</strong>
              </div>

              <div className="input-group">
                <label htmlFor="reg-code" className="input-label-with-icon">
                  <KeyRound size={16} aria-hidden="true" /> 6-Digit Code
                </label>
                <input
                  id="reg-code"
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
                className="register-btn"
                disabled={loading || code.trim().length !== 6}
              >
                {loading ? "Verifying..." : "Verify & Create Account"}
              </button>

              <div className="register-actions-row">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => { setStep(1); setError(null); setInfoMessage(null); }}
                >
                  Change details
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
          )}

          <p className="login-text">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Register;
