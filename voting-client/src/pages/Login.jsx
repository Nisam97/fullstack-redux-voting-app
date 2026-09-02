import { Link } from "react-router-dom";
import "./Login.css";

function Login() {
  return (
    <div className="login-page">

      <div className="login-card">

        <div className="login-header">
          <h1>🗳 VoteSphere</h1>
          <p>Welcome back! Login to continue.</p>
        </div>

        <form>

          <div className="input-group">
            <label>Email Address</label>
            <input
              type="email"
              placeholder="Enter your email"
            />
          </div>

          <div className="input-group">
            <label>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
            />
          </div>

          <div className="login-options">

            <label>
              <input type="checkbox" />
              Remember Me
            </label>
            <Link to="/login">
             Forgot Password?
             </Link>

            

          </div>

          <Link to="/dashboard">
          <button type="button" className="login-btn">
            Login
          </button>
          </Link>

        </form>

        <p className="signup-text">
          Don't have an account?
          <Link to="/register"> Register</Link>
        </p>

      </div>

    </div>
  );
}

export default Login;