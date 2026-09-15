import mongoose from 'mongoose';

const DEFAULT_URI = 'mongodb://localhost:27017/votesphere_dev';

/**
 * Connect to MongoDB database.
 * @param {string} [uri] - MongoDB connection string
 * @returns {Promise<typeof mongoose>}
 */
export async function connectMongo(uri = process.env.MONGODB_URI || DEFAULT_URI) {
  try {
    const conn = await mongoose.connect(uri);
    const host = conn.connection.host || 'localhost';
    const name = conn.connection.name || 'unknown';
    console.log(`[MongoDB] Connected: ${host}/${name}`);
    return conn;
  } catch (err) {
    console.error(`[MongoDB] Connection error: ${err.message}`);
    throw err;
  }
}

/**
 * Disconnect from MongoDB database.
 * @returns {Promise<void>}
 */
export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('[MongoDB] Disconnected');
  }
}

/**
 * Check whether MongoDB connection is currently active.
 * @returns {boolean}
 */
export function isConnected() {
  return mongoose.connection.readyState === 1;
}
