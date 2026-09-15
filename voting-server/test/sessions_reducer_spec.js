import { Map, List, fromJS } from 'immutable';
import { expect } from 'chai';
import reducer, { INITIAL_STATE } from '../src/reducer';

describe('sessions registry reducer', () => {

  describe('initial state', () => {
    it('has an initial state representing an empty sessions registry', () => {
      const state = reducer(undefined, { type: '@@INIT' });
      expect(state).to.equal(fromJS({
        sessions: {}
      }));
    });
  });

  describe('CREATE_SESSION', () => {
    it('creates a new session in the registry with status pending and ISO createdAt', () => {
      const action = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Best Horror Film',
        entries: ['The Shining', 'Psycho', 'Alien']
      };
      const beforeTime = new Date().toISOString();
      const state = reducer(INITIAL_STATE, action);
      const afterTime = new Date().toISOString();

      const session = state.getIn(['sessions', 'sess_1']);
      expect(session).to.be.ok;
      expect(session.get('id')).to.equal('sess_1');
      expect(session.get('title')).to.equal('Best Horror Film');
      expect(session.get('status')).to.equal('pending');
      expect(session.get('entries')).to.equal(List.of('The Shining', 'Psycho', 'Alien'));
      expect(session.get('vote')).to.be.null;
      expect(session.get('winner')).to.be.null;

      const createdAt = session.get('createdAt');
      expect(createdAt).to.be.a('string');
      expect(Date.parse(createdAt)).to.not.be.NaN;
      expect(createdAt >= beforeTime).to.be.true;
      expect(createdAt <= afterTime).to.be.true;
    });

    it('handles missing or invalid sessionId safely without corrupting registry', () => {
      const actionMissing = {
        type: 'CREATE_SESSION',
        title: 'Test',
        entries: ['A', 'B']
      };
      const state1 = reducer(INITIAL_STATE, actionMissing);
      expect(state1).to.equal(INITIAL_STATE);

      const actionEmpty = {
        type: 'CREATE_SESSION',
        sessionId: '   ',
        title: 'Test',
        entries: ['A', 'B']
      };
      const state2 = reducer(INITIAL_STATE, actionEmpty);
      expect(state2).to.equal(INITIAL_STATE);

      const actionInvalidType = {
        type: 'CREATE_SESSION',
        sessionId: 123,
        title: 'Test',
        entries: ['A', 'B']
      };
      const state3 = reducer(INITIAL_STATE, actionInvalidType);
      expect(state3).to.equal(INITIAL_STATE);
    });

    it('does not overwrite an existing session with duplicate ID', () => {
      const action1 = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Original Title',
        entries: ['A', 'B']
      };
      const state1 = reducer(INITIAL_STATE, action1);

      const actionDuplicate = {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Overwritten Title',
        entries: ['C', 'D']
      };
      const state2 = reducer(state1, actionDuplicate);

      expect(state2.getIn(['sessions', 'sess_1', 'title'])).to.equal('Original Title');
      expect(state2.getIn(['sessions', 'sess_1', 'entries'])).to.equal(List.of('A', 'B'));
    });
  });

  describe('START_SESSION', () => {
    it('starts an existing session by changing status to open and initializing active pair via core.next', () => {
      const state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Best Sci-Fi',
        entries: ['Blade Runner', 'Matrix', 'Interstellar']
      });

      const nextState = reducer(state, {
        type: 'START_SESSION',
        sessionId: 'sess_1'
      });

      const session = nextState.getIn(['sessions', 'sess_1']);
      expect(session.get('status')).to.equal('open');
      expect(session.get('id')).to.equal('sess_1');
      expect(session.get('title')).to.equal('Best Sci-Fi');
      expect(session.get('vote')).to.equal(fromJS({
        pair: ['Blade Runner', 'Matrix']
      }));
      expect(session.get('entries')).to.equal(List.of('Interstellar'));
    });

    it('leaves state unchanged if sessionId does not exist or is missing', () => {
      const state1 = reducer(INITIAL_STATE, {
        type: 'START_SESSION'
      });
      expect(state1).to.equal(INITIAL_STATE);

      const state2 = reducer(INITIAL_STATE, {
        type: 'START_SESSION',
        sessionId: 'non_existent'
      });
      expect(state2).to.equal(INITIAL_STATE);
    });

    it('does not re-advance the tournament if an active pair is already in progress', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Best Sci-Fi',
        entries: ['A', 'B', 'C', 'D']
      });
      state = reducer(state, { type: 'START_SESSION', sessionId: 'sess_1' });
      const voteState = state.getIn(['sessions', 'sess_1', 'vote']);

      // Call START_SESSION again
      const state2 = reducer(state, { type: 'START_SESSION', sessionId: 'sess_1' });
      expect(state2.getIn(['sessions', 'sess_1', 'vote'])).to.equal(voteState);
      expect(state2.getIn(['sessions', 'sess_1', 'entries'])).to.equal(List.of('C', 'D'));
    });

    it('does not start an archived session', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Best Sci-Fi',
        entries: ['A', 'B']
      });
      state = reducer(state, { type: 'ARCHIVE_SESSION', sessionId: 'sess_1' });
      const state2 = reducer(state, { type: 'START_SESSION', sessionId: 'sess_1' });
      expect(state2.getIn(['sessions', 'sess_1', 'status'])).to.equal('archived');
      expect(state2.getIn(['sessions', 'sess_1', 'vote'])).to.be.null;
    });
  });

  describe('SET_ENTRIES', () => {
    it('updates entries for the selected session delegating to core.setEntries', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Best Drama',
        entries: ['Initial 1', 'Initial 2']
      });

      state = reducer(state, {
        type: 'SET_ENTRIES',
        sessionId: 'sess_1',
        entries: ['Godfather', 'Casablanca', 'Citizen Kane']
      });

      expect(state.getIn(['sessions', 'sess_1', 'entries'])).to.equal(
        List.of('Godfather', 'Casablanca', 'Citizen Kane')
      );
      // Metadata preserved
      expect(state.getIn(['sessions', 'sess_1', 'title'])).to.equal('Best Drama');
      expect(state.getIn(['sessions', 'sess_1', 'status'])).to.equal('pending');
    });

    it('leaves state unchanged if sessionId does not exist or is missing', () => {
      const state1 = reducer(INITIAL_STATE, {
        type: 'SET_ENTRIES',
        entries: ['A', 'B']
      });
      expect(state1).to.equal(INITIAL_STATE);

      const state2 = reducer(INITIAL_STATE, {
        type: 'SET_ENTRIES',
        sessionId: 'non_existent',
        entries: ['A', 'B']
      });
      expect(state2).to.equal(INITIAL_STATE);
    });
  });

  describe('NEXT', () => {
    it('advances only the selected session delegating to core.next', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tournament',
        entries: ['A', 'B', 'C']
      });
      state = reducer(state, { type: 'START_SESSION', sessionId: 'sess_1' });

      // Vote for A
      state = reducer(state, { type: 'VOTE', sessionId: 'sess_1', entry: 'A' });

      // Advance
      state = reducer(state, { type: 'NEXT', sessionId: 'sess_1' });

      const session = state.getIn(['sessions', 'sess_1']);
      expect(session.getIn(['vote', 'pair'])).to.equal(List.of('C', 'A'));
      expect(session.get('entries')).to.equal(List());
    });

    it('marks session status as completed when winner is determined', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tournament',
        entries: ['A', 'B']
      });
      state = reducer(state, { type: 'START_SESSION', sessionId: 'sess_1' });
      state = reducer(state, { type: 'VOTE', sessionId: 'sess_1', entry: 'A' });

      // Advancing 2-entry tournament with a winner finishes it
      state = reducer(state, { type: 'NEXT', sessionId: 'sess_1' });

      const session = state.getIn(['sessions', 'sess_1']);
      expect(session.get('status')).to.equal('completed');
      expect(session.get('winner')).to.equal('A');
      expect(session.get('vote')).to.be.undefined;
    });

    it('leaves state unchanged if sessionId does not exist or is missing', () => {
      const state1 = reducer(INITIAL_STATE, { type: 'NEXT' });
      expect(state1).to.equal(INITIAL_STATE);

      const state2 = reducer(INITIAL_STATE, { type: 'NEXT', sessionId: 'missing' });
      expect(state2).to.equal(INITIAL_STATE);
    });

    it('safely leaves state unchanged if session is already completed or archived', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tournament',
        entries: ['A', 'B']
      });
      state = reducer(state, { type: 'START_SESSION', sessionId: 'sess_1' });
      state = reducer(state, { type: 'VOTE', sessionId: 'sess_1', entry: 'A' });
      state = reducer(state, { type: 'NEXT', sessionId: 'sess_1' });

      // Now session is completed
      expect(state.getIn(['sessions', 'sess_1', 'status'])).to.equal('completed');
      const stateAfterExtraNext = reducer(state, { type: 'NEXT', sessionId: 'sess_1' });
      expect(stateAfterExtraNext).to.equal(state);
    });
  });

  describe('VOTE', () => {
    let baseState;

    beforeEach(() => {
      baseState = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Voting Round',
        entries: ['Trainspotting', '28 Days Later', 'Sunshine']
      });
      baseState = reducer(baseState, {
        type: 'START_SESSION',
        sessionId: 'sess_1'
      });
    });

    it('updates tally for the voted candidate delegating to core.vote', () => {
      const nextState = reducer(baseState, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: 'Trainspotting'
      });

      expect(nextState.getIn(['sessions', 'sess_1', 'vote', 'tally', 'Trainspotting'])).to.equal(1);
    });

    it('accumulates tally across multiple votes', () => {
      let state = reducer(baseState, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: 'Trainspotting'
      });
      state = reducer(state, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: 'Trainspotting'
      });
      state = reducer(state, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: '28 Days Later'
      });

      expect(state.getIn(['sessions', 'sess_1', 'vote', 'tally'])).to.equal(Map({
        'Trainspotting': 2,
        '28 Days Later': 1
      }));
    });

    it('rejects candidate not in the active pair without modifying state', () => {
      const nextState = reducer(baseState, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: 'Sunshine' // in entries list, but not current pair
      });
      expect(nextState).to.equal(baseState);

      const nextStateBogus = reducer(baseState, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: 'Ghostbusters'
      });
      expect(nextStateBogus).to.equal(baseState);
    });

    it('rejects vote if sessionId is missing or non-existent without throwing', () => {
      const stateMissing = reducer(baseState, {
        type: 'VOTE',
        entry: 'Trainspotting'
      });
      expect(stateMissing).to.equal(baseState);

      const stateBogusId = reducer(baseState, {
        type: 'VOTE',
        sessionId: 'sess_999',
        entry: 'Trainspotting'
      });
      expect(stateBogusId).to.equal(baseState);
    });

    it('rejects vote if session status is pending, archived, or completed', () => {
      // Pending session
      const pendingState = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_pending',
        title: 'Pending Session',
        entries: ['A', 'B']
      });
      const votePending = reducer(pendingState, {
        type: 'VOTE',
        sessionId: 'sess_pending',
        entry: 'A'
      });
      expect(votePending).to.equal(pendingState);

      // Archived session
      let archivedState = reducer(baseState, {
        type: 'ARCHIVE_SESSION',
        sessionId: 'sess_1'
      });
      const voteArchived = reducer(archivedState, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: 'Trainspotting'
      });
      expect(voteArchived).to.equal(archivedState);

      // Completed session
      let completedState = reducer(baseState, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: 'Trainspotting'
      });
      completedState = reducer(completedState, {
        type: 'NEXT',
        sessionId: 'sess_1'
      });
      completedState = reducer(completedState, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: 'Trainspotting'
      });
      completedState = reducer(completedState, {
        type: 'NEXT',
        sessionId: 'sess_1'
      });
      expect(completedState.getIn(['sessions', 'sess_1', 'status'])).to.equal('completed');
      expect(completedState.getIn(['sessions', 'sess_1', 'winner'])).to.equal('Trainspotting');

      const voteCompleted = reducer(completedState, {
        type: 'VOTE',
        sessionId: 'sess_1',
        entry: 'Trainspotting'
      });
      expect(voteCompleted).to.equal(completedState);
    });
  });

  describe('ARCHIVE_SESSION', () => {
    it('archives an existing session without deleting it or corrupting tournament state', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tournament to Archive',
        entries: ['A', 'B']
      });
      state = reducer(state, { type: 'START_SESSION', sessionId: 'sess_1' });
      state = reducer(state, { type: 'VOTE', sessionId: 'sess_1', entry: 'A' });

      const archivedState = reducer(state, {
        type: 'ARCHIVE_SESSION',
        sessionId: 'sess_1'
      });

      const session = archivedState.getIn(['sessions', 'sess_1']);
      expect(session.get('status')).to.equal('archived');
      expect(session.get('id')).to.equal('sess_1');
      expect(session.get('title')).to.equal('Tournament to Archive');
      expect(session.getIn(['vote', 'pair'])).to.equal(List.of('A', 'B'));
      expect(session.getIn(['vote', 'tally', 'A'])).to.equal(1);
    });

    it('safely leaves state unchanged if sessionId does not exist or is missing', () => {
      const state1 = reducer(INITIAL_STATE, { type: 'ARCHIVE_SESSION' });
      expect(state1).to.equal(INITIAL_STATE);

      const state2 = reducer(INITIAL_STATE, {
        type: 'ARCHIVE_SESSION',
        sessionId: 'unknown'
      });
      expect(state2).to.equal(INITIAL_STATE);
    });

    it('safely leaves state unchanged if session is archived and NEXT is dispatched', () => {
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_1',
        title: 'Tournament to Archive',
        entries: ['A', 'B']
      });
      state = reducer(state, { type: 'START_SESSION', sessionId: 'sess_1' });
      state = reducer(state, { type: 'ARCHIVE_SESSION', sessionId: 'sess_1' });

      const stateAfterNext = reducer(state, { type: 'NEXT', sessionId: 'sess_1' });
      expect(stateAfterNext).to.equal(state);
    });
  });

  describe('multi-session isolation', () => {
    it('guarantees complete isolation between multiple sessions across all actions', () => {
      // 1. Create two independent sessions
      let state = reducer(INITIAL_STATE, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_horror',
        title: 'Best Horror Films',
        entries: ['The Shining', 'Psycho', 'Alien']
      });
      state = reducer(state, {
        type: 'CREATE_SESSION',
        sessionId: 'sess_comedy',
        title: 'Best Comedy Films',
        entries: ['Airplane!', 'Superbad', 'Step Brothers']
      });

      // Verify both exist
      expect(state.getIn(['sessions', 'sess_horror', 'status'])).to.equal('pending');
      expect(state.getIn(['sessions', 'sess_comedy', 'status'])).to.equal('pending');

      // 2. Start Horror session only
      state = reducer(state, {
        type: 'START_SESSION',
        sessionId: 'sess_horror'
      });

      expect(state.getIn(['sessions', 'sess_horror', 'status'])).to.equal('open');
      expect(state.getIn(['sessions', 'sess_horror', 'vote', 'pair'])).to.equal(
        List.of('The Shining', 'Psycho')
      );
      // Comedy session MUST remain completely untouched in pending state
      expect(state.getIn(['sessions', 'sess_comedy', 'status'])).to.equal('pending');
      expect(state.getIn(['sessions', 'sess_comedy', 'vote'])).to.be.null;

      // 3. Start Comedy session
      state = reducer(state, {
        type: 'START_SESSION',
        sessionId: 'sess_comedy'
      });
      expect(state.getIn(['sessions', 'sess_comedy', 'status'])).to.equal('open');
      expect(state.getIn(['sessions', 'sess_comedy', 'vote', 'pair'])).to.equal(
        List.of('Airplane!', 'Superbad')
      );

      // Snapshot comedy session
      const comedySnapshot1 = state.getIn(['sessions', 'sess_comedy']);

      // 4. Vote in Horror session
      state = reducer(state, {
        type: 'VOTE',
        sessionId: 'sess_horror',
        entry: 'The Shining'
      });

      expect(state.getIn(['sessions', 'sess_horror', 'vote', 'tally', 'The Shining'])).to.equal(1);
      // Comedy session must be byte-for-byte / structurally unchanged
      expect(state.getIn(['sessions', 'sess_comedy'])).to.equal(comedySnapshot1);

      // 5. Advance Horror session (NEXT)
      state = reducer(state, {
        type: 'NEXT',
        sessionId: 'sess_horror'
      });

      expect(state.getIn(['sessions', 'sess_horror', 'vote', 'pair'])).to.equal(
        List.of('Alien', 'The Shining')
      );
      // Comedy still unchanged
      expect(state.getIn(['sessions', 'sess_comedy'])).to.equal(comedySnapshot1);

      // 6. Snapshot horror session
      const horrorSnapshot = state.getIn(['sessions', 'sess_horror']);

      // 7. Vote in Comedy session
      state = reducer(state, {
        type: 'VOTE',
        sessionId: 'sess_comedy',
        entry: 'Airplane!'
      });

      expect(state.getIn(['sessions', 'sess_comedy', 'vote', 'tally', 'Airplane!'])).to.equal(1);
      // Horror session must be structurally unchanged
      expect(state.getIn(['sessions', 'sess_horror'])).to.equal(horrorSnapshot);

      // 8. Archive Horror session
      state = reducer(state, {
        type: 'ARCHIVE_SESSION',
        sessionId: 'sess_horror'
      });

      expect(state.getIn(['sessions', 'sess_horror', 'status'])).to.equal('archived');
      // Comedy status must remain open and vote tally intact
      expect(state.getIn(['sessions', 'sess_comedy', 'status'])).to.equal('open');
      expect(state.getIn(['sessions', 'sess_comedy', 'vote', 'tally', 'Airplane!'])).to.equal(1);

      // 9. SET_ENTRIES on Comedy session isolated from Horror session
      const comedyEntries = List.of('Airplane!', 'Superbad', 'The Hangover');
      state = reducer(state, {
        type: 'SET_ENTRIES',
        sessionId: 'sess_comedy',
        entries: comedyEntries
      });
      expect(state.getIn(['sessions', 'sess_comedy', 'entries'])).to.equal(comedyEntries);
      expect(state.getIn(['sessions', 'sess_horror'])).to.equal(horrorSnapshot.set('status', 'archived'));
    });
  });

});
