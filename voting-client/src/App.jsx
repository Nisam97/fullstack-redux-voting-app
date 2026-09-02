import { useState } from "react";

import {
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Home,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  User,
  Users,
  Vote,
  X,
  CalendarDays,
  Award,
  Lock,
  Mail,
  Phone,
  MapPin,
  Edit3,
  Save,
  Eye,
  EyeOff,
  ChevronDown,
} from "lucide-react";

import "./App.css";

/* =========================================================
   DATA
========================================================= */

const elections = [
  {
    id: 1,
    title: "Student Council Election 2026",
    description:
      "Choose the representatives who will lead and represent the student community.",
    category: "Student Council",
    candidates: 6,
    votes: 1248,
    ends: "2d 14h",
    status: "Live",
    color: "purple",
  },
  {
    id: 2,
    title: "Technology Club President",
    description:
      "Vote for the next president of the Technology & Innovation Club.",
    category: "Club Election",
    candidates: 4,
    votes: 782,
    ends: "1d 08h",
    status: "Live",
    color: "blue",
  },
  {
    id: 3,
    title: "Arts & Cultural Secretary",
    description:
      "Select your preferred candidate for Arts and Cultural activities.",
    category: "Cultural",
    candidates: 5,
    votes: 654,
    ends: "3d 02h",
    status: "Live",
    color: "pink",
  },
];

const candidates = [
  {
    id: 1,
    name: "Ananya Menon",
    role: "Independent",
    votes: 486,
    initials: "AM",
    description:
      "Focused on student welfare, campus innovation and stronger student representation.",
  },
  {
    id: 2,
    name: "Rahul Nair",
    role: "Progressive Students",
    votes: 392,
    initials: "RN",
    description:
      "Working toward better student facilities, events and technology initiatives.",
  },
  {
    id: 3,
    name: "Meera Joseph",
    role: "Student First",
    votes: 286,
    initials: "MJ",
    description:
      "Focused on academic support, inclusion and student engagement.",
  },
];

