import "./Testimonials.css";

// Product-strength cards, not invented testimonials: fictional users with
// invented quotes would not survive a question about who they are.
const strengths = [
  {
    icon: "🔐",
    title: "Passwordless by design",
    detail:
      "Voters sign in with a one-time code sent to their email — no passwords stored, nothing to leak.",
    tag: "Voter access"
  },
  {
    icon: "⚖️",
    title: "The server decides",
    detail:
      "Tallies, timers and round advancement run only on the backend. Clients render state and send intent.",
    tag: "Integrity"
  },
  {
    icon: "🧾",
    title: "Audit-ready history",
    detail:
      "Every completed session is persisted with its full round-by-round history and final result.",
    tag: "Transparency"
  }
];

function Testimonials() {
  return (
    <section className="testimonials">
      <div className="container">

        <div className="section-title">
          <h2>Built to Be Trusted</h2>
          <p>What makes a VoteSphere session trustworthy.</p>
        </div>

        <div className="testimonial-grid">

          {strengths.map((item, index) => (
            <div className="testimonial-card" key={index}>

              <div className="quote">{item.icon}</div>

              <p>{item.detail}</p>

              <h3>{item.title}</h3>

              <span>{item.tag}</span>

            </div>
          ))}

        </div>

      </div>
    </section>
  );
}

export default Testimonials;