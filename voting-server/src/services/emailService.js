const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function sendVerificationEmail(email, otp) {
  await transporter.sendMail({
    from: `"VoteSphere" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "VoteSphere Email Verification",
    text: `Your VoteSphere verification code is ${otp}. This code will expire in 10 minutes.`
  });
}

module.exports = {
  sendVerificationEmail
};