import { expect } from 'chai';
import path from 'path';
import fs from 'fs';
import { io as Client } from 'socket.io-client';
import makeStore from '../src/store';
import startServer from '../src/server';
import {
  bootstrapDefaultSession,
  bootstrapHorrorSession,
  loadEntries,
  DEFAULT_SESSION_ID,
  DEFAULT_SESSION_TITLE,
  HORROR_SESSION_ID,
  HORROR_SESSION_TITLE
} from '../src/bootstrap';

describe('bootstrap and seed session', () => {
  const entriesJsonPath = path.resolve(__dirname, '../entries.json');
  const expectedFileEntries = JSON.parse(fs.readFileSync(entriesJsonPath, 'utf8'));

  describe('unit: entries loader and store bootstrap', () => {
    it('1. default session exists after bootstrap in registry', () => {
      const store = makeStore();
      const bootstrapped = bootstrapDefaultSession(store);

      expect(bootstrapped).to.be.ok;
      expect(bootstrapped.id).to.equal(DEFAULT_SESSION_ID);

      const state = store.getState();
      expect(state.hasIn(['sessions', DEFAULT_SESSION_ID])).to.be.true;
    });

    it('2. default title matches "Danny Boyle Film Tournament"', () => {
      const store = makeStore();
      const bootstrapped = bootstrapDefaultSession(store);

      expect(bootstrapped.title).to.equal('Danny Boyle Film Tournament');
      expect(bootstrapped.title).to.equal(DEFAULT_SESSION_TITLE);
      expect(store.getState().getIn(['sessions', DEFAULT_SESSION_ID, 'title'])).to.equal(
        'Danny Boyle Film Tournament'
      );
    });

    it('3. seed entries come dynamically from entries.json', () => {
      const loaded = loadEntries();
      expect(loaded).to.deep.equal(expectedFileEntries);
      expect(loaded.length).to.be.at.least(2);

      const store = makeStore();
      const bootstrapped = bootstrapDefaultSession(store);

      // Verify pair and remaining entries together comprise the original entries.json list
      const totalEntriesInSession = [
        ...bootstrapped.vote.pair,
        ...bootstrapped.entries
      ];
      expect(totalEntriesInSession).to.deep.equal(expectedFileEntries);
    });

    it('4. initial voting state reflects CREATE_SESSION + START_SESSION contract', () => {
      const store = makeStore();
      const bootstrapped = bootstrapDefaultSession(store);

      expect(bootstrapped.status).to.equal('open');
      expect(bootstrapped.winner).to.be.null;
      expect(bootstrapped.vote).to.be.ok;
      expect(bootstrapped.vote.pair).to.deep.equal([
        expectedFileEntries[0],
        expectedFileEntries[1]
      ]);
      expect(bootstrapped.entries).to.deep.equal(expectedFileEntries.slice(2));
      expect(bootstrapped.createdAt).to.be.a('string');
    });

    it('5. registry visibility reflects the bootstrapped session', () => {
      const store = makeStore();
      bootstrapDefaultSession(store);

      const sessions = store.getState().get('sessions');
      expect(sessions.size).to.equal(1);
      const summary = sessions.get(DEFAULT_SESSION_ID);
      expect(summary.get('id')).to.equal(DEFAULT_SESSION_ID);
      expect(summary.get('status')).to.equal('open');
      expect(summary.get('title')).to.equal('Danny Boyle Film Tournament');
    });

    it('7. restart/reset behavior creates a fresh default session deterministically', () => {
      // First instance
      const store1 = makeStore();
      bootstrapDefaultSession(store1);
      expect(store1.getState().hasIn(['sessions', DEFAULT_SESSION_ID])).to.be.true;

      // Simulate restart by creating fresh in-memory store
      const store2 = makeStore();
      expect(store2.getState().get('sessions').isEmpty()).to.be.true;

      // Bootstrap second instance
      bootstrapDefaultSession(store2);
      expect(store2.getState().hasIn(['sessions', DEFAULT_SESSION_ID])).to.be.true;
      expect(store2.getState().getIn(['sessions', DEFAULT_SESSION_ID, 'title'])).to.equal(
        'Danny Boyle Film Tournament'
      );
      expect(store2.getState().getIn(['sessions', DEFAULT_SESSION_ID, 'vote', 'pair']).toJS()).to.deep.equal(
        [expectedFileEntries[0], expectedFileEntries[1]]
      );
    });

    it('handles duplicate bootstrap safely without throwing or corrupting state', () => {
      const store = makeStore();
      const first = bootstrapDefaultSession(store);
      const second = bootstrapDefaultSession(store);

      expect(second).to.deep.equal(first);
      expect(store.getState().get('sessions').size).to.equal(1);
    });

    it('handles missing or invalid entries file safely', () => {
      const result = loadEntries(path.resolve(__dirname, 'nonexistent_file.json'));
      expect(result).to.be.null;

      const store = makeStore();
      const bootstrapped = bootstrapDefaultSession(store, {
        entriesPath: path.resolve(__dirname, 'nonexistent_file.json')
      });
      expect(bootstrapped).to.be.null;
      expect(store.getState().get('sessions').isEmpty()).to.be.true;
    });

    it('handles invalid store argument safely', () => {
      expect(bootstrapDefaultSession(null)).to.be.null;
      expect(bootstrapDefaultSession({})).to.be.null;
    });

    it('8. horror session exists after bootstrap in registry with Horror Classics', () => {
      const store = makeStore();
      const bootstrapped = bootstrapHorrorSession(store);

      expect(bootstrapped).to.be.ok;
      expect(bootstrapped.id).to.equal(HORROR_SESSION_ID);
      expect(bootstrapped.title).to.equal(HORROR_SESSION_TITLE);
      expect(bootstrapped.status).to.equal('open');
      expect(bootstrapped.vote.pair).to.deep.equal(['The Shining', 'Psycho']);
      expect(bootstrapped.entries).to.deep.equal(['Alien']);

      const state = store.getState();
      expect(state.hasIn(['sessions', HORROR_SESSION_ID])).to.be.true;
    });

    it('9. both sess_default and sess_horror co-exist independently when both are bootstrapped', () => {
      const store = makeStore();
      bootstrapDefaultSession(store);
      bootstrapHorrorSession(store);

      const sessions = store.getState().get('sessions');
      expect(sessions.size).to.equal(2);
      expect(sessions.has(DEFAULT_SESSION_ID)).to.be.true;
      expect(sessions.has(HORROR_SESSION_ID)).to.be.true;
      expect(sessions.getIn([DEFAULT_SESSION_ID, 'title'])).to.equal(DEFAULT_SESSION_TITLE);
      expect(sessions.getIn([HORROR_SESSION_ID, 'title'])).to.equal(HORROR_SESSION_TITLE);
    });
  });

  describe('integration: socket.io visibility of seeded session', () => {
    let io;
    let port;
    let clientSocket;

    beforeEach((done) => {
      // startServer() with port 0 automatically initializes store and bootstraps default session
      io = startServer(0);
      port = io.httpServer.address().port;
      clientSocket = Client(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false
      });
      clientSocket.on('connect', done);
    });

    afterEach((done) => {
      if (clientSocket && clientSocket.connected) {
        clientSocket.disconnect();
      }
      if (io) {
        io.close(() => done());
      } else {
        done();
      }
    });

    it('6. socket client receives sessions registry containing sess_default and can subscribe to session_state', (done) => {
      clientSocket.on('sessions', (sessions) => {
        expect(sessions).to.be.an('array');
        const defaultSess = sessions.find(s => s.id === DEFAULT_SESSION_ID);
        expect(defaultSess).to.be.ok;
        expect(defaultSess.title).to.equal('Danny Boyle Film Tournament');
        expect(defaultSess.status).to.equal('open');

        // Subscribe to default session
        clientSocket.once('session_state', (state) => {
          expect(state.id).to.equal(DEFAULT_SESSION_ID);
          expect(state.title).to.equal('Danny Boyle Film Tournament');
          expect(state.status).to.equal('open');
          expect(state.vote.pair).to.deep.equal([expectedFileEntries[0], expectedFileEntries[1]]);
          expect(state.entries).to.deep.equal(expectedFileEntries.slice(2));
          done();
        });

        clientSocket.emit('subscribe_session', DEFAULT_SESSION_ID);
      });
    });
  });
});