/* =========================================================
   APP
========================================================= */

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [voted, setVoted] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const handleNavigation = (page) => {
    setActivePage(page);
    setMobileMenu(false);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleVote = () => {
    if (!selectedCandidate) return;

    setVoted(true);
    setSelectedCandidate(null);
  };

  /* =======================================================
     PAGE RENDER
  ======================================================= */

  const renderPage = () => {
    switch (activePage) {
      case "Dashboard":
        return (
          <Dashboard
            elections={elections}
            candidates={candidates}
            voted={voted}
            selectedCandidate={selectedCandidate}
            setSelectedCandidate={setSelectedCandidate}
            handleVote={handleVote}
            handleNavigation={handleNavigation}
          />
        );

      case "Elections":
        return (
          <ElectionsPage
            elections={elections}
            candidates={candidates}
            selectedCandidate={selectedCandidate}
            setSelectedCandidate={setSelectedCandidate}
            voted={voted}
            handleVote={handleVote}
          />
        );

      case "Results":
        return (
          <ResultsPage
            elections={elections}
            candidates={candidates}
          />
        );

      case "My Votes":
        return <MyVotesPage voted={voted} />;

      case "Profile":
        return <ProfilePage />;

      case "Notifications":
        return <NotificationsPage />;

      case "Settings":
        return (
          <SettingsPage
            darkMode={darkMode}
            setDarkMode={setDarkMode}
          />
        );

      default:
        return <Dashboard />;
    }
  };

  return (
    <div className={darkMode ? "app dark" : "app"}>

      {/* ===================================================
          SIDEBAR
      =================================================== */}

      <aside
        className={
          mobileMenu
            ? "sidebar open"
            : "sidebar"
        }
      >

        {/* BRAND */}

        <div className="brand">

          <div className="brand-icon">
            <Vote size={23} />
          </div>

          <div>
            <h2>VoteSphere</h2>
            <span>Digital Democracy</span>
          </div>

          <button
            className="mobile-close"
            onClick={() => setMobileMenu(false)}
          >
            <X size={20} />
          </button>

        </div>

        {/* PROFILE */}

        <div className="profile-card">

          <div className="avatar">
            PN
          </div>

          <div>
            <strong>PS Nandhana</strong>
            <span>Verified voter</span>
          </div>

          <CheckCircle2 size={17} />

        </div>

        {/* =================================================
            MAIN MENU
        ================================================= */}

        <nav>

          <p className="nav-title">
            MAIN MENU
          </p>

          {[
            ["Dashboard", Home],
            ["Elections", Vote],
            ["Results", BarChart3],
            ["My Votes", CheckCircle2],
          ].map(([name, Icon]) => (

            <button
              key={name}
              className={
                activePage === name
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() =>
                handleNavigation(name)
              }
            >

              <Icon size={19} />

              <span>
                {name}
              </span>

              {name === "Elections" && (
                <b>3</b>
              )}

            </button>

          ))}

          <p className="nav-title second">
            ACCOUNT
          </p>

          {[
            ["Profile", User],
            ["Notifications", Bell],
            ["Settings", Settings],
          ].map(([name, Icon]) => (

            <button
              key={name}
              className={
                activePage === name
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() =>
                handleNavigation(name)
              }
            >

              <Icon size={19} />

              <span>
                {name}
              </span>

              {name === "Notifications" && (
                <i />
              )}

            </button>

          ))}

        </nav>

        {/* SIDEBAR BOTTOM */}

        <div className="sidebar-bottom">

          <div className="security-box">

            <ShieldCheck size={20} />

            <div>
              <strong>Secure Voting</strong>
              <span>
                Your vote is protected
              </span>
            </div>

          </div>

          <button className="logout">

            <LogOut size={18} />

            Sign out

          </button>

        </div>

      </aside>

      {/* ===================================================
          MAIN
      =================================================== */}

      <main className="main">

        {/* TOPBAR */}

        <header className="topbar">

          <button
            className="mobile-menu"
            onClick={() =>
              setMobileMenu(true)
            }
          >
            <Menu size={22} />
          </button>

          <div className="breadcrumb">

            <span>
              Workspace
            </span>

            <ChevronRight size={15} />

            <strong>
              {activePage}
            </strong>

          </div>

          <div className="top-actions">

            <button className="icon-btn">
              <Search size={19} />
            </button>

            <button className="icon-btn notification">

              <Bell size={19} />

              <i />

            </button>

            <button
              className="icon-btn"
              onClick={() =>
                setDarkMode(!darkMode)
              }
            >
              <Moon size={19} />
            </button>

            <div className="mini-avatar">
              PN
            </div>

          </div>

        </header>

        {/* =================================================
            CURRENT PAGE
        ================================================= */}

        <section className="content">
          {renderPage()}
        </section>

      </main>

    </div>
  );
}

/* =========================================================
   DASHBOARD
========================================================= */

