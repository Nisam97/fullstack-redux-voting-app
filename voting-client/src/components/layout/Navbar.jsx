import { Link } from "react-router-dom";
import "./Navbar.css";

function Navbar() {
  return (
    <header className="navbar">
      <div className="logo">
        🗳 <span>VoteSphere</span>
      </div>

      <nav className="nav-links">
        <Link to="/">Home</Link>
        <Link to="/vote">Vote</Link>
        <Link to="/results">Results</Link>
      </nav>

      <Link to="/login">
        <button className="login-btn">
          Login
        </button>
      </Link>
    </header>
  );
}

export default Navbar;