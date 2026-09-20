import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./Register.css";

function Register() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    fullName: "",
    voterId: "",
    department: "",
    email: "",
    phone: "",
    dob: "",
    password: "",
    confirmPassword: ""
  });

  const [agree, setAgree] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  // ======================================================
  // HANDLE INPUT
  // ======================================================

  const handleChange = (e) => {
    const { name, value } = e.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value
    }));

    setError("");
  };

  // ======================================================
  // SUBMIT REGISTRATION
  // ======================================================

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setSuccess(false);

    // --------------------------------------------------
    // Empty field validation
    // --------------------------------------------------

    if (
      !formData.fullName ||
      !formData.voterId ||
      !formData.department ||
      !formData.email ||
      !formData.phone ||
      !formData.dob ||
      !formData.password ||
      !formData.confirmPassword
    ) {
      setError("Please fill in all required fields.");
      return;
    }

    // --------------------------------------------------
    // Full name validation
    // --------------------------------------------------

    if (formData.fullName.trim().length < 3) {
      setError("Please enter your full name.");
      return;
    }

    // --------------------------------------------------
    // Voter ID validation
    // --------------------------------------------------

    if (formData.voterId.trim().length < 4) {
      setError("Please enter a valid voter ID.");
      return;
    }

    // --------------------------------------------------
    // Department validation
    // --------------------------------------------------

    if (formData.department.trim().length < 2) {
      setError("Please enter your department.");
      return;
    }

    // --------------------------------------------------
    // Email validation
    // --------------------------------------------------

    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(formData.email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    // --------------------------------------------------
    // Phone validation
    // --------------------------------------------------

    const phonePattern = /^[0-9]{10}$/;

    if (!phonePattern.test(formData.phone)) {
      setError(
        "Please enter a valid 10-digit phone number."
      );
      return;
    }

    // --------------------------------------------------
    // Password validation
    // --------------------------------------------------

    if (formData.password.length < 8) {
      setError(
        "Password must contain at least 8 characters."
      );
      return;
    }

    // --------------------------------------------------
    // Password match
    // --------------------------------------------------

    if (
      formData.password !==
      formData.confirmPassword
    ) {
      setError("Passwords do not match.");
      return;
    }

    // --------------------------------------------------
    // Terms validation
    // --------------------------------------------------

    if (!agree) {
      setError(
        "Please accept the Terms & Conditions."
      );
      return;
    }

    try {
      setLoading(true);

      // ==================================================
      // SEND DATA TO BACKEND
      // ==================================================

      const response = await fetch(
        "http://localhost:5000/api/auth/register",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          credentials: "include",

          body: JSON.stringify({
            studentId: formData.voterId.trim(),

            fullName:
              formData.fullName.trim(),

            // NEW
            department:
              formData.department.trim(),

            email:
              formData.email.trim(),

            phone:
              formData.phone,

            password:
              formData.password
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.message ||
            "Registration failed. Please try again."
        );
        return;
      }

      console.log(
        "VoteSphere registration successful:",
        data
      );

      // ==================================================
      // REGISTRATION SUCCESS
      // ==================================================

      setSuccess(true);

      // Keep the existing redirect behavior
      setTimeout(() => {
        navigate("/login");
      }, 3000);

    } catch (error) {
      console.error(
        "Registration request error:",
        error
      );

      setError(
        "Unable to connect to VoteSphere server. Please make sure the backend is running."
      );

    } finally {
      setLoading(false);
    }
  };

  // ======================================================
  // SUCCESS SCREEN
  // ======================================================

  if (success) {
    return (
      <div className="register-page">

        <div className="register-success">

          <div className="success-circle">
            ✓
          </div>

          <h1>
            Registration Submitted
          </h1>

          <p>
            Your VoteSphere voter registration has
            been submitted successfully.
          </p>

          <div className="verification-box">

            <div>
              <span>
                Voter
              </span>

              <strong>
                {formData.fullName}
              </strong>
            </div>

            <div>
              <span>
                Voter ID
              </span>

              <strong>
                {formData.voterId}
              </strong>
            </div>

            <div>
              <span>
                Department
              </span>

              <strong>
                {formData.department}
              </strong>
            </div>

            <div>
              <span>
                Registration Status
              </span>

              <strong className="pending">
                Awaiting Email Verification
              </strong>
            </div>

          </div>

          <p className="verification-message">
            Please check your college email for the
            verification code. After email verification,
            your account will be reviewed by the
            Election Authority.
          </p>

          <p className="redirect-text">
            Redirecting you to the login page...
          </p>

        </div>

      </div>
    );
  }

  // ======================================================
  // REGISTRATION PAGE
  // ======================================================

  return (
    <div className="register-page">

      {/* =========================
          LEFT SIDE
      ========================== */}

      <div className="register-intro">

        <Link
          to="/"
          className="register-brand"
        >
          🗳️ <span>VoteSphere</span>
        </Link>

        <div className="intro-content">

          <span className="intro-label">
            SECURE DIGITAL ELECTION
          </span>

          <h1>
            Your Voice
            <br />
            <span>Starts Here.</span>
          </h1>

          <p>
            Create your voter account and participate
            in secure, transparent and real-time
            digital elections.
          </p>

          <div className="register-features">

            <div className="register-feature">

              <div className="feature-icon">
                🔐
              </div>

              <div>
                <strong>
                  Secure Identity
                </strong>

                <span>
                  Your voter identity is protected.
                </span>
              </div>

            </div>

            <div className="register-feature">

              <div className="feature-icon">
                ✓
              </div>

              <div>
                <strong>
                  Verified Voters
                </strong>

                <span>
                  Identity verification helps protect
                  election integrity.
                </span>
              </div>

            </div>

            <div className="register-feature">

              <div className="feature-icon">
                🗳️
              </div>

              <div>
                <strong>
                  One Vote Per Election
                </strong>

                <span>
                  Every eligible voter gets one official
                  vote.
                </span>
              </div>

            </div>

          </div>

        </div>

        <div className="register-footer">
          © 2026 VoteSphere
        </div>

      </div>


      {/* =========================
          RIGHT SIDE
      ========================== */}

      <div className="register-form-area">

        <div className="register-card">

          <div className="mobile-brand">
            🗳️ VoteSphere
          </div>

          <div className="form-heading">

            <span>
              CREATE ACCOUNT
            </span>

            <h2>
              Register as a Voter
            </h2>

            <p>
              Enter your details to create your
              secure voter account.
            </p>

          </div>


          {/* ERROR MESSAGE */}

          {error && (
            <div className="register-error">
              <span>!</span>
              {error}
            </div>
          )}


          <form onSubmit={handleSubmit}>

            {/* =========================
                FULL NAME
            ========================== */}

            <div className="form-group">

              <label htmlFor="fullName">
                Full Name
                <span>*</span>
              </label>

              <div className="input-wrapper">

                <span className="input-icon">
                  👤
                </span>

                <input
                  id="fullName"
                  type="text"
                  name="fullName"
                  placeholder="Enter your full name"
                  value={formData.fullName}
                  onChange={handleChange}
                  disabled={loading}
                />

              </div>

            </div>


            {/* =========================
                VOTER ID
            ========================== */}

            <div className="form-group">

              <label htmlFor="voterId">
                Voter ID
                <span>*</span>
              </label>

              <div className="input-wrapper">

                <span className="input-icon">
                  🪪
                </span>

                <input
                  id="voterId"
                  type="text"
                  name="voterId"
                  placeholder="Enter your voter ID"
                  value={formData.voterId}
                  onChange={handleChange}
                  disabled={loading}
                />

              </div>

              <small>
                Your voter ID will be used for identity
                verification.
              </small>

            </div>


            {/* =========================
                DEPARTMENT
            ========================== */}

            <div className="form-group">

              <label htmlFor="department">
                Department
                <span>*</span>
              </label>

              <div className="input-wrapper">

                <span className="input-icon">
                  🎓
                </span>

                <select
                  id="department"
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  disabled={loading}
                >
                  <option value="">
                    Select your department
                  </option>

                  <option value="Computer Applications">
                    Computer Applications
                  </option>

                  <option value="Computer Science">
                    Computer Science
                  </option>

                  <option value="Commerce">
                    Commerce
                  </option>

                  <option value="Management">
                    Management
                  </option>

                  <option value="Social Work">
                    Social Work
                  </option>
                </select>

              </div>

            </div>


            {/* =========================
                EMAIL + PHONE
            ========================== */}

            <div className="form-row">

              <div className="form-group">

                <label htmlFor="email">
                  Email Address
                  <span>*</span>
                </label>

                <div className="input-wrapper">

                  <span className="input-icon">
                    ✉
                  </span>

                  <input
                    id="email"
                    type="email"
                    name="email"
                    placeholder="you@example.com"
                    value={formData.email}
                    onChange={handleChange}
                    disabled={loading}
                  />

                </div>

              </div>


              <div className="form-group">

                <label htmlFor="phone">
                  Phone Number
                  <span>*</span>
                </label>

                <div className="input-wrapper">

                  <span className="input-icon">
                    📱
                  </span>

                  <input
                    id="phone"
                    type="tel"
                    name="phone"
                    placeholder="10-digit number"
                    maxLength="10"
                    value={formData.phone}
                    onChange={handleChange}
                    disabled={loading}
                  />

                </div>

              </div>

            </div>


            {/* =========================
                DATE OF BIRTH
            ========================== */}

            <div className="form-group">

              <label htmlFor="dob">
                Date of Birth
                <span>*</span>
              </label>

              <div className="input-wrapper">

                <span className="input-icon">
                  📅
                </span>

                <input
                  id="dob"
                  type="date"
                  name="dob"
                  value={formData.dob}
                  onChange={handleChange}
                  disabled={loading}
                />

              </div>

            </div>


            {/* =========================
                PASSWORD ROW
            ========================== */}

            <div className="form-row">

              <div className="form-group">

                <label htmlFor="password">
                  Password
                  <span>*</span>
                </label>

                <div className="input-wrapper">

                  <span className="input-icon">
                    🔒
                  </span>

                  <input
                    id="password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    name="password"
                    placeholder="Minimum 8 characters"
                    value={formData.password}
                    onChange={handleChange}
                    disabled={loading}
                  />

                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() =>
                      setShowPassword(
                        !showPassword
                      )
                    }
                    disabled={loading}
                  >
                    {showPassword
                      ? "Hide"
                      : "Show"}
                  </button>

                </div>

              </div>


              <div className="form-group">

                <label htmlFor="confirmPassword">
                  Confirm Password
                  <span>*</span>
                </label>

                <div className="input-wrapper">

                  <span className="input-icon">
                    🔒
                  </span>

                  <input
                    id="confirmPassword"
                    type={
                      showConfirmPassword
                        ? "text"
                        : "password"
                    }
                    name="confirmPassword"
                    placeholder="Re-enter password"
                    value={
                      formData.confirmPassword
                    }
                    onChange={handleChange}
                    disabled={loading}
                  />

                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() =>
                      setShowConfirmPassword(
                        !showConfirmPassword
                      )
                    }
                    disabled={loading}
                  >
                    {showConfirmPassword
                      ? "Hide"
                      : "Show"}
                  </button>

                </div>

              </div>

            </div>


            {/* =========================
                TERMS
            ========================== */}

            <div className="terms">

              <input
                id="agree"
                type="checkbox"
                checked={agree}
                onChange={(e) =>
                  setAgree(e.target.checked)
                }
                disabled={loading}
              />

              <label htmlFor="agree">

                I agree to the{" "}

                <span>
                  Terms & Conditions
                </span>{" "}

                and{" "}

                <span>
                  Privacy Policy
                </span>

              </label>

            </div>


            {/* =========================
                SUBMIT
            ========================== */}

            <button
              type="submit"
              className="register-button"
              disabled={loading}
            >
              {loading
                ? "Creating Account..."
                : "Create Voter Account"}

              <span>
                {loading ? "..." : "→"}
              </span>
            </button>

          </form>


          {/* =========================
              LOGIN
          ========================== */}

          <div className="already-account">

            Already have an account?

            <Link to="/login">
              Login
            </Link>

          </div>


          <Link
            to="/"
            className="back-home-link"
          >
            ← Back to Home
          </Link>

        </div>

      </div>

    </div>
  );
}

export default Register;