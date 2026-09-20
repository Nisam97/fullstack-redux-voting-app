import { Link } from "react-router-dom";
import "./Home.css";

function Home() {
  return (
    <div className="home-page">

      {/* ================= NAVBAR ================= */}
      <header className="home-navbar">
        <div className="home-container navbar-inner">

          <Link to="/" className="brand">
            <div className="brand-icon">✓</div>

            <div className="brand-text">
              <span className="brand-name">VoteSphere</span>
              <span className="brand-tagline">
                Digital Campus Elections
              </span>
            </div>
          </Link>

          <nav className="home-nav-links">
            <Link to="/" className="nav-link active">
              Home
            </Link>

            <Link to="/election" className="nav-link">
              Elections
            </Link>

            <a href="#how-it-works" className="nav-link">
              How It Works
            </a>

            <a href="#about" className="nav-link">
              About
            </a>
          </nav>

          <div className="navbar-actions">
            <Link to="/login" className="login-link">
              Login
            </Link>

            <Link to="/register" className="register-button">
              Register
            </Link>
          </div>

        </div>
      </header>


      {/* ================= HERO ================= */}
      <main>

        <section className="hero-section">
          <div className="home-container hero-grid">

            <div className="hero-content">

              <div className="hero-eyebrow">
                <span className="eyebrow-dot"></span>
                SECURE DIGITAL CAMPUS ELECTIONS
              </div>

              <h1>
                Your Voice.
                <span>Your Choice.</span>
                <strong>Your Vote.</strong>
              </h1>

              <p className="hero-description">
                VoteSphere is a secure and transparent digital voting
                platform designed to make college elections simple,
                accessible and trustworthy.
              </p>

              <div className="hero-buttons">
                <Link to="/register" className="primary-button">
                  Get Started
                  <span>→</span>
                </Link>

                <Link to="/election" className="secondary-button">
                  Explore Elections
                </Link>
              </div>

              <div className="hero-trust">

                <div className="trust-item">
                  <span className="trust-icon">✓</span>
                  <span>Verified Voters</span>
                </div>

                <div className="trust-item">
                  <span className="trust-icon">🔒</span>
                  <span>Secure Ballot</span>
                </div>

                <div className="trust-item">
                  <span className="trust-icon">◉</span>
                  <span>One Vote</span>
                </div>

              </div>

            </div>


            {/* ================= ELECTION PREVIEW ================= */}
            <div className="hero-visual">

              <div className="hero-glow"></div>

              <div className="election-preview-card">

                <div className="preview-top">

                  <div className="preview-election-icon">
                    🗳️
                  </div>

                  <div className="live-badge">
                    <span></span>
                    LIVE
                  </div>

                </div>

                <div className="preview-label">
                  CURRENT ELECTION
                </div>

                <h2>
                  Student Council
                  <br />
                  Election 2026
                </h2>

                <p className="preview-position">
                  Presidential Election
                </p>

                <div className="preview-divider"></div>

                <div className="preview-info">

                  <div>
                    <span>Position</span>
                    <strong>President</strong>
                  </div>

                  <div>
                    <span>Candidates</span>
                    <strong>3 Candidates</strong>
                  </div>

                </div>

                <div className="preview-secure">
                  <span>🔐</span>

                  <div>
                    <strong>Secure Ballot</strong>
                    <small>Your vote is protected</small>
                  </div>
                </div>

                <Link
                  to="/election"
                  className="preview-button"
                >
                  View Election
                  <span>→</span>
                </Link>

              </div>

            </div>

          </div>
        </section>


        {/* ================= TRUST STRIP ================= */}
        <section className="trust-strip">
          <div className="home-container trust-grid">

            <div className="trust-card">
              <div className="trust-card-icon">🔐</div>

              <div>
                <h3>Secure Voting</h3>
                <p>Protected digital ballot</p>
              </div>
            </div>

            <div className="trust-card">
              <div className="trust-card-icon">✓</div>

              <div>
                <h3>Verified Voters</h3>
                <p>Authority-approved students</p>
              </div>
            </div>

            <div className="trust-card">
              <div className="trust-card-icon">🗳️</div>

              <div>
                <h3>One Vote</h3>
                <p>One official vote per election</p>
              </div>
            </div>

            <div className="trust-card">
              <div className="trust-card-icon">🛡️</div>

              <div>
                <h3>Authority Controlled</h3>
                <p>Managed election process</p>
              </div>
            </div>

          </div>
        </section>


        {/* ================= HOW IT WORKS ================= */}
        <section
          className="how-section"
          id="how-it-works"
        >
          <div className="home-container">

            <div className="section-heading">

              <span>HOW IT WORKS</span>

              <h2>
                Simple. Secure.
                <br />
                <strong>Transparent.</strong>
              </h2>

              <p>
                VoteSphere makes participating in your college
                election easy with a clear and secure process.
              </p>

            </div>


            <div className="steps-container">

              <div className="step-card">

                <div className="step-number">
                  01
                </div>

                <div className="step-icon">
                  👤
                </div>

                <h3>Register</h3>

                <p>
                  Create your voter account using your
                  college details and email address.
                </p>

              </div>


              <div className="step-connector">
                →
              </div>


              <div className="step-card">

                <div className="step-number">
                  02
                </div>

                <div className="step-icon">
                  ✓
                </div>

                <h3>Get Approved</h3>

                <p>
                  Your registration is reviewed and
                  approved by the election Authority.
                </p>

              </div>


              <div className="step-connector">
                →
              </div>


              <div className="step-card">

                <div className="step-number">
                  03
                </div>

                <div className="step-icon">
                  🗳️
                </div>

                <h3>Cast Your Vote</h3>

                <p>
                  Select your candidate and securely
                  submit your official vote.
                </p>

              </div>

            </div>

          </div>
        </section>


        {/* ================= ACTIVE ELECTION ================= */}
        <section className="active-election-section">

          <div className="home-container">

            <div className="active-election-wrapper">

              <div className="active-election-content">

                <div className="active-label">
                  <span></span>
                  CURRENTLY OPEN
                </div>

                <h2>
                  Student Council
                  <br />
                  Election 2026
                </h2>

                <p>
                  Participate in the election for the
                  next Student Council President.
                </p>

                <div className="election-meta">

                  <div>
                    <span>POSITION</span>
                    <strong>President</strong>
                  </div>

                  <div>
                    <span>CANDIDATES</span>
                    <strong>3</strong>
                  </div>

                  <div>
                    <span>STATUS</span>
                    <strong className="open-status">
                      Voting Open
                    </strong>
                  </div>

                </div>

                <Link
                  to="/election"
                  className="white-button"
                >
                  View Election
                  <span>→</span>
                </Link>

              </div>


              <div className="active-election-art">

                <div className="floating-card card-one">
                  ✓
                  <span>Verified</span>
                </div>

                <div className="floating-card card-two">
                  🔒
                  <span>Secure</span>
                </div>

                <div className="vote-orbit">

                  <div className="orbit-ring"></div>

                  <div className="vote-center">
                    <span>🗳️</span>
                    <strong>VOTE</strong>
                  </div>

                </div>

              </div>

            </div>

          </div>

        </section>


        {/* ================= WHY VOTESPHERE ================= */}
        <section
          className="features-section"
          id="about"
        >

          <div className="home-container">

            <div className="section-heading centered">

              <span>WHY VOTESPHERE</span>

              <h2>
                Built for modern
                <br />
                <strong>campus elections.</strong>
              </h2>

              <p>
                Everything needed to create a secure and
                organized college election experience.
              </p>

            </div>


            <div className="features-grid">

              <div className="feature-card">
                <div className="feature-icon">🔐</div>
                <h3>Secure Voting</h3>
                <p>
                  Designed with secure authentication
                  and protected voting workflows.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">✓</div>
                <h3>Verified Students</h3>
                <p>
                  Only approved student voters can
                  participate in official elections.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">📊</div>
                <h3>Transparent</h3>
                <p>
                  Election information and official
                  results are presented clearly.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">⚡</div>
                <h3>Simple Process</h3>
                <p>
                  A clean and straightforward experience
                  from registration to voting.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">📱</div>
                <h3>Easy Access</h3>
                <p>
                  Responsive design for comfortable
                  access across different devices.
                </p>
              </div>

              <div className="feature-card">
                <div className="feature-icon">🛡️</div>
                <h3>Protected Ballot</h3>
                <p>
                  The system is designed to enforce
                  one official vote per election.
                </p>
              </div>

            </div>

          </div>

        </section>


        {/* ================= CTA ================= */}
        <section className="cta-section">

          <div className="home-container">

            <div className="cta-card">

              <div className="cta-content">

                <span>YOUR VOICE MATTERS</span>

                <h2>
                  Make your choice.
                  <br />
                  Make your voice heard.
                </h2>

                <p>
                  Register with VoteSphere and participate
                  in your college election.
                </p>

                <Link
                  to="/register"
                  className="cta-button"
                >
                  Create Your Account
                  <span>→</span>
                </Link>

              </div>


              <div className="cta-decoration">
                <div className="cta-circle circle-one"></div>
                <div className="cta-circle circle-two"></div>
                <div className="cta-ballot">
                  🗳️
                </div>
              </div>

            </div>

          </div>

        </section>

      </main>


      {/* ================= FOOTER ================= */}
      <footer className="home-footer">

        <div className="home-container">

          <div className="footer-main">

            <div className="footer-brand">

              <Link
                to="/"
                className="brand footer-brand-link"
              >

                <div className="brand-icon">
                  ✓
                </div>

                <div className="brand-text">

                  <span className="brand-name">
                    VoteSphere
                  </span>

                  <span className="brand-tagline">
                    Digital Campus Elections
                  </span>

                </div>

              </Link>

              <p>
                A secure digital platform designed
                for transparent and accessible
                college elections.
              </p>

              <div className="footer-security">
                <span>🔒</span>
                Secure
                <span>•</span>
                Transparent
                <span>•</span>
                Student-Focused
              </div>

            </div>


            <div className="footer-column">

              <h3>Platform</h3>

              <Link to="/">Home</Link>
              <Link to="/election">Elections</Link>

              <a href="#how-it-works">
                How It Works
              </a>

              <Link to="/results">
                Results
              </Link>

            </div>


            <div className="footer-column">

              <h3>Account</h3>

              <Link to="/login">
                Login
              </Link>

              <Link to="/register">
                Register
              </Link>

            </div>


            <div className="footer-column">

              <h3>Security</h3>

              <div className="footer-feature">
                <span>✓</span>
                Verified Voters
              </div>

              <div className="footer-feature">
                <span>🔒</span>
                Secure Ballot
              </div>

              <div className="footer-feature">
                <span>🛡️</span>
                Protected Access
              </div>

              <div className="footer-feature">
                <span>◉</span>
                One Vote Per Election
              </div>

            </div>

          </div>


          <div className="footer-bottom">

            <p>
              © 2026 VoteSphere. All rights reserved.
            </p>

            <div className="footer-bottom-links">
              <a href="#privacy">
                Privacy Policy
              </a>

              <a href="#terms">
                Terms of Use
              </a>

              <a href="#contact">
                Contact Authority
              </a>
            </div>

          </div>

        </div>

      </footer>

    </div>
  );
}

export default Home;