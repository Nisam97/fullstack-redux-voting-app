import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongoServer;

/**
 * Start in-memory MongoDB server and connect Mongoose.
 * @returns {Promise<string>} MongoDB URI
 */
export async function setupTestDb() {
  if (!mongoServer) {
    mongoServer = await MongoMemoryServer.create();
  }
  const uri = mongoServer.getUri();
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri);
  }
  return uri;
}

/**
 * Disconnect Mongoose and stop in-memory MongoDB server.
 * @returns {Promise<void>}
 */
export async function teardownTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}

/**
 * Clear all collections in the test database between tests.
 * @returns {Promise<void>}
 */
export async function clearTestDb() {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
}
