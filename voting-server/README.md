# voting-server

Authoritative VoteSphere backend: Node.js HTTP + Socket.io server, Redux 5 over
Immutable.js, and Mongoose 9 persistence on MongoDB.

```bash
npm install
npm start   # reads the repo-root .env, listens on PORT (default 8090)
npm test    # Mocha suite via test/runner.cjs
```

Configuration comes entirely from the repo-root `.env` (see `.env.example`).
Voting math, tallies, timers, and round advancement run only here; the client
never computes them.

Full documentation lives in the repo root [`README.md`](../README.md),
[`AGENTS.md`](AGENTS.md), and [`Architecture.md`](../Architecture.md).
