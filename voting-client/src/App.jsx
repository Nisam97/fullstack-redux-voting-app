import { useState } from "react";
import {
  Vote,
  Users,
  CheckCircle2,
  ShieldCheck,
  Bell,
  User,
  Settings,
  LogOut,
  Menu,
  X,
  Home,
  ClipboardCheck,
  CalendarDays,
  ArrowRight,
  Mail,
  Phone,
  MapPin,
  Lock,
  Moon,
  Sun,
} from "lucide-react";
import "./App.css";

const elections = [
  {
    id: 1,
    title: "Student Council Election 2026",
    description: "Choose your representatives for the student council.",
    status: "Live",
    date: "September 10, 2026",
    candidates: 6,
    totalVotes: 128,
  },
  {
    id: 2,
    title: "Department Representative Election",
    description: "Vote for your department representative.",
    status: "Live",
    date: "September 12, 2026",
    candidates: 4,
    totalVotes: 84,
  },
  {
    id: 3,
    title: "College Union Election",
    description: "Select your preferred college union representative.",
    status: "Upcoming",
    date: "September 20, 2026",
    candidates: 8,
    totalVotes: 0,
  },
];

const candidates = [
  {
    id: 1,
    name: "Ananya Menon",
    position: "Student Representative",
    description: "Focused on student welfare and academic development.",
  },
  {
    id: 2,
    name: "Rahul Kumar",
    position: "Student Representative",
    description: "Working towards better student activities and events.",
  },
  {
    id: 3,
    name: "Meera Thomas",
    position: "Student Representative",
    description: "Committed to creating an inclusive student community.",
  },
];

const initialNotifications = [
  {
    id: 1,
    title: "Election is Live",
    message: "Student Council Election 2026 is now open for voting.",
    time: "10 minutes ago",
    unread: true,
  },
  {
    id: 2,
    title: "Profile Verified",
    message: "Your voter identity has been successfully verified.",
    time: "Yesterday",
    unread: false,
  },
];

