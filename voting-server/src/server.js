const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const voteRoutes = require("./routes/voteRoutes");
const {
  port,
  clientUrl
} = require("./config/env");

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: clientUrl,
    credentials: true
  })
);

app.use(
  express.json({
    limit: "100kb"
  })
);

app.use(cookieParser());

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(generalLimiter);



const authRoutes = require("./routes/authRoutes");
const authorityRoutes = require("./routes/authorityRoutes");
const electionRoutes = require("./routes/electionRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/authority", authorityRoutes);
app.use("/api/votes", voteRoutes);
app.use("/api/elections", electionRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "VoteSphere server is running."
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found."
  });
});

app.listen(port, () => {
  console.log(
    `VoteSphere API running on http://localhost:${port}`
  );
});
EMAIL_USER="yourgmail@gmail.com"
EMAIL_APP_PASSWORD="your-16-character-app-password"