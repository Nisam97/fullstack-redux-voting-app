import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { Vote, Trophy, Clock, AlertCircle, Users } from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import { selectSessionList } from '../redux/voteSlice';

/**
 * Status badge color mapping for session lifecycle states.
 */
function getStatusStyle(status) {
  switch (status) {
    case 'open': return { color: '#22c55e', label: 'Live' };
    case 'pending': return { color: '#f59e0b', label: 'Pending' };
    case 'completed': return { color: '#6366f1', label: 'Completed' };
    case 'archived': return { color: '#94a3b8', label: 'Archived' };
    default: return { color: '#94a3b8', label: status || 'Unknown' };
  }
}

/**
 * SessionList Page
 * Displays the list of available sessions from the Redux registry.
 * Each session links to its voting page at /sessions/:id/vote.
 */
function SessionList() {
  const sessions = useSelector(selectSessionList);

  return (
    <div className="voting-page">
      <Navbar />

      <main className="voting-main">
        <div className="voting-container">
          <section style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1rem' }}>
            <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <span style={{
                display: 'inline-block',
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                background: 'rgba(99,102,241,0.15)',
                color: '#818cf8',
                marginBottom: '0.75rem'
              }}>Sessions Registry</span>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.5rem 0' }}>
                Available Sessions
              </h1>
              <p style={{ color: '#94a3b8', fontSize: '0.95rem' }}>
                Select a session to cast your vote or view results.
              </p>
            </header>

            {sessions.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '3rem 1rem',
                background: 'rgba(30,41,59,0.5)',
                borderRadius: '1rem',
                border: '1px solid rgba(148,163,184,0.1)'
              }}>
                <AlertCircle size={44} style={{ color: '#94a3b8', marginBottom: '1rem' }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  No Sessions Available
                </h2>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                  Waiting for sessions to be registered by the server.
                </p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {sessions.map((session) => {
                const statusInfo = getStatusStyle(session.status);
                return (
                  <article
                    key={session.id}
                    style={{
                      background: 'rgba(30,41,59,0.5)',
                      borderRadius: '1rem',
                      border: '1px solid rgba(148,163,184,0.1)',
                      padding: '1.25rem 1.5rem',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
                        {session.title || session.id}
                      </h2>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '9999px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        background: `${statusInfo.color}22`,
                        color: statusInfo.color,
                        flexShrink: 0
                      }}>
                        <span style={{
                          width: 6, height: 6,
                          borderRadius: '50%',
                          background: statusInfo.color
                        }} />
                        {statusInfo.label}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: '#94a3b8', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Clock size={14} /> ID: {session.id}
                      </span>
                      {typeof session.voterCount === 'number' && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#38bdf8' }}>
                          <Users size={14} /> {session.voterCount} {session.voterCount === 1 ? 'voter' : 'voters'}
                        </span>
                      )}
                      {session.winner && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#f59e0b' }}>
                          <Trophy size={14} /> Winner: {session.winner}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <Link
                        to={`/sessions/${session.id}/lobby`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.5rem 1rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          background: 'rgba(56,189,248,0.12)',
                          color: '#38bdf8',
                          textDecoration: 'none',
                          border: '1px solid rgba(56,189,248,0.25)',
                          transition: 'background 0.2s'
                        }}
                      >
                        <Users size={16} /> Lobby
                      </Link>
                      <Link
                        to={`/sessions/${session.id}/vote`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.5rem 1rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          background: 'rgba(99,102,241,0.15)',
                          color: '#818cf8',
                          textDecoration: 'none',
                          border: '1px solid rgba(99,102,241,0.2)',
                          transition: 'background 0.2s'
                        }}
                      >
                        <Vote size={16} /> Vote
                      </Link>
                      <Link
                        to={`/sessions/${session.id}/results`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.5rem 1rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          background: 'rgba(34,197,94,0.1)',
                          color: '#4ade80',
                          textDecoration: 'none',
                          border: '1px solid rgba(34,197,94,0.15)',
                          transition: 'background 0.2s'
                        }}
                      >
                        <Trophy size={16} /> Results
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default SessionList;
