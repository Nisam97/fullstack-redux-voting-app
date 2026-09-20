import { useNavigate } from "react-router-dom";
import "./About.css";

function About() {
  const navigate = useNavigate();

  return (
    <div className="about-page">

      <section className="about-hero">
        <span className="about-label">ABOUT VOTESPHERE</span>

        <h1>
          A secure digital platform
          <br />
          for college elections.
        </h1>

        <p>
          VoteSphere is designed to provide a controlled,
          transparent and secure environment for conducting
          institutional elections.
        </p>
      </section>

      <section className="about-grid">

        <div className="about-card">
          <div className="about-icon">🔐</div>
          <h2>Secure Voting</h2>
          <p>
            Registered and approved voters can participate
            in official elections through a controlled voting
            process.
          </p>
        </div>

        <div className="about-card">
          <div className="about-icon">✓</div>
          <h2>Verified Voters</h2>
          <p>
            Student registration and Authority approval help
            ensure that only eligible members participate.
          </p>
        </div>

        <div className="about-card">
          <div className="about-icon">◉</div>
          <h2>Final Vote</h2>
          <p>
            Once an official vote is confirmed, it is permanently
            finalized for that election.
          </p>
        </div>

      </section>

      <section className="about-bottom">
        <h2>Ready to participate?</h2>

        <p>
          Login to your registered account to access the
          available election.
        </p>

        <button onClick={() => navigate("/login")}>
          Login to Vote →
        </button>
      </section>

    </div>
  );
}

export default About;