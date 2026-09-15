import Navbar from "../components/layout/Navbar";
import Hero from "../components/home/Hero";
import Features from "../components/home/Features";
import HowItWorks from "../components/home/HowItWorks";
import Candidates from "../components/home/Candidates";
import Stats from "../components/home/Stats";
import Testimonials from "../components/home/Testimonials";
import Footer from "../components/layout/Footer";

function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Candidates />
        <Stats />
        <Testimonials />
      </main>
      <Footer />
    </>
  );
}

export default Home;