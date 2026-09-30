# Contributing to VoteSphere

Thank you for your interest in contributing to VoteSphere! This document provides guidelines and steps for contributing to the project.

---

## Architecture Principles & Guardrails

Before making any modifications, please review these core architectural rules:

1. **The Server is Authoritative:**
   - Voting mathematics, quorum checks, tie resolutions, and round advancements must run exclusively on the backend.
   - The frontend renders authoritative server state and dispatches user intent; it never calculates tallies or dispatches `NEXT` on its own.

2. **Protected Pure Core (`voting-server/src/core.js`):**
   - `core.js` is a protected pure module with a pinned SHA-256 hash (`b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`).
   - Do **NOT** edit `core.js`. All new behavior (timers, authentication, presence, persistence) must wrap around it.

3. **Sequential MongoDB Writes:**
   - Use `enqueueSessionWrite` in `voting-server/src/db/repository.js` to ensure atomic, sequentially-ordered persistence operations per session.

4. **Multi-Session Isolation:**
   - Backend state is an Immutable.js Map keyed `sessions.<sessionId>`.
   - Frontend Redux state is normalized under `bySessionId[sessionId]`. Never promote session data to the root level.

---

## Development Setup

### 1. Prerequisites
- **Node.js:** v18.0.0 or higher
- **MongoDB:** v6.0 or higher
- **npm:** v9 or higher

### 2. Installation
Clone the repository and install dependencies in both packages:
```bash
git clone https://github.com/Nisam97/fullstack-redux-voting-app.git
cd fullstack-redux-voting-app

# Configure local environment
cp .env.example .env

# Install backend dependencies
cd voting-server && npm install

# Install frontend dependencies
cd ../voting-client && npm install
```

### 3. Running Locally
Run both backend and frontend servers in separate terminals:
```bash
# Terminal 1: Backend Server (Port 8090)
cd voting-server && npm start

# Terminal 2: Frontend Client (Port 5173)
cd voting-client && npm run dev
```

---

## Testing & Quality Assurance

All contributions must pass all existing test suites, linting, and production builds prior to submitting a pull request.

```bash
# Run backend test suite (Mocha + in-memory MongoDB)
cd voting-server
npm test

# Run frontend test suite (Node test runner)
cd ../voting-client
npm test

# Run frontend linter
npm run lint

# Run frontend production build
npm run build
```

---

## Pull Request Guidelines

1. **Create a Topic Branch:**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```
2. **Follow Existing Code Style:**
   - Use ES modules.
   - Clean, descriptive variable names.
   - No commented-out obsolete code or leftover debug logs.
3. **Write Tests:**
   - Include corresponding unit and integration tests for any new features or bug fixes.
4. **Never Commit Secrets:**
   - Never commit `.env` files, production tokens, or database passwords. Use `.env.example` for template changes.
5. **Atomic Commits:**
   - Structure commits logically with clear, conventional messages (e.g., `feat: ...`, `fix: ...`, `chore: ...`).