function Dashboard({
  elections,
  candidates,
  voted,
  selectedCandidate,
  setSelectedCandidate,
  handleVote,
  handleNavigation,
}) {
  return (
    <>

      {/* WELCOME */}

      <div className="welcome">

        <div>

          <div className="eyebrow">

            <Sparkles size={14} />

            Your voting workspace

          </div>

          <h1>
            Make your voice{" "}
            <span>count.</span>
          </h1>

          <p>
            Participate in active elections,
            explore candidates and make your
            choice securely.
          </p>

        </div>

        <div className="welcome-badge">

          <ShieldCheck size={18} />

          <div>

            <strong>
              Verified voter
            </strong>

            <span>
              Identity confirmed
            </span>

          </div>

        </div>

      </div>

      {/* STATS */}

      <section className="stats">

        <Stat
          icon={<Vote />}
          label="Active Elections"
          value="03"
          trend="+2 this week"
        />

        <Stat
          icon={<CheckCircle2 />}
          label="Votes Cast"
          value="07"
          trend="100% verified"
        />

        <Stat
          icon={<Users />}
          label="Total Voters"
          value="12.4K"
          trend="+8.4% this month"
        />

        <Stat
          icon={<Trophy />}
          label="Participation"
          value="94.8%"
          trend="+4.2% from last"
        />

      </section>

      {/* ELECTION HEADING */}

      <PageHeading
        label="ELECTIONS"
        title="Active elections"
        description="Choose an election and make your vote count."
        buttonText="View all"
        onClick={() =>
          handleNavigation("Elections")
        }
      />

      {/* ELECTIONS */}

      <section className="election-grid">

        {elections.map((election) => (

          <ElectionCard
            key={election.id}
            election={election}
            onVote={() =>
              handleNavigation("Elections")
            }
          />

        ))}

      </section>

      {/* DASHBOARD PANELS */}

      <section className="dashboard-grid">

        <div className="panel">

          <div className="panel-heading">

            <div>

              <span className="section-label">
                LIVE RESULTS
              </span>

              <h2>
                Student Council 2026
              </h2>

            </div>

            <span className="live">
              <i />
              Live
            </span>

          </div>

          <ResultList
            candidates={candidates}
          />

          <button
            className="results-button"
            onClick={() =>
              handleNavigation("Results")
            }
          >
            View detailed results
            <ChevronRight size={17} />
          </button>

        </div>

        <div className="panel activity">

          <div className="panel-heading">

            <div>

              <span className="section-label">
                ACTIVITY
              </span>

              <h2>
                Recent activity
              </h2>

            </div>

          </div>

          <Activity
            icon={<CheckCircle2 />}
            title="Vote successfully recorded"
            text="Student Council Election"
            time="12 min ago"
          />

          <Activity
            icon={<BarChart3 />}
            title="Results updated"
            text="Technology Club President"
            time="38 min ago"
          />

          <Activity
            icon={<Bell />}
            title="New election available"
            text="Arts & Cultural Secretary"
            time="2 hrs ago"
          />

          <Activity
            icon={<ShieldCheck />}
            title="Identity verification completed"
            text="Your account is verified"
            time="Yesterday"
          />

        </div>

      </section>

      {/* VOTING */}

      <VotingSection
        candidates={candidates}
        selectedCandidate={selectedCandidate}
        setSelectedCandidate={setSelectedCandidate}
        voted={voted}
        handleVote={handleVote}
      />

      <Footer />

    </>
  );
}

/* =========================================================
   ELECTIONS PAGE
========================================================= */

function ElectionsPage({
  elections,
  candidates,
  selectedCandidate,
  setSelectedCandidate,
  voted,
  handleVote,
}) {
  return (
    <>

      <PageTitle
        icon={<Vote />}
        label="ELECTION CENTER"
        title="Active Elections"
        description="Explore current elections and cast your vote securely."
      />

      <div className="election-page-grid">

        {elections.map((election) => (

          <ElectionCard
            key={election.id}
            election={election}
            onVote={() => {
              document
                .getElementById("election-voting")
                ?.scrollIntoView({
                  behavior: "smooth",
                });
            }}
          />

        ))}

      </div>

      <div id="election-voting">

        <VotingSection
          candidates={candidates}
          selectedCandidate={selectedCandidate}
          setSelectedCandidate={setSelectedCandidate}
          voted={voted}
          handleVote={handleVote}
        />

      </div>

      <Footer />

    </>
  );
}

/* =========================================================
   RESULTS PAGE
========================================================= */

function ResultsPage({
  elections,
  candidates,
}) {
  return (
    <>

      <PageTitle
        icon={<BarChart3 />}
        label="RESULTS CENTER"
        title="Election Results"
        description="View live voting results and election participation."
      />

      <div className="results-summary">

        <div className="result-summary-card">
          <span>Total Votes</span>
          <strong>2,162</strong>
          <small>Across active elections</small>
        </div>

        <div className="result-summary-card">
          <span>Participation</span>
          <strong>94.8%</strong>
          <small>+4.2% from previous</small>
        </div>

        <div className="result-summary-card">
          <span>Active Elections</span>
          <strong>03</strong>
          <small>Currently running</small>
        </div>

      </div>

      <div className="results-page-panel">

        <div className="panel-heading">

          <div>

            <span className="section-label">
              LIVE ELECTION
            </span>

            <h2>
              Student Council Election 2026
            </h2>

          </div>

          <span className="live">
            <i />
            Live
          </span>

        </div>

        <ResultList
          candidates={candidates}
        />

      </div>

      <h2 className="page-subtitle">
        Other Election Results
      </h2>

      <div className="mini-results-grid">

        {elections.slice(1).map((election) => (

          <div
            className="mini-result-card"
            key={election.id}
          >

            <div className="mini-result-icon">
              <Trophy size={22} />
            </div>

            <div>

              <span>
                {election.category}
              </span>

              <h3>
                {election.title}
              </h3>

              <p>
                {election.votes.toLocaleString()} votes
              </p>

            </div>

            <ChevronRight />

          </div>

        ))}

      </div>

      <Footer />

    </>
  );
}

/* =========================================================
   MY VOTES PAGE
========================================================= */

function MyVotesPage({ voted }) {
  return (
    <>

      <PageTitle
        icon={<CheckCircle2 />}
        label="MY VOTING ACTIVITY"
        title="My Votes"
        description="Review your voting history and participation."
      />

      <div className="my-votes-header">

        <div>
          <span>Total Votes Cast</span>
          <strong>07</strong>
        </div>

        <div>
          <span>Verified Votes</span>
          <strong>07</strong>
        </div>

        <div>
          <span>Participation</span>
          <strong>94.8%</strong>
        </div>

      </div>

      <div className="votes-history">

        <div className="history-title">
          <h2>Voting History</h2>
          <span>2026</span>
        </div>

        <HistoryItem
          title="Student Council Election 2026"
          candidate="Ananya Menon"
          date="September 2, 2026"
          status="Verified"
        />

        <HistoryItem
          title="Technology Club President"
          candidate="Rahul Nair"
          date="August 28, 2026"
          status="Verified"
        />

        <HistoryItem
          title="Arts & Cultural Secretary"
          candidate="Meera Joseph"
          date="August 20, 2026"
          status="Verified"
        />

        {voted && (
          <HistoryItem
            title="Student Council Election"
            candidate="Vote recorded successfully"
            date="Just now"
            status="Verified"
          />
        )}

      </div>

      <div className="privacy-note">

        <ShieldCheck size={24} />

        <div>

          <strong>
            Your voting history is private
          </strong>

          <p>
            Your choices are securely recorded.
            Only authorized election administrators
            can access election records.
          </p>

        </div>

      </div>

      <Footer />

    </>
  );
}

/* =========================================================
   PROFILE PAGE
========================================================= */

function ProfilePage() {
  const [editing, setEditing] = useState(false);

  return (
    <>

      <PageTitle
        icon={<User />}
        label="ACCOUNT"
        title="My Profile"
        description="Manage your personal information and voter identity."
      />

      <div className="profile-page">

        <div className="profile-cover">

          <div className="profile-big-avatar">
            PN
          </div>

          <div>

            <h2>
              PS Nandhana
            </h2>

            <p>
              Verified Voter
            </p>

          </div>

          <span className="verified-profile">
            <CheckCircle2 size={16} />
            Verified
          </span>

        </div>

        <div className="profile-details">

          <div className="profile-details-heading">

            <div>
              <span className="section-label">
                PERSONAL INFORMATION
              </span>

              <h2>
                Account Details
              </h2>
            </div>

            <button
              className="edit-btn"
              onClick={() =>
                setEditing(!editing)
              }
            >
              {editing ? (
                <>
                  <Save size={16} />
                  Save
                </>
              ) : (
                <>
                  <Edit3 size={16} />
                  Edit Profile
                </>
              )}
            </button>

          </div>

          <div className="profile-fields">

            <ProfileField
              icon={<User />}
              label="Full Name"
              value="PS Nandhana"
              editing={editing}
            />

            <ProfileField
              icon={<Mail />}
              label="Email Address"
              value="nandhana@example.com"
              editing={editing}
            />

            <ProfileField
              icon={<Phone />}
              label="Phone Number"
              value="+91 98765 43210"
              editing={editing}
            />

            <ProfileField
              icon={<MapPin />}
              label="Location"
              value="Kerala, India"
              editing={editing}
            />

          </div>

        </div>

      </div>

      <Footer />

    </>
  );
}

/* =========================================================
   NOTIFICATIONS PAGE
========================================================= */

function NotificationsPage() {
  return (
    <>

      <PageTitle
        icon={<Bell />}
        label="ACCOUNT"
        title="Notifications"
        description="Stay updated with elections, results and account activity."
      />

      <div className="notifications-page">

        <Notification
          icon={<CheckCircle2 />}
          title="Vote successfully recorded"
          text="Your vote for Student Council Election has been securely recorded."
          time="12 minutes ago"
          unread
        />

        <Notification
          icon={<BarChart3 />}
          title="Election results updated"
          text="Live results for Technology Club President have been updated."
          time="38 minutes ago"
          unread
        />

        <Notification
          icon={<Vote />}
          title="New election available"
          text="Arts & Cultural Secretary election is now open for voting."
          time="2 hours ago"
          unread
        />

        <Notification
          icon={<ShieldCheck />}
          title="Identity verification completed"
          text="Your voter identity has been successfully verified."
          time="Yesterday"
        />

        <Notification
          icon={<CalendarDays />}
          title="Election reminder"
          text="Student Council Election closes in 2 days."
          time="Yesterday"
        />

      </div>

      <Footer />

    </>
  );
}

/* =========================================================
   SETTINGS PAGE
========================================================= */

function SettingsPage({
  darkMode,
  setDarkMode,
}) {
  const [emailNotifications, setEmailNotifications] =
    useState(true);

  const [voteReminders, setVoteReminders] =
    useState(true);

  return (
    <>

      <PageTitle
        icon={<Settings />}
        label="ACCOUNT"
        title="Settings"
        description="Customize your VoteSphere experience."
      />

      <div className="settings-page">

        <SettingsSection
          title="Appearance"
          description="Customize how VoteSphere looks."
        >

          <SettingRow
            icon={<Moon />}
            title="Dark Mode"
            description="Use a darker interface that's easier on the eyes."
          >

            <Toggle
              checked={darkMode}
              onChange={() =>
                setDarkMode(!darkMode)
              }
            />

          </SettingRow>

        </SettingsSection>

        <SettingsSection
          title="Notifications"
          description="Choose which notifications you receive."
        >

          <SettingRow
            icon={<Mail />}
            title="Email Notifications"
            description="Receive important election updates by email."
          >

            <Toggle
              checked={emailNotifications}
              onChange={() =>
                setEmailNotifications(
                  !emailNotifications
                )
              }
            />

          </SettingRow>

          <SettingRow
            icon={<Bell />}
            title="Vote Reminders"
            description="Get reminders before elections close."
          >

            <Toggle
              checked={voteReminders}
              onChange={() =>
                setVoteReminders(
                  !voteReminders
                )
              }
            />

          </SettingRow>

        </SettingsSection>

        <SettingsSection
          title="Security"
          description="Protect your voting account."
        >

          <SettingRow
            icon={<Lock />}
            title="Two-Factor Authentication"
            description="Add an extra layer of protection."
          >

            <button className="security-action">
              Enable
            </button>

          </SettingRow>

          <SettingRow
            icon={<ShieldCheck />}
            title="Verified Identity"
            description="Your voter identity has been verified."
          >

            <span className="verified-text">
              <CheckCircle2 size={16} />
              Verified
            </span>

          </SettingRow>

        </SettingsSection>

      </div>

      <Footer />

    </>
  );
}

/* =========================================================
   VOTING SECTION
========================================================= */

