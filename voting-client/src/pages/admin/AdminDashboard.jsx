import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./AdminDashboard.css";

function AdminDashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="admin-page">

      {/* SIDEBAR */}
      <aside className="admin-sidebar">

        <div className="admin-logo">
          🗳️
          <span>VoteSphere</span>
        </div>

        <div className="admin-role">
          <span className="admin-dot"></span>
          ADMIN / GUIDE
        </div>

        <nav className="admin-menu">

          <Link to="/admin">
            📊 Dashboard
          </Link>

          <Link to="/admin/users">
            👥 Voter Verification
          </Link>

          <Link to="/admin/elections">
            🗳️ Elections
          </Link>

          <Link to="/admin/candidates">
            👤 Candidates
          </Link>

          <Link to="/admin/security">
            🔐 Security Monitor
          </Link>

          <Link to="/admin/results">
            📈 Results
          </Link>

        </nav>

        <button
          className="admin-logout"
          onClick={logout}
        >
          🚪 Logout
        </button>

      </aside>

      {/* MAIN */}
      <main className="admin-main">

        <header className="admin-header">

          <div>
            <p>ADMINISTRATION</p>
            <h1>Admin Dashboard</h1>
          </div>

          <div className="admin-profile">
            <div className="admin-avatar">
              {user?.name?.charAt(0)?.toUpperCase() || "A"}
            </div>

            <div>
              <strong>{user?.name || "Administrator"}</strong>
              <span>Administrator</span>
            </div>
          </div>

        </header>

        {/* STATISTICS */}

        <section className="admin-stats">

          <div className="admin-stat-card">
            <span className="stat-icon">👥</span>
            <p>Total Voters</p>
            <h2>1,248</h2>
            <small>+12% this month</small>
          </div>

          <div className="admin-stat-card">
            <span className="stat-icon">⏳</span>
            <p>Pending Verification</p>
            <h2>37</h2>
            <small>Needs attention</small>
          </div>

          <div className="admin-stat-card">
            <span className="stat-icon">🗳️</span>
            <p>Active Elections</p>
            <h2>4</h2>
            <small>Currently running</small>
          </div>

          <div className="admin-stat-card">
            <span className="stat-icon">⚠️</span>
            <p>Suspicious Users</p>
            <h2>8</h2>
            <small>Under review</small>
          </div>

        </section>

        {/* QUICK ACTIONS */}

        <section className="admin-section">

          <div className="section-heading">
            <div>
              <h2>Administration</h2>
              <p>Control the complete VoteSphere platform</p>
            </div>
          </div>

          <div className="admin-grid">

            <Link
              to="/admin/users"
              className="admin-action-card"
            >
              <div className="action-icon">🛡️</div>
              <h3>Voter Verification</h3>
              <p>
                Verify voter identity and approve
                eligible users.
              </p>
              <span>Manage →</span>
            </Link>

            <Link
              to="/admin/elections"
              className="admin-action-card"
            >
              <div className="action-icon">🗳️</div>
              <h3>Election Management</h3>
              <p>
                Create, configure and control
                elections.
              </p>
              <span>Manage →</span>
            </Link>

            <Link
              to="/admin/candidates"
              className="admin-action-card"
            >
              <div className="action-icon">👤</div>
              <h3>Candidate Management</h3>
              <p>
                Add, edit and manage election
                candidates.
              </p>
              <span>Manage →</span>
            </Link>

            <Link
              to="/admin/security"
              className="admin-action-card"
            >
              <div className="action-icon">🔐</div>
              <h3>Security Monitor</h3>
              <p>
                Monitor suspicious activity and
                security events.
              </p>
              <span>Monitor →</span>
            </Link>

          </div>

        </section>

        {/* SYSTEM STATUS */}

        <section className="system-status">

          <div>
            <span className="online"></span>
            <strong>Voting System Online</strong>
          </div>

          <div>
            🔒 Secure Session
          </div>

          <div>
            ⚡ Real-Time Server
          </div>

          <div>
            🟢 Socket Connected
          </div>

        </section>

      </main>

    </div>
  );
}

export default AdminDashboard;