import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Prediction.css";

const candidates = [
  {
    id: 1,
    name: "Alex Mathew",
    party: "Progress Team",
    symbol: "⭐",
    percentage: 52,
  },
  {
    id: 2,
    name: "Riya Thomas",
    party: "Unity Team",
    symbol: "🌟",
    percentage: 34,
  },
  {
    id: 3,
    name: "Rahul Menon",
    party: "Future Team",
    symbol: "🚀",
    percentage: 14,
  },
];

function Prediction() {
  const navigate = useNavigate();

  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!selected) {
      alert("Please select one candidate as your prediction.");
      return;
    }

    const prediction = {
      candidateId: selected.id,
      candidateName: selected.name,
      timestamp: new Date().toISOString(),
    };

    localStorage.setItem(
      "votespherePrediction",
      JSON.stringify(prediction)
    );

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="prediction-page">

        <div className="prediction-result-card">

          <div className="poll-success-icon">
            ✓
          </div>

          <span className="prediction-label">
            PREDICTION SUBMITTED
          </span>

          <h1>
            Community Prediction
          </h1>

          <p className="prediction-description">
            Your prediction has been recorded. Here is what
            other participating users predicted.
          </p>

          <div className="poll-notice">
            📊 <strong>Prediction Poll Only</strong>
            <br />
            These percentages are community guesses and are
            <strong> not official election results.</strong>
          </div>

          <div className="prediction-results">

            {candidates.map((candidate, index) => (

              <div
                className="prediction-result"
                key={candidate.id}
              >

                <div className="prediction-result-header">

                  <div className="prediction-person">

                    <span className="prediction-rank">
                      #{index + 1}
                    </span>

                    <span className="prediction-symbol">
                      {candidate.symbol}
                    </span>

                    <div>
                      <strong>
                        {candidate.name}
                      </strong>

                      <small>
                        {candidate.party}
                      </small>
                    </div>

                  </div>

                  <strong>
                    {candidate.percentage}%
                  </strong>

                </div>

                <div className="prediction-bar">

                  <div
                    style={{
                      width: `${candidate.percentage}%`,
                    }}
                  ></div>

                </div>

              </div>

            ))}

          </div>

          <div className="poll-total">
            <strong>1,248</strong>
            <span>users participated in the prediction poll</span>
          </div>

          <div className="prediction-footer-note">
            Official election results are separate from this
            prediction poll and will be available according
            to the election schedule.
          </div>

          <button
            className="prediction-home-button"
            onClick={() => navigate("/")}
          >
            Return to Home
          </button>

        </div>

      </div>
    );
  }

  return (
    <div className="prediction-page">

      <div className="prediction-card">

        <div className="prediction-icon">
          🔮
        </div>

        <span className="prediction-label">
          COMMUNITY PREDICTION POLL
        </span>

        <h1>
          Who do you think will win?
        </h1>

        <p>
          Your official vote has been submitted.
          Now make a prediction about who you think will
          win the election.
        </p>

        <div className="prediction-info">

          <span>💡</span>

          <div>
            <strong>
              This is not your official vote
            </strong>

            <p>
              The prediction poll is completely separate
              from the official election ballot.
            </p>
          </div>

        </div>

        <div className="prediction-options">

          {candidates.map((candidate) => {

            const isSelected =
              selected?.id === candidate.id;

            return (
              <button
                key={candidate.id}
                className={`prediction-option ${
                  isSelected ? "selected" : ""
                }`}
                onClick={() => setSelected(candidate)}
              >

                <span className="prediction-option-symbol">
                  {candidate.symbol}
                </span>

                <span className="prediction-option-info">

                  <strong>
                    {candidate.name}
                  </strong>

                  <small>
                    {candidate.party}
                  </small>

                </span>

                <span className="prediction-radio">

                  {isSelected && "✓"}

                </span>

              </button>
            );
          })}

        </div>

        <button
          className="submit-prediction-button"
          onClick={handleSubmit}
        >
          Submit My Prediction →
        </button>

        <p className="prediction-disclaimer">
          Prediction results are community opinions and do not
          represent official election results.
        </p>

      </div>

    </div>
  );
}

export default Prediction;