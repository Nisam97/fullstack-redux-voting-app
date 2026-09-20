const express = require("express");

const {
  createElection,
  getAllElections,
  getElectionById,
  updateElection,
  publishElection,
  openElection,
  closeElection
} = require("../controllers/electionController");

const {
  requireAuth,
  requireAuthority
} = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth, requireAuthority);

router.post("/", createElection);

router.get("/", getAllElections);

router.get("/:id", getElectionById);

router.patch("/:id", updateElection);

router.patch("/:id/publish", publishElection);

router.patch("/:id/open", openElection);

router.patch("/:id/close", closeElection);

module.exports = router;