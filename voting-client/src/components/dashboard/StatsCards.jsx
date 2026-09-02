import "./StatsCards.css";

const data = [
  {
    number: 12,
    title: "Active Elections",
    icon: "🗳"
  },
  {
    number: 845,
    title: "Votes Today",
    icon: "📊"
  },
  {
    number: 25,
    title: "Candidates",
    icon: "👤"
  },
  {
    number: "99%",
    title: "Accuracy",
    icon: "✅"
  }
];

function StatsCards() {

  return (

    <div className="stats-grid">

      {data.map((item,index)=>(

        <div className="stats-card" key={index}>

          <span>{item.icon}</span>

          <h2>{item.number}</h2>

          <p>{item.title}</p>

        </div>

      ))}

    </div>

  );

}

export default StatsCards;