function App() {
  const [page, setPage] = useState("Dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedElection, setSelectedElection] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [votedElections, setVotedElections] = useState([]);
  const [notifications] = useState(initialNotifications);
  const [showLogout, setShowLogout] = useState(false);

  const navigate = (newPage) => {
    setPage(newPage);
    setSelectedElection(null);
    setSelectedCandidate(null);
    setMobileMenu(false);
  };

  const openElection = (election) => {
    setSelectedElection(election);
    setPage("Vote");
  };

  const castVote = () => {
    if (!selectedElection || !selectedCandidate) {
      alert("Please select a candidate.");
      return;
    }

    const alreadyVoted = votedElections.some(
      (vote) => vote.electionId === selectedElection.id
    );

    if (alreadyVoted) {
      alert("You have already voted in this election.");
      return;
    }

    const newVote = {
      id: `VS-${Date.now()}`,
      electionId: selectedElection.id,
      election: selectedElection.title,
      candidate: selectedCandidate.name,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString(),
    };

    setVotedElections((prev) => [...prev, newVote]);
    setPage("My Votes");
    setSelectedElection(null);
    setSelectedCandidate(null);
  };

  return (
    <div className={darkMode ? "app dark" : "app"}>
      <header className="navbar">
        <div className="brand" onClick={() => navigate("Dashboard")}>
          <div className="brand-icon">
            <Vote size={24} />
          </div>

          <div>
            <h2>VoteSphere</h2>
            <span>Secure Digital Voting</span>
          </div>
        </div>

        <button
          className="mobile-menu-button"
          onClick={() => setMobileMenu(!mobileMenu)}
        >
          {mobileMenu ? <X /> : <Menu />}
        </button>

        <nav className={mobileMenu ? "nav open" : "nav"}>
          <button onClick={() => navigate("Dashboard")}>
            <Home size={17} />
            Dashboard
          </button>

          <button onClick={() => navigate("Elections")}>
            <Vote size={17} />
            Elections
          </button>

          <button onClick={() => navigate("My Votes")}>
            <ClipboardCheck size={17} />
            My Votes
          </button>

          <button onClick={() => navigate("Profile")}>
            <User size={17} />
            Profile
          </button>

          <button onClick={() => navigate("Notifications")}>
            <Bell size={17} />
            Notifications
          </button>

          <button onClick={() => navigate("Settings")}>
            <Settings size={17} />
            Settings
          </button>

          <button
            className="logout-nav"
            onClick={() => setShowLogout(true)}
          >
            <LogOut size={17} />
            Logout
          </button>
        </nav>
      </header>

      <main className="main-content">
        {page === "Dashboard" && (
          <Dashboard
            navigate={navigate}
            elections={elections}
            votedElections={votedElections}
            openElection={openElection}
          />
        )}

        {page === "Elections" && (
          <ElectionsPage
            elections={elections}
            votedElections={votedElections}
            openElection={openElection}
          />
        )}

        {page === "Vote" && selectedElection && (
          <VotePage
            election={selectedElection}
            candidates={candidates}
            selectedCandidate={selectedCandidate}
            setSelectedCandidate={setSelectedCandidate}
            castVote={castVote}
            navigate={navigate}
          />
        )}

        {page === "My Votes" && (
          <MyVotesPage
            votedElections={votedElections}
            navigate={navigate}
          />
        )}

        {page === "Profile" && <ProfilePage />}

        {page === "Notifications" && (
          <NotificationsPage notifications={notifications} />
        )}

        {page === "Settings" && (
          <SettingsPage
            darkMode={darkMode}
            setDarkMode={setDarkMode}
          />
        )}
      </main>

      <footer className="footer">
        <div>
          <strong>VoteSphere</strong>
          <span>Secure Digital Voting Platform</span>
        </div>

        <span>© 2026 VoteSphere. All rights reserved.</span>

        <div className="footer-security">
          <Lock size={14} />
          Secure & Private
        </div>
      </footer>

      {showLogout && (
        <LogoutModal
          close={() => setShowLogout(false)}
          confirm={() => {
            setShowLogout(false);
            navigate("Dashboard");
          }}
        />
      )}
    </div>
  );
}

/* =========================
   DASHBOARD
========================= */

function Dashboard({
  navigate,
  elections,
  votedElections,
  openElection,
}) {
  const active = elections.filter(
    (election) => election.status === "Live"
  ).length;

  return (
    <div className="page">
      <div className="hero">
        <div>
          <span className="eyebrow">WELCOME BACK</span>

          <h1>
            Your Vote.
            <br />
            Your Voice.
          </h1>

          <p>
            Participate in secure and transparent digital elections
            with VoteSphere.
          </p>

          <button
            className="primary-button"
            onClick={() => navigate("Elections")}
          >
            View Elections
            <ArrowRight size={18} />
          </button>
        </div>

        <div className="hero-icon">
          <ShieldCheck size={100} />
        </div>
      </div>

      <div className="stats-grid">
        <Stat
          icon={Vote}
          title="Active Elections"
          value={active}
          text="Currently open"
        />

        <Stat
          icon={Users}
          title="Candidates"
          value={candidates.length}
          text="Available candidates"
        />

        <Stat
          icon={CheckCircle2}
          title="Votes Cast"
          value={votedElections.length}
          text="Your votes"
        />

        <Stat
          icon={ShieldCheck}
          title="Status"
          value="Verified"
          text="Your identity"
        />
      </div>

      <PageHeading
        title="Active Elections"
        subtitle="Elections currently open for voting."
      />

      <div className="elections-grid">
        {elections
          .filter((election) => election.status === "Live")
          .map((election) => (
            <ElectionCard
              key={election.id}
              election={election}
              voted={votedElections.some(
                (vote) => vote.electionId === election.id
              )}
              openElection={openElection}
            />
          ))}
      </div>
    </div>
  );
}

/* =========================
   ELECTIONS
========================= */

function ElectionsPage({
  elections,
  votedElections,
  openElection,
}) {
  return (
    <div className="page">
      <PageHeading
        title="Elections"
        subtitle="Browse current and upcoming elections."
      />

      <div className="elections-list">
        {elections.map((election) => (
          <ElectionCardLarge
            key={election.id}
            election={election}
            voted={votedElections.some(
              (vote) => vote.electionId === election.id
            )}
            openElection={openElection}
          />
        ))}
      </div>
    </div>
  );
}

/* =========================
   VOTE PAGE
========================= */

function VotePage({
  election,
  candidates,
  selectedCandidate,
  setSelectedCandidate,
  castVote,
  navigate,
}) {
  return (
    <div className="page">
      <PageHeading
        title={election.title}
        subtitle={election.description}
      />

      <div className="vote-panel">
        <div className="vote-header">
          <Vote size={25} />
          <div>
            <h2>Select your candidate</h2>
            <p>Your vote will be securely recorded.</p>
          </div>
        </div>

        <div className="candidate-grid">
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              className={
                selectedCandidate?.id === candidate.id
                  ? "candidate-card selected"
                  : "candidate-card"
              }
              onClick={() => setSelectedCandidate(candidate)}
            >
              <div className="candidate-avatar">
                {candidate.name
                  .split(" ")
                  .map((word) => word[0])
                  .join("")}
              </div>

              <div>
                <h3>{candidate.name}</h3>
                <span>{candidate.position}</span>
                <p>{candidate.description}</p>
              </div>

              {selectedCandidate?.id === candidate.id && (
                <CheckCircle2 className="selected-check" size={23} />
              )}
            </button>
          ))}
        </div>

        <div className="vote-actions">
          <button
            className="secondary-button"
            onClick={() => navigate("Elections")}
          >
            Cancel
          </button>

          <button
            className="primary-button"
            onClick={castVote}
          >
            Confirm Vote
            <CheckCircle2 size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================
   MY VOTES