function VotingSection({
  candidates,
  selectedCandidate,
  setSelectedCandidate,
  voted,
  handleVote,
}) {
  return (
    <section className="candidate-section">

      <div className="section-heading">

        <div>

          <span className="section-label">
            CAST YOUR VOTE
          </span>

          <h2>
            Student Council Election
          </h2>

          <p>
            Select one candidate to continue.
          </p>

        </div>

        <div className="deadline">

          <Clock3 size={17} />

          Ends in

          <strong>
            2d 14h
          </strong>

        </div>

      </div>

      {voted && (

        <div className="success-banner">

          <CheckCircle2 size={22} />

          <div>

            <strong>
              Your vote has been recorded!
            </strong>

            <span>
              Thank you for participating
              in the election.
            </span>

          </div>

        </div>

      )}

      <div className="candidate-grid">

        {candidates.map((candidate) => (

          <div
            className={
              selectedCandidate?.id === candidate.id
                ? "candidate-card selected"
                : "candidate-card"
            }
            key={candidate.id}
            onClick={() =>
              setSelectedCandidate(candidate)
            }
          >

            <div className="candidate-header">

              <div className="candidate-large">
                {candidate.initials}
              </div>

              {selectedCandidate?.id ===
                candidate.id && (

                <CheckCircle2
                  className="selected-check"
                  size={25}
                />

              )}

            </div>

            <div className="candidate-info">

              <span className="candidate-role">
                {candidate.role}
              </span>

              <h3>
                {candidate.name}
              </h3>

              <p>
                {candidate.description}
              </p>

            </div>

            <div className="candidate-footer">

              <span>
                <Users size={15} />
                {candidate.votes} votes
              </span>

              <button
                onClick={(event) => {
                  event.stopPropagation();

                  setSelectedCandidate(
                    candidate
                  );
                }}
              >
                Choose
              </button>

            </div>

          </div>

        ))}

      </div>

      <div className="vote-action">

        <div>

          <ShieldCheck size={19} />

          <span>
            Your vote is private and securely recorded.
          </span>

        </div>

        <button
          className="primary-btn"
          disabled={
            !selectedCandidate || voted
          }
          onClick={handleVote}
        >

          <Vote size={18} />

          {voted
            ? "Vote Recorded"
            : "Confirm My Vote"}

        </button>

      </div>

    </section>
  );
}

/* =========================================================
   RESULT LIST
========================================================= */

function ResultList({ candidates }) {
  const totalVotes = candidates.reduce(
    (total, candidate) =>
      total + candidate.votes,
    0
  );

  return (
    <div className="result-list">

      {candidates.map((candidate) => {

        const percentage = Math.round(
          (candidate.votes / totalVotes) * 100
        );

        return (
          <div
            className="result"
            key={candidate.id}
          >

            <div className="result-top">

              <div className="candidate-small">

                <div className="candidate-avatar">
                  {candidate.initials}
                </div>

                <div>

                  <strong>
                    {candidate.name}
                  </strong>

                  <span>
                    {candidate.role}
                  </span>

                </div>

              </div>

              <strong>
                {percentage}%
              </strong>

            </div>

            <div className="progress">

              <span
                style={{
                  width: `${percentage}%`,
                }}
              />

            </div>

            <small>
              {candidate.votes.toLocaleString()} votes
            </small>

          </div>
        );
      })}

    </div>
  );
}

/* =========================================================
   ELECTION CARD
========================================================= */

function ElectionCard({
  election,
  onVote,
}) {
  return (
    <article
      className={`election-card ${election.color}`}
    >

      <div className="card-top">

        <span className="live-pill">

          <i />

          {election.status}

        </span>

        <button className="more">
          •••
        </button>

      </div>

      <div className="election-icon">
        <Vote size={24} />
      </div>

      <span className="category">
        {election.category}
      </span>

      <h3>
        {election.title}
      </h3>

      <p>
        {election.description}
      </p>

      <div className="election-meta">

        <span>
          <Users size={15} />
          {election.candidates} candidates
        </span>

        <span>
          <Clock3 size={15} />
          {election.ends}
        </span>

      </div>

      <div className="card-bottom">

        <span>
          <strong>
            {election.votes.toLocaleString()}
          </strong>{" "}
          votes
        </span>

        <button onClick={onVote}>

          Vote now

          <ChevronRight size={16} />

        </button>

      </div>

    </article>
  );
}

/* =========================================================
   STAT
========================================================= */

function Stat({
  icon,
  label,
  value,
  trend,
}) {
  return (
    <div className="stat-card">

      <div className="stat-icon">
        {icon}
      </div>

      <div>

        <span>
          {label}
        </span>

        <h3>
          {value}
        </h3>

        <small>
          {trend}
        </small>

      </div>

    </div>
  );
}

/* =========================================================
   ACTIVITY
========================================================= */

function Activity({
  icon,
  title,
  text,
  time,
}) {
  return (
    <div className="activity-item">

      <div className="activity-icon">
        {icon}
      </div>

      <div>

        <strong>
          {title}
        </strong>

        <span>
          {text}
        </span>

      </div>

      <small>
        {time}
      </small>

    </div>
  );
}

