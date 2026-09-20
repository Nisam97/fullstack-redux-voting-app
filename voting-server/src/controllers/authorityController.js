const prisma = require("../config/prisma");

/*
=========================================================
GET ALL USERS
=========================================================
Authority can view all registered voters, regardless of
email verification status.
*/
async function getAllUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: "VOTER"
      },
      select: {
        id: true,
        studentId: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        emailVerified: true,
        verificationStatus: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error("Get all users error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load users."
    });
  }
}


/*
=========================================================
GET PENDING USERS
=========================================================
IMPORTANT:

Do NOT require emailVerified: true here.

This allows Authority to see newly registered users even
when their college email has not yet been verified.

The frontend can display the email verification status.
*/
async function getPendingUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      where: {
        role: "VOTER",
        verificationStatus: "PENDING"
      },
      select: {
        id: true,
        studentId: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        emailVerified: true,
        verificationStatus: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error("Get pending users error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load pending voter requests."
    });
  }
}


/*
=========================================================
APPROVE USER
=========================================================
Authority approval is independent from email verification.

This means:

emailVerified = false
verificationStatus = APPROVED

is allowed.

However, the login controller will still prevent login until
email verification is completed.
*/
async function approveUser(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required."
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    if (user.role !== "VOTER") {
      return res.status(400).json({
        success: false,
        message: "Only voter accounts can be approved."
      });
    }

    if (user.verificationStatus === "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "This voter is already approved."
      });
    }

    if (user.verificationStatus === "SUSPENDED") {
      return res.status(400).json({
        success: false,
        message:
          "Suspended users cannot be approved. Reactivate the voter first."
      });
    }

    if (user.verificationStatus === "REJECTED") {
      return res.status(400).json({
        success: false,
        message:
          "This voter was rejected. A new registration is required."
      });
    }

    const updatedUser = await prisma.user.update({
      where: {
        id
      },
      data: {
        verificationStatus: "APPROVED"
      },
      select: {
        id: true,
        studentId: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        emailVerified: true,
        verificationStatus: true,
        createdAt: true,
        updatedAt: true
      }
    });

    /*
    Keep the existing approval audit-log structure.
    */
    await prisma.auditLog.create({
      data: {
        action: "APPROVE_VOTER",
        performedBy: req.user.id,
        targetUserId: user.id
      }
    });

    return res.json({
      success: true,
      message:
        "Voter approved successfully.",
      user: updatedUser
    });
  } catch (error) {
    console.error("Approve user error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to approve voter."
    });
  }
}


/*
=========================================================
REJECT USER
=========================================================
*/
async function rejectUser(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required."
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    if (user.role !== "VOTER") {
      return res.status(400).json({
        success: false,
        message: "Only voter accounts can be rejected."
      });
    }

    if (user.verificationStatus === "REJECTED") {
      return res.status(400).json({
        success: false,
        message: "This voter is already rejected."
      });
    }

    const updatedUser = await prisma.user.update({
      where: {
        id
      },
      data: {
        verificationStatus: "REJECTED"
      },
      select: {
        id: true,
        studentId: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        emailVerified: true,
        verificationStatus: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await prisma.auditLog.create({
      data: {
        authorityId: req.user.id,
        action: "REJECT_VOTER",
        targetType: "USER",
        targetId: user.id,
        metadata: {
          studentId: user.studentId,
          email: user.email
        }
      }
    });

    return res.json({
      success: true,
      message: "Voter request rejected.",
      user: updatedUser
    });
  } catch (error) {
    console.error("Reject user error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to reject voter."
    });
  }
}


/*
=========================================================
SUSPEND USER
=========================================================
*/
async function suspendUser(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required."
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    if (user.role !== "VOTER") {
      return res.status(400).json({
        success: false,
        message: "Only voter accounts can be suspended."
      });
    }

    if (user.verificationStatus === "SUSPENDED") {
      return res.status(400).json({
        success: false,
        message: "This voter is already suspended."
      });
    }

    const updatedUser = await prisma.user.update({
      where: {
        id
      },
      data: {
        verificationStatus: "SUSPENDED"
      },
      select: {
        id: true,
        studentId: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        emailVerified: true,
        verificationStatus: true,
        createdAt: true,
        updatedAt: true
      }
    });

    /*
    Invalidate active sessions when a voter is suspended.
    This prevents an already logged-in suspended voter from
    continuing to use an existing session.
    */
    await prisma.session.deleteMany({
      where: {
        userId: user.id
      }
    });

    await prisma.auditLog.create({
      data: {
        authorityId: req.user.id,
        action: "SUSPEND_VOTER",
        targetType: "USER",
        targetId: user.id,
        metadata: {
          studentId: user.studentId,
          email: user.email
        }
      }
    });

    return res.json({
      success: true,
      message: "Voter suspended successfully.",
      user: updatedUser
    });
  } catch (error) {
    console.error("Suspend user error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to suspend voter."
    });
  }
}


/*
=========================================================
REACTIVATE USER
=========================================================
*/
async function reactivateUser(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required."
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    if (user.role !== "VOTER") {
      return res.status(400).json({
        success: false,
        message: "Only voter accounts can be reactivated."
      });
    }

    if (user.verificationStatus !== "SUSPENDED") {
      return res.status(400).json({
        success: false,
        message:
          "Only suspended voters can be reactivated."
      });
    }

    const updatedUser = await prisma.user.update({
      where: {
        id
      },
      data: {
        verificationStatus: "APPROVED"
      },
      select: {
        id: true,
        studentId: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        emailVerified: true,
        verificationStatus: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await prisma.auditLog.create({
      data: {
        authorityId: req.user.id,
        action: "REACTIVATE_VOTER",
        targetType: "USER",
        targetId: user.id,
        metadata: {
          studentId: user.studentId,
          email: user.email
        }
      }
    });

    return res.json({
      success: true,
      message: "Voter reactivated successfully.",
      user: updatedUser
    });
  } catch (error) {
    console.error("Reactivate user error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to reactivate voter."
    });
  }
}


/*
=========================================================
EXPORT CONTROLLERS
=========================================================
*/

module.exports = {
  getPendingUsers,
  getAllUsers,
  approveUser,
  rejectUser,
  suspendUser,
  reactivateUser
};