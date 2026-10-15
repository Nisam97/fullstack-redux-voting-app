# VoteSphere

## A Full Stack Real Time Voting Application Using Redux

---

### TITLE PAGE

**A PROJECT REPORT**

**ON**

**VOTESPHERE: A FULL STACK REAL TIME VOTING APPLICATION USING REDUX**

Submitted in partial fulfillment of the requirements for the award of the degree of

**[TO BE PROVIDED: degree and programme, for example Master of Computer Applications]**

**[TO BE PROVIDED: department and institution name]**

**[TO BE PROVIDED: university name]**

---

**BY**

**Nisam Rahman K**
Roll Number: 44

---

**[TO BE PROVIDED: guide name]**
Project Guide

---

**[TO BE PROVIDED: month and year of submission, for example October 2026]**

---

### CERTIFICATE

*Include this page only if the college requires it. Replace the whole text with the institution's own wording.*

**[TO BE PROVIDED: institution certificate wording. The certificate typically states that the project work titled VoteSphere was carried out by Nisam Rahman K under the guidance of the project guide during the academic year, and names the department, institution and university.]**

---

### DECLARATION

I hereby declare that the project report entitled **VoteSphere: A Full Stack Real Time Voting Application Using Redux** submitted in partial fulfillment of the requirements for the award of the degree of **[TO BE PROVIDED: degree]** is a record of original work carried out by me under the guidance of **[TO BE PROVIDED: guide name]**. This work has not been submitted elsewhere for the award of any other degree.

Place: **[TO BE PROVIDED]**
Date: **[TO BE PROVIDED]**

**Nisam Rahman K**
Roll Number: 44

---

### ACKNOWLEDGEMENT

I would like to express my sincere gratitude to the Almighty for giving me the strength and health to complete this project successfully.

I thank my project guide **[TO BE PROVIDED: guide name]** for the constant support, the valuable suggestions and the time spent in reviewing each stage of the work.

I thank the Head of the Department **[TO BE PROVIDED: HOD name]** and the principal **[TO BE PROVIDED: principal name]** of **[TO BE PROVIDED: institution name]** for providing the facilities and the encouraging environment needed to carry out this work.

I also thank the project review panel members for their feedback at each review, which helped improve the quality of the system. My sincere thanks go to my parents and my friends for their support and motivation throughout the course of this project.

**Nisam Rahman K**

---

### TABLE OF CONTENTS

*Page numbers are generated from heading styles when this document is prepared in the word processor. The list below gives the structure.*

| SI No | Contents | Page No |
| --- | --- | --- |
| | **FRONT MATTER** | |
| 1 | Certificate | |
| 2 | Declaration | |
| 3 | Acknowledgement | |
| 4 | Table of Contents | |
| 5 | List of Figures | |
| 6 | List of Tables | |
| 7 | Abstract | |
| | **CHAPTER 1: INTRODUCTION** | |
| 1.1 | Introduction | |
| 1.2 | Problem Statement | |
| 1.3 | Objectives of the System | |
| 1.4 | Scope and Relevance of the Project | |
| 1.5 | Organisation of the Report | |
| | **CHAPTER 2: SYSTEM ANALYSIS** | |
| 2.1 | Introduction | |
| 2.2 | Existing System | |
| 2.3 | Proposed System | |
| 2.4 | Feasibility Study | |
| 2.4.1 | Technical Feasibility | |
| 2.4.2 | Economic Feasibility | |
| 2.4.3 | Operational Feasibility | |
| 2.4.4 | Legal Feasibility | |
| 2.5 | Software Engineering Paradigm Applied | |
| 2.6 | Project Planning and Scheduling | |
| 2.7 | System Cost Estimation | |
| | **CHAPTER 3: SYSTEM DESIGN** | |
| 3.1 | Introduction | |
| 3.2 | Database Design | |
| 3.2.1 | Entity Relationship Model | |
| 3.2.2 | Data Dictionary | |
| 3.3 | Process Design: Data Flow Diagram | |
| 3.4 | Object Oriented Design: UML Diagrams | |
| 3.4.1 | Use Case Diagram | |
| 3.4.2 | Activity Diagrams | |
| 3.4.3 | Class Diagram | |
| 3.4.4 | Sequence Diagrams | |
| 3.5 | Modular Design | |
| 3.6 | Input Design | |
| 3.7 | Output Design | |
| | **CHAPTER 4: SYSTEM IMPLEMENTATION** | |
| 4.1 | Introduction | |
| 4.2 | Software Requirement Specification | |
| 4.3 | Hardware Requirement Specification | |
| 4.4 | Tools and Platforms | |
| 4.4.1 | Front End Tools | |
| 4.4.2 | Back End Tools | |
| 4.4.3 | Operating System | |
| 4.5 | System Architecture | |
| 4.6 | Coding | |
| 4.7 | Debugging | |
| | **CHAPTER 5: SYSTEM TESTING** | |
| 5.1 | Introduction | |
| 5.2 | Testing Procedures | |
| 5.3 | Test Plan and Test Cases | |
| 5.4 | Test Results | |
| | **CHAPTER 6: CONCLUSION AND FUTURE ENHANCEMENT** | |
| 6.1 | Conclusion | |
| 6.2 | Merits of the System | |
| 6.3 | Limitations of the System | |
| 6.4 | Future Enhancement of the System | |
| 6.5 | References | |
| | **ANNEXURE** | |
| A | Screenshots | |
| | Notes for the Author | |

---

### LIST OF FIGURES

| Figure No | Title | Chapter Section |
| --- | --- | --- |
| Figure 2.1 | Gantt chart of the project schedule | 2.6 |
| Figure 2.2 | PERT chart of task dependencies | 2.6 |
| Figure 3.1 | Entity relationship diagram of VoteSphere collections | 3.2.1 |
| Figure 3.2 | Data flow diagram, Level 0 | 3.3 |
| Figure 3.3 | Data flow diagram, Level 1 | 3.3 |
| Figure 3.4 | Data flow diagram, Level 2, voting round | 3.3 |
| Figure 3.5 | Use case diagram | 3.4.1 |
| Figure 3.6 | Activity diagram, voter sign in and join | 3.4.2 |
| Figure 3.7 | Activity diagram, voting round and tie ladder | 3.4.2 |
| Figure 3.8 | Class diagram of models and server modules | 3.4.3 |
| Figure 3.9 | Sequence diagram, voter joins and votes | 3.4.4 |
| Figure 3.10 | Sequence diagram, round close and advance | 3.4.4 |
| Figure 3.11 | Structure chart of the system modules | 3.5 |
| Figure 3.12 | State diagram, session lifecycle | 3.5 |
| Figure 3.13 | State diagram, round lifecycle | 3.5 |
| Figure 3.14 | Flowchart of the tie resolution ladder | 3.5 |
| Figure 4.1 | System architecture diagram | 4.5 |
| Figure 6.1 | Layered security diagram | 4.6 |

---

### LIST OF TABLES

| Table No | Title | Chapter Section |
| --- | --- | --- |
| Table 3.1 | User collection | 3.2.2 |
| Table 3.2 | Session collection | 3.2.2 |
| Table 3.3 | Result collection | 3.2.2 |
| Table 3.4 | OtpChallenge collection | 3.2.2 |
| Table 3.5 | SessionAllowlistEntry collection | 3.2.2 |
| Table 3.6 | SessionJoinRequest collection | 3.2.2 |
| Table 3.7 | VoteParticipation collection | 3.2.2 |
| Table 4.1 | Software requirement specification | 4.2 |
| Table 4.2 | Hardware requirement specification | 4.3 |
| Table 5.1 | Test plan and test cases | 5.3 |
| Table 5.2 | Automated test results, 13 October 2026 | 5.4 |
| Table 6.1 | References | 6.5 |

---

### ABSTRACT

Group decision making has moved from paper ballots and show of hands to computers, yet most digital polling tools still present the voter with one long ballot and a single decision. VoteSphere is a real time voting platform built for groups that need a fair and transparent way to choose between many candidates. It serves four kinds of people: an administrator who hosts a session, anonymous voters who join with only a display name, signed in voters who hold an emailed one time password (OTP) account, and public viewers who browse completed results.

VoteSphere replaces the long ballot with a pairwise tournament mode. When a session carries seven or more candidates, the system pairs them head to head, one matchup at a time, and round winners stay in the pool until one undisputed champion remains. Smaller contests of two to six candidates automatically use a single ballot mode, where every candidate appears on one ballot and the highest count wins, with an instant runoff when the top candidates tie. Voters join a session with a six character join code or a QR code link, wait in a lobby with a live headcount, and vote in timed rounds from any browser.

The administrator creates sessions from a protected panel, shares the join code, starts voting, watches turnout, resolves ties when the ladder calls for a decision, and publishes or withholds results. Every voting operation, the tallies, the timers, the round advancement and the duplicate vote checks, runs only on the backend, so the browser never computes a result. Completed sessions are stored in MongoDB, recover automatically after a restart, and appear in a public history archive, while secured session results stay private to approved participants and the administrator until they are published.

The platform is implemented as two packages, a React 19 client with Redux Toolkit and a Node.js backend that runs Redux over Immutable.js behind Socket.io, with MongoDB reached through Mongoose. A protected 39 line pure core holds the tournament mathematics, round history is persisted per round, and a layered security model combines JSON Web Token (JWT) authentication, OTP accounts, rate limits, timing parity and a fail closed result visibility matrix. The system was verified by 1484 automated tests and accessibility scans of the voting screens.

VoteSphere demonstrates that pairwise voting, long considered too complex for live use, can run fairly in real time over the web. It gives organisers an auditable result history, gives voters a fast and fatiguing free experience, and keeps every counting decision in one authoritative place.

---

# CHAPTER 1

## INTRODUCTION

### 1.1 Introduction

Group decision making is a routine part of academic, professional and social life. Clubs elect office bearers, departments choose award recipients, committees pick between proposals, and panels select the best entry in a competition. The methods used for these decisions have changed little over the decades: a paper ballot, a show of hands, or a simple majority counted by hand. Each of these methods works for small groups and simple choices, but each breaks down as the number of candidates grows or the participants are spread across locations.

Digital polling tools improved matters by moving the ballot to a screen, but most of them still present one long list of candidates and ask the voter for a single choice. When the list is long, voters tire, skip candidates they do not know, or vote against the options they fear rather than for the options they prefer. The result may satisfy the rules of voting theory while failing the people who voted. There is also little that an organiser can show afterwards: a final number, with no record of how it was reached.

VoteSphere is a full stack real time voting platform that addresses both sides of this problem. It runs two kinds of contests. A tournament mode pairs candidates head to head, one matchup at a time, and continues until one undisputed champion remains. A single ballot mode places every candidate on one ballot for smaller contests, with an instant runoff when the top candidates tie. Sessions are created by an administrator, shared with a six character join code or a QR code link, and run in timed rounds whose progress reaches every connected browser at the same moment.

The system serves four kinds of users. The **administrator** hosts sessions from a protected panel, shares the join code, starts voting, manages participants of secured sessions, resolves ties, and publishes results. An **anonymous voter** joins a public session with only a display name. A **signed in voter** holds a passwordless account created with an emailed one time password (OTP) and can take part in secured sessions. A **public viewer** browses completed results without any account at all. The implementation uses React 19 with Redux Toolkit on the client, Node.js with Redux over Immutable.js on the server, Socket.io for real time communication, and MongoDB through Mongoose for durable storage.

VoteSphere therefore closes a real gap. It brings the fairness of pairwise comparison, a method long discussed in voting theory but rarely offered in live tools, into an ordinary web browser, while keeping the counting, the timers and the record of the result in one authoritative place that the participants can trust.

### 1.2 Problem Statement

**Voter side problems.** A voter faced with a long ballot suffers from cognitive fatigue. Attention falls as the list grows, and the last candidates on the ballot receive less considered choices than the first. This fatigue encourages random selections and default choices. It also encourages tactical voting: a voter who prefers a similar but less popular candidate may abandon that preference to avoid splitting the vote, so the ballot records fear rather than preference. Similar candidates divide their shared support, and an alternative that few voters actually prefer can win a plurality. These are not failures of the voters; they are failures of the ballot design.

**Organiser side problems.** The organiser of a manual vote carries a different burden. Entries must be tabulated by hand, which invites arithmetic errors and disputes. A voter can be influenced to vote twice when no register of participation exists. Participants in different locations cannot be kept in step, so the vote stalls while counts are collected. When the result is challenged afterwards, the organiser has no auditable history to produce: only a final number, with no round by round record of how the contest unfolded. Existing online poll tools solve convenience but inherit the single long ballot, and they rarely provide the access controls that a closed group needs.

### 1.3 Objectives of the System

The objectives below were fixed before implementation and are verified again in Chapter 5 (testing) and Chapter 6 (conclusion).

1. **Dual voting modes.** Provide a pairwise tournament mode for sessions with seven or more candidates and an automatic single ballot mode for sessions with two to six candidates, so the ballot shape always fits the size of the contest.
2. **Server authority.** Keep every counting operation, the tallies, the quorum decisions, the timers and the round advancement, exclusively on the backend, so the browser only renders state and emits intent.
3. **Duplicate vote prevention.** Block a second ballot from the same voter in the same round through a composite key that combines the session, the round, the sorted pair and the voter token.
4. **Timed round lifecycle.** Run each round through a deterministic lifecycle of voting, round closed and results revealed, driven by server side timers with a configurable round length and a dedicated reveal window.
5. **Deterministic tie resolution.** Resolve ties through a fixed ladder: a first tie replays the matchup or runs a runoff, a second consecutive tie opens a 30 second window for the administrator, and an unattended window is resolved by a server coin flip.
6. **Controlled access.** Offer frictionless public joining with a six character join code and QR link, and offer secured sessions with an email allowlist or an approval queue backed by OTP voter accounts.
7. **Durable record.** Persist session metadata, results and round history in MongoDB, recover interrupted sessions at startup, and publish a public history archive of completed contests.
8. **Result visibility and audit.** Enforce one visibility matrix for every result read, keep secured results private until published, and record per round participation for the administrator without ever storing the vote choice.
9. **Hardening and accessibility.** Protect the public endpoints with rate limits and timing parity, restrict socket actions through an ingress allowlist, and keep the voting and lobby screens free of serious accessibility violations.

### 1.4 Scope and Relevance of the Project

**Voter facing scope:** joining a session by code or QR link, entering a display name or signing in with an OTP account, waiting in a lobby with a live headcount, voting in the arena during timed rounds, watching the countdown, seeing the revealed round result, and browsing the history archive of completed public sessions.

**Administrator scope:** signing in with a credential, creating public or secured sessions, choosing the timer length and the joining rule, sharing the join code and QR link, approving or rejecting participants, removing a participant, starting the session, resolving ties, watching the per round turnout panel, exporting turnout to a CSV file, publishing secured results, and archiving a finished session.

**Technical scope:** the React and Redux client, the Node.js and Socket.io server, the pure voting engine, the round and timer managers, the Redux store over Immutable.js, the MongoDB schemas and indexes, the OTP and cookie authentication, and the automated test suites for both packages.

**Out of scope.** The following are deliberately deferred and are not part of the delivered system: multiple administrators with role management, scheduled sessions with start and end times, migration of the administrator credential to an HttpOnly cookie, candidate photographs and voter avatars, social or single sign on login, ranked choice or multi select ballots, and deployment and hosting infrastructure.

**Fairness and Accuracy.** Pairwise comparison reduces the distortion caused by split votes, because a candidate must beat its nearest rival directly rather than benefit from a divided field.

**Transparency.** Every round result is frozen when the round closes and every closed round is appended to the stored history, so the final outcome can be explained round by round.

**Real time Participation.** A single server clock drives every connected browser, so all voters see the same countdown, the same matchup and the same reveal at the same moment, wherever they are.

**Auditability and Trust.** The participation record proves who voted in each round without recording how anyone voted, which supports turnout analysis while protecting the secrecy of the ballot.

### 1.5 Organisation of the Report

Chapter 1 introduces the project, states the problem, lists the objectives and defines the scope. Chapter 2 analyses the existing practice, describes the proposed system, presents the feasibility study, the engineering paradigm, the project schedule and the cost estimation. Chapter 3 explains the system design, covering the database design, the data flow diagrams, the UML diagrams, the modular design and the input and output design. Chapter 4 describes the implementation environment, the tools used, the architecture, the coding standards and the debugging carried out during development. Chapter 5 presents the testing procedure, the test plan and the results. Chapter 6 concludes the report, lists the merits, the limitations and the future enhancements, and gives the references.

---

# CHAPTER 2

## SYSTEM ANALYSIS

### 2.1 Introduction

System analysis is the stage of a software project in which the problem is studied before any solution is designed. It answers three questions: what exists today, what is wrong with it, and what a better system must do. Analysis produces the requirements that every later stage is measured against, and it protects the project from building the wrong thing well.

For VoteSphere, the analysis covered two areas. The first was the practice of group voting itself, including manual methods and generic online poll tools. The second was the existing repository state, which held a working pairwise engine and a browser mock with no backend, so the analysis also had to decide what to keep and what to build.

The outcome of the analysis is recorded in three forms: the problem statement of Chapter 1, the feature scope with eleven numbered features and a deferred list, and numbered specifications with acceptance criteria for each risky feature. The feasibility study, the schedule and the cost estimation that follow in this chapter were produced from the same record.

### 2.2 Existing System

Before VoteSphere, a group that wanted to vote among many candidates had four realistic options.

**Paper ballots.** Each voter receives a printed list and marks a preference. Paper is familiar and trusted, but counting is manual, spoiled ballots must be handled, and voters in different locations cannot take part at the same time.

**Show of hands.** The chair counts raised hands in the room. This is the fastest method of all, but it is public, so a voter cannot choose freely, and a large field of candidates makes raised hands hard to count and easy to dispute.

**Generic online poll tools.** A web form can collect choices quickly, but these tools normally offer a single long ballot, provide no meaningful access control beyond an unguessable link, and store only a final tally. They do not support a sequence of timed rounds, and they rarely offer any record of how the result was reached.

**The single long ballot approach.** Even a well built electronic ballot that lists every candidate at once places the whole burden of comparison on the voter. Voting theory identifies the familiar failure modes of such ballots, and they appear in practice whenever the candidate list grows.

**Limitations of the existing system:**

