import Login from "../pages/Login";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "../pages/Home";
import Voting from "../pages/Voting";
import Results from "../pages/Results";
import NotFound from "../pages/NotFound";
import Register from "../pages/Register";
import Dashboard from "../pages/Dashboard";
function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Home />} />
        <Route path="/vote" element={<Voting />} />
        <Route path="/results" element={<Results />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRoutes;