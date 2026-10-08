import './src/env-loader.cjs'; // first import: reads repo-root .env into process.env
import makeStore from './src/store';
import startServer, { getUniqueJoinCode } from './src/server';
import { bootstrapDefaultSession, bootstrapHorrorSession,
  DEFAULT_SESSION_ID, HORROR_SESSION_ID } from './src/bootstrap';
import { connectMongo, disconnectMongo } from './src/db/connection';
import { recoverSessionsFromDb, persistSeedSessions } from './src/db/persistence';
import { backfillResultTypes, countResultsWithoutType } from './src/db/repository.js';
import { validateVoterJwtSecret } from './src/auth/voterCookie.js';

// Accept any numeric PORT from the environment; fall back to the standard
// 8090 when it is unset, invalid, or an ephemeral "0" some hosts inject.
const portEnv = Number(process.env.PORT);
const PORT = Number.isFinite(portEnv) && portEnv > 0 ? portEnv : 8090;
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
    // Validate voter secret configuration
    validateVoterJwtSecret();

    // 1. Connect to MongoDB — fail startup if unavailable
    await connectMongo(MONGODB_URI);

    // 2. Create Redux store
    const store = makeStore();

    // 3. Recover persisted sessions from MongoDB
    const recovered = await recoverSessionsFromDb(store);
    console.log(`[Startup] Recovered ${recovered} session(s) from MongoDB`);

    // 3b. Backfill Result.type from Session.type for rows created before the
    // visibility matrix existed (spec 0008 AC-9). Idempotent, additive.
    try {
      const backfill = await backfillResultTypes();
      if (backfill.scanned > 0) {
        console.log(`[Startup] Backfilled type on ${backfill.backfilled} result(s)`);
      }
    } catch (backfillErr) {
      // Loud, with the number of rows still untyped (spec 0008 AC-9, review
      // finding on the silent catch). An untyped Result is now gated as secured
      // rather than public, so this is a visibility outage for those rows, not
      // a leak, and the operator needs the count to repair it.
      let stillUntyped = 'unknown';
      try {
        stillUntyped = await countResultsWithoutType();
      } catch {
        // Counting is best effort; the original failure is what matters.
      }
      console.error(
        `[Startup] Result type backfill FAILED: ${backfillErr.message}. ` +
        `${stillUntyped} result(s) still carry no type and will be gated as secured ` +
        'until the backfill succeeds. Re-run the server once MongoDB is reachable.'
      );
    }

    // 4. Bootstrap seed sessions (skip if already recovered from DB).
    // Join codes are resolved against the DB (pending and open sessions only)
    // so a seed can never collide with a recovered active session's code.
    bootstrapDefaultSession(store, { joinCode: await getUniqueJoinCode() });
    bootstrapHorrorSession(store, { joinCode: await getUniqueJoinCode() });

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

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled promise rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});

main();