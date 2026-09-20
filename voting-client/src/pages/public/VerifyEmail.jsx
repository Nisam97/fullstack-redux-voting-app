import { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";

function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState(
    location.state?.email || ""
  );

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleVerify = async (e) => {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    if (!otp.trim()) {
      setError("Please enter the verification code.");
      return;
    }

    if (!/^\d{6}$/.test(otp.trim())) {
      setError("Verification code must contain 6 digits.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        "http://localhost:5000/api/auth/verify-email",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({
            email: email.trim(),
            otp: otp.trim()
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Email verification failed.");
        return;
      }

      setSuccess(
        "Email verified successfully! Your account is now waiting for Authority approval."
      );

      setTimeout(() => {
        navigate("/login");
      }, 2500);

    } catch (error) {
      console.error("Verification error:", error);

      setError(
        "Unable to connect to VoteSphere server."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#06111f",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px"
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "#0b1a2b",
          border: "1px solid #18344f",
          borderRadius: "22px",
          padding: "40px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.35)"
        }}
      >
        <div
          style={{
            textAlign: "center",
            fontSize: "26px",
            fontWeight: "700",
            color: "#09c7e8",
            marginBottom: "12px"
          }}
        >
          🗳️ VoteSphere
        </div>

        <h1
          style={{
            color: "#ffffff",
            textAlign: "center",
            marginBottom: "10px"
          }}
        >
          Verify Your Email
        </h1>

        <p
          style={{
            color: "#8ea4bd",
            textAlign: "center",
            lineHeight: "1.6",
            marginBottom: "30px"
          }}
        >
          Enter the 6-digit demo verification code
          generated during registration.
        </p>

        {error && (
          <div
            style={{
              background: "#3a1720",
              color: "#ff8c9c",
              padding: "12px 15px",
              borderRadius: "10px",
              marginBottom: "20px"
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            style={{
              background: "#123524",
              color: "#69e6a1",
              padding: "12px 15px",
              borderRadius: "10px",
              marginBottom: "20px"
            }}
          >
            {success}
          </div>
        )}

        <form onSubmit={handleVerify}>
          <label
            style={{
              display: "block",
              color: "#ffffff",
              marginBottom: "8px"
            }}
          >
            College Email
          </label>

          <input
            type="email"
            placeholder="Enter your college email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "10px",
              border: "1px solid #29445e",
              marginBottom: "20px",
              fontSize: "15px",
              boxSizing: "border-box"
            }}
          />

          <label
            style={{
              display: "block",
              color: "#ffffff",
              marginBottom: "8px"
            }}
          >
            6-Digit Verification Code
          </label>

          <input
            type="text"
            inputMode="numeric"
            maxLength="6"
            placeholder="Enter OTP"
            value={otp}
            onChange={(e) =>
              setOtp(
                e.target.value.replace(/\D/g, "")
              )
            }
            disabled={loading}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "10px",
              border: "1px solid #29445e",
              marginBottom: "25px",
              fontSize: "20px",
              textAlign: "center",
              letterSpacing: "6px",
              boxSizing: "border-box"
            }}
          />

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "15px",
              border: "none",
              borderRadius: "10px",
              background: "#09c7e8",
              color: "#06111f",
              fontSize: "16px",
              fontWeight: "700",
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading
              ? "Verifying..."
              : "Verify Email →"}
          </button>
        </form>

        <div
          style={{
            textAlign: "center",
            marginTop: "25px"
          }}
        >
          <Link
            to="/login"
            style={{
              color: "#09c7e8",
              textDecoration: "none"
            }}
          >
            ← Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default VerifyEmail;