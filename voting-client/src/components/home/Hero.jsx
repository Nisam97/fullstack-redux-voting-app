import { Link } from "react-router-dom";
import { Lock, Zap, Check } from "lucide-react";
import "./Hero.css";

function Hero() {
  return (
    <section className="hero-section">
      <div className="hero-container">

        <div className="hero-content">

          <p className="hero-badge">
            <span><Lock size={14} aria-hidden="true" /> Passwordless</span>
            <span><Zap size={14} aria-hidden="true" /> Real-Time</span>
            <span><Check size={14} aria-hidden="true" /> Server-Authoritative</span>
          </p>

          <h1>
            Your Voice.
            <br />
            <span>Your Choice.</span>
          </h1>

          <p>
            VoteSphere is a digital voting platform for colleges,
            organizations, competitions and events.
          </p>

          <div className="hero-buttons">

            <Link to="/join" className="hero-primary-btn">
              Join Session
            </Link>

            <Link to="/history" className="hero-secondary-btn">
              Browse Results
            </Link>

          </div>

        </div>

        <div className="hero-visual">

          {/* Illustrative preview of the results view, not live data: the
              figures describe the interface and carry a visible "Preview"
              label instead of posing as a real tally. */}
          <div className="hero-card" aria-label="Preview of a results screen">

            <div className="hero-card-header">
              <div>
                <span className="dashboard-label">
                  RESULTS PREVIEW
                </span>

                <h3>Knockout Round</h3>
              </div>

              <span className="hero-preview-tag">Preview</span>
            </div>

            <div className="candidate">
              <div className="candidate-info">
                <div className="avatar">A</div>

                <div>
                  <strong>Candidate A</strong>
                  <small>Example</small>
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
                <div className="avatar second">B</div>

                <div>
                  <strong>Candidate B</strong>
                  <small>Example</small>
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
                <small>Pairwise matchups</small>
                <strong>Round by round</strong>
              </div>

              <div>
                <small>Tallies computed</small>
                <strong>On the server</strong>
              </div>

            </div>

          </div>

        </div>

      </div>
    </section>
  );
}

export default Hero;