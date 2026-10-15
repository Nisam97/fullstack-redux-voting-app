import { Link } from "react-router-dom";
import { Vote } from "lucide-react";
import "./Footer.css";

function Footer() {
  return (
    <footer className="footer">

      <div className="container footer-grid">

        <div className="footer-brand">

          <h2>
            <Vote size={20} aria-hidden="true" /> VoteSphere
          </h2>

          <p>
            Passwordless, server-authoritative voting for colleges,
            organizations and events.
          </p>

        </div>

        <div>

          <h3>Quick Links</h3>

          <ul>
            <li><Link to="/">Home</Link></li>
            <li><Link to="/join">Join a Session</Link></li>
            <li><Link to="/history">Results History</Link></li>
            <li><Link to="/login">Sign In</Link></li>
          </ul>

        </div>

      </div>

      <div className="copyright">
        © 2026 VoteSphere. All Rights Reserved.
      </div>

    </footer>
  );
}

export default Footer;