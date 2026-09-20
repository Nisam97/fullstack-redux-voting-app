const crypto = require("crypto");
const argon2 = require("argon2");

const prisma = require("../config/prisma");

// ======================================================
// OTP GENERATOR
// ======================================================

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

// ======================================================
// COLLEGE EMAIL CHECK
// ======================================================

function isCollegeEmail(email) {
  const domain = process.env.COLLEGE_EMAIL_DOMAIN;

  if (!domain) {
    return false;
  }

  return email
    .toLowerCase()
    .endsWith(`@${domain.toLowerCase()}`);
}

// ======================================================
// REGISTER
// ======================================================

async function register(req, res) {
  try {
    const {
      studentId,
      fullName,
      department,
      email,
      phone,
      password
    } = req.body;

    // --------------------------------------------------
    // Required fields
    // --------------------------------------------------

    if (
      !studentId ||
      !fullName ||
      !department ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Student ID, full name, department, email and password are required."
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedStudentId = studentId.trim();
    const normalizedDepartment = department.trim();

    // --------------------------------------------------
    // Department validation
    // --------------------------------------------------

    if (normalizedDepartment.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid department."
      });
    }

    // --------------------------------------------------
    // College email validation
    // --------------------------------------------------

    if (!isCollegeEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message:
          "Registration is allowed only with a valid college email address."
      });
    }

    // --------------------------------------------------
    // Password validation
    // --------------------------------------------------

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 8 characters."
      });
    }

    // --------------------------------------------------
    // Check Student ID
    // --------------------------------------------------

    const existingStudent = await prisma.user.findUnique({
      where: {
        studentId: normalizedStudentId
      }
    });

    if (existingStudent) {
      return res.status(409).json({
        success: false,
        message: "Student ID is already registered."
      });
    }

    // --------------------------------------------------
    // Check email
    // --------------------------------------------------

    const existingEmail = await prisma.user.findUnique({
      where: {
        email: normalizedEmail
      }
    });

    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: "Email address is already registered."
      });
    }

    // --------------------------------------------------
    // Hash password
    // --------------------------------------------------

    const passwordHash = await argon2.hash(password);

    // --------------------------------------------------
    // Generate OTP
    // --------------------------------------------------

    const otp = generateOtp();

    // OTP expires after 10 minutes
    const otpExpires = new Date(
      Date.now() + 10 * 60 * 1000
    );

    // --------------------------------------------------
    // Create voter
    // --------------------------------------------------

    const user = await prisma.user.create({
      data: {
        studentId: normalizedStudentId,
        fullName: fullName.trim(),
        department: normalizedDepartment,
        email: normalizedEmail,
        phone: phone ? phone.trim() : null,

        passwordHash,

        role: "VOTER",

        // Email is not verified yet
        emailVerified: false,

        // Authority approval is still required
        verificationStatus: "PENDING",

        emailVerificationOtp: otp,
        emailVerificationOtpExpires: otpExpires
      }
    });

    // --------------------------------------------------
    // DEMO OTP
    // --------------------------------------------------

    console.log("====================================");
    console.log("VOTESPHERE DEMO OTP");
    console.log("Student:", user.studentId);
    console.log("Email:", user.email);
    console.log("Department:", user.department);
    console.log("OTP:", otp);
    console.log("Expires:", otpExpires);
    console.log("====================================");

    // --------------------------------------------------
    // Registration response
    // --------------------------------------------------

    return res.status(201).json({
      success: true,

      message:
        "Registration successful. Use the demo verification code to verify your email.",

      // Demo only
      developmentOtp: otp,

      user: {
        id: user.id,
        studentId: user.studentId,
        fullName: user.fullName,
        department: user.department,
        email: user.email,
        phone: user.phone,
        emailVerified: user.emailVerified,
        verificationStatus: user.verificationStatus
      }
    });

  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      success: false,
      message: "Registration failed."
    });
  }
}

// ======================================================
// VERIFY EMAIL
// ======================================================

async function verifyEmail(req, res) {
  try {
    const {
      email,
      otp
    } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message:
          "Email and verification code are required."
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedOtp = otp.toString().trim();

    // --------------------------------------------------
    // Find user
    // --------------------------------------------------

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    // --------------------------------------------------
    // Already verified
    // --------------------------------------------------

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified."
      });
    }

    // --------------------------------------------------
    // OTP missing
    // --------------------------------------------------

    if (
      !user.emailVerificationOtp ||
      !user.emailVerificationOtpExpires
    ) {
      return res.status(400).json({
        success: false,
        message:
          "No active verification code. Please register again."
      });
    }

    // --------------------------------------------------
    // OTP expired
    // --------------------------------------------------

    if (
      new Date() >
      user.emailVerificationOtpExpires
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Verification code has expired. Please register again."
      });
    }

    // --------------------------------------------------
    // Wrong OTP
    // --------------------------------------------------

    if (
      user.emailVerificationOtp !== normalizedOtp
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code."
      });
    }

    // --------------------------------------------------
    // Verify user
    // --------------------------------------------------

    const updatedUser =
      await prisma.user.update({
        where: {
          id: user.id
        },

        data: {
          emailVerified: true,
          emailVerificationOtp: null,
          emailVerificationOtpExpires: null
        },

        select: {
          id: true,
          studentId: true,
          fullName: true,
          department: true,
          email: true,
          phone: true,
          emailVerified: true,
          verificationStatus: true
        }
      });

    console.log(
      `Email verified successfully for ${updatedUser.email}`
    );

    return res.json({
      success: true,

      message:
        "Email verified successfully. Your account is now waiting for Authority approval.",

      user: updatedUser
    });

  } catch (error) {
    console.error(
      "Email verification error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Email verification failed."
    });
  }
}

// ======================================================
// LOGIN
// ======================================================

async function login(req, res) {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Email and password are required."
      });
    }

    const normalizedEmail =
      email.toLowerCase().trim();

    // --------------------------------------------------
    // Find user
    // --------------------------------------------------

    const user =
      await prisma.user.findUnique({
        where: {
          email: normalizedEmail
        }
      });

    // Don't reveal whether email exists
    if (!user) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid email or password."
      });
    }

    // --------------------------------------------------
    // Verify password
    // --------------------------------------------------

    const passwordValid =
      await argon2.verify(
        user.passwordHash,
        password
      );

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid email or password."
      });
    }

    // --------------------------------------------------
    // Email verification
    // --------------------------------------------------

    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your college email before logging in."
      });
    }

    // --------------------------------------------------
    // Rejected
    // --------------------------------------------------

    if (
      user.verificationStatus === "REJECTED"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your voter registration has been rejected by the Authority."
      });
    }

    // --------------------------------------------------
    // Suspended
    // --------------------------------------------------

    if (
      user.verificationStatus === "SUSPENDED"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your voter account has been suspended."
      });
    }

    // --------------------------------------------------
    // Pending
    // --------------------------------------------------

    if (
      user.verificationStatus === "PENDING"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your email is verified, but your voter account is still waiting for Authority approval."
      });
    }

    // ==================================================
    // CREATE SESSION
    // ==================================================

    const sessionToken =
      crypto.randomBytes(32).toString("hex");

    const tokenHash =
      crypto
        .createHash("sha256")
        .update(sessionToken)
        .digest("hex");

    const expiresAt =
      new Date(
        Date.now() + 8 * 60 * 60 * 1000
      );

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt
      }
    });

    // --------------------------------------------------
    // Secure HTTP-only cookie
    // --------------------------------------------------

    res.cookie(
      "votesphere_session",
      sessionToken,
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          "production",

        sameSite: "lax",

        maxAge:
          8 * 60 * 60 * 1000
      }
    );

    // --------------------------------------------------
    // Login response
    // --------------------------------------------------

    return res.json({
      success: true,

      message:
        "Login successful.",

      user: {
        id: user.id,
        studentId: user.studentId,
        fullName: user.fullName,
        department: user.department,
        email: user.email,
        phone: user.phone,
        role: user.role,
        emailVerified:
          user.emailVerified,
        verificationStatus:
          user.verificationStatus
      }
    });

  } catch (error) {
    console.error(
      "Login error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Login failed."
    });
  }
}
async function logout(req, res) {
  try {
    const sessionToken = req.cookies.votesphere_session;

    if (sessionToken) {
      const crypto = require("crypto");

      const tokenHash = crypto
        .createHash("sha256")
        .update(sessionToken)
        .digest("hex");

      await prisma.session.deleteMany({
        where: {
          tokenHash
        }
      });
    }

    res.clearCookie("votesphere_session", {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    });

    return res.json({
      success: true,
      message: "Logged out successfully."
    });

  } catch (error) {
    console.error("Logout error:", error);

    return res.status(500).json({
      success: false,
      message: "Logout failed."
    });
  }
}
// ======================================================
// EXPORT
// ======================================================

module.exports = {
  register,
  verifyEmail,
  login,
  logout
};