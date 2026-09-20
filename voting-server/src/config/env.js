const dotenv = require("dotenv");

dotenv.config();

const requiredVariables = [
  "DATABASE_URL",
  "CLIENT_URL",
  "SESSION_SECRET",
  "COLLEGE_EMAIL_DOMAIN"
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(
      `Missing required environment variable: ${variable}`
    );
  }
}

module.exports = {
  port: Number(process.env.PORT || 5000),
  clientUrl: process.env.CLIENT_URL,
  sessionSecret: process.env.SESSION_SECRET,
  collegeEmailDomain: process.env.COLLEGE_EMAIL_DOMAIN
};