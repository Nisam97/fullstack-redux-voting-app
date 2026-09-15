import { expect } from 'chai';
import { connectMongo, disconnectMongo, isConnected } from '../src/db/connection.js';
import { setupTestDb, teardownTestDb } from './db_test_helper.js';

describe('MongoDB Connection Module', () => {
  let uri;

  before(async function () {
    this.timeout(120000);
    uri = await setupTestDb();
    // disconnect the helper's connection so we can test connectMongo / disconnectMongo
    await disconnectMongo();
  });

  after(async function () {
    this.timeout(30000);
    await disconnectMongo();
    await teardownTestDb();
  });

  it('reports isConnected() as false when disconnected', () => {
    expect(isConnected()).to.be.false;
  });

  it('connects successfully to a valid MongoDB URI', async function () {
    this.timeout(10000);
    const conn = await connectMongo(uri);
    expect(conn).to.exist;
    expect(isConnected()).to.be.true;
  });

  it('disconnects successfully', async function () {
    this.timeout(10000);
    await disconnectMongo();
    expect(isConnected()).to.be.false;
  });

  it('throws when connecting to an invalid MongoDB URI', async function () {
    this.timeout(10000);
    let err = null;
    try {
      await connectMongo('mongodb://localhost:99999/invalid?serverSelectionTimeoutMS=500');
    } catch (e) {
      err = e;
    }
    expect(err).to.exist;
  });
});
