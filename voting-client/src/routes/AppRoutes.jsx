import Login from "../pages/Login";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Home from "../pages/Home";
import Voting from "../pages/Voting";
import Results from "../pages/Results";
import SessionList from "../pages/SessionList";
import History from "../pages/History";
import NotFound from "../pages/NotFound";
import Register from "../pages/Register";
import Admin from "../pages/Admin";
import Lobby from "../pages/Lobby";
import AdminGuard from "./AdminGuard";
import {
  LegacyVoteRedirect,
  LegacyResultsRedirect,
  LegacyElectionRedirect,
  LegacyElectionVoteRedirect,
  LegacyElectionResultsRedirect
} from "./LegacyRedirects";

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Canonical Admin route with authentication protection */}
        <Route
          path="/admin"
          element={
            <AdminGuard>
              <Admin />
            </AdminGuard>
          }
        />

        {/* Dashboard compatibility: redirects to /admin */}
        <Route path="/dashboard" element={<Navigate to="/admin" replace />} />

        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Home />} />
        <Route path="/history" element={<History />} />

        {/* Multi-session routes */}
        <Route path="/sessions" element={<SessionList />} />
        <Route path="/sessions/:id/lobby" element={<Lobby />} />
        <Route path="/sessions/:id/vote" element={<Voting />} />
        <Route path="/sessions/:id/results" element={<Results />} />

        {/* Backward compatibility redirects from /elections */}
        <Route path="/elections" element={<LegacyElectionRedirect />} />
        <Route path="/elections/:id/vote" element={<LegacyElectionVoteRedirect />} />
        <Route path="/elections/:id/results" element={<LegacyElectionResultsRedirect />} />

        {/* Legacy route compatibility → redirect to first valid session */}
        <Route path="/vote" element={<LegacyVoteRedirect />} />
        <Route path="/results" element={<LegacyResultsRedirect />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRoutes;