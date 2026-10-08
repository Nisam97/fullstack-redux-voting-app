# VoteSphere User Manual

This manual explains how to use VoteSphere as an end user: a session host (admin), a voter, or a visitor browsing results. Everything here matches the current application. No developer knowledge is required.

## 2.1 Introduction

**What the application does.** VoteSphere runs live group votes in two formats:

* **Tournament (pairwise) mode:** candidates face each other one matchup at a time. After each round the winner stays in the pool and the loser is eliminated, until one undisputed champion remains. A session with **7 or more candidates** uses this mode automatically.
* **Single ballot mode:** every candidate appears on one ballot and the highest vote count wins. Ties are handled with an automatic runoff, and a second tie is decided by the host or by a coin flip. A session with **2 to 6 candidates** uses this mode automatically.

All counting, timers and round advancement happen on the server. Every connected voter sees the same state at the same time.

**Who can use it.** Anyone with the web address. Some sessions are open to anyone (public), and some are restricted (secured) so only invited or approved people can join.

**Main capabilities.**

* Create a voting session, share it with a 6 character join code or a QR code
* Run timed voting rounds with live countdowns and live participant counts
* Reveal round results to everyone at once, then advance automatically
* Resolve ties as a host, or let a coin flip decide
* Browse a permanent archive of completed tournaments
* Sign in with an emailed code (no password) when a session requires it
* Manage who may join a secured session (allowlist of emails, or approval requests)

## 2.2 Prerequisites

| Requirement | Detail |
| ----------- | ------ |
| Browser | Any modern browser (Chrome, Edge, Firefox, Safari). No plugins or extensions |
| Network | A connection to where VoteSphere is hosted. In local development that is `http://localhost:5173` for the app and the backend on port `8090` |
| Account | Not required for public sessions. Required (email based, no password) for secured sessions |
| Email access | Needed only when a session is secured, or when you create a voter account. In local development with no mail server configured, the code is printed in the backend console instead |
| Display name | Required to join a public session. This is a label for the voting room, not an account |

## 2.3 Getting Started

**1. Open the application.** Visit the app address in your browser. In local development:

```text
Frontend: http://localhost:5173
```

The home page explains the product, with sections for features, how it works, example candidates, statistics and testimonials.

**2. Navigate.** The bar at the top of every page has:

| Link | Goes to |
| ---- | ------- |
| VoteSphere logo / Home | The landing page |
| Join | The join code screen (`/join`) |
| History | The archive of completed tournaments (`/history`) |
| Admin | The admin panel, shown only after an admin signs in |
| Sign in | The login page (voter code mode or admin mode) |
| Hi, \<name\> / Log out | Shown when a voter is signed in |

**3. Join your first session.** Ask the host for the 6 character join code or a QR link, then open `/join`, type the code, and press **Enter Lobby**. You land in the waiting room lobby where you enter a display name.

**4. Sign in (only if asked).** Secured sessions ask you to sign in with your email first. See section 2.5, "Voter account registration".

## 2.4 User Roles

### Session host (administrator)

**Can:** sign in at `/login` in Administrator Portal mode; create sessions (public or secured); set the voting timer (5 to 300 seconds); share the join code and QR code; refresh the join code; start a session; advance rounds; resolve ties (pick a winner or flip a coin); switch a secured session between allowlist and approval mode; add or remove allowlist emails; approve or reject join requests; remove participants; publish a secured result when the session has ended; download a turnout report; archive a session.

**Cannot:** change a session type after creation; edit the candidate list of a session that has started through the panel (the server guards entries against tournament progression); publish results before a secured session has completed or been archived; change who can join after the session has started; join a secured session as a voter using the admin credential alone without signing in as that voter.

**Screens:** the admin panel at `/admin` (also `/dashboard`, which redirects there), the results page in admin mode (publish toggle and turnout), and the manage session dialog.

### Anonymous voter

