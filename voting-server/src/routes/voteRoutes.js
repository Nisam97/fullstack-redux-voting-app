const express = require("express");

const {
  castVote,
  getVotingStatus
} = require("../controllers/voteController");

const {
  requireAuth
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);

router.post("/", castVote);

router.get(
  "/status/:electionId",
  getVotingStatus
);

module.exports = router;