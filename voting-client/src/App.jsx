import {
  BrowserRouter,
  Routes,
  Route
} from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";

import Home from "./pages/Home";
import About from "./pages/About";
import Login from "./pages/admin/login.jsx";
import Register from "./pages/Register";
import VerifyEmail from "./pages/public/VerifyEmail";
import Profile from "./pages/Profile";
import Election from "./pages/Election";
import Vote from "./pages/Vote";
import Confirmation from "./pages/Confirmation";
import Prediction from "./pages/Prediction";
import Results from "./pages/Results";

import AuthorityDashboard from "./pages/authority/Dashboard";
import AuthorityUsers from "./pages/authority/Users";

function App() {
  return (
    <BrowserRouter>
  <AuthProvider>
    <Routes>

      <Route path="/" element={<Home />} />

      <Route path="/about" element={<About />} />

      <Route path="/login" element={<Login />} />

      <Route path="/register" element={<Register />} />

      <Route path="/verify-email" element={<VerifyEmail />} />

      <Route path="/profile" element={<Profile />} />

      <Route path="/election" element={<Election />} />

      <Route path="/vote" element={<Vote />} />

      <Route path="/confirmation" element={<Confirmation />} />

      <Route path="/prediction" element={<Prediction />} />

      <Route path="/results" element={<Results />} />

      <Route
        path="/authority"
        element={<AuthorityDashboard />}
      />

      <Route
        path="/authority/users"
        element={<AuthorityUsers />}
      />

    </Routes>
  </AuthProvider>
</BrowserRouter>
  );
}

export default App;