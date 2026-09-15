# Real-Time & HTTP API Contract Documentation

**Project:** Full-Stack Real-Time Pairwise Voting Application  
**Author:** Technical Writer (`agency-technical-writer`)  
**Last Updated:** September 13, 2026  
**Current Branch:** `develop1`  
**Transport Protocols:** HTTP/REST & WebSocket / Socket.io (`http://<host>:8090` / `ws://<host>:8090`)  
**Data Format:** Serialized JSON  
**Reference:** [ARCHITECTURE.md](file:///d:/Mine_project/fullstack-redux-voting-app/docs/ARCHITECTURE.md), [PROJECT_PROGRESS.md](file:///d:/Mine_project/fullstack-redux-voting-app/docs/PROJECT_PROGRESS.md), [CHANGELOG.md](file:///d:/Mine_project/fullstack-redux-voting-app/docs/CHANGELOG.md)

---

## 1. Overview & Communication Architecture

The backend voting server runs on port `8090` and provides two coordinated communication interfaces:
1. **HTTP REST API**: Serves authentication endpoints for administrator login, session profile verification, and voter session-joining with cookie-based token delivery.
2. **Socket.io Real-Time API**: Delivers low-latency, bidirectional state synchronization across room-isolated channels, handles real-time action ingress, and enforces server-side authorization.

### Communication Principles
* **Server Authoritativeness**: Every state change, tally increment, round progression, and token verification is enforced on the server.
* **Two-Tier Authentication**: Access is divided into an administrative tier (requiring a signed JWT) and a voter tier (requiring a session-scoped token).
* **Zero Engine Corruption**: Ingress layers validate and authenticate actions before they reach the Redux store or pure tournament engine in [`voting-server/src/core.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/core.js).
* **Admin Lifecycle Authority & Zero Competing REST Mutation Endpoints**: All session lifecycle mutations (`CREATE_SESSION`, `START_SESSION`, `NEXT`, `ARCHIVE_SESSION`, `SET_ENTRIES`) occur **exclusively via the authenticated Socket.io `action` pipeline**. There are NO competing REST mutation endpoints (e.g. no `POST /api/sessions/:id/start` or `POST /api/sessions/:id/next`). HTTP REST endpoints remain strictly dedicated to public session discovery, waiting room metadata hydration, voter registration, and results history.

---

## 2. HTTP REST Endpoints

The server exposes native HTTP endpoints implemented in [`voting-server/src/server.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js). All endpoints accept and return JSON with standard CORS headers (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Credentials: true`).

```text
HTTP REST Interface (Port 8090)
 ├── POST /api/admin/login                ──▶ Authenticate Admin & Issue JWT
 ├── POST /api/sessions/:sessionId/join   ──▶ Register Voter & Issue Session Token + Cookie
 ├── GET  /api/auth/me                    ──▶ Verify Admin Token & Retrieve Profile
 ├── GET  /api/sessions                   ──▶ Public Session Discovery & Roster Summaries
 ├── GET  /api/sessions/:sessionId/lobby  ──▶ Public Waiting Room & Live Headcount Metadata
 ├── GET  /api/sessions/history           ──▶ List Completed Tournament Outcomes (MongoDB)
 └── GET  /api/sessions/:sessionId/result ──▶ Retrieve Completed Result for Session (MongoDB)
      └── (Alias: GET /api/sessions/:sessionId/history)
```

---

### Endpoint: `POST /api/admin/login`

* **Purpose**: Authenticates the single global administrator using credentials and issues a signed JSON Web Token (JWT).
* **Authentication Requirement**: None (Public authentication endpoint).
* **Request Headers**:
  ```http
  Content-Type: application/json
  ```
* **Request Body Formats**:
  Accepts either `username` or `email` combined with `password`:
  ```json
  {
    "username": "admin",
    "password": "yourAdminPasswordHere"
  }
  ```
  *or*
  ```json
  {
    "email": "admin@votesphere.local",
    "password": "yourAdminPasswordHere"
  }
  ```
* **Request Parameters**:
  * `username` (*string*, optional if `email` provided): Administrator username. Case-insensitive comparison.
  * `email` (*string*, optional if `username` provided): Administrator email address. Case-insensitive comparison.
  * `password` (*string*, required): Plaintext password attempt.

#### Successful Response: `200 OK`
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "username": "admin",
    "email": "admin@votesphere.local",
    "role": "admin",
    "seededAt": "2026-09-12T06:00:00.000Z"
  }
}
```
* **Response Fields**:
  * `success` (*boolean*): Always `true` on successful authentication.
  * `token` (*string*): Signed JWT signed with `JWT_SECRET`, containing `role: 'admin'`, `username`, and `email`.
  * `user` (*object*): Public profile information. Plaintext password and `passwordHash` are strictly excluded.

#### Error Responses

* **`401 Unauthorized` — Invalid Credentials**
  ```json
  {
    "success": false,
    "error": "INVALID_CREDENTIALS",
    "message": "Invalid username/email or password."
  }
  ```
  *Occurs when identifier is not found, password does not match, or inputs are empty.*
* **`500 Internal Server Error`**
  ```json
  {
    "error": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected server error occurred."
  }
  ```

#### Security Considerations
* **Enumeration Resistance**: The error response is generic (`INVALID_CREDENTIALS`), never revealing whether the username/email or password was the cause of rejection.
* **Bcrypt Timing Safety**: Passwords are verified using `bcrypt.compareSync()`, which runs in constant time relative to password length to protect against timing attacks.
* **JWT Lifespan**: Tokens carry an expiration timestamp (`exp`) dictated by `JWT_EXPIRES_IN` (default `'24h'`).

---

### Endpoint: `POST /api/sessions/:sessionId/join`

* **Purpose**: Registers a frictionless, session-scoped voter identity using only a display name, issues an unguessable session token, and sets an HTTP cookie.
* **Authentication Requirement**: None (Public voter join endpoint).
* **Request Headers**:
  ```http
  Content-Type: application/json
  ```
* **Path Parameters**:
  * `sessionId` (*string*, required): The target session identifier (e.g., `sess_default`).
* **Request Body**:
  ```json
  {
    "displayName": "Alex"
  }
  ```
* **Request Parameters**:
  * `displayName` (*string*, required): Non-empty cosmetic display name for the voter.

#### Successful Response: `200 OK`
```http
HTTP/1.1 200 OK
Content-Type: application/json
Set-Cookie: voter_token_sess_default=c4b3a1e2-9f8d-4e5a-8b1c-7d6e5f4a3b2c; Path=/; SameSite=Lax
```
```json
{
  "success": true,
  "sessionId": "sess_default",
  "displayName": "Alex",
  "voterToken": "c4b3a1e2-9f8d-4e5a-8b1c-7d6e5f4a3b2c",
  "voterCount": 1
}
```
* **Response Fields**:
  * `success` (*boolean*): Always `true`.
  * `sessionId` (*string*): The normalized session identifier.
  * `displayName` (*string*): The trimmed display name provided by the user.
  * `voterToken` (*string*): Cryptographically random, unguessable token issued exclusively for this voter in this session.
  * `voterCount` (*number*): The updated count of active voters joined to this session.
* **Response Headers**:
  * `Set-Cookie`: Sets a session cookie `voter_token_${sessionId}=${voterToken}; Path=/; SameSite=Lax`.

#### Error Responses

* **`400 Bad Request` — Missing or Empty Display Name**
  ```json
  {
    "success": false,
    "error": "INVALID_DISPLAY_NAME",
    "message": "A non-empty display name is required."
  }
  ```
* **`400 Bad Request` — Invalid Session ID**
  ```json
  {
    "success": false,
    "error": "INVALID_SESSION",
    "message": "A valid session ID is required to join."
  }
  ```
* **`400 Bad Request` — Session Archived**
  ```json
  {
    "success": false,
    "error": "SESSION_ARCHIVED",
    "message": "Cannot join an archived session."
  }
  ```
* **`404 Not Found` — Session Missing in Registry**
  ```json
  {
    "success": false,
    "error": "SESSION_NOT_FOUND",
    "message": "Session \"sess_unknown\" does not exist in registry."
  }
  ```

#### Security Considerations
* **Display Name Boundary**: The `displayName` is NOT an authentication credential. It is stored as cosmetic presentation metadata. Possession of the `voterToken` is the sole authorization factor.
* **Duplicate Display Names Permitted**: Multiple participants can join with the same display name (e.g. two users named "Sam"); the server issues unique, independent `sessionToken` values to each, allowing both to vote independently.
* **Strict Session Scoping**: The token is bound exclusively to `sessionId`. It cannot be used to vote in another session.

---

### Endpoint: `GET /api/auth/me`

* **Purpose**: Validates the current admin JWT token and returns the authenticated administrator's profile.
* **Authentication Requirement**: Requires valid Administrator JWT in the `Authorization` header.
* **Request Headers**:
  ```http
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  ```

#### Successful Response: `200 OK`
```json
{
  "success": true,
  "admin": {
    "username": "admin",
    "email": "admin@votesphere.local",
    "role": "admin"
  }
}
```

#### Error Responses

* **`401 Unauthorized` — Missing Token**
  ```json
  {
    "success": false,
    "error": "UNAUTHORIZED",
    "message": "Authentication token is required."
  }
  ```
* **`401 Unauthorized` — Expired Token**
  ```json
  {
    "success": false,
    "error": "INVALID_TOKEN",
    "message": "Authentication token has expired."
  }
  ```
* **`401 Unauthorized` — Malformed or Tampered Token**
  ```json
  {
    "success": false,
    "error": "INVALID_TOKEN",
    "message": "Malformed or invalid authentication token."
  }
  ```
* **`401 Unauthorized` — Non-Admin Role or Mismatched Identity**
  ```json
  {
    "success": false,
    "error": "FORBIDDEN",
    "message": "Admin authorization required."
  }
  ```

---

### Endpoint: `GET /api/sessions` (Public Session Discovery)

* **Purpose**: Retrieves a public list of all active registered tournament sessions with live headcounts and metadata for discovery.
* **Authentication Requirement**: None (Public read-only endpoint).
* **Request Headers**:
  ```http
  Accept: application/json
  ```

#### Successful Response: `200 OK`
```json
{
  "success": true,
  "sessions": [
    {
      "id": "sess_default",
      "sessionId": "sess_default",
      "title": "Danny Boyle Film Tournament",
      "status": "open",
      "entryCount": 11,
      "voterCount": 3,
      "timerDuration": 30,
      "createdAt": "2026-09-12T06:00:00.000Z"
    },
    {
      "id": "sess_horror",
      "sessionId": "sess_horror",
      "title": "Horror Classics Tournament",
      "status": "pending",
      "entryCount": 8,
      "voterCount": 0,
      "timerDuration": 30,
      "createdAt": "2026-09-12T06:00:00.000Z"
    }
  ],
  "count": 2
}
```
* **Response Fields**:
  * `success` (*boolean*): Always `true` on successful retrieval.
  * `sessions` (*array*): Array of session summaries. Contains `id`, `sessionId`, `title`, `status`, `entryCount`, `voterCount`, `timerDuration` (configured round duration in seconds, default 30), and optional `createdAt`/`winner`. Sensitive authentication credentials, passwords, JWTs, and voter tokens are strictly excluded.
  * `count` (*number*): Number of sessions in the response.


---

### Endpoint: `GET /api/sessions/:sessionId/lobby` (Waiting Room & Headcount Metadata)

* **Purpose**: Returns real-time waiting room metadata for a specific session. Used by the Waiting Room UI (`/sessions/:id/lobby`) for instant hydration (e.g., when a participant scans a QR code or opens a direct share link).
* **Authentication Requirement**: None (Public read-only endpoint).
* **Request Headers**:
  ```http
  Accept: application/json
  ```
* **Path Parameters**:
  * `sessionId` (*string*, required): Target session identifier.

#### Successful Response: `200 OK`
```json
{
  "success": true,
  "sessionId": "sess_default",
  "title": "Danny Boyle Film Tournament",
  "status": "pending",
  "entryCount": 11,
  "voterCount": 4,
  "winner": null,
  "votingStarted": false,
  "isArchived": false,
  "session": {
    "sessionId": "sess_default",
    "title": "Danny Boyle Film Tournament",
    "status": "pending",
    "entryCount": 11,
    "voterCount": 4,
    "winner": null,
    "votingStarted": false,
    "isArchived": false
  }
}
```

#### Error Responses

* **`404 Not Found` — Session Not Found**
  ```json
  {
    "success": false,
    "error": "SESSION_NOT_FOUND",
    "message": "Session \"sess_unknown\" was not found."
  }
  ```

---

### Endpoint: `GET /api/sessions/history`

* **Purpose**: Retrieves a paginated list of concluded tournament results from MongoDB.
* **Authentication Requirement**: None (Public read-only endpoint).
* **Request Headers**:
  ```http
  Accept: application/json
  ```
* **Query Parameters**:
  * `limit` (*number*, optional, default: `50`, max: `100`): Maximum number of completed tournament records to return. Values greater than 100 are automatically clamped to 100; invalid or negative values fallback to 50.
* **Ordering**: Deterministic descending order by completion timestamp (`completedAt` descending).
* **Filter**: Strictly queries completed tournament outcomes from the `Result` collection.

#### Successful Response: `200 OK`
```json
{
  "success": true,
  "results": [
    {
      "sessionId": "sess_default",
      "title": "Danny Boyle Film Tournament",
      "winner": "Trainspotting",
      "entries": [
        "Shallow Grave",
        "Trainspotting",
        "A Life Less Ordinary",
        "The Beach",
        "28 Days Later",
        "Millions",
        "Sunshine",
        "Slumdog Millionaire",
        "127 Hours",
        "Trance",
        "Steve Jobs"
      ],
      "completedAt": "2026-09-12T14:00:00.000Z"
    }
  ],
  "count": 1
}
```

* **Response Fields**:
  * `success` (*boolean*): Always `true` on successful retrieval.
  * `results` (*array*): List of result objects sorted by `completedAt` desc. Internal MongoDB fields (`_id`, `__v`) and sensitive tokens are strictly excluded.
  * `count` (*number*): Number of result records in the `results` array.

#### Empty Response: `200 OK`
When no tournaments have completed yet:
```json
{
  "success": true,
  "results": [],
  "count": 0
}
```

#### Error Responses

* **`500 Internal Server Error` — Database Unavailable or Query Failure**
  ```json
  {
    "success": false,
    "error": "DATABASE_ERROR",
    "message": "Database connection is unavailable"
  }
  ```
  *(or `"Failed to retrieve results history"`).*

---

### Endpoint: `GET /api/sessions/:sessionId/result`

* **Purpose**: Retrieves the completed tournament outcome and candidate roster for a specific session ID from MongoDB.
* **Authentication Requirement**: None (Public read-only endpoint).
* **Request Headers**:
  ```http
  Accept: application/json
  ```
* **Path Parameters**:
  * `sessionId` (*string*, required): Unique session identifier (e.g., `sess_default`).

#### Successful Response: `200 OK`
```json
{
  "success": true,
  "result": {
    "sessionId": "sess_default",
    "title": "Danny Boyle Film Tournament",
    "winner": "Trainspotting",
    "entries": [
      "Shallow Grave",
      "Trainspotting",
      "A Life Less Ordinary",
      "The Beach",
      "28 Days Later",
      "Millions",
      "Sunshine",
      "Slumdog Millionaire",
      "127 Hours",
      "Trance",
      "Steve Jobs"
    ],
    "completedAt": "2026-09-12T14:00:00.000Z"
  }
}
```

* **Response Fields**:
  * `success` (*boolean*): Always `true`.
  * `result` (*object*):
    * `sessionId` (*string*): Session identifier.
    * `title` (*string*): Tournament title.
    * `winner` (*string*): Tournament champion crowned in final round.
    * `entries` (*array of strings*): Original candidate roster preserved from initial setup.
    * `completedAt` (*string, ISO 8601*): Timestamp when tournament concluded.
  * Internal fields `_id`, `__v`, passwords, and tokens are strictly excluded.

#### Error Responses

* **`404 Not Found` — Result Missing**
  ```json
  {
    "success": false,
    "error": "RESULT_NOT_FOUND",
    "message": "No completed result found for session \"sess_default\""
  }
  ```
* **`500 Internal Server Error` — Database Unavailable or Query Failure**
  ```json
  {
    "success": false,
    "error": "DATABASE_ERROR",
    "message": "Database connection is unavailable"
  }
  ```
  *(or `"Failed to retrieve result for session"`).*

---

### Endpoint: `GET /api/sessions/:sessionId/history` (Alias)

* **Purpose**: Identical route alias for `GET /api/sessions/:sessionId/result`.
* **Implementation Note**: Handled by the identical router pattern `^\/api\/sessions\/([^/?]+)\/(result|history)$` in [`voting-server/src/server.js`](file:///d:/Mine_project/fullstack-redux-voting-app/voting-server/src/server.js).
* **Specifications**: Parameters, headers, responses, fields, and error codes are 100% identical to `GET /api/sessions/:sessionId/result`.

---

## 3. Socket.io Real-Time API Contract

Socket.io runs concurrently on port `8090` and handles real-time bidirectional events.

```text
Client ───▶ socket.emit('admin_login', credentials, ackCallback)
Client ───▶ socket.emit('join_session', payload, ackCallback)
Client ───▶ socket.emit('action', actionPayload)
Client ───▶ socket.emit('subscribe_session', { sessionId })
Client ───▶ socket.emit('unsubscribe_session', { sessionId })
Client ───▶ socket.emit('sessions')

Server ───▶ socket.emit('sessions', summaryArray)
Server ───▶ io.to('session:' + id).emit('session_state', fullState)
Server ───▶ socket.emit('action_error', errorPayload)
```

---

### Event: `admin_login` (WebSocket Admin Auth)

* **Direction**: Client to Server with acknowledgment callback.
* **Description**: Authenticates the administrator directly over the WebSocket connection.
* **Invocation**:
  ```javascript
  socket.emit('admin_login', {
    username: 'admin',
    password: 'yourAdminPasswordHere'
  }, (response) => {
    console.log(response);
  });
  ```
* **Server Action on Success**:
  * Sets `socket.data.adminToken = token`.
  * Sets `socket.data.isAdmin = true`.
  * Executes callback with `{ success: true, token, user }`.
* **Callback on Failure**:
  * Returns `{ success: false, error: "INVALID_CREDENTIALS", message: "..." }`.

---

### Event: `join_session` (WebSocket Voter Join)

* **Direction**: Client to Server with acknowledgment callback.
* **Description**: Registers a voter identity over the WebSocket connection.
* **Invocation**:
  ```javascript
  socket.emit('join_session', {
    sessionId: 'sess_default',
    displayName: 'Alex'
  }, (response) => {
    console.log(response);
  });
  ```
* **Server Action on Success**:
  * Stores issued token in `socket.data.voterTokens[sessionId] = voterToken`.
  * Executes callback with `{ success: true, sessionId, displayName, voterToken }`.
* **Callback on Failure**:
  * Returns `{ success: false, error: "<ERROR_CODE>", message: "..." }`.

---

### Event: `action` (Ingress Dispatch & Authorization)

* **Direction**: Client to Server (`socket.emit('action', action)`).
* **Description**: Dispatches a domain action into the authoritative backend engine.

#### Protected Administrative Actions

> [!IMPORTANT]
> **Authoritative Admin Lifecycle Mutation Pipeline**  
> In accordance with architectural specifications, **no competing REST mutation endpoints exist** for session lifecycle management. Starting sessions, advancing rounds, archiving, setting entries, and creating sessions are performed **exclusively** via this Socket.io `action` ingress pipeline. REST endpoints remain strictly dedicated to public read queries, lobby hydration, voter registration, and results history.

The following action types require valid Admin JWT authorization:
* `CREATE_SESSION`
* `START_SESSION`
* `ARCHIVE_SESSION`
* `SET_ENTRIES`
* `NEXT`

##### Token Resolution Order for Admin Actions
The server checks the following locations in order to find the admin JWT:
1. `action.token`
2. `action.meta.token`
3. `socket.data.adminToken` (set during `admin_login`)
4. `socket.handshake.auth.token`
5. `socket.handshake.headers.authorization` (`Bearer <token>`)

##### Admin Action Rejection
If the token is missing, expired, tampered, or not an admin token, the action is dropped without dispatching to the store, and the server emits an `action_error` back to the socket:
```json
{
  "action": "NEXT",
  "error": "UNAUTHORIZED",
  "message": "Authentication token is required."
}
```
*(or `INVALID_TOKEN` / `FORBIDDEN`).*

##### Admin Action Payload Specifications:

1. **`CREATE_SESSION`**
   ```json
   {
     "type": "CREATE_SESSION",
     "sessionId": "sess_scifi",
     "title": "Sci-Fi Classics",
     "entries": ["Blade Runner", "The Matrix", "Interstellar"],
     "timerDuration": 30,
     "token": "eyJhbGciOi..."
   }
   ```
   * `sessionId` (*string*, required): Unique session identifier. Must be a non-empty string that does not collide with an existing session in the registry.
   * `title` (*string*, required): Human-readable session title. Must be a non-empty trimmed string.
   * `entries` (*array of strings*, required): Candidate entries roster. Must contain at least 2 distinct non-empty string entries.
   * `timerDuration` (*number*, optional, default: `30`): Integer between `5` and `300` inclusive defining round voting duration in seconds. Values outside this range emit `INVALID_TIMER_DURATION`; non-integer types emit `INVALID_TIMER_DURATION_TYPE`.
   * `token` (*string*, required): Valid administrator JWT.

   ##### Server Validation Rules for `CREATE_SESSION`:
   1. **Admin Authorization**: Rejects missing or non-admin JWT with `UNAUTHORIZED` or `FORBIDDEN`.
   2. **Session ID Validation**: Rejects missing, empty, or non-string IDs with `INVALID_SESSION_ID`. Rejects IDs already present in the registry with `DUPLICATE_SESSION_ID`.
   3. **Title Validation**: Rejects missing, empty, or non-string titles with `INVALID_TITLE`.
   4. **Entries Validation**: Rejects non-array or fewer than 2 entries with `INSUFFICIENT_ENTRIES`. Rejects non-string or blank entry items with `INVALID_ENTRIES`. Rejects duplicate entries resulting in fewer than 2 distinct entries with `INSUFFICIENT_ENTRIES`.
   5. **Timer Duration Validation**: When provided, non-integers or decimal values emit `INVALID_TIMER_DURATION_TYPE`. Integer values `< 5` or `> 300` emit `INVALID_TIMER_DURATION`.

2. **`START_SESSION`**
   ```json
   {
     "type": "START_SESSION",
     "sessionId": "sess_scifi",
     "token": "eyJhbGciOi..."
   }
   ```
3. **`NEXT`**
   ```json
   {
     "type": "NEXT",
     "sessionId": "sess_default",
     "token": "eyJhbGciOi..."
   }
   ```
4. **`SET_ENTRIES`**
   ```json
   {
     "type": "SET_ENTRIES",
     "sessionId": "sess_default",
     "entries": ["Trainspotting", "28 Days Later"],
     "token": "eyJhbGciOi..."
   }
   ```
5. **`ARCHIVE_SESSION`**
   ```json
   {
     "type": "ARCHIVE_SESSION",
     "sessionId": "sess_default",
     "token": "eyJhbGciOi..."
   }
   ```

---

#### Protected Voter Action: `VOTE`

* **Type**: `VOTE`
* **Payload Structure**:
  ```json
  {
    "type": "VOTE",
    "sessionId": "sess_default",
    "entry": "Trainspotting",
    "voterToken": "c4b3a1e2-9f8d-4e5a-8b1c-7d6e5f4a3b2c"
  }
  ```

##### Token Resolution Order for `VOTE`
The server resolves the voter token from:
1. `action.voterToken`
2. `action.meta.voterToken`
3. `socket.data.voterTokens[sessionId]`
4. `socket.handshake.auth.voterToken`
5. Handshake Cookie: `voter_token_${sessionId}` or `voter_token`

##### Server Validation Pipeline for `VOTE`:
1. **Session Presence**: If `sessionId` is missing, emits `action_error` (`SESSION_REQUIRED`).
2. **Anonymous Voting Check**: If no `voterToken` is present, emits `action_error` (`VOTER_TOKEN_REQUIRED`). Anonymous voting is strictly blocked.
3. **Token Validity & Scoping**:
   * Token must exist in server's voter registry.
   * `voter.sessionId` must match the target `action.sessionId`. If mismatched, emits `action_error` (`SESSION_MISMATCH`).
4. **Session Open Check**: Target session status must be `'open'`. If pending, completed, or archived, emits `action_error` (`SESSION_NOT_OPEN`).
5. **Pair Verification**: The target session must have an active pairwise round (`vote.pair`), and `action.entry` must be one of the two candidates in `vote.pair`.
6. **Server-Side Duplicate Vote Protection**:
   * Generates composite key: `${sessionId}:::${sortedPair}:::${voterToken}`.
   * Checks `recordedVotes` set. If already present, emits:
     ```json
     {
       "action": "VOTE",
       "error": "DUPLICATE_VOTE",
       "message": "Voter has already cast a vote in this pairwise round."
     }
     ```
   * If not present, records the key via `recordVote(voteKey)`.
7. **Round Participation Recording (Feature 7)**:
   * Resolves the active round ID (`${sessionId}:::r${roundIndex}`) from `roundManager.getCurrentRoundId(sessionId)`.
   * Records the voter's session token via `roundManager.recordRoundSubmission({ sessionId, roundId, sessionToken: voterToken })`.
8. **Authoritative Store Dispatch**:
   * Dispatches the authenticated, authorized action to `store.dispatch(action)` for pure core tally update via `core.vote()`.
9. **Early Round Completion Check (Feature 7)**:
   * Evaluates `roundManager.canCompleteEarly({ sessionId, roundId })`.
   * If all currently registered eligible voters (minimum 2) have cast valid ballots, triggers `roundManager.closeRoundOnce({ sessionId, roundId, store, timerManager, io })`:
     - Disarms and cancels the active round countdown timer via `timerManager.clearTimer()`.
     - Dispatches `{ type: 'NEXT', sessionId }` to the Redux store to authoritatively advance the tournament to the next candidate pair or determine the winner.
     - Broadcasts new `session_state` and fresh `timer_state` to room `session:${sessionId}`.

---

### Event: `action_error` (Server Feedback)

* **Direction**: Server to Client (Unicast to calling socket).
* **Description**: Emitted when an action dispatched via `action` fails authentication, authorization, or business validation.
* **Payload Structure**:
  ```json
  {
    "action": "VOTE",
    "error": "DUPLICATE_VOTE",
    "message": "Voter has already cast a vote in this pairwise round."
  }
  ```

#### Complete Machine-Readable Error Codes:

| Error Code | HTTP / Event Context | Cause |
|---|---|---|
| `INVALID_CREDENTIALS` | `POST /api/admin/login`, `admin_login` | Username/email or password does not match seeded admin. |
| `UNAUTHORIZED` | `POST /api/auth/me`, `action` | Admin token was missing where required. |
| `INVALID_TOKEN` | `POST /api/auth/me`, `action` | Token is expired, malformed, or tampered. |
| `FORBIDDEN` | `POST /api/auth/me`, `action` | Token lacks `admin` role or identity does not match current admin. |
| `INVALID_SESSION` | `POST .../join`, `action: VOTE` | Session ID was missing, empty, or invalid type. |
| `INVALID_DISPLAY_NAME`| `POST .../join`, `join_session` | Display name was empty or whitespace. |
| `SESSION_NOT_FOUND` | `POST .../join`, `action: VOTE` | Target session ID does not exist in store registry. |
| `SESSION_ARCHIVED` | `POST .../join`, `action: VOTE` | Cannot join or mutate an archived session. |
| `SESSION_NOT_OPEN` | `action: VOTE` | Target session is currently in `pending` or `completed` state. |
| `VOTER_TOKEN_REQUIRED` | `action: VOTE` | Anonymous vote attempted without session voter token. |
| `SESSION_MISMATCH` | `action: VOTE` | Token was issued for Session A but used to vote in Session B. |
| `INVALID_ENTRY` | `action: VOTE` | Selected candidate entry is not part of the active voting pair. |
| `DUPLICATE_VOTE` | `action: VOTE` | Voter has already cast a ballot in this active round pair. |
| `NO_ACTIVE_PAIR` | `action: VOTE` | Round has no active pairwise candidates open for voting. |
| `ROUND_CLOSED` | `roundManager`, `action: VOTE` | Action or submission attempted after the round has already closed. |
| `INVALID_SESSION_ID` | `action: CREATE_SESSION` | Session ID was missing, empty, or not a string. |
| `DUPLICATE_SESSION_ID` | `action: CREATE_SESSION` | Session with specified ID already exists in registry. |
| `INVALID_TITLE` | `action: CREATE_SESSION` | Session title was missing, empty, or whitespace. |
| `INSUFFICIENT_ENTRIES`| `action: CREATE_SESSION` | Fewer than 2 distinct non-empty candidate entries provided. |
| `INVALID_ENTRIES` | `action: CREATE_SESSION` | One or more candidate entries are not non-empty strings. |
| `INVALID_TIMER_DURATION_TYPE` | `action: CREATE_SESSION` | Provided timer duration is not an integer. |
| `INVALID_TIMER_DURATION` | `action: CREATE_SESSION` | Timer duration is outside the permitted 5–300 seconds range. |

---

### Room Subscription & Registry Events

#### Event: `subscribe_session`
* **Direction**: Client to Server (`socket.emit('subscribe_session', { sessionId: 'sess_default' })`).
* **Description**: Joins the socket to room `session:${sessionId}` and triggers an immediate unicast of both `session_state` and current `timer_state` (if a timer is running).

#### Event: `unsubscribe_session`
* **Direction**: Client to Server (`socket.emit('unsubscribe_session', { sessionId: 'sess_default' })`).
* **Description**: Removes the socket from room `session:${sessionId}`.

#### Event: `sessions` (Query & Summary Broadcast)
* **Direction**: Client → Server (Query) and Server → Client (Broadcast/Unicast).
* **Payload**: Lightweight summary array of all active sessions (including configured `timerDuration`):
  ```json
  [
    {
      "id": "sess_default",
      "title": "Danny Boyle Film Tournament",
      "status": "open",
      "timerDuration": 30,
      "createdAt": "2026-09-12T06:00:00.000Z"
    }
  ]
  ```

#### Event: `session_state` (Authoritative Room State)
* **Direction**: Server to Client (Scoped to room `session:${sessionId}`).
* **Payload**: Authoritative tournament state containing active pair, tallies, and round lifecycle metadata:
  ```json
  {
    "id": "sess_default",
    "title": "Danny Boyle Film Tournament",
    "status": "open",
    "createdAt": "2026-09-12T06:00:00.000Z",
    "entries": ["Sunshine", "Slumdog Millionaire"],
    "vote": {
      "pair": ["Shallow Grave", "Trainspotting"],
      "tally": {
        "Shallow Grave": 3,
        "Trainspotting": 5
      }
    },
    "winner": null,
    "roundLifecycle": "RESULTS_REVEALED",
    "roundId": "sess_default:::r1",
    "roundIndex": 1,
    "finalVote": {
      "pair": ["Shallow Grave", "Trainspotting"],
      "tally": {
        "Shallow Grave": 3,
        "Trainspotting": 5
      },
      "closedAt": 1789454396000
    },
    "revealTimer": {
      "duration": 1,
      "startedAt": 1789454396000,
      "expiresAt": 1789454397000,
      "status": "revealing"
    }
  }
  ```
* **Lifecycle State Meanings (`roundLifecycle`)**:
  - `VOTING`: Pairwise voting is actively permitted. `finalVote` is `null`.
  - `ROUND_CLOSED`: Voting has halted (via timer expiry or 100% participation quorum). Voting controls are disabled.
  - `RESULTS_REVEALED`: Concluded round outcome is revealed. `finalVote` contains the frozen snapshot. Voting remains disabled.
  - Reset to `VOTING` when the server authoritatively advances to the next round via `NEXT`.

#### Event: `timer_state` (Authoritative Round & Reveal Timer Synchronization)
* **Direction**: Server to Client (Scoped to room `session:${sessionId}`).
* **Description**: Broadcast in real time by `TimerManager` during active voting rounds (`status: 'running'`) and results reveal windows (`status: 'revealing'`). Also unicast directly upon `subscribe_session` for initial synchronization and reconnect recovery. Ephemeral in-memory state; never persisted to MongoDB.
* **Timer Exclusivity**: A session can never hold both a voting timer and a reveal timer simultaneously. Active voting timers are disarmed upon round closure before a reveal timer begins.
* **Room Isolation Guarantee**: Emitted strictly via `io.to('session:' + sessionId).emit('timer_state', ...)` ensuring complete isolation between concurrent sessions.
* **Payload Structure (Active Voting Timer)**:
  ```json
  {
    "sessionId": "sess_default",
    "duration": 30,
    "expiresAt": 1789303370511,
    "status": "running",
    "roundId": "sess_default:::r1"
  }
  ```
* **Payload Structure (Active Reveal Timer)**:
  ```json
  {
    "sessionId": "sess_default",
    "duration": 1,
    "expiresAt": 1789454397000,
    "status": "revealing",
    "roundId": "sess_default:::r1"
  }
  ```
* **Payload Structure (Stopped / Expired)**:
  ```json
  {
    "sessionId": "sess_default",
    "status": "stopped"
  }
  ```
* **Client Behavior & Non-Interference**:
  - `CountdownTimer` calculates remaining seconds for display: `Math.max(0, Math.ceil((expiresAt - now) / 1000))`.
  - When `status === 'revealing'`, `Voting.jsx` renders the reveal countdown with dedicated styling and displays frozen `finalVote`.
  - Reconnecting clients compute remaining time from the server-provided `expiresAt` without restarting the timer.
  - The client **never** dispatches `NEXT`. Round advancement is executed strictly on the server by `TimerManager.expireReveal()`.

#### Event: `lobby_update` (Real-Time Live Headcount & Room Status)
* **Direction**: Server to Client (Scoped to room `session:${sessionId}`).
* **Description**: Broadcast in real time whenever a participant joins the session or session metadata changes, updating the Waiting Room's live headcount without requiring page reloads or full tournament state refreshes.
* **Room Isolation Guarantee**: Emitted strictly via `io.to('session:' + sessionId).emit('lobby_update', ...)` so only clients subscribed to that specific session room receive the headcount update. Clients subscribed to other session rooms receive zero events, preventing cross-session pollution.
* **Payload Structure**:
  ```json
  {
    "sessionId": "sess_default",
    "voterCount": 4,
    "status": "pending",
    "title": "Danny Boyle Film Tournament"
  }
  ```
  *(Note: When emitted immediately upon voter join in `server.js`, payload includes `{ sessionId, voterCount }`.)*

---

## 4. Environment Configuration Specification

The backend server reads authentication and network parameters from environment variables (`.env`). Safe placeholder values are documented below.

> [!CAUTION]
> **Never commit real secrets or production credentials to source control.**
> In production deployments, `JWT_SECRET` must be set to a high-entropy cryptographically secure string (e.g., generated with `openssl rand -hex 32`), and `ADMIN_PASSWORD` must be set to a strong passphrase.

### Configuration Template (`.env.example`):
```bash
# Server Network Port
PORT=8090

# MongoDB Database Connection String
MONGODB_URI=mongodb://localhost:27017/votesphere_dev

# JSON Web Token Secret (Replace with secure random string in production)
JWT_SECRET=change_this_to_a_secure_random_secret_in_production

# JWT Expiration Period (e.g., 1h, 24h, 7d)
JWT_EXPIRES_IN=24h

# Single Global Administrator Credentials
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@votesphere.local
ADMIN_PASSWORD=adminPassword123!
```

| Variable | Type | Default Fallback | Purpose |
|---|---|---|---|
| `PORT` | `number` | `8090` | Port for HTTP endpoints and Socket.io server. |
| `MONGODB_URI` | `string` | `'mongodb://localhost:27017/votesphere_dev'` | MongoDB database connection URI for sessions and results persistence. |
| `JWT_SECRET` | `string` | Safe development fallback string | Secret key used to sign and verify admin JWTs. |
| `JWT_EXPIRES_IN` | `string` | `'24h'` | Expiration duration for issued admin JWTs. |
| `ADMIN_USERNAME` | `string` | `'admin'` | Username for the single global admin account. |
| `ADMIN_EMAIL` | `string` | `'admin@votesphere.local'` | Email address for the single global admin account. |
| `ADMIN_PASSWORD` | `string` | `'adminPassword123!'` | Initial plaintext password hashed via bcrypt on startup. |