**Can:** join any public session with only a display name; see the live participant count; vote during open rounds; see revealed round results; view the history archive; browse all public pages.

**Cannot:** join secured sessions (the lobby asks you to sign in); vote twice in the same round; vote after a round closes; join a session that has already started (a voter who already joined may rejoin).

**Screens:** `/join`, the lobby, the voting arena, the results page, `/history`.

### Signed in voter

**Can:** everything an anonymous voter can, plus join secured sessions your email is approved for; request to join an approval based session; see your name in the per round turnout report the host sees.

**Cannot:** the same voting rules apply (one vote per round per voter). Your vote choice is never recorded in the turnout report, only the fact that you voted.

**Screens:** everything above, plus the account pages (`/register`, `/login`, the signed in state in the bar).

### Public visitor

**Can:** read the home page, use the join screen, and browse the history archive of public (and already published) results.

**Cannot:** see secured sessions in any list; confirm that a secured session exists (a link you are not allowed to see shows the same "not available" state as a wrong link).

## 2.5 Feature by Feature User Guide

### Feature: Home page

**Purpose:** introduces the product and links you into the app.

**How to Access:** open `/`.

**Steps:** 1. Open the app address. 2. Scroll through the sections (hero, features, how it works, candidates, statistics, testimonials). 3. Use the top bar or the calls to action to reach Join, History or Sign in.

**Expected Result:** the landing page renders with working navigation.

**Important Notes:** the statistics and testimonials on this page are static presentation content. Live data lives in the lobby, arena and results pages.

### Feature: Join with a join code

**Purpose:** enters you into a specific voting session.

**How to Access:** the Join link in the top bar (`/join`), or a link of the shape `/join/<CODE>`.

**Steps:**
1. Open `/join`.
2. Type the 6 character code from your host (letters and digits; the alphabet excludes easily confused characters such as `O`, `0`, `1`, `I` and `L`).
3. Press **Enter Lobby**.

**Expected Result:** you are taken to the session lobby, for example `/sessions/<sessionId>/lobby`. If you opened a `/join/<CODE>` link directly, the code resolves on its own.

**Important Notes:** the input accepts only 6 characters and normalizes to upper case. An unknown, expired or already finished session shows "Code not found or no longer active." Resolving codes is limited to 30 attempts per minute from your address.

### Feature: Lobby (waiting room)

**Purpose:** shows who is in the room and lets you join with a display name before voting starts.

**How to Access:** automatic after a successful join code resolution, or directly at `/sessions/<id>/lobby`.

**Steps:**
1. Read the session title, status and the live voter count.
2. Type a display name in the join form (a signed in voter sees their profile name prefilled; you may override it).
3. Press the join button.
4. Wait in the lobby while the status is pending. The headcount updates live as others join.

**Expected Result:** you are marked as joined. When the host starts the session and the status becomes open, you are moved to the voting arena automatically.

**Important Notes:**
* A display name is required, and duplicate names are allowed.
* Secured sessions refuse anonymous joins: you are asked to sign in, told your email is not on the allowlist, or told your request was rejected, depending on the session setup.
* Approval based sessions answer with a pending state: you wait until the host approves or rejects you, and the lobby tells you which happened.
* If the host removes you, the lobby clears your joined state and shows the removal message.
* If a session link is wrong, mistyped, finished in a way that hides it, or secured and not visible to you, the lobby shows one neutral message: "This session is not available." It never claims that a hidden session does not exist.

### Feature: Voting arena

**Purpose:** casts your vote in each round.

**How to Access:** `/sessions/<id>/vote` (you arrive here automatically from the lobby once voting opens).

