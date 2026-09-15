import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { selectSessionList } from '../redux/voteSlice';

/**
 * LegacyVoteRedirect
 * Handles /vote → /sessions/<first-valid-id>/vote redirect.
 * Falls back to /sessions if no session is available.
 */
export function LegacyVoteRedirect() {
  const navigate = useNavigate();
  const sessions = useSelector(selectSessionList);

  useEffect(() => {
    if (sessions.length > 0) {
      navigate(`/sessions/${sessions[0].id}/vote`, { replace: true });
    } else {
      navigate('/sessions', { replace: true });
    }
  }, [sessions, navigate]);

  return null;
}

/**
 * LegacyResultsRedirect
 * Handles /results → /sessions/<first-valid-id>/results redirect.
 * Falls back to /sessions if no session is available.
 */
export function LegacyResultsRedirect() {
  const navigate = useNavigate();
  const sessions = useSelector(selectSessionList);

  useEffect(() => {
    if (sessions.length > 0) {
      navigate(`/sessions/${sessions[0].id}/results`, { replace: true });
    } else {
      navigate('/sessions', { replace: true });
    }
  }, [sessions, navigate]);

  return null;
}

/**
 * LegacyElectionRedirect
 * Redirects /elections → /sessions
 */
export function LegacyElectionRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/sessions', { replace: true });
  }, [navigate]);

  return null;
}

/**
 * LegacyElectionVoteRedirect
 * Redirects /elections/:id/vote → /sessions/:id/vote
 */
export function LegacyElectionVoteRedirect() {
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(`/sessions/${id}/vote`, { replace: true });
  }, [id, navigate]);

  return null;
}

/**
 * LegacyElectionResultsRedirect
 * Redirects /elections/:id/results → /sessions/:id/results
 */
export function LegacyElectionResultsRedirect() {
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(`/sessions/${id}/results`, { replace: true });
  }, [id, navigate]);

  return null;
}
