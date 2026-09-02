import { Link } from "react-router-dom";
import "./Register.css";

function Register() {
  return (
    <div className="register-page">
      <div className="register-card">

        <div className="register-header">
          <h1>Create Your Account</h1>
          <p>Join VoteSphere and start voting securely.</p>
        </div>

        <form>

          <div className="input-group">
            <label>Full Name</label>
            <input
              type="text"
              placeholder="Enter your full name"
            />
          </div>

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
              placeholder="Create password"
            />
          </div>

          <div className="input-group">
            <label>Confirm Password</label>
            <input
              type="password"
              placeholder="Confirm password"
            />
          </div>

          <div className="input-group">
            <label>Register As</label>

            <select>
              <option>Student</option>
              <option>Faculty</option>
              <option>Admin</option>
            </select>

          </div>

          <div className="input-group">
            <label>Profile Picture</label>

            <input type="file" />
          </div>

          <button className="register-btn">
            Create Account
          </button>

        </form>

        <p className="login-text">
          Already have an account?

          <Link to="/login">
            Login
          </Link>

        </p>

      </div>
    </div>
  );
}

export default Register;