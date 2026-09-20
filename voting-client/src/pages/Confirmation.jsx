import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Confirmation.css";

function Confirmation() {
  const navigate = useNavigate();

  const [candidate] = useState(() => {
    const storedCandidate = sessionStorage.getItem("selectedCandidate");

    if (!storedCandidate) {
      return null;
    }

    try {
      return JSON.parse(storedCandidate);
    } catch (error) {
      console.error("Unable to read selected candidate:", error);
      return null;
    }
  });
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const confirmVote = async () => {
    if (!candidate) {
      setError("No candidate selected.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        "http://localhost:5000/api/votes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            candidateName: candidate.name,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setError(
            data.message ||
              "You have already voted in this election."
          );
        } else {
          setError(
            data.message ||
              "Unable to submit your vote."
          );
        }

        return;
      }

      const receiptNumber =
        data.vote?.receiptNumber ||
        data.receiptNumber ||
        "VS-RECEIPT";

      setReceipt(receiptNumber);

      sessionStorage.removeItem("selectedCandidate");

      setConfirmed(true);

    } catch (error) {
      console.error("Vote confirmation error:", error);

      setError(
        "Unable to connect to VoteSphere server."
      );
    } finally {
      setLoading(false);
    }
  };

  if (confirmed) {
    return (
      <div className="confirmation-page success-page">

        <div className="success-card">

          <div className="success-icon">
            ✓
          </div>

          <span className="success-label">
            VOTE SUCCESSFULLY CAST
          </span>

          <h1>
            Thank You for Voting
          </h1>

          <p className="success-description">
            Your official vote has been successfully
            submitted and permanently finalized.
          </p>

          <div className="receipt-card">

            <span>VOTE RECEIPT</span>

            <strong>
              {receipt}
            </strong>

            <small>
              Keep this receipt for your records.
            </small>

          </div>

          <div className="final-status">
            <span>✓</span>

            <div>
              <strong>
                Your vote is final
              </strong>

              <p>
                This official vote cannot be changed,
                cancelled, edited or submitted again
                for this election.
              </p>
            </div>
          </div>

          <div className="next-section">

            <span className="next-label">
              WHAT'S NEXT?
            </span>

            <h2>
              Participate in the prediction poll
            </h2>

            <p>
              You can now make a separate prediction
              about the election outcome.
            </p>

            <div className="success-actions">

              <button
                className="prediction-button"
                onClick={() => navigate("/prediction")}
              >
                Prediction
                <span>→</span>
              </button>

              <button
                className="home-button"
                onClick={() => navigate("/")}
              >
                Back to Home
              </button>

            </div>

          </div>

          <div className="logout-suggestion">

            <span>🔒</span>

            <div>
              <strong>
                Finished voting?
              </strong>

              <p>
                You can safely log out of your account.
              </p>
            </div>

            <button
              onClick={async () => {
                try {
                  await fetch(
                    "http://localhost:5000/api/auth/logout",
                    {
                      method: "POST",
                      credentials: "include",
                    }
                  );
                } catch (error) {
                  console.error(
                    "Logout error:",
                    error
                  );
                }

                navigate("/");
              }}
            >
              Logout
            </button>

          </div>

        </div>

      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="confirmation-page">

        <div className="confirmation-empty">

          <h2>
            No candidate selected
          </h2>

          <p>
            Please return to the ballot and select
            a candidate.
          </p>

          <button
            onClick={() => navigate("/vote")}
          >
            ← Back to Vote
          </button>

        </div>

      </div>
    );
  }

  return (
    <div className="confirmation-page">

      <div className="confirmation-card">

        <span className="confirmation-label">
          FINAL REVIEW
        </span>

        <h1>
          Confirm Your Vote
        </h1>

        <p className="confirmation-description">
          Please carefully review your selection.
          Once confirmed, your official vote is
          permanently finalized.
        </p>

        <div className="selected-candidate">

          <div className="selected-symbol">
            {candidate.symbol}
          </div>

          <div>
            <span>
              PRESIDENT
            </span>

            <h2>
              {candidate.name}
            </h2>

            <p>
              {candidate.party}
            </p>
          </div>

        </div>

        {error && (
          <div className="confirmation-error">
            {error}
          </div>
        )}

        <div className="confirmation-warning">

          <span>!</span>

          <div>
            <strong>
              Important
            </strong>

            <p>
              After clicking Confirm Official Vote,
              you cannot change, cancel or submit
              another vote for this election.
            </p>
          </div>

        </div>

        <button
          className="confirm-vote-button"
          onClick={confirmVote}
          disabled={loading}
        >
          {loading
            ? "Submitting Vote..."
            : "Confirm Official Vote"}
        </button>

        <button
          className="back-vote-button"
          onClick={() => navigate("/vote")}
          disabled={loading}
        >
          ← Back to Selection
        </button>

      </div>

    </div>
  );
}

export default Confirmation;