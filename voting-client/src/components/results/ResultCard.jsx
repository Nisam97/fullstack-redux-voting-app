import ResultCard from "../components/result/ResultCard";

function Results() {
  return (
    <div>
      <ResultCard
        candidate="Ananya Sharma"
        party="Student Progress Alliance"
        votes={1248}
        percentage={68.4}
        position={1}
        totalVotes={1825}
        isWinner={true}
      />

      <ResultCard
        candidate="Rahul Menon"
        party="Student Unity Group"
        votes={577}
        percentage={31.6}
        position={2}
        totalVotes={1825}
      />
    </div>
  );
}

export default Results;