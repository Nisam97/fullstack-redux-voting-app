# voting-client

React 19 + Redux Toolkit 2 frontend for VoteSphere. Built with Vite.

```bash
npm install
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # production bundle in dist/
npm run lint     # ESLint
npm test         # node --test unit specs, then Vitest component specs
```

The backend URL is read from `VITE_SERVER_URL`, loaded from the repo-root `.env`
(see [`vite.config.js`](vite.config.js) `envDir`). No backend secrets belong in
this package.

The client renders server state and emits intent only. Full documentation lives
in the repo root [`README.md`](../README.md) and [`AGENTS.md`](AGENTS.md).
