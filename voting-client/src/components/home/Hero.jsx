import { Link } from "react-router-dom";
import "./Hero.css";

function Hero() {
  return (
    <section className="hero-section">
      <div className="hero-container">

        <div className="hero-content">

          <div className="hero-badge">
            🔒 Secure • ⚡ Real-Time • ✓ Transparent
          </div>

          <h1>
            Your Voice.
            <br />
            <span>Your Choice.</span>
          </h1>

          <p>
            VoteSphere is a modern digital voting platform designed
            for colleges, organizations, competitions and events.
          </p>

          <div className="hero-buttons">

            <Link to="/vote" className="hero-primary-btn">
              Start Voting →
            </Link>

            <Link to="/results" className="hero-secondary-btn">
              View Results
            </Link>

          </div>

        </div>

        <div className="hero-visual">

          <div className="hero-card">

            <div className="hero-card-header">
              <div>
                <span className="dashboard-label">
                  LIVE ELECTION
                </span>

                <h3>Student Council 2026</h3>
              </div>

              <div className="live-status">
                <span></span>
                LIVE
              </div>
            </div>

            <div className="candidate">
              <div className="candidate-info">
                <div className="avatar">A</div>

                <div>
                  <strong>Alex Mathew</strong>
                  <small>President</small>
                </div>
              </div>

              <strong>68%</strong>
            </div>

            <div className="progress-track">
              <div
                className="progress-value"
                style={{ width: "68%" }}
              ></div>
            </div>

            <div className="candidate">
              <div className="candidate-info">
                <div className="avatar second">R</div>

                <div>
                  <strong>Riya Thomas</strong>
                  <small>President</small>
                </div>
              </div>

              <strong>32%</strong>
            </div>

            <div className="progress-track">
              <div
                className="progress-value second-progress"
                style={{ width: "32%" }}
              ></div>
            </div>

            <div className="hero-card-footer">

              <div>
                <small>Total Votes</small>
                <strong>2,847</strong>
              </div>

              <div>
                <small>Participation</small>
                <strong>87.4%</strong>
              </div>

            </div>

          </div>

        </div>

      </div>
    </section>
  );
}

export default Hero;