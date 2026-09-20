import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Profile.css";

function Profile() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        "http://localhost:5000/api/auth/me",
        {
          method: "GET",
          credentials: "include",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to load profile.");
        return;
      }

      setUser(data.user);
    } catch (error) {
      console.error("Profile loading error:", error);
      setError("Unable to connect to VoteSphere server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadProfileTimeout = setTimeout(() => {
      loadProfile();
    }, 0);

    return () => clearTimeout(loadProfileTimeout);
  }, []);

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-loading">
          <div className="profile-spinner"></div>
          <p>Loading your profile...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="profile-page">
        <div className="profile-error">
          <div className="error-icon">!</div>
          <h2>Profile Unavailable</h2>
          <p>{error}</p>

          <button onClick={() => navigate("/login")}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-container">

        <div className="profile-header">
          <div>
            <span className="profile-label">MY ACCOUNT</span>
            <h1>My Profile</h1>
            <p>View your registered VoteSphere account information.</p>
          </div>

          <div className="profile-status">
            <span className="profile-status-dot"></span>
            {user?.verificationStatus || "PENDING"}
          </div>
        </div>

        <section className="profile-card">

          <div className="profile-card-header">
            <div className="profile-avatar">
              {user?.fullName
                ? user.fullName.charAt(0).toUpperCase()
                : "U"}
            </div>

            <div>
              <h2>{user?.fullName || "User"}</h2>
              <p>{user?.email || ""}</p>
            </div>
          </div>

          <div className="profile-divider"></div>

          <div className="profile-grid">

            <div className="profile-field">
              <span>FULL NAME</span>
              <strong>{user?.fullName || "—"}</strong>
            </div>

            <div className="profile-field">
              <span>STUDENT ID</span>
              <strong>{user?.studentId || "—"}</strong>
            </div>

            <div className="profile-field">
              <span>DEPARTMENT</span>
              <strong>{user?.department || "—"}</strong>
            </div>

            <div className="profile-field">
              <span>COLLEGE EMAIL</span>
              <strong>{user?.email || "—"}</strong>
            </div>

            <div className="profile-field">
              <span>PHONE</span>
              <strong>{user?.phone || "—"}</strong>
            </div>

            <div className="profile-field">
              <span>ROLE</span>
              <strong>{user?.role || "VOTER"}</strong>
            </div>

            <div className="profile-field">
              <span>EMAIL VERIFICATION</span>
              <strong className={user?.emailVerified ? "verified" : "not-verified"}>
                {user?.emailVerified ? "Verified" : "Not Verified"}
              </strong>
            </div>

            <div className="profile-field">
              <span>ACCOUNT STATUS</span>
              <strong className="status-value">
                {user?.verificationStatus || "PENDING"}
              </strong>
            </div>

          </div>

        </section>

        <div className="profile-actions">
          <button
            className="profile-back-button"
            onClick={() => navigate("/")}
          >
            ← Back to Home
          </button>

          {user?.verificationStatus === "APPROVED" && (
            <button
              className="profile-election-button"
              onClick={() => navigate("/election")}
            >
              View Election →
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

export default Profile;