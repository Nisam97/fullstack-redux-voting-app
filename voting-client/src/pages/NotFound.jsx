import { Link } from "react-router-dom";
import Navbar from "../components/layout/Navbar";
import "./NotFound.css";

function NotFound() {
  return (
    <>
      <Navbar />

      <main className="notfound-main">
        <p className="notfound-code">404</p>
        <h1>Page not found</h1>
        <p className="notfound-hint">
          The address may be mistyped, or the page may have moved.
        </p>
        <div className="notfound-actions">
          <Link to="/" className="btn-primary">Go Home</Link>
          <Link to="/join" className="btn-secondary">Join a Session</Link>
        </div>
      </main>
    </>
  );
}

export default NotFound;