**Steps:**
1. Wait for the round to load. The header shows the session title, your display name, and how many voters are active.
2. Read the countdown timer ("ROUND TIMER"). It shows the server's clock.
3. Click one candidate card to vote.
4. Your choice is confirmed on screen. The cards lock for this round.
5. When the round closes, the frozen result appears ("ROUND RESULTS") with the vote distribution. A second countdown ("NEXT ROUND IN") runs before the next matchup.
6. Repeat until the tournament concludes. A champion screen ("We Have a Winner!") links to the results page.

**Expected Result:** one vote per round per voter, counted by the server. Everyone connected sees the same reveal at the same moment.

**Important Notes:**
* **Tournament mode:** you see two candidates at a time (a head to head matchup).
* **Single ballot mode:** you see all candidates on one ballot at once.
* You cannot change a vote after submitting it in that round.
* A vote sent after the round closes is rejected with "Voting is closed for this round."
* A second vote in the same round is rejected as a duplicate.
* If you did not join first, the arena shows a display name join form before voting.
* If the timer reaches zero before you vote, the round closes without you.

### Feature: Results page

**Purpose:** shows the revealed round outcome, the round by round history, and the final champion.

**How to Access:** `/sessions/<id>/results` (also linked from the champion screen and from each history card).

**Steps:**
1. Open the page during or after a session.
2. While voting is in progress, note that tallies are deliberately hidden: you see the contenders and a "Voting in Progress" message.
3. After a round closes, the chart and per candidate vote counts appear for that round.
4. After the session concludes, the champion banner shows, and the full round timeline and totals panel list every closed round and every candidate's accumulated votes.

**Expected Result:** a stable, server driven presentation. Nothing on this page advances the session.

**Important Notes:**
* Round resolution labels you may see: Majority Win, Tie Both Advanced, Runoff Rematch, Admin Decision, Coin Flip, No Result, Zero Vote Replay.
* A session can end with no official champion (for example two empty rounds). The page and the archive say so explicitly.
* For a secured session that has not been published, a visitor who is not approved sees the same neutral "not available" state as for a missing result.
* As an admin on a secured, finished session you additionally get the publish toggle and the turnout report (see the admin features below).

### Feature: History archive

**Purpose:** lists completed tournaments so anyone can review past champions.

**How to Access:** the History link in the top bar (`/history`).

**Steps:** 1. Open History. 2. Read the cards: title, completed date, candidate count, the champion (or "No official champion was declared."), and a Public or Secured badge. 3. Press **View Result Details** to open the full result.

**Expected Result:** public completed sessions appear. Secured sessions appear only after the host published them, and they carry a Secured badge.

**Important Notes:** an empty archive shows "No Completed Tournaments Yet" with a link back to the join screen. Secured sessions that were never published are never listed.

### Feature: Voter account registration

**Purpose:** creates a voter account so you can join secured sessions. There is no password: your email is your identity.

**How to Access:** `/register`, or the Sign in link.

**Steps:**
1. Open `/register`.
2. Enter your email address, display name and username.
3. Press the button to request a code.
4. Read the 6 digit code from your email (in local development, from the backend console).
5. Enter the code and submit.

**Expected Result:** your account exists, you are signed in, the top bar shows "Hi, \<name\>", and you land on the home page.

**Important Notes:**
* Usernames are 3 to 20 letters, digits or underscores, and must be unique.
* A new code can be requested after a 60 second cooldown; the page counts it down for you.
* Requesting a code for an email that already has an account simply signs that account in; registration details are ignored for existing accounts.
* The reply you get never says whether an email is already registered.

### Feature: Voter sign in and sign out

**Purpose:** signs an existing voter in with an emailed code.

**How to Access:** `/login`, Voter Sign In mode (the default).

**Steps:** 1. Open `/login`. 2. Enter your email and request a code. 3. Enter the 6 digit code. 4. Submit.

**Expected Result:** you are signed in and returned to the page you came from (or home).

**Important Notes:** five wrong codes lock that code; request a fresh one. Sign out with the **Log out** button in the top bar.

### Feature: Secured session participation

**Purpose:** restricts a session to invited or approved voters.

