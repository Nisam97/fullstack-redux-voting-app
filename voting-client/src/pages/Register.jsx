import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { setVoterAuth } from "../redux/voterAuthSlice";
import { requestOtp, verifyOtp } from "../services/auth";
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
    <div className="register-page" style={{ flexDirection: "column", minHeight: "100vh", padding: 0 }}>
      <Navbar />

      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div className="register-card">
          <div className="register-header">
            <h1 style={{ fontSize: "1.8rem" }}>Create Voter Account</h1>
            <p>Passwordless voting identity with email verification</p>
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

          {step === 1 ? (
            <form onSubmit={handleRequestOtp}>
              <div className="input-group">
                <label htmlFor="reg-email" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <Mail size={16} /> Email Address
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
                <label htmlFor="reg-name" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <User size={16} /> Display Name
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
                <label htmlFor="reg-username" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <AtSign size={16} /> Username
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
                <span style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "4px" }}>
                  3-20 characters: letters, numbers, underscores
                </span>
              </div>

              <button
                type="submit"
                className="register-btn"
                disabled={loading || cooldownSeconds > 0}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
              >
                {loading ? "Sending Code..." : cooldownSeconds > 0 ? `Please wait (${cooldownSeconds}s)` : (
                  <>
                    Send Verification Code <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <div style={{ textAlign: "center", marginBottom: "1.5rem", color: "#cbd5e1", fontSize: "0.9rem" }}>
                Enter the 6-digit code sent to <strong style={{ color: "#38bdf8" }}>{email}</strong>
              </div>

              <div className="input-group">
                <label htmlFor="reg-code" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <KeyRound size={16} /> 6-Digit Code
                </label>
                <input
                  id="reg-code"
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
                className="register-btn"
                disabled={loading || code.trim().length !== 6}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
              >
                {loading ? "Verifying..." : "Verify & Create Account"}
              </button>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
                <button
                  type="button"
                  onClick={() => { setStep(1); setError(null); setInfoMessage(null); }}
                  style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem" }}
                >
                  Change details
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