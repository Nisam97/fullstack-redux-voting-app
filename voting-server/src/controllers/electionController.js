const prisma = require("../config/prisma");

async function createElection(req, res) {
  try {
    const {
      title,
      description,
      position,
      startTime,
      endTime
    } = req.body;

    if (!title || !position || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "Title, position, start time and end time are required."
      });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid election date or time."
      });
    }

    if (start >= end) {
      return res.status(400).json({
        success: false,
        message: "Election end time must be after start time."
      });
    }

    const election = await prisma.election.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        position: position.trim(),
        startTime: start,
        endTime: end,
        status: "DRAFT",
        resultsReleased: false,
        createdById: req.user.id
      }
    });

    await prisma.auditLog.create({
      data: {
        authorityId: req.user.id,
        action: "CREATE_ELECTION",
        targetType: "ELECTION",
        targetId: election.id,
        metadata: {
          title: election.title,
          position: election.position
        }
      }
    });

    return res.status(201).json({
      success: true,
      message: "Election created successfully.",
      election
    });
  } catch (error) {
    console.error("Create election error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create election."
    });
  }
}

async function getAllElections(req, res) {
  try {
    const elections = await prisma.election.findMany({
      include: {
        _count: {
          select: {
            candidates: true,
            votes: true,
            predictions: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.json({
      success: true,
      elections
    });
  } catch (error) {
    console.error("Get elections error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve elections."
    });
  }
}

async function getElectionById(req, res) {
  try {
    const { id } = req.params;

    const election = await prisma.election.findUnique({
      where: { id },
      include: {
        candidates: {
          where: {
            active: true
          },
          orderBy: {
            createdAt: "asc"
          }
        },
        _count: {
          select: {
            votes: true,
            predictions: true
          }
        }
      }
    });

    if (!election) {
      return res.status(404).json({
        success: false,
        message: "Election not found."
      });
    }

    return res.json({
      success: true,
      election
    });
  } catch (error) {
    console.error("Get election error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve election."
    });
  }
}

async function updateElection(req, res) {
  try {
    const { id } = req.params;

    const election = await prisma.election.findUnique({
      where: { id }
    });

    if (!election) {
      return res.status(404).json({
        success: false,
        message: "Election not found."
      });
    }

    // Only draft elections can be edited.
    if (election.status !== "DRAFT") {
      return res.status(400).json({
        success: false,
        message: "Only draft elections can be edited."
      });
    }

    const {
      title,
      description,
      position,
      startTime,
      endTime
    } = req.body;

    const updatedStart = startTime
      ? new Date(startTime)
      : election.startTime;

    const updatedEnd = endTime
      ? new Date(endTime)
      : election.endTime;

    if (
      Number.isNaN(updatedStart.getTime()) ||
      Number.isNaN(updatedEnd.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid election date or time."
      });
    }

    if (updatedStart >= updatedEnd) {
      return res.status(400).json({
        success: false,
        message: "Election end time must be after start time."
      });
    }

    const updatedElection = await prisma.election.update({
      where: { id },
      data: {
        ...(title !== undefined && {
          title: title.trim()
        }),
        ...(description !== undefined && {
          description: description?.trim() || null
        }),
        ...(position !== undefined && {
          position: position.trim()
        }),
        startTime: updatedStart,
        endTime: updatedEnd
      }
    });

    await prisma.auditLog.create({
      data: {
        authorityId: req.user.id,
        action: "UPDATE_ELECTION",
        targetType: "ELECTION",
        targetId: election.id,
        metadata: {
          title: updatedElection.title,
          position: updatedElection.position
        }
      }
    });

    return res.json({
      success: true,
      message: "Election updated successfully.",
      election: updatedElection
    });
  } catch (error) {
    console.error("Update election error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update election."
    });
  }
}

async function publishElection(req, res) {
  try {
    const { id } = req.params;

    const election = await prisma.election.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            candidates: true
          }
        }
      }
    });

    if (!election) {
      return res.status(404).json({
        success: false,
        message: "Election not found."
      });
    }

    if (election.status !== "DRAFT") {
      return res.status(400).json({
        success: false,
        message: "Only draft elections can be published."
      });
    }

    if (election._count.candidates < 2) {
      return res.status(400).json({
        success: false,
        message: "At least two candidates are required before publishing."
      });
    }

    const updatedElection = await prisma.election.update({
      where: { id },
      data: {
        status: "PUBLISHED"
      }
    });

    await prisma.auditLog.create({
      data: {
        authorityId: req.user.id,
        action: "PUBLISH_ELECTION",
        targetType: "ELECTION",
        targetId: election.id,
        metadata: {
          title: election.title
        }
      }
    });

    return res.json({
      success: true,
      message: "Election published successfully.",
      election: updatedElection
    });
  } catch (error) {
    console.error("Publish election error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to publish election."
    });
  }
}

async function openElection(req, res) {
  try {
    const { id } = req.params;

    const election = await prisma.election.findUnique({
      where: { id }
    });

    if (!election) {
      return res.status(404).json({
        success: false,
        message: "Election not found."
      });
    }

    if (election.status !== "PUBLISHED") {
      return res.status(400).json({
        success: false,
        message: "Only published elections can be opened."
      });
    }

    const now = new Date();

    if (now < election.startTime) {
      return res.status(400).json({
        success: false,
        message: "The election start time has not been reached."
      });
    }

    if (now >= election.endTime) {
      return res.status(400).json({
        success: false,
        message: "The election end time has already passed."
      });
    }

    const updatedElection = await prisma.election.update({
      where: { id },
      data: {
        status: "OPEN",
        resultsReleased: false
      }
    });

    await prisma.auditLog.create({
      data: {
        authorityId: req.user.id,
        action: "OPEN_ELECTION",
        targetType: "ELECTION",
        targetId: election.id,
        metadata: {
          title: election.title
        }
      }
    });

    return res.json({
      success: true,
      message: "Election opened successfully.",
      election: updatedElection
    });
  } catch (error) {
    console.error("Open election error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to open election."
    });
  }
}

async function closeElection(req, res) {
  try {
    const { id } = req.params;

    const election = await prisma.election.findUnique({
      where: { id }
    });

    if (!election) {
      return res.status(404).json({
        success: false,
        message: "Election not found."
      });
    }

    if (election.status !== "OPEN") {
      return res.status(400).json({
        success: false,
        message: "Only open elections can be closed."
      });
    }

    const updatedElection = await prisma.election.update({
      where: { id },
      data: {
        status: "CLOSED"
      }
    });

    await prisma.auditLog.create({
      data: {
        authorityId: req.user.id,
        action: "CLOSE_ELECTION",
        targetType: "ELECTION",
        targetId: election.id,
        metadata: {
          title: election.title
        }
      }
    });

    return res.json({
      success: true,
      message: "Election closed successfully.",
      election: updatedElection
    });
  } catch (error) {
    console.error("Close election error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to close election."
    });
  }
}

module.exports = {
  createElection,
  getAllElections,
  getElectionById,
  updateElection,
  publishElection,
  openElection,
  closeElection
};