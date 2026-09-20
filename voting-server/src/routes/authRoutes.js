const express = require("express");

const {
  register,
  verifyEmail,
  login,
  logout
} = require("../controllers/authController");

const {
  requireAuth
} = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/login", login);
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user.id,
      studentId: req.user.studentId,
      fullName: req.user.fullName,
      department: req.user.department,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role,
      emailVerified: req.user.emailVerified,
      verificationStatus: req.user.verificationStatus
    }
  });
});

module.exports = router;