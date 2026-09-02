import "./HowItWorks.css";
import { BsPersonCheckFill, BsCheckCircleFill } from "react-icons/bs";
import { FaVoteYea } from "react-icons/fa";
import { MdOutlineLeaderboard } from "react-icons/md";

function HowItWorks() {
  const steps = [
    {
      icon: <BsPersonCheckFill />,
      title: "Register Account",
      text: "Create your secure account and verify your identity before participating."
    },
    {
      icon: <FaVoteYea />,
      title: "Cast Your Vote",
      text: "Vote quickly with a secure and transparent voting experience."
    },
    {
      icon: <BsCheckCircleFill />,
      title: "Vote Verification",
      text: "Every vote is verified instantly to ensure complete integrity."
    },
    {
      icon: <MdOutlineLeaderboard />,
      title: "View Live Results",
      text: "Watch results update in real time using WebSocket technology."
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
          Fast, secure and transparent voting experience
          built for universities, organizations and events.
        </p>
      </div>

      <div className="steps">

        {steps.map((step, index) => (

          <div className="step-card" key={index}>

            <div className="step-number">
              0{index + 1}
            </div>

            <div className="step-icon">
              {step.icon}
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