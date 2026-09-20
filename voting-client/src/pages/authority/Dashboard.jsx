import { useEffect, useState } from "react";

function AuthorityDashboard() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // =====================================================
  // LOAD ALL VOTERS
  // =====================================================

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        "http://localhost:5000/api/authority/users",
        {
          method: "GET",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Unable to load voters."
        );
      }

      // IMPORTANT:
      // Always make sure users is an array
      setUsers(
        Array.isArray(data.users)
          ? data.users
          : []
      );

    } catch (err) {
      console.error("Load users error:", err);

      setUsers([]);

      setError(
        err.message ||
          "Unable to connect to VoteSphere server."
      );
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // LOAD USERS WHEN PAGE OPENS
  // =====================================================

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadUsers();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, []);

  // =====================================================
  // APPROVE VOTER
  // =====================================================

  const approveVoter = async (userId) => {
    try {
      setMessage("");
      setError("");

      const confirmed = window.confirm(
        "Are you sure you want to approve this voter?"
      );

      if (!confirmed) {
        return;
      }

      const response = await fetch(
        `http://localhost:5000/api/authority/users/${userId}/approve`,
        {
          method: "PATCH",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Approval failed."
        );
      }

      setMessage(
        "Voter approved successfully."
      );

      await loadUsers();

    } catch (err) {
      console.error("Approve voter error:", err);

      setError(
        err.message || "Unable to approve voter."
      );
    }
  };

  // =====================================================
  // REJECT VOTER
  // =====================================================

  const rejectVoter = async (userId) => {
    try {
      setMessage("");
      setError("");

      const confirmed = window.confirm(
        "Are you sure you want to reject this voter?"
      );

      if (!confirmed) {
        return;
      }

      const response = await fetch(
        `http://localhost:5000/api/authority/users/${userId}/reject`,
        {
          method: "PATCH",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Rejection failed."
        );
      }

      setMessage(
        "Voter request rejected successfully."
      );

      await loadUsers();

    } catch (err) {
      console.error("Reject voter error:", err);

      setError(
        err.message || "Unable to reject voter."
      );
    }
  };

  // =====================================================
  // SUSPEND VOTER
  // =====================================================

  const suspendVoter = async (userId) => {
    try {
      setMessage("");
      setError("");

      const confirmed = window.confirm(
        "Are you sure you want to suspend this voter?"
      );

      if (!confirmed) {
        return;
      }

      const response = await fetch(
        `http://localhost:5000/api/authority/users/${userId}/suspend`,
        {
          method: "PATCH",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Suspension failed."
        );
      }

      setMessage(
        "Voter suspended successfully."
      );

      await loadUsers();

    } catch (err) {
      console.error("Suspend voter error:", err);

      setError(
        err.message || "Unable to suspend voter."
      );
    }
  };

  // =====================================================
  // REACTIVATE VOTER
  // =====================================================

  const reactivateVoter = async (userId) => {
    try {
      setMessage("");
      setError("");

      const confirmed = window.confirm(
        "Are you sure you want to reactivate this voter?"
      );

      if (!confirmed) {
        return;
      }

      const response = await fetch(
        `http://localhost:5000/api/authority/users/${userId}/reactivate`,
        {
          method: "PATCH",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || "Reactivation failed."
        );
      }

      setMessage(
        "Voter reactivated successfully."
      );

      await loadUsers();

    } catch (err) {
      console.error(
        "Reactivate voter error:",
        err
      );

      setError(
        err.message ||
          "Unable to reactivate voter."
      );
    }
  };

  // =====================================================
  // SAFE STATISTICS
  // =====================================================

  const safeUsers = Array.isArray(users)
    ? users
    : [];

  const totalVoters = safeUsers.length;

  const approvedVoters = safeUsers.filter(
    (user) =>
      user.verificationStatus === "APPROVED"
  );

  const pendingVoters = safeUsers.filter(
    (user) =>
      user.verificationStatus === "PENDING"
  );

  const suspendedVoters = safeUsers.filter(
    (user) =>
      user.verificationStatus === "SUSPENDED"
  );

  const rejectedVoters = safeUsers.filter(
    (user) =>
      user.verificationStatus === "REJECTED"
  );

  // =====================================================
  // STATUS BADGE
  // =====================================================

  const getStatusClass = (status) => {
    switch (status) {
      case "APPROVED":
        return "status approved";

      case "PENDING":
        return "status pending";

      case "SUSPENDED":
        return "status suspended";

      case "REJECTED":
        return "status rejected";

      default:
        return "status";
    }
  };

  // =====================================================
  // PAGE
  // =====================================================

  return (
    <div className="authority-page">

      {/* =================================================
          HEADER
      ================================================= */}

      <header className="authority-header">

        <div>
          <div className="brand">
            🗳️ VoteSphere
          </div>

          <h1>
            Authority Console
          </h1>

          <p>
            Manage voter registration and election
            access securely.
          </p>
        </div>

        <button
          className="refresh-btn"
          onClick={loadUsers}
          disabled={loading}
        >
          {loading
            ? "Loading..."
            : "↻ Refresh"}
        </button>

      </header>


      {/* =================================================
          MESSAGES
      ================================================= */}

      {message && (
        <div className="success-message">
          ✓ {message}
        </div>
      )}

      {error && (
        <div className="error-message">
          ⚠ {error}
        </div>
      )}


      {/* =================================================
          STATISTICS
      ================================================= */}

      <section className="stats-grid">

        <div className="stat-card">
          <div className="stat-icon">
            👥
          </div>

          <div>
            <span>
              Total Voters
            </span>

            <strong>
              {totalVoters}
            </strong>
          </div>
        </div>


        <div className="stat-card approved-card">
          <div className="stat-icon">
            ✓
          </div>

          <div>
            <span>
              Approved
            </span>

            <strong>
              {approvedVoters.length}
            </strong>
          </div>
        </div>


        <div className="stat-card pending-card">
          <div className="stat-icon">
            ⏳
          </div>

          <div>
            <span>
              Pending
            </span>

            <strong>
              {pendingVoters.length}
            </strong>
          </div>
        </div>


        <div className="stat-card suspended-card">
          <div className="stat-icon">
            ⚠
          </div>

          <div>
            <span>
              Suspended
            </span>

            <strong>
              {suspendedVoters.length}
            </strong>
          </div>
        </div>


        <div className="stat-card rejected-card">
          <div className="stat-icon">
            ✕
          </div>

          <div>
            <span>
              Rejected
            </span>

            <strong>
              {rejectedVoters.length}
            </strong>
          </div>
        </div>

      </section>


      {/* =================================================
          VOTER MANAGEMENT
      ================================================= */}

      <section className="users-section">

        <div className="section-header">

          <div>
            <h2>
              Voter Management
            </h2>

            <p>
              Review and control registered student
              voter accounts.
            </p>
          </div>

          <span className="user-count">
            {totalVoters} voters
          </span>

        </div>


        {/* =================================================
            LOADING
        ================================================= */}

        {loading ? (

          <div className="empty-state">
            <div className="loader">
              ⟳
            </div>

            <p>
              Loading voter records...
            </p>
          </div>

        ) : safeUsers.length === 0 ? (

          <div className="empty-state">

            <div className="empty-icon">
              👥
            </div>

            <h3>
              No voters found
            </h3>

            <p>
              There are currently no registered
              voter accounts.
            </p>

          </div>

        ) : (

          <div className="table-container">

            <table>

              <thead>

                <tr>

                  <th>
                    Student
                  </th>

                  <th>
                    Student ID
                  </th>

                  <th>
                    Email
                  </th>

                  <th>
                    Email Verified
                  </th>

                  <th>
                    Status
                  </th>

                  <th>
                    Registered
                  </th>

                  <th>
                    Action
                  </th>

                </tr>

              </thead>


              <tbody>

                {safeUsers.map((user) => (

                  <tr key={user.id}>

                    {/* Student */}

                    <td>

                      <div className="student-cell">

                        <div className="avatar">
                          {user.fullName
                            ? user.fullName
                                .charAt(0)
                                .toUpperCase()
                            : "?"}
                        </div>

                        <div>

                          <strong>
                            {user.fullName ||
                              "Unknown Student"}
                          </strong>

                          <small>
                            {user.phone ||
                              "No phone number"}
                          </small>

                        </div>

                      </div>

                    </td>


                    {/* Student ID */}

                    <td>

                      <span className="student-id">
                        {user.studentId}
                      </span>

                    </td>


                    {/* Email */}

                    <td>

                      <span className="email">
                        {user.email}
                      </span>

                    </td>


                    {/* Email Verification */}

                    <td>

                      {user.emailVerified ? (

                        <span className="verified">
                          ✓ Verified
                        </span>

                      ) : (

                        <span className="not-verified">
                          ✕ Not Verified
                        </span>

                      )}

                    </td>


                    {/* Status */}

                    <td>

                      <span
                        className={getStatusClass(
                          user.verificationStatus
                        )}
                      >
                        {user.verificationStatus}
                      </span>

                    </td>


                    {/* Registration Date */}

                    <td>

                      {user.createdAt
                        ? new Date(
                            user.createdAt
                          ).toLocaleDateString()
                        : "-"}

                    </td>


                    {/* Actions */}

                    <td>

                      <div className="actions">

                        {/* PENDING */}

                        {user.verificationStatus ===
                          "PENDING" && (

                          <>

                            <button
                              className="approve-btn"
                              onClick={() =>
                                approveVoter(
                                  user.id
                                )
                              }
                              disabled={
                                !user.emailVerified
                              }
                              title={
                                !user.emailVerified
                                  ? "Student must verify email first"
                                  : "Approve voter"
                              }
                            >
                              ✓ Approve
                            </button>

                            <button
                              className="reject-btn"
                              onClick={() =>
                                rejectVoter(
                                  user.id
                                )
                              }
                            >
                              ✕ Reject
                            </button>

                          </>

                        )}


                        {/* APPROVED */}

                        {user.verificationStatus ===
                          "APPROVED" && (

                          <button
                            className="suspend-btn"
                            onClick={() =>
                              suspendVoter(
                                user.id
                              )
                            }
                          >
                            Suspend
                          </button>

                        )}


                        {/* SUSPENDED */}

                        {user.verificationStatus ===
                          "SUSPENDED" && (

                          <button
                            className="reactivate-btn"
                            onClick={() =>
                              reactivateVoter(
                                user.id
                              )
                            }
                          >
                            Reactivate
                          </button>

                        )}


                        {/* REJECTED */}

                        {user.verificationStatus ===
                          "REJECTED" && (

                          <span className="rejected-text">
                            Rejected
                          </span>

                        )}

                      </div>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        )}

      </section>


      {/* =================================================
          INFORMATION
      ================================================= */}

      <section className="security-note">

        <div className="security-icon">
          🔐
        </div>

        <div>

          <h3>
            Authority Security
          </h3>

          <p>
            Only verified college email accounts
            can be approved for voting. Voter
            approval, suspension and reactivation
            are controlled by the Authority backend.
          </p>

        </div>

      </section>


      {/* =================================================
          PAGE STYLES
      ================================================= */}

      <style>{`

        * {
          box-sizing: border-box;
        }

        .authority-page {
          min-height: 100vh;
          background: #06111f;
          color: #ffffff;
          padding: 35px;
          font-family:
            Inter,
            Arial,
            sans-serif;
        }

        .authority-header {
          max-width: 1400px;
          margin: 0 auto 30px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
        }

        .brand {
          color: #09c7e8;
          font-size: 22px;
          font-weight: 800;
          margin-bottom: 15px;
        }

        .authority-header h1 {
          margin: 0;
          font-size: 36px;
          letter-spacing: -0.5px;
        }

        .authority-header p {
          margin-top: 10px;
          color: #8ea4bd;
          font-size: 15px;
        }

        .refresh-btn {
          border: 1px solid #24506d;
          background: #0b1a2b;
          color: #ffffff;
          padding: 12px 20px;
          border-radius: 10px;
          cursor: pointer;
          font-weight: 700;
        }

        .refresh-btn:hover {
          background: #11283d;
        }

        .refresh-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .success-message,
        .error-message {
          max-width: 1400px;
          margin: 0 auto 20px;
          padding: 14px 18px;
          border-radius: 10px;
          font-weight: 600;
        }

        .success-message {
          background: #123524;
          color: #6ee7a5;
          border: 1px solid #245b3e;
        }

        .error-message {
          background: #3b1820;
          color: #ff8e9e;
          border: 1px solid #67303b;
        }

        .stats-grid {
          max-width: 1400px;
          margin: 0 auto 30px;
          display: grid;
          grid-template-columns:
            repeat(5, 1fr);
          gap: 18px;
        }

        .stat-card {
          background: #0b1a2b;
          border: 1px solid #18344f;
          border-radius: 16px;
          padding: 22px;
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .stat-icon {
          width: 48px;
          height: 48px;
          display: flex;
          justify-content: center;
          align-items: center;
          border-radius: 12px;
          background: #122b41;
          font-size: 21px;
        }

        .stat-card span {
          display: block;
          color: #8ea4bd;
          font-size: 13px;
          margin-bottom: 5px;
        }

        .stat-card strong {
          display: block;
          font-size: 28px;
        }

        .approved-card .stat-icon {
          color: #6ee7a5;
        }

        .pending-card .stat-icon {
          color: #ffd166;
        }

        .suspended-card .stat-icon {
          color: #ff9f68;
        }

        .rejected-card .stat-icon {
          color: #ff7185;
        }

        .users-section {
          max-width: 1400px;
          margin: 0 auto;
          background: #0b1a2b;
          border: 1px solid #18344f;
          border-radius: 18px;
          overflow: hidden;
        }

        .section-header {
          padding: 25px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          border-bottom: 1px solid #18344f;
        }

        .section-header h2 {
          margin: 0;
          font-size: 22px;
        }

        .section-header p {
          margin: 7px 0 0;
          color: #8ea4bd;
          font-size: 14px;
        }

        .user-count {
          background: #122b41;
          color: #09c7e8;
          padding: 8px 13px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 700;
        }

        .table-container {
          width: 100%;
          overflow-x: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1100px;
        }

        th {
          background: #091625;
          color: #8ea4bd;
          text-align: left;
          padding: 15px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        td {
          padding: 16px 15px;
          border-top: 1px solid #18344f;
          font-size: 13px;
          vertical-align: middle;
        }

        tr:hover td {
          background: #0e2134;
        }

        .student-cell {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #153a52;
          color: #09c7e8;
          font-weight: 800;
          font-size: 16px;
        }

        .student-cell strong {
          display: block;
          color: #ffffff;
          margin-bottom: 4px;
        }

        .student-cell small {
          display: block;
          color: #6f879e;
        }

        .student-id {
          color: #09c7e8;
          font-weight: 700;
        }

        .email {
          color: #c1d0df;
        }

        .verified {
          color: #6ee7a5;
          font-weight: 700;
        }

        .not-verified {
          color: #ff8798;
          font-weight: 700;
        }

        .status {
          display: inline-block;
          padding: 6px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 800;
        }

        .status.approved {
          background: #123524;
          color: #6ee7a5;
        }

        .status.pending {
          background: #3b3217;
          color: #ffd166;
        }

        .status.suspended {
          background: #3b261a;
          color: #ff9f68;
        }

        .status.rejected {
          background: #3b1820;
          color: #ff7185;
        }

        .actions {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
        }

        .actions button {
          border: none;
          border-radius: 7px;
          padding: 8px 11px;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
        }

        .approve-btn {
          background: #1d8f5a;
          color: #ffffff;
        }

        .approve-btn:hover {
          background: #24aa6b;
        }

        .approve-btn:disabled {
          background: #394651;
          color: #9ba7b0;
          cursor: not-allowed;
        }

        .reject-btn {
          background: #b33a4b;
          color: #ffffff;
        }

        .reject-btn:hover {
          background: #d04a5c;
        }

        .suspend-btn {
          background: #8d542c;
          color: #ffffff;
        }

        .suspend-btn:hover {
          background: #aa6738;
        }

        .reactivate-btn {
          background: #256b96;
          color: #ffffff;
        }

        .reactivate-btn:hover {
          background: #2f83b5;
        }

        .rejected-text {
          color: #ff7185;
          font-weight: 700;
          font-size: 12px;
        }

        .empty-state {
          text-align: center;
          padding: 70px 20px;
          color: #8ea4bd;
        }

        .empty-icon {
          font-size: 40px;
          margin-bottom: 15px;
        }

        .empty-state h3 {
          color: #ffffff;
          margin-bottom: 8px;
        }

        .loader {
          font-size: 32px;
          color: #09c7e8;
          margin-bottom: 10px;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }

          to {
            transform: rotate(360deg);
          }
        }

        .security-note {
          max-width: 1400px;
          margin: 25px auto 0;
          padding: 20px;
          background: #091625;
          border: 1px solid #18344f;
          border-radius: 14px;
          display: flex;
          align-items: flex-start;
          gap: 15px;
        }

        .security-icon {
          font-size: 25px;
        }

        .security-note h3 {
          margin: 0 0 7px;
          font-size: 16px;
        }

        .security-note p {
          margin: 0;
          color: #8ea4bd;
          line-height: 1.6;
          font-size: 13px;
        }

        @media (max-width: 1100px) {

          .stats-grid {
            grid-template-columns:
              repeat(2, 1fr);
          }

        }

        @media (max-width: 700px) {

          .authority-page {
            padding: 20px;
          }

          .authority-header {
            flex-direction: column;
          }

          .authority-header h1 {
            font-size: 28px;
          }

          .stats-grid {
            grid-template-columns: 1fr;
          }

          .section-header {
            flex-direction: column;
            align-items: flex-start;
          }

        }

      `}</style>

    </div>
  );
}

export default AuthorityDashboard;