- **Cognitive fatigue:** the voter loses patience on a long list and resorts to random selection or to the first familiar name.
- **Tactical voting:** the ballot records a vote against a feared contender rather than a vote for the true preference, to avoid splitting a shared vote.
- **Split vote anomalies:** similar candidates divide their support, and an unrepresentative alternative wins a plurality.
- **Manual tabulation errors:** hand counting introduces arithmetic mistakes and disagreements that are hard to settle after the event.
- **Double voting:** without a register of participation, a voter can be influenced or enabled to vote more than once.
- **No live synchronisation:** participants at different locations wait while counts are collected by hand or by email.
- **No auditable result history:** only a final number survives, with no round by round record that a challenger could inspect.
- **Weak access control:** an unguessable link is the only gate most poll tools offer, so a closed group cannot restrict a vote to approved members.

### 2.3 Proposed System

VoteSphere replaces the long ballot with a contest structure. A session is created by the administrator with a title, a list of candidates, a round timer and an access rule. When the session has seven or more candidates the server runs it in tournament mode: two candidates face each other, the voters in the room choose between them, and the winner returns to the pool while the loser is eliminated. The bracket continues until one candidate remains. When a session has two to six candidates the server runs it in single ballot mode: every candidate appears on one ballot, the highest count wins, and a tie at the top triggers an instant runoff containing only the tied candidates.

Voting happens in rounds, and every round follows the same deterministic path. The round opens with a server side countdown. Voters submit their choice from any connected browser, and the choice is checked against the duplicate vote key before it is counted. The round closes when the timer expires or when every eligible voter has voted. The tally is frozen at that moment and stays hidden until the reveal window, when the result is shown to the room at once. The server then advances the bracket or concludes the session. If a round ends tied twice in a row, the administrator is given a 30 second window to pick a winner or flip a coin, and an unattended window is resolved by the server itself.

**Advantages of the proposed system:**

- **Two voting modes:** pairwise tournament for seven or more candidates and single ballot for two to six, chosen automatically from the candidate count.
- **Fair comparison:** a candidate must beat its nearest rival directly, which limits the effect of split votes.
- **Live synchronisation:** every browser receives the same state, countdown and reveal from one server clock.
- **Duplicate vote prevention:** the composite vote key blocks a second ballot in the same round and survives a server restart for signed in voters.
- **Controlled access:** public sessions need only a display name, while secured sessions accept an allowlist of email addresses or an approval queue.
- **Auditable history:** every closed round is stored as a frozen snapshot, and completed sessions appear in a public archive.
- **Turnout audit without exposure:** the administrator sees who voted in each round, never how they voted.
- **Crash recovery:** interrupted sessions are reset safely at startup and completed results are restored from the database.
- **Hardened public surfaces:** rate limits, timing parity and an ingress allowlist close the obvious routes to abuse.
- **Accessible interface:** the voting arena and lobby are scanned with automated accessibility checks so serious violations are caught during development.

### 2.4 Feasibility Study

A feasibility study decides whether a proposed system is worth building, and in what form. It examines the technology, the cost, the people who will use it, and the legal duties that apply. Each dimension is considered below for VoteSphere.

#### 2.4.1 Technical Feasibility

VoteSphere is technically feasible because every component is a mature, widely documented open source technology. The client uses React 19 with Redux Toolkit and React Router, and the server uses Node.js with the built in HTTP module and Socket.io 4. Redux over Immutable.js holds the authoritative state, MongoDB 6 or newer stores the data through Mongoose 9, and Nodemailer delivers OTP emails over SMTP with a console fallback for development. No component in this stack requires research or invention. The risky part of the system, the tournament mathematics, already existed as a small pure module and was kept unchanged and protected by a pinned hash. The remaining engineering is the integration of known parts, which the completed implementation and its 1484 automated tests confirm.

#### 2.4.2 Economic Feasibility

The whole stack is open source and free to use. The client and server run on ordinary development hardware, and MongoDB can run on the same machine, so no hosting or database licence is needed during development. Email delivery can use an existing SMTP account, and for local development no mail account is needed at all, because the server prints OTP codes to its own console. The main cost of the project is therefore the effort of the development team, which is estimated in Section 2.7. Against that cost the system replaces repeated manual voting with a tool that can be reused for any number of sessions at no per vote cost.

#### 2.4.3 Operational Feasibility

The system is designed for people who already use a browser. Voters need no account for public sessions, only a display name and the join code the administrator shares. Signed in voters request a six digit code by email and enter it once; the browser then holds a signed HttpOnly cookie for seven days. The administrator works from a single panel with forms and confirmation steps, and every destructive action, such as archiving a session, requires a second confirmation. Error messages are neutral and consistent, so a refused action always explains itself without leaking internal detail. These choices make the system operable by a non technical host and a mixed group of voters.

#### 2.4.4 Legal Feasibility

A voting system handles personal data, so its legal duties deserve attention. VoteSphere collects two kinds of personal data: voter email addresses, which are needed only for OTP delivery and for secured session eligibility, and voter display names, which appear in the lobby and in the turnout report. Email addresses are never sent to other voters: voter facing payloads are filtered, and the allowlist is visible only to the administrator. OTP codes are stored only as salted hashes and expire automatically, so a database reader cannot recover a working code. Participation records store the fact that a person voted in a round and never the choice, which protects the secrecy of the ballot. The system asks for an email address only when a feature needs it, and a public session never requires one. [TO BE PROVIDED: if the college requires a citation of the applicable data protection statute, insert it here; the repository does not name one.]

### 2.5 Software Engineering Paradigm Applied

A software engineering paradigm is the overall approach that governs how a project moves from requirement to delivered system. The classic choices are a sequential paradigm, where each stage completes before the next begins, and an iterative paradigm, where each cycle delivers a working slice of the product.

VoteSphere used an **incremental, test first paradigm built on the Tracer Bullet approach**. Each phase added one real, thin end to end strand through the full stack, from the browser form to the socket, the reducer, the database write and the broadcast, with nothing faked or stubbed. The alternative, building each layer completely before the next, was rejected because the risk in this project lived in the integration between real time state, timers and persistence, not in any single layer.

The build moved through ten numbered phases. Phase 0 cleaned the repository and defined the environment and the `SINGLE_BALLOT_MAX` constant. Phase 1 extended the session model with session type, voting mode and join code. Phases 2 to 5 added join code discovery, round history, the single ballot mode with its tie ladder, and eligibility with presence snapshots. Phases 6 to 8 added OTP accounts, secured sessions, and the result visibility matrix. Phase 9 hardened the public surfaces with rate limits, timing parity and accessibility work. Alongside these phases the project kept a working test suite: risky features followed a sequence of design, build, verify, test, and for the highest risk features an independent review and a documentation step. Every acceptance criterion carries a runtime record, so the claim that a feature is done is backed by a run, not by an opinion.

> [VISUAL-2.5, optional. Development process diagram. Purpose: show the ten phases and the design, build, verify, test, review, document sequence. Source: docs/scope/scope.md. To be created in the next stage.]

### 2.6 Project Planning and Scheduling

Planning a software project means deciding what will be built, in what order, by whom and by when. Poor scheduling does not merely delay a project; it changes what can be built at all, because time spent reworking early decisions is time taken from later features.

The planning of VoteSphere followed five steps, each mapped to what the repository records.

1. **Requirement analysis.** The existing repository was audited branch by branch, and a feature list was written with eleven numbered features and an explicit deferred list. The audit found that the server package was empty on the active branch while a preserved branch held the pure voting logic, so the plan began with recovery rather than with new code.
2. **Feasibility study.** The technology, the cost, the operational model and the legal duties were assessed as described in Section 2.4, which fixed the open source stack and the local database.
3. **System design.** Numbered specifications with acceptance criteria were written for every risky feature before it was built, covering the session model, join code discovery, round history, the tie ladder, eligibility, OTP accounts, secured sessions and the visibility matrix.
4. **Selection of tools and platforms.** React with Vite for the client, Node.js with Socket.io for the server, MongoDB with Mongoose for storage, Mocha and Vitest for testing. The tool versions are listed in Section 4.2.
5. **Resource and timeline planning.** The work was split into phases 0 to 9 with one feature each, and each phase closed only when its tests passed. The dates below are derived from the dated review logs, verification records and the project changelog in the repository, and are offered for the author to confirm.

| Phase | Work item | Derived dates, 2026 |
| --- | --- | --- |
| 0 | Repository audit, cleanup, environment bootstrap | 9 to 11 September |
| 0 | Backend recovery and real time server integration | 9 to 10 September |
| 0 | Client foundation, routing and Redux state | 10 September |
| 1 | Session model extension (specification 0001, review 22 September) | 21 to 22 September |
| 2 | Join code and discovery (review 24 September) | 23 to 24 September |
| 3 | Round history and full results | 25 September |
| 4 | Single ballot mode and tie ladder (review 26 September) | 25 to 26 September |
| 5 | Eligibility and presence (review 28 September) | 27 to 28 September |
| 6 | Accounts and OTP (review 29 September) | 28 to 29 September |
| 7 | Secured sessions (reviews 3 and 4 October) | 2 to 4 October |
| 8 | Visibility and privacy (verification 5 October) | 4 to 5 October |
| 9 | Hardening, accessibility and documentation (verification 6 October, test pass 7 October) | 6 to 7 October |
| 9 | Regression, report writing and final verification | 8 to 13 October |

A **Gantt chart** is a bar chart that shows each task against a calendar, so the reader can see duration and overlap at a glance. The tasks plotted are the phases in the table above.

> [VISUAL-6.3 — Gantt chart. Purpose: plot the fourteen tasks of the table above against the calendar from 9 September to 13 October 2026. Source: dates derived from docs/reviews/ and docs/CHANGELOG.md, to be confirmed by the author. To be created in the next stage.]

