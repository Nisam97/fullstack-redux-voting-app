import { UserCheck, KeyRound, CheckCircle2, LineChart } from "lucide-react";
import "./HowItWorks.css";

function HowItWorks() {
  const steps = [
    {
      icon: UserCheck,
      title: "Sign In",
      text: "Verify your email with a one-time code. No password to create or remember."
    },
    {
      icon: KeyRound,
      title: "Join the Session",
      text: "Enter the 6-character join code from the organizer, or scan the lobby QR code."
    },
    {
      icon: CheckCircle2,
      title: "Cast Your Vote",
      text: "Pick a candidate in a ballot, or a winner in each pairwise matchup."
    },
    {
      icon: LineChart,
      title: "Watch Live Results",
      text: "Tallies and round results update in real time, computed on the server."
    }
  ];

  return (
    <section className="how-section">

      <div className="section-heading">
        <span>HOW IT WORKS</span>

        <h2>
          Vote in just
          <br />
          Four Easy Steps
        </h2>

        <p>
          From email sign-in to live results, every step
          runs in the browser, on desktop or mobile.
        </p>
      </div>

      <div className="steps">

        {steps.map((step, index) => (

          <div className="step-card" key={step.title}>

            <div className="step-number">
              0{index + 1}
            </div>

            <div className="step-icon">
              <step.icon size={30} aria-hidden="true" />
            </div>

            <h3>{step.title}</h3>

            <p>{step.text}</p>

          </div>

        ))}

      </div>

    </section>
  );
}

export default HowItWorks;