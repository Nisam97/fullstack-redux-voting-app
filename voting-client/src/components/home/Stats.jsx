import "./Stats.css";

function Stats() {
  // Product-truth facts instead of fabricated adoption numbers, so every
  // value survives an audience question ("how do you know?").
  const stats = [
    { number: "OTP", title: "Passwordless, verified voters" },
    { number: "2", title: "Voting modes: ballot & tournament" },
    { number: "WS", title: "Live updates over WebSockets" },
    { number: "100%", title: "Server-authoritative tallies" },
  ];

  return (
    <section className="stats">
      <div className="stats-container">
        {stats.map((item, index) => (
          <div className="stat-card" key={index}>
            <h2>{item.number}</h2>
            <p>{item.title}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Stats;