A **PERT chart** is a network diagram that shows tasks as nodes and dependencies as arrows, so the longest chain, the critical path, becomes visible.

**Critical Path:** the protected engine, then the reducer, then the round manager, then the socket server, then the client arena, then persistence, then the results and history surfaces, and finally hardening. Any slip on this chain delays the delivery directly, because each of these steps consumes the output of the one before it.

**Task Dependencies:** the round manager depends on the engine, because it calls the pure `next` function to advance the bracket. The client arena depends on the socket contract, because it renders only server state. The visibility matrix depends on the persistence layer, because it decides which stored rows a caller may read.

**Parallel Tasks:** the client and the server workstreams ran side by side from September onwards, and documentation was maintained continuously rather than at the end, which is why each phase carries its own changelog entry.

**Milestones:** the first end to end vote over a live socket (10 September), the first full public tournament with timers (25 September), the first OTP secured session (29 September), and the final green test run of both suites (13 October).

> [VISUAL-6.4 — PERT chart. Purpose: show the dependency network and the critical path described above. Source: scope phases and specification numbering. To be created in the next stage.]

### 2.7 System Cost Estimation

Cost estimation answers how much effort a system will need before it is built. VoteSphere is estimated with the Function Point method, which measures size from the functionality a user sees rather than from lines of code, so the estimate can be made before implementation and checked afterwards. The five component types are **External Inputs**, transactions that bring data into the system; **External Outputs**, transactions that send data out; **External Inquiries**, read only requests with a response; **Internal Logical Files**, the data the system stores and maintains; and **External Interface Files**, reference data maintained outside the system but used by it.

The counts below were taken from the implemented system: the fourteen socket action types accepted by the server plus the HTTP forms give the inputs, the REST read endpoints give the inquiries, the server to client real time events give the outputs, the seven MongoDB collections give the internal files, and the email service gives the external interface.

| Component | Count in VoteSphere | Average weight | Weighted points |
| --- | --- | --- | --- |
| External Inputs | 20 (14 socket actions, 6 HTTP forms) | 4 | 80 |
| External Outputs | 10 (real time broadcast events) | 5 | 50 |
| External Inquiries | 9 (REST GET endpoints) | 4 | 36 |
| Internal Logical Files | 7 (MongoDB collections) | 10 | 70 |
| External Interface Files | 1 (email service) | 7 | 7 |
| **Unadjusted Function Points** | | | **243** |

The fourteen General System Characteristics are then rated from 0 (no influence) to 5 (strong influence). These ratings are the author's assessment of the delivered system and are stated here so an examiner can re rate them.

| No | Characteristic | Rating | No | Characteristic | Rating |
| --- | --- | --- | --- | --- | --- |
| 1 | Data communication | 4 | 8 | Online update | 2 |
| 2 | Distributed data processing | 0 | 9 | Complex processing | 3 |
| 3 | Performance | 3 | 10 | Reusability | 4 |
| 4 | Heavily used configuration | 2 | 11 | Installation ease | 2 |
| 5 | Transaction rate | 3 | 12 | Operation ease | 3 |
| 6 | Online data entry | 4 | 13 | Multiple sites | 0 |
| 7 | End user efficiency | 3 | 14 | External design | 3 |

The sum of the fourteen ratings is 36, so the Value Adjustment Factor is 0.65 + (0.01 x 36) = 1.01, and the adjusted size is 243 x 1.01 = **245 Function Points**.

