/* Socket.io smoke test against the running demo server. */
const path = require('path');
const { io } = require(path.join(__dirname, '..', 'voting-server', 'node_modules', 'socket.io-client'));

const URL = process.env.SMOKE_URL || 'http://localhost:8090';
const socket = io(URL, { transports: ['websocket', 'polling'], timeout: 8000 });

const timers = setTimeout(() => { console.error('SMOKE FAIL: timeout'); process.exit(1); }, 12000);

socket.on('connect', () => {
  console.log('connected:', socket.id, '| transport:', socket.io.engine.transport.name);
  socket.emit('sessions');
  socket.emit('subscribe_session', { sessionId: 'sess_default' });
});

socket.on('sessions', (list) => {
  console.log('registry:', JSON.stringify(list));
});

socket.on('session_state', (state) => {
  console.log('session_state for', state && (state.id || state.sessionId), '| status:', state && state.status,
    '| entries:', Array.isArray(state && state.entries) ? state.entries.length : '?',
    '| pair:', state && state.vote && JSON.stringify(state.vote.pair));
  clearTimeout(timers);
  console.log('SMOKE PASS');
  socket.disconnect();
  process.exit(0);
});

socket.on('connect_error', (err) => {
  console.error('connect_error:', err.message);
  clearTimeout(timers);
  process.exit(1);
});
