const express = require("express");

const {
  getPendingUsers,
  getAllUsers,
  approveUser,
  rejectUser,
  suspendUser,
  reactivateUser
} = require("../controllers/authorityController");

const {
  requireAuth,
  requireAuthority
} = require("../middleware/authMiddleware");

const router = express.Router();

// Every Authority API requires authentication + Authority role.
router.use(requireAuth, requireAuthority);

// User management
router.get("/users", getAllUsers);
router.get("/users/pending", getPendingUsers);

router.patch("/users/:id/approve", approveUser);
router.patch("/users/:id/reject", rejectUser);
router.patch("/users/:id/suspend", suspendUser);
router.patch("/users/:id/reactivate", reactivateUser);

module.exports = router;