**How to Access:** a secured session link or code. The lobby detects that the session is secured.

**Steps (allowlist mode):**
1. Open the lobby. You are asked to sign in if you have not.
2. Sign in with the email your host allowlisted.
3. Enter a display name and join.

**Steps (approval mode):**
1. Open the lobby and sign in.
2. Submit a join request.
3. Wait in the pending state until the host approves or rejects you.

**Expected Result:** an approved voter joins normally and votes like any other participant.

**Important Notes:**
* An email that is not on the allowlist is refused with "Your email is not on the approved allowlist for this session."
* A rejected request shows "Your join request was rejected by the organizer."
* Once the host starts the session, new joins and new requests are closed ("This session has already started..."). A voter who already has access can rejoin after clearing browser storage.
* If the host removes you mid session you lose access immediately, and if the session is already voting your cut off takes effect at the end of the current round.

### Feature: Admin sign in

**Purpose:** opens the host portal.

**How to Access:** `/login`, then switch to Administrator Portal mode.

**Steps:** 1. Open `/login`. 2. Select the administrator mode. 3. Enter the admin username and password issued by the operator (the local development default is `admin` / `adminPassword123!` from the environment file). 4. Submit.

**Expected Result:** you are taken to `/admin`, and the top bar shows "Admin: \<username\>" with a Logout button. The Admin link appears in the navigation.

**Important Notes:** after 5 failed attempts from your address the login is throttled with a growing wait (up to 60 seconds between attempts). If the server later rejects your stored credential, the app clears it and admin screens say the session is gone instead of showing empty data; simply sign in again.

### Feature: Admin panel overview

**Purpose:** the control room for every session.

**How to Access:** `/admin` after admin sign in.

**What you see:**
* A **Create Session** button in the header.
* Six metric cards: Total Sessions, Live / Open, Pending, Completed, Active Voters, Archived.
* A list of sessions, each with its status badge, Secured or tie badges when relevant, join code, voter count, timer duration, the current round matchup when live, and quick controls: Lobby, Vote, Results, Refresh code, Share, Manage Session.
* An error banner and a success message area, plus a tie alert banner with a shortcut into tie resolution while a tie is pending.

**Important Notes:** the panel reflects the server registry live. Secured sessions appear only for an authenticated admin socket.

### Feature: Create a session

**Purpose:** sets up a new contest.

**How to Access:** the Create Session button (header, section header, or empty state).

**Steps:**
1. Open the create dialog.
2. Enter a **title** (required).
3. Optionally enter a **session ID**. If you leave it blank, one is generated (`sess_<timestamp>`). The value is cleaned to lower case letters, digits, dashes and underscores.
4. Set the **voting timer** in seconds: an integer from 5 to 300 (default 30). Decimals are rejected.
5. Paste the **candidates**: one per line, or separated by commas. At least 2 distinct entries are required.
6. Read the mode note: 2 to 6 entries produce a single ballot session, 7 or more produce a tournament. The app chooses this for you.
7. Choose the **session type**: Public (open to anyone) or Secured (restricted access).
8. For a secured session choose **who can join**: Allowlist (you paste emails now or later) or Approval (voters request, you decide). Optionally paste the initial allowlist, one email per line.
9. Submit.

**Expected Result:** the session appears in your list as Pending, with its join code. If you supplied an initial allowlist, those entries are registered immediately.

**Important Notes:** the server re checks everything. A duplicate session ID, a blank title, fewer than 2 distinct entries, an out of range timer, or a secured session with public joining are all refused with an error banner.

### Feature: Share a session (join code and QR)

**Purpose:** gives voters a way in.

**How to Access:** the Share button on a session row.

**Steps:** 1. Press Share. 2. Read the join code, or scan the QR code with a phone. The link encoded in the QR is `<app address>/join/<joinCode>` (or the lobby URL when a session has no code).

