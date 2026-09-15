import makeStore from './src/store';
import startServer from './src/server';
import { bootstrapDefaultSession, bootstrapHorrorSession,
  DEFAULT_SESSION_ID, HORROR_SESSION_ID } from './src/bootstrap';
import { connectMongo, disconnectMongo } from './src/db/connection';
import { recoverSessionsFromDb, persistSeedSessions } from './src/db/persistence';

const PORT = process.env.PORT || 8090;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/votesphere_dev';

/**
 * Startup sequence:
 *
 * 1. Connect to MongoDB
 * 2. Create Redux store
 * 3. Recover persisted sessions into the store
 * 4. Bootstrap seed sessions (only if they don't already exist)
 * 5. Persist seed sessions to MongoDB (idempotent)
 * 6. Start the HTTP + Socket.io server
 */
async function main() {
  try {
    // 1. Connect to MongoDB — fail startup if unavailable
    await connectMongo(MONGODB_URI);

    // 2. Create Redux store
    const store = makeStore();

    // 3. Recover persisted sessions from MongoDB
    const recovered = await recoverSessionsFromDb(store);
    console.log(`[Startup] Recovered ${recovered} session(s) from MongoDB`);

    // 4. Bootstrap seed sessions (skip if already recovered from DB)
    bootstrapDefaultSession(store);
    bootstrapHorrorSession(store);

    // 5. Persist seed sessions to MongoDB (idempotent — skips if already in DB)
    await persistSeedSessions(store, [DEFAULT_SESSION_ID, HORROR_SESSION_ID]);

    // 6. Start server
    const io = startServer(store, PORT);
    console.log(`[Startup] Server listening on port ${PORT}`);

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);
      io.close();
      await disconnectMongo();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('[Startup] Fatal error:', err.message);
    process.exit(1);
  }
}

main();