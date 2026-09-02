import "./Features.css";

const features = [
  {
    icon: "🔒",
    title: "Secure Voting",
    description:
      "Advanced authentication and encrypted voting ensure every vote is safe and trusted."
  },
  {
    icon: "⚡",
    title: "Real-Time Results",
    description:
      "Watch votes update instantly with live synchronization using WebSockets."
  },
  {
    icon: "📊",
    title: "Smart Analytics",
    description:
      "Visual dashboards and reports help organizers understand voting trends."
  },
  {
    icon: "🌐",
    title: "Cloud Access",
    description:
      "Access the platform securely from any device, anywhere in the world."
  }
];

function Features() {
  return (
    <section className="features">
      <div className="container">

        <div className="section-title">
          <h2>Why Choose VoteSphere?</h2>
          <p>
            A secure, fast and intelligent voting platform designed for
            universities, organizations and modern events.
          </p>
        </div>

        <div className="feature-grid">
          {features.map((feature, index) => (
            <div className="feature-card" key={index}>
              <div className="feature-icon">
                {feature.icon}
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