**Expected Result:** voters scanning or typing the code land in your lobby.

**Important Notes:** the **Refresh code** button replaces the join code with a new unique one and persists it. The old code stops working. Codes are unique across sessions that are still pending or open.

### Feature: Manage a session

**Purpose:** everything about one session in one dialog.

**How to Access:** the Manage Session button on a session row.

**What is inside, by session state:**
* **Live section:** the Start button while pending; the Next button while open (advances the bracket manually, in addition to the automatic advance after the reveal countdown).
* **Tie pending section:** while a tie awaits a decision, a dropdown of the tied candidates with a **Pick winner** button, and a **Coin flip** button.
* **Completed section:** the outcome, and the archive action.
* **Archived section:** a read only reminder that the session is retired.
* **Participants section (secured sessions):** the current mode, an allowlist with per email Remove buttons, an add emails box, and, in approval mode, the join request queue with Approve and Reject buttons. The **Switch access mode** button moves between allowlist and approval (this asks for confirmation and clears the current roster).

**Important Notes:**
* Archiving always needs a second confirmation, in the dialog and in the browser confirm prompt.
* Removing a participant asks for confirmation, because they lose access at once (or at the end of the current round while voting).
* Switching the access mode clears the existing roster and revokes the related voter access.
* Starting a secured session requires at least one eligible voter, and auto rejects any join requests still pending, notifying those voters.
* While a session is open, removal is deferred to the end of the current round so in flight votes are not disturbed.

### Feature: Publish a secured result

**Purpose:** makes a secured session's final result visible to everyone.

**How to Access:** the results page of a secured session, in admin mode.

**Steps:** 1. Sign in as admin. 2. Open `/sessions/<id>/results` for the secured session. 3. In the "Result visibility" panel press the toggle. 4. Wait for the server acknowledgement (the control does not move until then).

**Expected Result:** the hint changes between "Private: only approved participants and you can view this result." and "Published: anyone with the session id can view this result.", and the result joins the public history archive.

**Important Notes:** publishing is only possible after the session has completed or been archived. If the server refuses or does not answer within 10 seconds, the control stays where it was and shows an error.

### Feature: Turnout report (admin only)

**Purpose:** shows who voted in each round, as an audit trail. It never shows what anyone voted.

**How to Access:** the results page of any session, in admin mode (subscribe automatically on open).

**Steps:** 1. Sign in as admin. 2. Open the session's results page. 3. Read the per round voter lists (name and email). 4. Optionally press the download button to save `turnout-<sessionId>.csv`.

**Expected Result:** every closed round appears, including rounds where nobody voted. The CSV opens in any spreadsheet.

**Important Notes:** a non admin caller gets the same 404 an unknown address gets, so the report is never advertised to voters.

### Feature: Accessibility and layout

**Purpose:** the voting arena and lobby are built to be usable with keyboards and screen readers.

**How to Access:** anywhere.

**Steps:** 1. Navigate the lobby and arena with the Tab key and activate controls with Enter or Space. 2. Note the live regions: the countdown announces itself, and status changes are announced politely.

**Expected Result:** controls are reachable and labelled; the automated accessibility checks in the project's test suite cover the voting and lobby screens.

## 2.6 Common User Workflows

### Host: full public tournament

```text
Sign in as admin
  -> Create Session (title, timer, 7 or more entries, Public)
  -> Share (give voters the code or QR)
  -> Watch the lobby headcount rise
  -> Start
  -> (optional) advance rounds manually with Next, or let timers run
  -> Resolve any second tie with Pick winner or Coin flip
  -> Champion declared, status becomes completed
  -> Open the results page: publish toggle N/A (public), turnout report available
  -> Archive (two confirmations)
```

### Voter: public session

```text
Open the join link or /join
  -> Enter the 6 character code
  -> Lobby: enter a display name, join
  -> Wait (live headcount)
  -> Auto moved to the arena when voting opens
  -> Vote each round, watch each reveal
  -> Champion screen -> View Results
```

