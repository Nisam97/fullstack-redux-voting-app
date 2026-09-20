import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Vote.css";

const candidates = [
  {
    id: 1,
    name: "Alex Mathew",
    party: "Progress Team",
    symbol: "⭐",
  },
  {
    id: 2,
    name: "Riya Thomas",
    party: "Unity Team",
    symbol: "🌟",
  },
  {
    id: 3,
    name: "Rahul Menon",
    party: "Future Team",
    symbol: "🚀",
  },
];

function Vote() {
  const navigate = useNavigate();

  const [selectedCandidate, setSelectedCandidate] =
    useState(null);

  const handleCandidateSelect = (candidate) => {
    setSelectedCandidate(candidate);
  };

  const handleContinue = () => {
    if (!selectedCandidate) {
      alert("Please select one candidate.");
      return;
    }

    // Save selected candidate safely
    sessionStorage.setItem(
      "selectedCandidate",
      JSON.stringify(selectedCandidate)
    );

    navigate("/confirmation");
  };

  return (
    <div className="vote-page">

      {/* =====================================================
          HEADER
      ====================================================== */}

      <header className="vote-header">

        <div className="vote-header-content">

          <span className="vote-label">
            OFFICIAL VOTING
          </span>

          <h1>
            Cast Your Vote
          </h1>

          <p>
            Student Council Election 2026
          </p>

        </div>

        <div className="secure-badge">
          <span>🔒</span>
          Secure Ballot
        </div>

      </header>


      {/* =====================================================
          PROGRESS
      ====================================================== */}

      <div className="vote-progress">

        <div className="progress-step active">

          <span>1</span>

          <div>
            <strong>Select</strong>
            <small>Choose candidate</small>
          </div>

        </div>

        <div className="progress-line"></div>

        <div className="progress-step">

          <span>2</span>

          <div>
            <strong>Review</strong>
            <small>Check your choice</small>
          </div>

        </div>

        <div className="progress-line"></div>

        <div className="progress-step">

          <span>3</span>

          <div>
            <strong>Confirm</strong>
            <small>Submit vote</small>
          </div>

        </div>

      </div>


      {/* =====================================================
          WARNING
      ====================================================== */}

      <section className="vote-warning">

        <div className="warning-icon">
          !
        </div>

        <div>

          <h3>
            One candidate only
          </h3>

          <p>
            Select exactly one candidate. Your selection
            will be reviewed before the official vote is
            permanently submitted.
          </p>

        </div>

      </section>


      {/* =====================================================
          BALLOT
      ====================================================== */}

      <section className="vote-section">

        <div className="vote-section-heading">

          <span>
            YOUR BALLOT
          </span>

          <h2>
            Select your candidate
          </h2>

          <p>
            Choose one candidate to continue to the final
            review.
          </p>

        </div>


        <div className="vote-candidate-list">

          {candidates.map((candidate) => {

            const isSelected =
              selectedCandidate?.id === candidate.id;

            return (
              <button
                type="button"
                key={candidate.id}
                className={`vote-candidate ${
                  isSelected ? "selected" : ""
                }`}
                onClick={() =>
                  handleCandidateSelect(candidate)
                }
              >

                {/* RADIO */}

                <div
                  className={`candidate-radio ${
                    isSelected ? "checked" : ""
                  }`}
                >
                  {isSelected && (
                    <span>✓</span>
                  )}
                </div>


                {/* SYMBOL */}

                <div className="vote-symbol">
                  {candidate.symbol}
                </div>


                {/* CANDIDATE INFORMATION */}

                <div className="vote-candidate-info">

                  <span className="candidate-position">
                    PRESIDENT
                  </span>

                  <h3>
                    {candidate.name}
                  </h3>

                  <p>
                    {candidate.party}
                  </p>

                </div>


                {/* SELECTED LABEL */}

                {isSelected && (
                  <div className="selected-label">
                    ✓ Selected
                  </div>
                )}

              </button>
            );
          })}

        </div>

      </section>


      {/* =====================================================
          BOTTOM ACTION
      ====================================================== */}

      <div className="vote-action">

        <div className="selection-status">

          <span>
            YOUR SELECTION
          </span>

          <strong>
            {selectedCandidate
              ? selectedCandidate.name
              : "No candidate selected"}
          </strong>

        </div>


        <button
          type="button"
          className="continue-vote-button"
          onClick={handleContinue}
        >

          Review Vote

          <span>
            →
          </span>

        </button>

      </div>


      {/* =====================================================
          SECURITY MESSAGE
      ====================================================== */}

      <div className="vote-security">

        <span>
          🔐
        </span>

        <p>
          Your official vote is protected and can only
          be submitted once.
        </p>

      </div>

    </div>
  );
}

export default Vote;