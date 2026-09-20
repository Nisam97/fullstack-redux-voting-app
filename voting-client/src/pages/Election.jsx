import { useNavigate } from "react-router-dom";
import "./Election.css";

const candidates = [
  {
    id: 1,
    name: "Alex Mathew",
    position: "President",
    party: "Progress Team",
    symbol: "⭐",
    manifesto:
      "Focus on student development, transparent leadership, academic support and better campus activities.",
  },
  {
    id: 2,
    name: "Riya Thomas",
    position: "President",
    party: "Unity Team",
    symbol: "🌟",
    manifesto:
      "Build a connected student community with improved communication, events and student welfare initiatives.",
  },
  {
    id: 3,
    name: "Rahul Menon",
    position: "President",
    party: "Future Team",
    symbol: "🚀",
    manifesto:
      "Introduce innovative campus programs, technology-driven services and opportunities for students.",
  },
];

function Election() {
  const navigate = useNavigate();

  return (
    <div className="election-page">

      {/* Header */}
      <header className="election-header">
        <div>
          <span className="election-label">ACTIVE ELECTION</span>
          <h1>Student Council Election 2026</h1>
          <p>
            Presidential Election • Official Voting Portal
          </p>
        </div>

        <div className="election-status">
          <span className="status-dot"></span>
          Voting Open
        </div>
      </header>

      {/* Election information */}
      <section className="election-info-grid">

        <div className="info-box">
          <span>Election Status</span>
          <strong>Open</strong>
        </div>

        <div className="info-box">
          <span>Eligible Voters</span>
          <strong>1,500</strong>
        </div>

        <div className="info-box">
          <span>Position</span>
          <strong>President</strong>
        </div>

        <div className="info-box">
          <span>Candidates</span>
          <strong>{candidates.length}</strong>
        </div>

      </section>

      {/* Notice */}
      <section className="voting-notice">
        <div className="notice-icon">🔒</div>

        <div>
          <h3>Official Election Information</h3>
          <p>
            Official vote counts are hidden while voting is active.
            Cast your vote first. After voting, you can participate
            in the separate prediction poll.
          </p>
        </div>
      </section>

      {/* Candidate section */}
      <section className="candidate-section">

        <div className="section-heading">
          <div>
            <span>CANDIDATES</span>
            <h2>Meet the Candidates</h2>
          </div>

          <p>
            Review each candidate before making your official choice.
          </p>
        </div>

        <div className="candidate-grid">

          {candidates.map((candidate) => (
            <article className="candidate-card" key={candidate.id}>

              <div className="candidate-top">

                <div className="candidate-symbol">
                  {candidate.symbol}
                </div>

                <div>
                  <span className="candidate-position">
                    {candidate.position}
                  </span>

                  <h3>{candidate.name}</h3>

                  <p className="candidate-party">
                    {candidate.party}
                  </p>
                </div>

              </div>

              <div className="manifesto">

                <span>MANIFESTO</span>

                <p>{candidate.manifesto}</p>

              </div>

              <div className="candidate-footer">

                <span>
                  ✓ Verified Candidate
                </span>

              </div>

            </article>
          ))}

        </div>

      </section>

      {/* Voting action */}
      <section className="start-voting-section">

        <div>
          <span>READY TO VOTE?</span>

          <h2>
            Make your official choice
          </h2>

          <p>
            You can select only one candidate in this election.
            Your vote cannot be changed after confirmation.
          </p>
        </div>

        <button
          className="start-voting-button"
          onClick={() => navigate("/vote")}
        >
          Cast Your Vote
          <span>→</span>
        </button>

      </section>

    </div>
  );
}

export default Election;