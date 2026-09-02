import "./Stats.css";

function Stats() {
  const stats = [
    { number: "15K+", title: "Active Users" },
    { number: "120K+", title: "Votes Cast" },
    { number: "500+", title: "Organizations" },
    { number: "99.9%", title: "Server Uptime" },
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