import { Vote, Trophy, ShieldCheck } from "lucide-react";
import "./Candidates.css";

// Real product modes instead of fictional named candidates with placeholder
// avatar photos (external images break offline) or dead "View Profile" buttons.
const modes = [
  {
    id: "ballot",
    icon: Vote,
    name: "Single Ballot",
    role: "2 to 6 candidates in one vote"
  },
  {
    id: "tournament",
    icon: Trophy,
    name: "Knockout Tournament",
    role: "Pairwise rounds for 7+ entries"
  },
  {
    id: "secured",
    icon: ShieldCheck,
    name: "Secured Sessions",
    role: "Approval or allowlist entry"
  }
];

function Candidates() {
  return (
    <section className="candidates">
      <div className="container">

        <div className="section-title">
          <h2>Three Ways to Run a Vote</h2>
          <p>
            Pick the structure that fits your session. VoteSphere
            handles the rounds, ties and results.
          </p>
        </div>

        <div className="candidate-grid">

          {modes.map((mode) => (

            <div className="candidate-card" key={mode.id}>

              <div className="mode-icon" role="img" aria-label={mode.name}>
                <mode.icon size={44} aria-hidden="true" />
              </div>

              <h3>{mode.name}</h3>

              <span>{mode.role}</span>

            </div>

          ))}

        </div>

      </div>
    </section>
  );
}

export default Candidates;