/* =========================================================
   PAGE TITLE
========================================================= */

function PageTitle({
  icon,
  label,
  title,
  description,
}) {
  return (
    <div className="page-title">

      <div className="page-title-icon">
        {icon}
      </div>

      <div>

        <span className="section-label">
          {label}
        </span>

        <h1>
          {title}
        </h1>

        <p>
          {description}
        </p>

      </div>

    </div>
  );
}

/* =========================================================
   PAGE HEADING
========================================================= */

function PageHeading({
  label,
  title,
  description,
  buttonText,
  onClick,
}) {
  return (
    <div className="section-heading">

      <div>

        <span className="section-label">
          {label}
        </span>

        <h2>
          {title}
        </h2>

        <p>
          {description}
        </p>

      </div>

      {buttonText && (

        <button
          className="view-all"
          onClick={onClick}
        >

          {buttonText}

          <ChevronRight size={17} />

        </button>

      )}

    </div>
  );
}

/* =========================================================
   HISTORY ITEM
========================================================= */

function HistoryItem({
  title,
  candidate,
  date,
  status,
}) {
  return (
    <div className="history-item">

      <div className="history-icon">
        <CheckCircle2 size={21} />
      </div>

      <div className="history-info">

        <strong>
          {title}
        </strong>

        <span>
          Your choice: {candidate}
        </span>

      </div>

      <div className="history-date">

        <span>
          {date}
        </span>

        <strong>
          {status}
        </strong>

      </div>

    </div>
  );
}

/* =========================================================
   PROFILE FIELD
========================================================= */

function ProfileField({
  icon,
  label,
  value,
  editing,
}) {
  return (
    <div className="profile-field">

      <div className="field-icon">
        {icon}
      </div>

      <div>

        <label>
          {label}
        </label>

        {editing ? (
          <input
            defaultValue={value}
          />
        ) : (
          <strong>
            {value}
          </strong>
        )}

      </div>

    </div>
  );
}

/* =========================================================
   NOTIFICATION
========================================================= */

function Notification({
  icon,
  title,
  text,
  time,
  unread,
}) {
  return (
    <div
      className={
        unread
          ? "notification-card unread"
          : "notification-card"
      }
    >

      <div className="notification-icon">
        {icon}
      </div>

      <div className="notification-content">

        <strong>
          {title}
        </strong>

        <p>
          {text}
        </p>

        <span>
          {time}
        </span>

      </div>

      {unread && (
        <span className="unread-dot" />
      )}

    </div>
  );
}

/* =========================================================
   SETTINGS SECTION
========================================================= */

function SettingsSection({
  title,
  description,
  children,
}) {
  return (
    <div className="settings-section">

      <div className="settings-heading">

        <h2>
          {title}
        </h2>

        <p>
          {description}
        </p>

      </div>

      <div className="settings-content">
        {children}
      </div>

    </div>
  );
}

/* =========================================================
   SETTING ROW
========================================================= */

function SettingRow({
  icon,
  title,
  description,
  children,
}) {
  return (
    <div className="setting-row">

      <div className="setting-icon">
        {icon}
      </div>

      <div className="setting-info">

        <strong>
          {title}
        </strong>

        <span>
          {description}
        </span>

      </div>

      <div>
        {children}
      </div>

    </div>
  );
}

/* =========================================================
   TOGGLE
========================================================= */

function Toggle({
  checked,
  onChange,
}) {
  return (
    <button
      className={
        checked
          ? "toggle active"
          : "toggle"
      }
      onClick={onChange}
      aria-label="Toggle setting"
    >

      <span />

    </button>
  );
}

/* =========================================================
   FOOTER
========================================================= */

function Footer() {
  return (
    <footer>

      <div className="footer-brand">

        <div className="brand-icon">
          <Vote size={20} />
        </div>

        <strong>
          VoteSphere
        </strong>

      </div>

      <span>
        Secure digital voting for modern communities.
      </span>

      <span>
        © 2026 VoteSphere
      </span>

    </footer>
  );
}

export default App;