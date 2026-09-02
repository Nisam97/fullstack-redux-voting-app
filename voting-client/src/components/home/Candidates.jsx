import "./Candidates.css";

const candidates = [
  {
    id: 1,
    name: "Alex Johnson",
    role: "President Candidate",
    image: "https://i.pravatar.cc/300?img=12"
  },
  {
    id: 2,
    name: "Sophia Williams",
    role: "Vice President",
    image: "https://i.pravatar.cc/300?img=32"
  },
  {
    id: 3,
    name: "David Miller",
    role: "Secretary",
    image: "https://i.pravatar.cc/300?img=15"
  }
];

function Candidates() {
  return (
    <section className="candidates">
      <div className="container">

        <div className="section-title">
          <h2>Featured Candidates</h2>
          <p>
            Meet the candidates participating in this election.
          </p>
        </div>

        <div className="candidate-grid">

          {candidates.map((candidate) => (

            <div className="candidate-card" key={candidate.id}>

              <img
                src={candidate.image}
                alt={candidate.name}
              />

              <h3>{candidate.name}</h3>

              <span>{candidate.role}</span>

              <button>
                View Profile
              </button>

            </div>

          ))}

        </div>

      </div>
    </section>
  );
}

export default Candidates;