Effort is then estimated as Function Points divided by team productivity. [TO BE PROVIDED: the team's measured productivity in hours per function point, or the cost per person month, if the college requires an effort or rupee figure. The repository records no productivity or cost rate, so none is claimed here.]

---
# CHAPTER 3

## SYSTEM DESIGN

### 3.1 Introduction

System design translates the requirements of Chapter 2 into a shape that can be built: the data the system holds, the flows that move it, the objects that manipulate it, and the screens that present it. The design of VoteSphere is governed by one principle that shapes every other decision: **the server is authoritative**. The browser renders state and emits intent, and it never computes a tally, a quorum or an advancement of its own.

The system has four kinds of actors. The **administrator** signs in with a credential and holds the only rights that can change a session's lifecycle. An **anonymous voter** presents a display name and receives a session scoped token. A **signed in voter** holds an OTP verified account and a signed cookie, which is what allows entry to secured sessions. A **public viewer** reads only what the visibility matrix releases.

The architecture is client server. A request from the browser travels over one of two channels: an HTTP REST call for reads and for the few enrolment steps, and a Socket.io connection for everything that happens during a live session. Every client intent arrives at the server as a Redux action on the socket, passes an ingress guard, reaches the reducer, produces new immutable state, and is then serialised, guarded for tally visibility and broadcast to the room before being written to MongoDB.

Access is role based at every layer. The admin JWT opens the thirteen administrative actions, a valid session voter token opens the vote action, and the result visibility matrix decides which stored rows each caller may read. Security is emphasised throughout the design rather than added afterwards: the ingress allowlist, the duplicate vote key, the timing floor and the fail closed reads all originate in design decisions in this chapter.

### 3.2 Database Design

The data of VoteSphere is stored in MongoDB, a document database, through the Mongoose library. A document database groups related data into collections of JSON style documents rather than into tables of rows, which suits a voting system because a round result is naturally a small document that belongs inside its session result.

#### 3.2.1 Entity Relationship Model

An entity relationship (ER) diagram names the entities of a system, their attributes and the relationships between them. An **entity** is a thing about which data is held, such as a session. An **attribute** is a property of an entity, such as the session title. A **relationship** links two entities, and its **cardinality** says how many instances of one may relate to how many of the other. **Existence** dependency describes whether an entity can survive without the related one.

VoteSphere uses seven collections. Because the database is document oriented, the ER model is expressed in two ways. Some relationships are **references**, in which one document stores the identifier of another, exactly as a foreign key would in a relational design: a join request references its user, and a vote participation references its user. Other relationships are **embedded sub-documents**, in which the child documents live inside the parent: `Session.candidateInfo[]` holds the name and description of each candidate inside the session, and `Result.rounds[]` holds one frozen snapshot per closed round inside the result. Embedding was chosen where the child is always read together with the parent and never updated independently, which is true of both candidate details and closed round snapshots.

The cardinalities are as follows. One user may hold many join requests across sessions, and one session may hold many join requests, so the relationship is one to many from user to request within a session. One session has one allowlist of many entries, and one session has one result document containing many round snapshots. A vote participation belongs to one session, one round and one user, and the unique compound index on that triple makes a second participation record for the same round impossible.

> [VISUAL-3.2.1 — ER diagram. Purpose: show the seven collections, the reference relationships (SessionJoinRequest to User, VoteParticipation to User) and the embedded sub-documents (Session.candidateInfo, Result.rounds). Source: voting-server/src/db/models/. To be created in the next stage.]

#### 3.2.2 Data Dictionary

The data dictionary lists every field of every collection with its type, its size where the schema constrains one, its constraints and its meaning. The tables below were transcribed from the Mongoose schema files in `voting-server/src/db/models/`.

**Table 3.1 — User collection (`users`)**

| Field name | Data type | Size | Constraints | Description |
| --- | --- | --- | --- | --- |
| email | String | – | required, unique, indexed, lowercased, trimmed | Email address of the voter, used for OTP delivery |
| username | String | 3 to 20 | required, unique, indexed, trimmed, alphanumeric or underscore | Public handle chosen at registration |
| name | String | 1 to 80 | required, trimmed | Display name of the voter |
| createdAt | Date | – | default now, managed by timestamps | Account creation time |
| updatedAt | Date | – | managed by timestamps | Last profile change |

**Table 3.2 — Session collection (`sessions`)**

| Field name | Data type | Size | Constraints | Description |
| --- | --- | --- | --- | --- |
| sessionId | String | – | required, unique, indexed | Identifier assigned by the server |
| title | String | – | default empty | Title shown in the lobby and results |
| entries | Array of String | – | required | Original candidate roster, preserved against tournament reduction |
| status | String | – | required, indexed, default `pending`, enum `pending`, `open`, `completed`, `archived` | Lifecycle stage of the session |
| winner | String | – | default null | Champion, set when the session completes |
| timerDuration | Number | – | default 30, minimum 5, maximum 300 | Round length in seconds |
| type | String | – | required, default `public`, enum `public`, `secured` | Visibility class of the session |
| votingMode | String | – | required, default `tournament`, enum `single_ballot`, `tournament` | Mode derived from the candidate count at creation |
| joinCode | String | 6 | partial unique index over pending and open sessions only | Short code shared with voters |
| whoCanJoin | String | – | default `public`, enum `public`, `allowlist`, `approval` | Entry rule for a secured session |
| candidateInfo | Array of embedded | name 80, description 80 | default empty | Name and short description of each candidate |
| publishResultsPublicly | Boolean | – | required, default true | Whether a completed result joins the public archive |
| pendingExpiresAt | Date | – | default null, time to live index, pending only | Expiry moment used to delete abandoned pending sessions |
| createdAt | Date | – | default now | Creation time |
| updatedAt | Date | – | default now | Last update time |
| completedAt | Date | – | default null | Completion time |
| archivedAt | Date | – | default null | Archive time |

**Table 3.3 — Result collection (`results`)**

| Field name | Data type | Size | Constraints | Description |
| --- | --- | --- | --- | --- |
| sessionId | String | – | required, indexed | Session this result belongs to |
| title | String | – | default empty | Title copied at completion |
| entries | Array of String | – | required | Full original roster, read back from the session |
| winner | String | – | nullable | Champion, or null for a `no_result` conclusion |
| completedAt | Date | – | default now, indexed descending | Completion time, drives the archive order |
| type | String | – | required, default `public`, indexed, enum `public`, `secured` | Mirrors the session type at completion |
| publishResultsPublicly | Boolean | – | required, default false, indexed | The administrator's publish switch |
| rounds | Array of embedded | – | default empty | One frozen snapshot per closed round: `roundIndex`, `kind` (enum `pairwise`, `single_ballot`), `candidates`, `tally`, `totalVotes`, `closedAt`, `resolution` (enum `majority_win`, `tie_advance`, `runoff`, `admin_pick`, `coin_flip`, `no_result`, `zero_vote_replay`), `advanced` |

The collection carries three indexes: `completedAt` descending, the pair `sessionId` with `completedAt` descending, and the compound `type`, `publishResultsPublicly`, `completedAt` that the history query uses.

**Table 3.4 — OtpChallenge collection (`otpchallenges`)**

| Field name | Data type | Size | Constraints | Description |
| --- | --- | --- | --- | --- |
| email | String | – | required, indexed, lowercased, trimmed | Address the code was requested for |
| codeHash | String | – | required | Salted SHA-256 hash of the code; the code itself is never stored |
| salt | String | – | required | 16 random bytes in hex, one per challenge |
| expiresAt | Date | – | required, time to live index | Expiry moment; expired rows delete themselves |
| attempts | Number | – | minimum 0, default 0 | Failed verification count, locks at 5 |
| lastSentAt | Date | – | required, default now | Drives the 60 second resend cooldown |
| consumedAt | Date | – | default null | Set when the code is used successfully |
| pendingName | String | – | default null, trimmed | Display name carried from the registration form |
| pendingUsername | String | – | default null, trimmed | Username carried from the registration form |

**Table 3.5 — SessionAllowlistEntry collection (`sessionallowlistentries`)**

| Field name | Data type | Size | Constraints | Description |
| --- | --- | --- | --- | --- |
| sessionId | String | – | required, indexed, part of unique compound | Session the entry belongs to |
| email | String | – | required, lowercased, trimmed, part of unique compound | Approved address |
| addedAt | Date | – | default now | When the address was added |

**Table 3.6 — SessionJoinRequest collection (`sessionjoinrequests`)**

| Field name | Data type | Size | Constraints | Description |
| --- | --- | --- | --- | --- |
| sessionId | String | – | required, indexed, part of unique compound | Session the request targets |
| userId | ObjectId, reference to User | – | required, part of unique compound | The signed in voter asking to join |
| email | String | – | required, lowercased, trimmed | Email of the requester |
| displayName | String | – | default empty | Name shown to the administrator |
| status | String | – | required, default `pending`, enum `pending`, `approved`, `rejected` | Decision state |
| requestedAt | Date | – | default now | Request time |
| decidedAt | Date | – | default null | Decision time |

**Table 3.7 — VoteParticipation collection (`voteparticipations`)**

| Field name | Data type | Size | Constraints | Description |
| --- | --- | --- | --- | --- |
| sessionId | String | – | required, indexed, part of unique compound | Session the round belongs to |
| roundId | String | – | required, part of unique compound | Monotonic round identity |
| userId | ObjectId, reference to User | – | required, part of unique compound | The voter who voted; never the choice |
| createdAt | Date | – | default now | When the vote was cast |

The unique compound index on `sessionId`, `roundId` and `userId` is what makes the audit trail honest: a second participation row for the same voter in the same round cannot be written.

### 3.3 Process Design: Data Flow Diagram

A data flow diagram (DFD) shows how data moves through a system. It uses four symbols: an **external entity** is a person or system outside the boundary that produces or consumes data; a **process** transforms incoming data into outgoing data; a **data flow** is the arrow that carries data between the other symbols; and a **data store** is a place where data rests between flows. A DFD is drawn in levels, so that complexity is revealed gradually.

**Level 0** places the whole system in one process. The external entities of VoteSphere are the administrator, the voter, whether anonymous or signed in, the public viewer, and the email service, which is an external system that delivers OTP codes. The single process is VoteSphere itself, and the data stores are the seven MongoDB collections together with the in memory Redux store, which is authoritative while a session is live because the database is written to asynchronously after the state changes.

> [VISUAL-3.3-L0 — DFD Level 0. Purpose: one process for the whole system, with the four external entities and the eight data stores. Source: Architecture.md 1.3 and 1.7. To be created in the next stage.]

**Level 1** explodes the system into its main processes: session management, covering creation, join code generation and lifecycle transitions; identity and access, covering OTP requests, verification and eligibility checks; the voting engine, covering vote intake, round closing and tie resolution; and results and history, covering persistence, the visibility matrix and the archive. The flows between these processes and the stores are what Sections 3.5 describes as modules.

> [VISUAL-3.3-L1 — DFD Level 1. Purpose: show the four main processes and their flows to the eight data stores for the administrator and voter paths. Source: Architecture.md 1.7. To be created in the next stage.]

**Level 2** explodes one Level 1 process further. The voting round process is chosen here because it carries the project's risk: a vote arrives with a voter token, is validated by the ingress, checked against the duplicate key and the eligibility snapshot, counted by the reducer, and only then broadcast and persisted; the timer and the early completion check may close the round, which freezes the tally and starts the reveal.

> [VISUAL-3.3-L2 — DFD Level 2. Purpose: explode the voting round process into validation, counting, closing and reveal steps. Source: Architecture.md 1.7, 'Voting (both modes)'. To be created in the next stage.]

---
### 3.4 Object Oriented Design: UML Diagrams

The Unified Modelling Language (UML) describes a system as a set of diagrams, each answering one question about structure or behaviour. Four kinds are used here: the use case diagram says what the actors want, the activity diagram says how a flow proceeds, the class diagram says what the building blocks are, and the sequence diagram says in what order messages are exchanged.

#### 3.4.1 Use Case Diagram

A use case diagram shows the actors of a system and the goals each actor can reach. VoteSphere has four actors. The **administrator** can log in, create a session, share the join code and QR link, edit the candidate list, set the entry rule, manage the allowlist, approve or reject join requests, remove a participant, start the session, advance during a reveal, resolve a tie, view turnout, publish results and archive a session. An **anonymous voter** can resolve a join code, join a lobby with a display name, vote in an open round, watch the countdown and view public results. A **signed in voter** adds the use cases of requesting an OTP, verifying it, updating a profile, logging out, requesting to join a secured session, and reading a secured result that they participated in. A **public viewer** can browse the home page, resolve a join code and read the history archive.

> [VISUAL-3.5, Figure 3.5 — Use case diagram. Purpose: four actors with the use cases listed above, with the secured session use cases grouped under the signed in voter and the administrative use cases behind the admin login. Source: docs/scope/scope.md. To be created in the next stage.]

#### 3.4.2 Activity Diagrams

An activity diagram shows a flow of steps with decision nodes that branch it. Two flows of VoteSphere carry enough decisions to deserve one each.

**Voter sign in and join.** The voter opens the join link, and the system checks whether the session is public. A public session asks only for a display name, registers a random session token, and places the voter in the lobby. A secured session instead checks for a valid signed cookie; without one the voter is sent to the OTP path, where a code is requested, sent by email or printed to the server console in development, and verified. A failed verification loops back to the request step, and a locked challenge, after five failed attempts, ends the flow. With a valid identity the server checks the allowlist or the approval status; a rejection ends the flow with a neutral message, and an approval places the voter in the lobby.

> [VISUAL-3.6 — Activity diagram, voter sign in and join. Purpose: show the public and secured branches, the OTP loop and the eligibility decision. Source: Architecture.md 1.7 and 1.8. To be created in the next stage.]

**A voting round with the tie ladder.** The round starts with an eligibility snapshot and a server timer. Voters cast their choice, and the duplicate key decides whether each ballot is counted. The round closes when the timer expires or when every eligible voter has voted. The tally is frozen and then revealed. If one candidate leads, the resolution is a majority win and the bracket advances. If the candidates are tied, the ladder decides: a first tie replays the matchup, or runs a runoff ballot of the tied candidates in single ballot mode; a second consecutive tie opens the 30 second administrator window, where the administrator may pick a winner or flip a coin; if the window expires, the server flips the coin itself. A round with no votes at all replays once, and a second empty round ends the session with no result.

> [VISUAL-3.7 — Activity diagram, voting round and tie ladder. Purpose: show the close, reveal and tie ladder branches including the zero vote path. Source: Architecture.md 1.5 and 1.7. To be created in the next stage.]

#### 3.4.3 Class Diagram

A class diagram shows the classes of a system, their attributes and operations, and the relationships between them. One adaptation is needed for VoteSphere: the implementation is written in JavaScript modules and Mongoose schemas, not in language level classes, so the class diagram draws the **Mongoose models** as classes, with the fields of Section 3.2.2 as attributes, and adds the key server modules as component classes to show responsibility. The models are `User`, `Session`, `Result`, `OtpChallenge`, `SessionAllowlistEntry`, `SessionJoinRequest` and `VoteParticipation`. The module classes are the voting core, which exposes `setEntries`, `next` and `vote`; the ballot module, which adds single ballot initialisation, vote counting, totals, plurality detection and runoff derivation; the round manager, which owns the lifecycle constants, `closeRoundOnce`, `canCompleteEarly` and `resolveTieAuthoritative`; the timer manager, which owns the round, reveal and tie clocks; and the reducer, which holds every action case.

The relationships mirror Section 3.2.1: `Session` contains many `candidateInfo` values, `Result` contains many round snapshots, `SessionJoinRequest` and `VoteParticipation` reference `User`, and the allowlist is a set of `SessionAllowlistEntry` rows belonging to one session.

> [VISUAL-3.8 — Class diagram. Purpose: the seven models with their attributes, plus the five server module classes and their public operations. Source: voting-server/src/. To be created in the next stage.]

#### 3.4.4 Sequence Diagrams

A sequence diagram shows the participants of one scenario as vertical lifelines and the messages between them as horizontal arrows in time order. Two scenarios are drawn.

**Voter joins and votes.** The browser sends an HTTP join with the display name; the server registers the token, answers with it, and stores it in an HttpOnly cookie and in browser storage; the browser then opens the socket and emits the subscribe event; the server records presence and joins the room; when the voter chooses a candidate the browser emits the vote action with the token; the ingress guard validates the token, the session status, the round lifecycle and the duplicate key; the reducer counts the vote; the store subscriber serialises the change and broadcasts the new state to the room; and the repository layer writes the participation row for a signed in voter.

> [VISUAL-3.9 — Sequence diagram, voter joins and votes. Purpose: the message order between browser, REST layer, socket server, ingress guard, Redux store and MongoDB for the join and vote scenario. Source: Architecture.md 1.7. To be created in the next stage.]

**Round close and advance.** The timer manager expires the round timer and calls the close function, which is idempotent, so a stale callback can never close a newer round; the close freezes `finalVote`, appends the round snapshot to the result, and starts the reveal timer; the tally guard empties the live tally in the outbound payload; on reveal expiry the server dispatches the advance action; the reducer either loads the next pair or completes the session; the store subscriber broadcasts the new lifecycle, and the repository writes the completion with the full original roster.

> [VISUAL-3.10 — Sequence diagram, round close and advance. Purpose: the message order between timer manager, round manager, Redux store, broadcast layer and MongoDB for the close, reveal and advance scenario. Source: Architecture.md 1.5 and 1.7. To be created in the next stage.]

### 3.5 Modular Design

Modular design splits a system into named modules, each with one responsibility and a narrow interface to the others. Its benefit is change: a defect in the tie ladder is fixed inside the round manager without touching the timer, and a new ballot type can be added beside `ballot.js` without disturbing the protected core. VoteSphere is designed as nine modules under one main control, the server entry point.

> [VISUAL-3.11 — Structure chart. Purpose: Level 0 main control with Level 1 sub-systems: session management, join code and discovery, voter identity and OTP, secured sessions, voting engine, round, timer and tie resolution, presence and eligibility, results, history and visibility, persistence and recovery. Source: the module list below. To be created in the next stage.]

**Module 1: Session Management.**

**Functions:** validate the create form, assign the session identifier, derive the voting mode from the candidate count, default the timer, set the entry rule and the expiry, and drive the lifecycle transitions pending to open to completed to archived.

**Logic:** the `CREATE_SESSION` action is validated at ingress for a non blank title, at least two distinct entries, a timer between 5 and 300 seconds, and a secured type that may not claim a public entry rule. The reducer builds the session as pending, and only `START_SESSION`, issued by an authenticated administrator, opens it. The archive step requires a second confirmation and releases the in memory voter data.

**Module 2: Join Code and Discovery.**

**Functions:** generate a six character code, guarantee its uniqueness against live sessions, resolve a code to session metadata, and rate limit the resolver.

**Logic:** codes are drawn from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, which excludes the confusable characters 0, O, 1, I and L, using a cryptographically secure random source. The resolver allows 30 requests per minute per address, holds every reply open for a minimum duration, and answers unknown, expired, archived and gated codes with the same 404 body, so timing and wording never reveal whether a code exists.

> [VISUAL-3.12 — State diagram, session lifecycle. Purpose: pending, open, completed and archived with the actions that cause each transition. Source: README.md, Session Lifecycle. To be created in the next stage.]

**Module 3: Voter Identity and OTP.**

**Functions:** issue and verify six digit codes, enforce the cooldown and the attempt limit, sign and verify the voter cookie, and mint session tokens for anonymous and signed in voters.

**Logic:** a code is generated with a secure random source, salted per challenge, stored only as a SHA-256 hash and given a time to live so expired rows delete themselves. Sixty seconds must elapse between sends, and five failed verifications lock the challenge. A verified voter receives the `vs_voter` cookie, which is HttpOnly, uses SameSite=Lax, gains the secure flag on HTTPS, and carries a seven day lifetime. Anonymous voters receive a random universal unique identifier that lives only in server memory.

**Module 4: Secured Sessions.**

**Functions:** maintain the allowlist, parse pasted email lists, hold the approval queue, approve, reject and remove participants, and recheck eligibility at every entry point.

**Logic:** a pasted list is parsed line by line, lowercased and diffed against the stored set, and a joined voter whose address disappears is revoked and disconnected. An approval request answers with a pending status until the administrator decides, and starting the session locks the roster by auto rejecting anything still pending. The same eligibility helper guards the REST join, the socket join, the room subscription and the vote itself, and it fails closed: an unreadable database means ineligible.

> [VISUAL-3.13 — State diagram, round lifecycle. Purpose: voting, round closed, results revealed and the tie pending branch, with the advance transition. Source: Architecture.md 1.5. To be created in the next stage.]

**Module 5: Voting Engine.**

**Functions:** hold the pairwise mathematics in the protected core, count single ballots in the ballot module, and decide the winner of a round.

**Logic:** the core is 39 lines of pure functions whose file carries a pinned SHA-256 hash and is never edited. In tournament mode the winner of a pair re joins the queue and the loser is eliminated, and the last entry standing is the champion. In single ballot mode every candidate is tallied at once and the candidates tied for first place form the runoff ballot. Keeping the single ballot mathematics in its own module is what allows the core to stay untouched.

**Module 6: Round, Timer and Tie Resolution.**

**Functions:** close a round exactly once, freeze the outcome, run the reveal, advance the bracket, and operate the tie ladder.

**Logic:** round identity is the monotonic string of session and round index, and the close function is idempotent, so a late timer callback cannot close a newer round. The reveal duration defaults to one second in code, is configurable between 1 and 60 seconds, and the example configuration sets 10 seconds. The tie ladder replays a first tie, opens a 30 second window on a second, and resolves an unattended window with its own coin flip through a single resolution path shared by the administrator action and the timer.

> [VISUAL-3.14 — Flowchart, tie resolution ladder. Purpose: first tie, second tie, administrator window, coin flip and the zero vote path. Source: README.md Key Feature 3. To be created in the next stage.]

**Module 7: Presence and Eligibility.**

**Functions:** track connected voters, snapshot the eligible set at the start of each round, and decide whether a round may complete early.

**Logic:** presence is a map of session to voter key to socket identifiers and a last seen time. The snapshot taken at round start does not change during that round, so a voter who joins late becomes eligible only from the next round. A voter disconnected for more than the 10 second grace window drops out of the early completion count, while a voter who reconnects before the round closes still counts, so disconnected ghosts can neither block nor fake a full turnout. Broadcasts expose only headcount numbers, never tokens or socket identifiers.

**Module 8: Results, History and Visibility.**

**Functions:** guard the outbound tallies, serve the result and round reads, list the history archive, decide visibility for every caller, and build the turnout report and its CSV export.

**Logic:** the tally guard releases the round history as soon as a round closes, because every closed round was already broadcast, and keeps the live tally and the frozen outcome hidden until the reveal. The visibility resolver is the single decision for every result read: a public result is always visible, a secured result is visible to its approved participants and the administrator until it is published, and a result whose type cannot be resolved is gated as secured. A caller who may not see a result receives the same 404 a missing result receives.

**Module 9: Persistence and Recovery.**

**Functions:** write new sessions, status transitions, completions, join code refreshes and roster edits to MongoDB, append round snapshots idempotently, and recover the store at startup.

**Logic:** each write passes through a per session queue, so concurrent lifecycle transitions cannot land out of order, and status transitions may never regress, so an open session cannot overwrite a completed one. Round snapshots are guarded by the round index, so a repeated write appends nothing. At startup, pending and completed rows reload into the store, open rows reset to pending because a mid round state cannot be rebuilt, and a startup backfill gives legacy results the type they lacked, so the visibility matrix can gate them correctly.

### 3.6 Input Design

Input design decides what the user types, where, in what format, and how it is checked. Good input design removes errors before they reach the database, and it never asks for data the system does not need.

- **Create session form:** title, optional identifier, round timer between 5 and 300 seconds, at least two distinct candidate entries, session type of public or secured, entry rule of public, allowlist or approval, and for a secured session an initial allowlist of email addresses pasted as comma or newline separated values. The form shows a live note of which voting mode the candidate count will select.
- **Join code:** six characters drawn from the safe alphabet, typed on the join page or carried inside the join link and the QR code.
- **Display name:** a non empty name for a public session, stored with the session token and shown in the lobby headcount and the turnout report.
- **OTP request:** an email address, and optionally a display name and a username of 3 to 20 alphanumeric or underscore characters.
- **OTP code:** six digits entered on the verify step, valid for 10 minutes by default and accepted at most five times.
- **Administrator credentials:** a username and a password, checked against a bcrypt hash and throttled after five failures per address bucket.
- **Vote selection:** one candidate choice in the arena, submitted as a socket action and locked locally for the current pair once cast.

Validation is applied in three layers. The **client** checks form shape and gives immediate feedback, so an obvious mistake never leaves the browser. The **server ingress** re checks every field independently, because client checks are advisory: the timer range, the entry count, the enums and the identifier format are all verified again before the reducer sees the action. The **parser** layer handles pasted allowlists, splitting lines, trimming and lowercasing each address, and reporting rejected lines by number so the administrator can correct them.

### 3.7 Output Design

Output design decides what the system shows, when, and in what form, so that each user sees exactly what their role requires and nothing more.

- **Live countdown:** a minutes and seconds clock rendered from the server expiry time, which turns to a warning style at 10 seconds and a critical style at 5 seconds. It never counts on its own.
- **Lobby headcount:** the number of connected voters, updated live, showing only counts and never identities to other voters.
- **Round results chart:** a bar chart of the revealed tally for the frozen pair or ballot, rendered with the Recharts library.
- **Round timeline and totals panel:** every closed round with its resolution label, and the accumulated per candidate totals across the tournament.
- **Winner banner:** the champion at conclusion, with the full round history beneath it.
- **History archive:** the list of completed public sessions, each linking to its stored result, newest first.
- **Turnout panel and CSV export:** per round participation for the administrator only, downloadable as a CSV file whose cells are guarded so a display name cannot become a spreadsheet formula.
- **Error and status messages:** neutral, consistent wording for refused actions, identical 404 bodies for unknown and gated reads, and rate limit answers that carry a retry time.

**Design principles followed.** **Consistency:** the same state renders the same way on every screen, so a voter who knows one page can use the next. **Minimalism:** a screen shows only what the current phase requires, and tallies are removed from the live page entirely rather than hidden with styling. **Error handling:** every refusal carries a stable machine readable code for the client and a human sentence for the user, and an expired administrator credential produces a clear session expired state instead of an empty screen. **Clarity:** technical states are translated, so a voter sees that voting is closed rather than reading an internal lifecycle constant.

---
# CHAPTER 4

## SYSTEM IMPLEMENTATION

### 4.1 Introduction

Implementation converts the designs of Chapter 3 into a running system. The pattern that governs VoteSphere is a server authoritative Flux style architecture: data flows in one direction, from the browser to the server as an intent, through validation into the reducer, and back out to every browser as new state. The client never writes state of its own; it renders what the server broadcasts and emits what the server permits.

The project is delivered as two separate npm packages with no shared workspace tooling. `voting-client` is the browser application, and `voting-server` is the authoritative engine. They share no code, only a contract: the REST endpoints and the socket events listed in Section 4.5. This separation keeps the authority boundary physical, not merely conventional.

This chapter describes the environment the system runs in, the tools used at each tier, the architecture that binds them, the coding standards applied, sample code from the real implementation, and the debugging carried out during development.

### 4.2 Software Requirement Specification

The versions below are the ones pinned in the two `package.json` files of the repository.

**Table 4.1 — Software requirement specification**

| Label | Value |
| --- | --- |
| Frontend framework | React 19 with ES modules and JSX |
| Frontend state | Redux Toolkit 2, React Redux 9 |
| Routing | React Router DOM 7 |
| Charts | Recharts 3 |
| Real time client | Socket.io client 4, websocket transport with polling fallback |
| Icons and QR codes | lucide-react, react-icons, qrcode |
| Styling | Plain CSS files per component, no CSS framework |
| Build tool | Vite 8 with @vitejs/plugin-react |
| Lint | ESLint 10 with react hooks and react refresh plugins |
| Language | JavaScript, ECMAScript modules |
| Backend runtime | Node.js 18 or newer, with @babel/register at startup |
| Backend HTTP | Node built in http module, no Express |
| Backend state | Redux 5 over Immutable.js 3 |
| Real time server | Socket.io 4 |
| Database | MongoDB 6 or newer, through Mongoose 9 |
| Admin authentication | jsonwebtoken 9, bcrypt 6 |
| Email delivery | Nodemailer 10 over SMTP, console fallback in development |
| Allowlist parsing | csv-parse 7 |
| Backend test tools | Mocha 10, Chai 4, chai-immutable, mongodb-memory-server 11 |
| Frontend test tools | Node built in test runner, Vitest 5, jsdom 29, Testing Library React 16, axe-core 4 |
| Operating system used for development | [TO BE PROVIDED: operating system of the development machine] |
| IDE / editor | [TO BE PROVIDED: editor used, for example Visual Studio Code] |
| Documentation tool | Markdown, prepared into this report |

### 4.3 Hardware Requirement Specification

The system is a web application, so its hardware needs are modest and split between the machine that runs it and the machines that use it.

**Table 4.2 — Hardware requirement specification**

| Item | Requirement |
| --- | --- |
| Processor | [TO BE PROVIDED: processor of the development machine, for example Intel Core i5 or equivalent] |
| RAM | [TO BE PROVIDED: memory of the development machine, for example 8 GB or 16 GB] |
| Hard disk | [TO BE PROVIDED: free disk space, for example 5 GB for the two packages, MongoDB data and logs] |
| Display | [TO BE PROVIDED: display resolution, for example 1366 x 768 or higher] |
| Internet | Required for voters joining from other machines; not required when every browser runs on the host machine |
| Client machine | Any modern browser on a desktop, laptop, tablet or phone; no installation required |

### 4.4 Tools and Platforms

This section names each tool, defines what it is, and states how it is used in this project.

#### 4.4.1 Front End Tools

**React** is a JavaScript library for building user interfaces from reusable components. VoteSphere uses React 19 for every screen, from the home page to the voting arena, with function components and hooks throughout.

**Redux Toolkit** is the official toolset for state management with Redux. It provides the store, the slice pattern and the action creators. The client keeps three slices: the normalised sessions slice, the history slice and the voter authentication slice. Session data is kept under a `bySessionId` map rather than promoted to the top level, and a normaliser strips every token and secret from anything the server sends before it can reach state.

**React Router** handles the client route table, from the public pages to the guarded administrator route, and restores a signed in voter from the cookie when the application mounts.

**Recharts** draws the round result chart and the totals panel. It is used only for revealed data: while a round is live the chart has no data at all, because the tally never reaches the browser before the reveal.

**Socket.io client** holds the single connection to the server, attaches the administrator token at the handshake when one exists, restores every room subscription after a reconnect, and forwards server events into Redux.

**Vite** builds and serves the client. During development it runs the development server on port 5173, and for production it emits a bundled build to the `dist` folder.

**Plain CSS** styles each component and page in its own file. No CSS framework is used, which keeps the stylesheet vocabulary small and local.

**The qrcode library** renders the join link as a QR code in the share modal, so a voter in the same room can join by scanning instead of typing.

#### 4.4.2 Back End Tools

**Node.js** is the server runtime. It executes the server package as ES modules, and its built in libraries provide the cryptographic random source, the hashing routines and the HTTP server itself.

**The http module** serves every REST route. There is no web framework: one request handler matches the URL path by hand, which keeps the entire request surface of the system visible in a single file.

**Socket.io** carries the real time layer on the same port as the HTTP server. It provides rooms per session, reconnection support and acknowledgement callbacks, which the publish toggle uses to move only after the server confirms.

**Redux over Immutable.js** holds the authoritative state. Immutable data structures make state transitions cheap to detect and impossible to mutate by accident, which is what allows the store subscriber to compare snapshots and broadcast only real changes.

**MongoDB and Mongoose** provide storage. Mongoose declares the seven schemas, their enums, their required fields and their indexes, so the database rejects structurally invalid documents even if application code were bypassed.

**jsonwebtoken** signs and verifies the administrator JWT and the voter cookie JWT, which use two separate secrets so that one cannot impersonate the other.

**bcrypt** hashes the administrator password, so the credential cannot be recovered from any storage the system holds.

**Nodemailer** delivers OTP emails over SMTP, and reports failure honestly, so the request route can refuse instead of pretending a code was sent.

**csv-parse** parses pasted allowlists line by line, which is safer and clearer than splitting strings by hand.

#### 4.4.3 Operating System

An operating system is the software layer that manages hardware and hosts applications. VoteSphere is cross platform by construction: Node.js, MongoDB and Vite all run on Windows, macOS and Linux, and the browser client has no operating system dependency at all. The development machine ran **[TO BE PROVIDED: development operating system]**. Deployment is deliberately out of scope for this project, so no production operating system is claimed; the system is suitable for any host that can run Node.js 18 or newer and MongoDB 6 or newer.

### 4.5 System Architecture

The system has three parts: the browser, the Node.js server, and the database, with the email service beside them as an external dependency.

```text
Browser (React 19 + Redux Toolkit, port 5173)
  |
  |  REST fetch (JSON, credentials for cookies)
  |  Socket.io (websocket with polling fallback, port 8090)
  v
Node HTTP + Socket.io server (voting-server/src/server.js)
  |
  |  ingress guard (action allowlist, JWT checks)
  v
Redux store over Immutable.js (sessions.<sessionId> maps)
  |
  +--> pure engine core.js (protected, 39 lines, pinned SHA-256)
  +--> ballot.js (single ballot math)
  +--> roundManager.js (round lifecycle, tie ladder, eligibility)
  +--> timer.js (round, reveal and tie pending clocks)
  |
  |  store subscriber compares snapshots
  v
MongoDB via Mongoose (sessions, results, users, OTP challenges,
allowlist entries, join requests, vote participation)
```

The client uses the following routes: the public home, join, history, login and register pages; the guarded administrator panel; and the lobby, voting and results pages for a session, which are public routes whose real gating happens on the server. Legacy links redirect to the session routes, and any unknown address reaches a not found page.

The server answers fifteen REST endpoints, covering administrator login, session reads, the lobby read, voter join, the history archive, the result and rounds reads, the join code resolver, the turnout report and the OTP and profile steps. Its real time surface is one inbound action event, carrying one of the fourteen accepted action types, plus subscribe and unsubscribe events, and a set of outbound events that carry the registry, the room state, the lobby and presence counts, the timer, the tie pending signal and any action error.

> [VISUAL-4.1, Figure 4.1 — System architecture diagram. Purpose: show the browser, the Node.js server with its ingress guard and store, MongoDB, and the email service as an external system. Source: Architecture.md 1.3. To be created in the next stage.]

### 4.6 Coding

Coding in this project followed the standards below, each chosen to protect a specific property of the system.

#### 4.6.1 Coding Standards

- **Modularisation:** each responsibility lives in its own module, the core, the ballot maths, the round manager, the timer, the repository, the auth modules, the utilities, so that a change in one is provably local.
- **Meaningful naming:** identifiers carry their meaning, `closeRoundOnce`, `canCompleteEarly`, `resolveResultVisibility`, `buildVoteKey`, so the code reads as intent rather than as mechanics.
- **Immutability:** reducers never mutate the state they receive. Every transition returns a new structure, which makes the snapshot comparison in the store subscriber exact.
- **Protected core:** the voting mathematics in `voting-server/src/core.js` is 39 lines long and carries a pinned SHA-256 hash, `b479f3f0b90c5bd81e1a813b3c5753179efeecd08a531aa833000b65188fb310`. The file is never edited and no new behaviour is wrapped inside it; the single ballot maths lives in its own module so the core could stay frozen.
- **Server authority:** the browser never computes a tally, a quorum or an advancement, and no client claim is trusted on its own; the client check is a courtesy, the server check is the rule.
- **Lint discipline:** the client package is checked with ESLint on every change, and the build must exit cleanly.
- **Comments for critical logic:** comments appear where a reader could be misled, such as the idempotent close, the round scoped duplicate key, the visibility fallback and the TTL indexes.

#### 4.6.2 Sample Codes

The excerpts below are the real code of the project, taken from the files named above each listing.

**`voting-server/src/core.js` — the protected tournament engine, shown in full:**

```js
import {List, Map} from 'immutable';

export const INITIAL_STATE = Map();

export function setEntries(state, entries) {
  return state.set('entries', List(entries));
}

function getWinners(vote) {
  if (!vote) return [];
  const [a, b] = vote.get('pair');
  const aVotes = vote.getIn(['tally', a], 0);
  const bVotes = vote.getIn(['tally', b], 0);
  if      (aVotes > bVotes)  return [a];
  else if (aVotes < bVotes)  return [b];
  else                       return [a, b];
}

export function next(state) {
  const entries = state.get('entries')
                       .concat(getWinners(state.get('vote')));
  if (entries.size === 1) {
    return state.remove('vote')
                .remove('entries')
                .set('winner', entries.first());
  } else {
    return state.merge({
      vote: Map({pair: entries.take(2)}),
      entries: entries.skip(2)
    });
  }
}

export function vote(voteState, entry) {
  return voteState.updateIn(
    ['tally', entry],
    0,
    tally => tally + 1
  );
}
```

The whole engine is a pure function set over immutable structures: `next` takes the winner of the current pair back into the queue, declares a champion when one entry remains, and otherwise opens the next pair. `vote` increments one candidate's tally without touching anything else.

**`voting-server/src/auth/voter.js` — the duplicate vote key builder:**

```js
export function buildVoteKey(sessionId, pair, sessionToken, roundId) {
  const pairKey = Array.isArray(pair)
    ? [...pair].sort().join(':::')
    : String(pair || '');
  const roundPart = roundId ? `${roundId}:::` : '';
  return `${sessionId}:::${roundPart}${pairKey}:::${sessionToken}`;
}
```

The pair is sorted before it is joined, so the same matchup in either order produces the same key, and the round identifier scopes the key so a pair that meets again after a tie accepts fresh votes.

**`voting-server/src/auth/otp.js` — code generation, salting and hashing:**

```js
export function generateOtpCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

export function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

export function hashOtpCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}
```

Only the hash and the salt reach the database. The code itself exists in memory for the length of the request and, when no mail server is configured, in one console line.

**`voting-server/src/server.js` — the result visibility resolver:**

```js
export async function resolveResultVisibility({ result = null, sessionType = null,
  adminToken = null, voterCookie = null }) {
  const resolvedType = (result && result.type) || sessionType || null;
  const type = resolvedType || 'secured';   // fail closed

  if (type !== 'secured') {
    return { visible: true, viewerKind: 'public', type };
  }
  if (result && result.publishResultsPublicly === true) {
    return { visible: true, viewerKind: 'public', type };
  }
  if (adminToken && verifyAdminToken(adminToken).valid) {
    return { visible: true, viewerKind: 'admin', type };
  }
  if (voterCookie) {
    const auth = verifyVoterToken(voterCookie);
    if (auth.valid && auth.payload) {
      const eligible = await isApprovedParticipant({
        sessionId: result ? result.sessionId : null,
        voterUserId: auth.payload.userId,
        voterEmail: auth.payload.email
      });
      if (eligible) {
        return { visible: true, viewerKind: 'participant', type };
      }
    }
  }
  return { visible: false, viewerKind: 'denied', type };
}
```

One function decides every result read in the system, and its default is refusal: an unresolvable type is treated as secured, never as public.

#### 4.6.3 Code Validation and Optimization

Validation runs in layers. **Client checks** give immediate feedback on form shape. **Server ingress validation** re checks every field of every action: a non blank title, at least two distinct entries, a timer between 5 and 300 seconds, the allowed enums, and a verifiable administrator JWT for every administrative action regardless of what the client claims. **Schema validation** in Mongoose rejects structurally invalid documents at the database boundary, including enum values and the required fields. **Rate limits and the timing floor** protect the two public routes that answer questions about secrets, so brute force guessing is both slow and silent.

Optimization was applied where the design allowed it. The store subscriber serialises only sessions that actually changed, through an explicit allowlist of fields that also strips presence, tokens and secrets. Writes to MongoDB pass through one queue per session, so lifecycle transitions cannot land out of order under load. Round snapshots and completions are idempotent, so a repeated write appends nothing and a retry cannot duplicate history. Terminal sessions release their voter tokens, socket mappings and presence records, so memory does not grow with every completed contest.

### 4.7 Debugging

Debugging is the process of finding the cause of a defect and removing it, not merely its symptom. The defects below were found during development by the project's own review and test process. Each was recorded with its evidence before it was fixed, and each fix was confirmed by a regression test.

**The server started without its state.** During the recovery of the preserved backend, the server refused to start because the startup helper was called without the store argument, so the socket layer had no state to read. The call was corrected and a startup verification was added to the daily routine, so a broken boot is caught immediately rather than at the first vote.

**The client build broke on a circular import.** One results component imported itself, which broke the production build. The import was removed and the build was made part of the routine checks, so this class of error cannot return silently.

**The toolchain no longer matched the runtime.** The recovered backend used Babel 6 and Mocha 3, which failed on the installed Node.js version. The tooling was upgraded to Babel 7 and Mocha 10, and every existing test was kept green through the upgrade, proving that only the tooling had changed.

**Socket paths trusted a claimed identity.** An independent review found that two socket paths accepted a `userId` supplied by the client, so a malicious voter could claim another voter's identity and consume the victim's vote slot. The fix made `user:` prefixed tokens server derived only, taken from the verified cookie at the handshake, and a regression test now emits a forged identity and expects a refusal. The review that found it called it a blocker because it defeated the identity guarantee the whole account system rests on.

**The OTP route reported success when email failed.** The request route always answered with the same generic success, even when the mail transport had failed, so a production misconfiguration would have turned login into a silent brick while the cooldown punished every retry. The route now checks the delivery result, cancels the unusable challenge, and answers with a stable delivery failure code.

**Cooldown order punished the common correction.** A register request that fixed a taken username within 60 seconds was refused with a cooldown message, because the cooldown had started on the rejected attempt. The checks were reordered so that rejected validation requests leave the cooldown untouched.

**Removing a participant did not revoke the token.** A second review found that the remove action deleted the roster row but left the issued voter token valid, so a removed voter could still cast a counted vote, and a reconnect put them back into presence. The fix revokes the token at its source, disconnects the socket as the specification always promised, and adds a vote time eligibility re check for secured sessions, so the control fails closed on the correct side.

**An allowlist paste could not cut anyone off.** The same review showed that pasting a shortened allowlist updated the list but never touched the joined voter, so two controls that looked identical in the panel had different effects. Both removal paths now share one revocation helper, so there is a single way to cut a person off and it always works.

**A secret could fall back silently.** The voter cookie secret had a hard coded development fallback with no warning, which would have issued forgeable cookies in a careless deployment. Startup validation was added that throws in production when the secret is missing and warns in development, so the failure is loud and early.

---
<!-- CHAPTERS -->