### Voter: secured session

```text
Open the link -> lobby asks you to sign in
  -> Register or sign in with email + 6 digit code
  -> Return to the lobby
  -> Allowlist mode: join immediately (if your email is listed)
     Approval mode: request to join, wait for the host's decision
  -> Vote like a public session once approved
```

### Reviewing the past

```text
History -> pick a tournament -> View Result Details
  -> champion banner, round timeline, totals panel
```

## 2.7 Errors and Troubleshooting

Only errors the application actually produces are listed.

| What you see | What it means | What to do |
| ------------ | ------------- | ---------- |
| "Code not found or no longer active." | The join code is wrong, the session finished, or it expired (pending sessions expire after 7 days) | Check the code with your host, or ask for a fresh one |
| "Too many requests, please wait." (join code screen) | More than 30 code lookups in a minute from your address | Wait a minute and try again |
| "Too many code requests. Please wait before trying again." | More than 5 code requests in an hour for one email, or 20 from your address | Wait for the announced time; a host can also raise the configured limits |
| "Please wait N seconds before requesting a new code." | The 60 second resend cooldown is active | Wait the countdown shown on screen, then use Resend |
| "Incorrect code. N attempts remaining." | Wrong verification code | Re read the email and enter the code again; after 5 failures the code locks |
| "This code is locked due to too many failed attempts. Please request a new code." | Five failed attempts used up the code | Request a new code |
| "This username is already taken." | Registration username collides with another account | Choose a different username |
| "Username must be 3 to 20 alphanumeric characters or underscores." | Username format is wrong | Use only letters, digits and underscores, length 3 to 20 |
| "This session is not available." | Wrong id, hidden secured session, or a session you may not read | Check the link; for secured sessions, sign in with an invited email or ask the host |
| "You must sign in with an email account to join this secured session." | A secured session refused an anonymous join | Sign in first, then rejoin |
| "Your email is not on the approved allowlist for this session." | Allowlist mode, your email missing | Ask the host to add your email |
| "Your join request was rejected by the organizer." | Approval mode, host rejected you | Contact the host |
| "This session has already started, so new joins are closed." (or "...join requests are closed.") | The roster locked at Start | Ask the host; voters who already joined may rejoin |
| "You have been removed from this session by the organizer." | The host removed you | Contact the host |
| "Voting is closed for this round." | Your vote arrived after the round closed | Wait for the next round |
| "Duplicate vote rejected: You have already cast a vote in this round." | One vote per round is enforced | No action needed; your first vote counts |
| "Authentication error: Voter token is required. Please re-join the session." | Your browser storage was cleared or the session reset | Rejoin from the lobby with your display name |
| "You are no longer eligible to vote in this session." | Secured session, and your approval was withdrawn at vote time | Contact the host |
| "Invalid administrator credentials." | Wrong admin username or password | Check the credentials issued by the operator |
| Login refused with a wait time | 5 failed admin logins from your address | Wait for the announced backoff (grows to a maximum of 60 seconds) |
| Admin screens say the session is gone | The server no longer accepts your stored admin credential | Sign in again at `/login` |
| History shows "Failed to Load History" with a retry button | The database was unreachable | Press Try Again once the server is healthy |
| OTP never arrives (no mail server) | Local development without SMTP configuration | Read the code from the backend console: `[OTP-DEV] Code <code> for <email>...` |
| "Service temporarily unavailable." on the join screen | The backend cannot reach its database | Ask the operator to check the server; retry shortly |
| "Unable to reach voting server. Please check your connection." | The app cannot reach the backend at all | Check your network and whether the backend is running |
| The app shows a 404 page | Unknown address in the browser | Use the top bar navigation instead |
| Backend says "Port 8090 is already in use" at startup | Another process holds the backend port | Stop the other process or change `PORT` |
