import { useEffect, useState } from "react";

function Users() {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadPendingUsers = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        "http://localhost:5000/api/authority/users/pending",
        {
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to load pending voters.");
      }

      setPendingUsers(data.users || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      loadPendingUsers();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, []);

  const approveVoter = async (userId) => {
    try {
      setMessage("");
      setError("");

      const response = await fetch(
        `http://localhost:5000/api/authority/users/${userId}/approve`,
        {
          method: "PATCH",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Approval failed.");
      }

      setMessage("Voter approved successfully.");

      // Remove approved voter from pending list
      setPendingUsers((currentUsers) =>
        currentUsers.filter((user) => user.id !== userId)
      );
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  const rejectVoter = async (userId) => {
    const confirmed = window.confirm(
      "Are you sure you want to reject this voter?"
    );

    if (!confirmed) return;

    try {
      setMessage("");
      setError("");

      const response = await fetch(
        `http://localhost:5000/api/authority/users/${userId}/reject`,
        {
          method: "PATCH",
          credentials: "include"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Rejection failed.");
      }

      setMessage("Voter request rejected.");

      setPendingUsers((currentUsers) =>
        currentUsers.filter((user) => user.id !== userId)
      );
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  return (
    <div className="authority-users-page">

      <div className="page-header">
        <div>
          <h1>Pending Voter Requests</h1>
          <p>
            Review and approve students who have requested access to the
            election.
          </p>
        </div>

        <button onClick={loadPendingUsers}>
          Refresh
        </button>
      </div>

      {message && (
        <div className="success-message">
          {message}
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {loading ? (
        <div className="loading">
          Loading pending requests...
        </div>
      ) : pendingUsers.length === 0 ? (
        <div className="empty-state">
          <h2>No Pending Requests</h2>
          <p>
            There are currently no voter approval requests.
          </p>
        </div>
      ) : (
        

<div className="pending-table-container">
  <table className="pending-table">
    <thead>
      <tr>
        <th>Student ID</th>
        <th>Name</th>
        <th>College Email</th>
        <th>Email Verified</th>
        <th>Requested On</th>
        <th>Action</th>
      </tr>
    </thead>

    <tbody>
      {pendingUsers.map((user) => (
        <tr key={user.id}>
          <td>{user.studentId}</td>

          <td>
            <strong>{user.fullName}</strong>
          </td>

          <td>{user.email}</td>

          <td>
            {user.emailVerified ? (
              <span className="verified">
                ✓ Verified
              </span>
            ) : (
              <span className="not-verified">
                Not Verified
              </span>
            )}
          </td>

          <td>
            {new Date(user.createdAt).toLocaleDateString()}
          </td>

          {/* ACTION COLUMN */}
          <td className="action-column">

            <button
              className="approve-btn"
              onClick={() => approveVoter(user.id)}
              disabled={!user.emailVerified}
            >
              ✓ Approve
            </button>

            <button
              className="reject-btn"
              onClick={() => rejectVoter(user.id)}
            >
              ✕ Reject
            </button>

          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>


        
      )}
    </div>
  );
}

export default Users;