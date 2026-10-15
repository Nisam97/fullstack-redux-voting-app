import { Lock, Radio, BarChart3, Globe } from "lucide-react";
import "./Features.css";

const features = [
  {
    icon: Lock,
    title: "Passwordless Voting",
    description:
      "Voters sign in with a one-time code sent to their email. No passwords are stored."
  },
  {
    icon: Radio,
    title: "Real-Time Results",
    description:
      "Votes update live over WebSockets, with the server as the single source of truth."
  },
  {
    icon: BarChart3,
    title: "Results Analytics",
    description:
      "Per-round charts, candidate totals and turnout history for every completed session."
  },
  {
    icon: Globe,
    title: "Runs Anywhere",
    description:
      "A browser is all organizers and voters need, on desktop or mobile."
  }
];

function Features() {
  return (
    <section className="features">
      <div className="container">

        <div className="section-title">
          <h2>Why Choose VoteSphere?</h2>
          <p>
            One platform for ballots and knockout tournaments,
            built for universities, organizations and events.
          </p>
        </div>

        <div className="feature-grid">
          {features.map((feature) => (
            <div className="feature-card" key={feature.title}>
              <div className="feature-icon">
                <feature.icon size={26} aria-hidden="true" />
              </div>

              <h3>{feature.title}</h3>

              <p>{feature.description}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}

export default Features;