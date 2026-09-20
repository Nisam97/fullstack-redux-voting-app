import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import "./Login.css";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();

    setError("");

    // Basic validation
    if (!email.trim()) {
      setError("Please enter your college email address.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        "http://localhost:5000/api/auth/login",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          credentials: "include",

          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password: password,
          }),
        }
      );

      const data = await response.json();

      console.log("Login response:", data);

      // Backend error
      if (!response.ok) {
        setError(
          data.message ||
            "Unable to login. Please check your credentials."
        );
        return;
      }

      // Make sure user data exists
      if (!data.user) {
        setError("Invalid server response.");
        return;
      }

      console.log("Logged in user:", data.user);

      // =========================================
      // AUTHORITY
      // =========================================

      if (data.user.role === "AUTHORITY") {
        navigate("/authority");
        return;
      }

      // =========================================
      // VOTER
      // =========================================

      if (data.user.role === "VOTER") {

        // Email must already be verified
        if (!data.user.emailVerified) {
          setError(
            "Please verify your college email before logging in."
          );
          return;
        }

        // Authority approval required
        if (
          data.user.verificationStatus === "PENDING"
        ) {
          setError(
            "Your email is verified, but your voter account is still waiting for Authority approval."
          );
          return;
        }

        // Rejected account
        if (
          data.user.verificationStatus === "REJECTED"
        ) {
          setError(
            "Your voter registration request has been rejected by the Authority."
          );
          return;
        }

        // Suspended account
        if (
          data.user.verificationStatus === "SUSPENDED"
        ) {
          setError(
            "Your voter account has been suspended."
          );
          return;
        }

        // Approved voter
        if (
          data.user.verificationStatus === "APPROVED"
        ) {
          navigate("/election");
          return;
        }

        setError(
          "Your account is not currently eligible for voting."
        );

        return;
      }

      // Unknown role
      setError("Unknown account role.");

    } catch (error) {
      console.error(
        "Login request error:",
        error
      );

      setError(
        "Unable to connect to VoteSphere server. Please make sure the backend is running."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">

      <div className="login-card">

        {/* LOGO */}

        <div className="login-logo">
          🗳️ VoteSphere
        </div>


        {/* HEADING */}

        <h1>
          Welcome Back
        </h1>

        <p>
          Login to access your secure election portal.
        </p>


        {/* ERROR */}

        {error && (
          <div className="login-error">
            <span>!</span>
            {error}
          </div>
        )}


        {/* LOGIN FORM */}

        <form onSubmit={handleLogin}>

          {/* EMAIL */}

          <label htmlFor="email">
            College Email
          </label>

          <input
            id="email"
            type="email"
            placeholder="Enter your college email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
            disabled={loading}
            autoComplete="email"
          />


          {/* PASSWORD */}

          <label htmlFor="password">
            Password
          </label>

          <input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            disabled={loading}
            autoComplete="current-password"
          />


          {/* LOGIN BUTTON */}

          <button
            type="submit"
            disabled={loading}
          >
            {loading
              ? "Signing in..."
              : "Login →"}
          </button>

        </form>


        {/* REGISTER */}

        <p className="register-text">
          Don't have an account?

          <Link to="/register">
            Register
          </Link>
        </p>


        {/* HOME */}

        <Link
          to="/"
          className="back-home"
        >
          ← Back to Home
        </Link>

      </div>

    </div>
  );
}

export default Login;