========================= */

function MyVotesPage({ votedElections, navigate }) {
  return (
    <div className="page">
      <PageHeading
        title="My Votes"
        subtitle="View your voting history and receipts."
      />

      {votedElections.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <ClipboardCheck size={35} />
          </div>

          <h2>No votes yet</h2>

          <p>
            You haven't cast a vote yet. Browse active elections
            to participate.
          </p>

          <button
            className="primary-button"
            onClick={() => navigate("Elections")}
          >
            View Elections
            <ArrowRight size={17} />
          </button>
        </div>
      ) : (
        <div className="vote-history">
          {votedElections.map((vote) => (
            <div className="history-card" key={vote.id}>
              <div className="history-icon">
                <CheckCircle2 size={24} />
              </div>

              <div className="history-main">
                <span className="history-status">
                  VOTE RECORDED
                </span>

                <h3>{vote.election}</h3>

                <p>
                  You voted for <strong>{vote.candidate}</strong>
                </p>
              </div>

              <div className="history-details">
                <div>
                  <span>Vote ID</span>
                  <strong>{vote.id}</strong>
                </div>

                <div>
                  <span>Date</span>
                  <strong>{vote.date}</strong>
                </div>

                <div>
                  <span>Time</span>
                  <strong>{vote.time}</strong>
                </div>
              </div>

              <ShieldCheck
                className="history-shield"
                size={23}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================
   PROFILE
========================= */

function ProfilePage() {
  return (
    <div className="page">
      <PageHeading
        title="My Profile"
        subtitle="Manage your voter profile information."
      />

      <div className="profile-layout">
        <div className="profile-card">
          <div className="large-avatar">PN</div>

          <h2>PS Nandhana</h2>

          <p>Verified Voter</p>

          <div className="verified-label">
            <ShieldCheck size={16} />
            Identity Verified
          </div>
        </div>

        <div className="profile-details panel">
          <div className="panel-header">
            <div>
              <h3>Personal Information</h3>
              <p>Your registered voter details</p>
            </div>

            <User size={21} />
          </div>

          <ProfileField
            icon={User}
            label="Full Name"
            value="PS Nandhana"
          />

          <ProfileField
            icon={Mail}
            label="Email"
            value="nandhana@example.com"
          />

          <ProfileField
            icon={Phone}
            label="Phone"
            value="+91 XXXXX XXXXX"
          />

          <ProfileField
            icon={MapPin}
            label="Location"
            value="Kerala, India"
          />

          <ProfileField
            icon={ShieldCheck}
            label="Voter Status"
            value="Verified"
          />
        </div>
      </div>
    </div>
  );
}

/* =========================
   NOTIFICATIONS
========================= */

function NotificationsPage({ notifications }) {
  return (
    <div className="page">
      <PageHeading
        title="Notifications"
        subtitle="Stay updated about your elections and account."
      />

      <div className="notifications-list">
        {notifications.map((notification) => (
          <div
            className={`notification-card ${
              notification.unread ? "unread" : ""
            }`}
            key={notification.id}
          >
            <div className="notification-icon">
              <Bell size={20} />
            </div>

            <div className="notification-content">
              <div>
                <h3>{notification.title}</h3>

                {notification.unread && (
                  <span className="new-label">NEW</span>
                )}
              </div>

              <p>{notification.message}</p>

              <span className="notification-time">
                {notification.time}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================
   SETTINGS
========================= */

function SettingsPage({ darkMode, setDarkMode }) {
  const [emailNotifications, setEmailNotifications] =
    useState(true);

  const [voteNotifications, setVoteNotifications] =
    useState(true);

  return (
    <div className="page">
      <PageHeading
        title="Settings"
        subtitle="Customize your VoteSphere experience."
      />

      <div className="settings-container">
        <SettingsSection
          title="Appearance"
          description="Customize how VoteSphere looks."
        >
          <SettingRow
            icon={darkMode ? Moon : Sun}
            title="Dark Mode"
            description="Use a darker appearance."
          >
            <Toggle
              enabled={darkMode}
              setEnabled={setDarkMode}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          title="Notifications"
          description="Control the notifications you receive."
        >
          <SettingRow
            icon={Mail}
            title="Email Notifications"
            description="Receive important updates by email."
          >
            <Toggle
              enabled={emailNotifications}
              setEnabled={setEmailNotifications}
            />
          </SettingRow>

          <SettingRow
            icon={Bell}
            title="Voting Notifications"
            description="Get notified when elections open."
          >
            <Toggle
              enabled={voteNotifications}
              setEnabled={setVoteNotifications}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          title="Security"
          description="Keep your voting account secure."
        >
          <SettingRow
            icon={Lock}
            title="Two-Factor Authentication"
            description="Add an additional layer of account security."
          >
            <Toggle enabled={false} setEnabled={() => {}} />
          </SettingRow>
        </SettingsSection>
      </div>
    </div>
  );
}

/* =========================
   COMPONENTS
========================= */

function PageHeading({ title, subtitle }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, title, value, text }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">
        <Icon size={21} />
      </div>

      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{text}</small>
      </div>
    </div>
  );
}

function ElectionCard({ election, voted, openElection }) {
  return (
    <div className="election-card">
      <div className="election-card-top">
        <span className="status live">
          <span className="status-dot" />
          {election.status}
        </span>

        <CalendarDays size={19} />
      </div>

      <h3>{election.title}</h3>

      <p>{election.description}</p>

      <div className="election-meta">
        <span>
          <Users size={15} />
          {election.candidates} Candidates
        </span>

        <span>
          <Vote size={15} />
          {election.totalVotes} Votes
        </span>
      </div>

      {voted ? (
        <button className="voted-button" disabled>
          <CheckCircle2 size={17} />
          Vote Already Cast
        </button>
      ) : (
        <button
          className="primary-button full"
          onClick={() => openElection(election)}
        >
          Vote Now
          <ArrowRight size={17} />
        </button>
      )}
    </div>
  );
}

function ElectionCardLarge({
  election,
  voted,
  openElection,
}) {
  return (
    <div className="large-election-card">
      <div className="large-election-icon">
        <Vote size={27} />
      </div>

      <div className="large-election-main">
        <span
          className={`status ${
            election.status === "Live" ? "live" : "upcoming"
          }`}
        >
          <span className="status-dot" />
          {election.status}
        </span>

        <h2>{election.title}</h2>

        <p>{election.description}</p>

        <div className="large-election-meta">
          <span>
            <CalendarDays size={15} />
            {election.date}
          </span>

          <span>
            <Users size={15} />
            {election.candidates} Candidates
          </span>

          <span>
            <Vote size={15} />
            {election.totalVotes} Votes
          </span>
        </div>
      </div>

      <div className="large-election-action">
        {voted ? (
          <button className="voted-button" disabled>
            <CheckCircle2 size={17} />
            Voted
          </button>
        ) : election.status === "Live" ? (
          <button
            className="primary-button"
            onClick={() => openElection(election)}
          >
            Vote Now
            <ArrowRight size={17} />
          </button>
        ) : (
          <button className="disabled-button" disabled>
            Not Open
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileField({ icon: Icon, label, value }) {
  return (
    <div className="profile-field">
      <div className="profile-field-icon">
        <Icon size={18} />
      </div>

      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      <div className="settings-card">{children}</div>
    </section>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}) {
  return (
    <div className="setting-row">
      <div className="setting-icon">
        <Icon size={19} />
      </div>

      <div className="setting-content">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>

      {children}
    </div>
  );
}

function Toggle({ enabled, setEnabled }) {
  return (
    <button
      className={`toggle ${enabled ? "on" : ""}`}
      onClick={() => setEnabled(!enabled)}
      aria-label="Toggle setting"
    >
      <span />
    </button>
  );
}

function LogoutModal({ close, confirm }) {
  return (
    <div className="modal-overlay">
      <div className="logout-modal">
        <div className="modal-icon">
          <LogOut size={24} />
        </div>

        <h2>Logout?</h2>

        <p>
          Are you sure you want to logout from your voting
          account?
        </p>

        <div className="modal-actions">
          <button className="secondary-button" onClick={close}>
            Cancel
          </button>

          <button className="danger-button" onClick={confirm}>
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;