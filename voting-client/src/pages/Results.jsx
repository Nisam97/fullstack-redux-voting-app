import { useNavigate } from "react-router-dom";
import "./Results.css";

function Results() {
  const navigate = useNavigate();

  const electionClosed = false;

  return (
    <div className="results-page">

      <header className="results-header">

        <div>
          <span>OFFICIAL ELECTION RESULTS</span>

          <h1>
            Student Council Election 2026
          </h1>

          <p>
            Official election result portal
          </p>
        </div>

        <div className="results-status">
          <span></span>
          Election in Progress
        </div>

      </header>

      {!electionClosed ? (

        <div className="results-locked">

          <div className="lock-icon">
            🔒
          </div>

          <span className="locked-label">
            RESULTS CURRENTLY HIDDEN
          </span>

          <h2>
            Official results are not available yet
          </h2>

          <p>
            To protect the integrity of the election, official
            vote counts and candidate standings are hidden while
            voting is still in progress.
          </p>

          <div className="locked-info-grid">

            <div>
              <strong>
                Voting
              </strong>

              <span>
                Currently Open
              </span>
            </div>

            <div>
              <strong>
                Official Results
              </strong>

              <span>
                Locked
              </span>
            </div>

            <div>
              <strong>
                Prediction Poll
              </strong>

              <span>
                Available After Voting
              </span>
            </div>

          </div>

          <button
            onClick={() => navigate("/election")}
            className="results-back-button"
          >
            Back to Election
          </button>

        </div>

      ) : (

        <div className="results-open">

          <div className="results-summary">

            <div>
              <span>Total Votes</span>
              <strong>1,248</strong>
            </div>

            <div>
              <span>Participation</span>
              <strong>83.2%</strong>
            </div>

            <div>
              <span>Election Status</span>
              <strong>Closed</strong>
            </div>

          </div>

          <div className="official-results">

            <h2>
              Final Results
            </h2>

            <div className="result-row">
              <span>1</span>
              <strong>Alex Mathew</strong>
              <b>582 votes</b>
            </div>

            <div className="result-row">
              <span>2</span>
              <strong>Riya Thomas</strong>
              <b>441 votes</b>
            </div>

            <div className="result-row">
              <span>3</span>
              <strong>Rahul Menon</strong>
              <b>225 votes</b>
            </div>

          </div>

        </div>

      )}

    </div>
  );
}

export default Results;