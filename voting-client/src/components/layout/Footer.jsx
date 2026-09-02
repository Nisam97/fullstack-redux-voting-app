import "./Footer.css";

function Footer() {
  return (
    <footer className="footer">

      <div className="container footer-grid">

        <div>

          <h2>🗳 VoteSphere</h2>

          <p>
            Secure • Transparent • Real-Time Voting Platform
          </p>

        </div>

        <div>

          <h3>Quick Links</h3>

          <ul>
            <li>Home</li>
            <li>Vote</li>
            <li>Results</li>
            <li>About</li>
          </ul>

        </div>

        <div>

          <h3>Contact</h3>

          <p>support@votesphere.com</p>

          <p>+91 98765 43210</p>

        </div>

      </div>

      <div className="copyright">
        © 2026 VoteSphere. All Rights Reserved.
      </div>

    </footer>
  );
}

export default Footer;