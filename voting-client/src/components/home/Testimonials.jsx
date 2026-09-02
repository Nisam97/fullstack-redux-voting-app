import "./Testimonials.css";

const reviews = [
  {
    name: "Ananya Sharma",
    role: "College Coordinator",
    review:
      "VoteSphere made our student election simple, secure, and completely transparent."
  },
  {
    name: "Rahul Menon",
    role: "Event Organizer",
    review:
      "The live results and smooth voting experience impressed everyone in our organization."
  },
  {
    name: "Sarah Joseph",
    role: "Faculty Advisor",
    review:
      "A modern and reliable platform that saved us hours during campus elections."
  }
];

function Testimonials() {
  return (
    <section className="testimonials">
      <div className="container">

        <div className="section-title">
          <h2>What Our Users Say</h2>
         <p>Trusted by students, organizations and event managers.</p>
        </div>

        <div className="testimonial-grid">

          {reviews.map((item, index) => (
            <div className="testimonial-card" key={index}>

              <div className="quote">★★★★★</div>

              <p>{item.review}</p>

              <h3>{item.name}</h3>

              <span>{item.role}</span>

            </div>
          ))}

        </div>

      </div>
    </section>
  );
}

export default Testimonials;