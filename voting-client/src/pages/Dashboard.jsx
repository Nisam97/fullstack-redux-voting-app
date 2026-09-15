import Navbar from "../components/layout/Navbar";
import WelcomeCard from "../components/dashboard/WelcomeCard";
import StatsCards from "../components/dashboard/StatsCards";
import "./Dashboard.css";

function Dashboard() {
  return (
    <>
      <Navbar />
      <div style={{ padding: "40px 8%" }}>
        <WelcomeCard />
        <div style={{ marginTop: "30px" }}>
          <StatsCards />
        </div>
      </div>
    </>
  );
}

export default Dashboard;
