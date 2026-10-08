/* Persistent voter presence for the E2E run: joins sess_default with a fresh
 * voter token and stays subscribed so the round does not self-close. */
const path = require('path');
const { io } = require(path.join(__dirname, '..', 'voting-server', 'node_modules', 'socket.io-client'));

const URL = process.env.SMOKE_URL || 'http://localhost:8090';
const TOKEN = process.argv[2];
const VOTE_CHOICE = process.argv[3] || null; // entry name to vote for when a pair appears

if (!TOKEN) { console.error('usage: node smoke-voter.cjs <voterToken> [voteChoice]'); process.exit(1); }

const socket = io(URL, { transports: ['websocket', 'polling'] });
let voted = false;

socket.on('connect', () => {
  console.log('[voter] connected', socket.id);
  socket.emit('subscribe_session', { sessionId: 'sess_default', voterToken: TOKEN });
  setInterval(() => socket.emit('subscribe_session', { sessionId: 'sess_default', voterToken: TOKEN }), 15000);
});

socket.on('session_state', (s) => {
  if (!s || (s.sessionId !== 'sess_default' && s.id !== 'sess_default')) return;
  console.log('[voter] status:', s.status,
    '| roundIndex:', s.vote && s.vote.roundIndex,
    '| pair:', s.vote && (s.vote.pair || s.vote.candidates) ? (s.vote.pair || s.vote.candidates).join(' vs ') : '-',
    '| tally:', s.vote && JSON.stringify(s.vote.tally));
  const pair = (s.vote && (s.vote.pair || s.vote.candidates)) || [];
  if (VOTE_CHOICE && !voted && s.status === 'open' && pair.includes(VOTE_CHOICE)) {
    voted = true;
    console.log('[voter] casting vote for', VOTE_CHOICE);
    socket.emit('action', { type: 'VOTE', sessionId: 'sess_default', entry: VOTE_CHOICE, voterToken: TOKEN });
  }
});

socket.on('action_error', (e) => console.log('[voter] action_error:', JSON.stringify(e)));
socket.on('disconnect', () => console.log('[voter] disconnected'));

process.on('SIGINT', () => { socket.disconnect(); process.exit(0); });
