const crypto = require("crypto");
const prisma = require("../config/prisma");

// =========================================================
// GENERATE UNIQUE RECEIPT NUMBER
// =========================================================

function generateReceiptNumber() {
  return (
    "VS-" +
    new Date().getFullYear() +
    "-" +
    crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase()
  );
}


// =========================================================
// CAST OFFICIAL VOTE
// =========================================================

async function castVote(req, res) {
  try {
    const voterId = req.user.id;

    const { candidateName } = req.body;

    // -------------------------------------------------------
    // VALIDATE CANDIDATE
    // -------------------------------------------------------

    if (!candidateName || !candidateName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Candidate selection is required."
      });
    }

    // -------------------------------------------------------
    // FIND CURRENT OPEN ELECTION
    // -------------------------------------------------------

    const now = new Date();

    const election = await prisma.election.findFirst({
      where: {
        status: "OPEN",

        startTime: {
          lte: now
        },

        endTime: {
          gte: now
        }
      },

      orderBy: {
        createdAt: "desc"
      }
    });

    if (!election) {
      return res.status(404).json({
        success: false,
        message:
          "No active election is currently available for voting."
      });
    }

    // -------------------------------------------------------
    // FIND VOTER
    // -------------------------------------------------------

    const voter = await prisma.user.findUnique({
      where: {
        id: voterId
      }
    });

    if (!voter) {
      return res.status(404).json({
        success: false,
        message: "Voter account not found."
      });
    }

    // -------------------------------------------------------
    // CHECK VOTER ROLE
    // -------------------------------------------------------

    if (voter.role !== "VOTER") {
      return res.status(403).json({
        success: false,
        message:
          "Only registered voters can cast an official vote."
      });
    }

    // -------------------------------------------------------
    // CHECK EMAIL VERIFICATION
    // -------------------------------------------------------

    if (!voter.emailVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your college email before voting."
      });
    }

    // -------------------------------------------------------
    // CHECK AUTHORITY APPROVAL
    // -------------------------------------------------------

    if (voter.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message:
          "Your voter account has not been approved by the Authority."
      });
    }

    // -------------------------------------------------------
    // FIND SELECTED CANDIDATE
    // -------------------------------------------------------

    const candidate = await prisma.candidate.findFirst({
      where: {
        electionId: election.id,

        name: candidateName.trim(),

        active: true
      }
    });

    if (!candidate) {
      return res.status(400).json({
        success: false,
        message:
          "The selected candidate was not found in the active election."
      });
    }

    // -------------------------------------------------------
    // CHECK WHETHER VOTER HAS ALREADY VOTED
    // -------------------------------------------------------

    const existingVote = await prisma.vote.findUnique({
      where: {
        electionId_voterId: {
          electionId: election.id,
          voterId: voterId
        }
      }
    });

    if (existingVote) {
      return res.status(409).json({
        success: false,
        alreadyVoted: true,

        message:
          "You have already voted in this election. Your vote is final and cannot be changed.",

        vote: {
          receiptNumber: existingVote.receiptNumber
        }
      });
    }

    // -------------------------------------------------------
    // GENERATE RECEIPT BEFORE SAVING VOTE
    // -------------------------------------------------------

    const receiptNumber = generateReceiptNumber();

    // -------------------------------------------------------
    // CREATE PERMANENT OFFICIAL VOTE
    // -------------------------------------------------------

    const vote = await prisma.vote.create({
      data: {
        electionId: election.id,

        candidateId: candidate.id,

        voterId: voterId,

        receiptNumber: receiptNumber
      }
    });

    // -------------------------------------------------------
    // AUDIT LOG
    // -------------------------------------------------------

    try {
      await prisma.auditLog.create({
        data: {
          authorityId: voterId,

          targetType: "VOTE",

          targetId: vote.id,

          metadata: {
            action: "OFFICIAL_VOTE_CAST",

            electionId: election.id,

            candidateId: candidate.id,

            candidateName: candidate.name,

            receiptNumber: receiptNumber
          }
        }
      });
    } catch (auditError) {
      console.log(
        "Audit log warning:",
        auditError.message
      );
    }

    // -------------------------------------------------------
    // SUCCESS
    // -------------------------------------------------------

    return res.status(201).json({
      success: true,

      message:
        "Your official vote has been successfully finalized.",

      vote: {
        id: vote.id,

        electionId: election.id,

        electionTitle: election.title,

        candidateId: candidate.id,

        candidateName: candidate.name,

        receiptNumber: vote.receiptNumber,

        votedAt: vote.createdAt
      }
    });

  } catch (error) {

    // -------------------------------------------------------
    // UNIQUE CONSTRAINT
    // -------------------------------------------------------

    if (error.code === "P2002") {

      return res.status(409).json({
        success: false,

        alreadyVoted: true,

        message:
          "Your vote could not be submitted because a voting record already exists for this election."
      });
    }

    console.error(
      "Cast vote error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Unable to submit your official vote."
    });
  }
}


// =========================================================
// CHECK VOTING STATUS
// =========================================================

async function getVotingStatus(req, res) {
  try {

    const voterId = req.user.id;

    const { electionId } = req.params;

    if (!electionId) {
      return res.status(400).json({
        success: false,

        message:
          "Election ID is required."
      });
    }

    const vote = await prisma.vote.findUnique({
      where: {
        electionId_voterId: {
          electionId: electionId,

          voterId: voterId
        }
      },

      select: {
        id: true,

        receiptNumber: true,

        createdAt: true
      }
    });

    return res.json({
      success: true,

      hasVoted: Boolean(vote),

      vote: vote
        ? {
            id: vote.id,

            receiptNumber: vote.receiptNumber,

            votedAt: vote.createdAt
          }
        : null
    });

  } catch (error) {

    console.error(
      "Voting status error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Unable to check voting status."
    });
  }
}


// =========================================================
// EXPORT
// =========================================================

module.exports = {
  castVote,
  getVotingStatus
};