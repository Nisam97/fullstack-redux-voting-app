const crypto = require("crypto");

const prisma = require("../config/prisma");

async function requireAuth(req, res, next) {
  try {
    const sessionToken = req.cookies.votesphere_session;

    if (!sessionToken) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(sessionToken)
      .digest("hex");

    const session = await prisma.session.findUnique({
      where: {
        tokenHash
      },
      include: {
        user: true
      }
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Invalid session."
      });
    }

    if (new Date() > session.expiresAt) {
      await prisma.session.delete({
        where: {
          id: session.id
        }
      });

      return res.status(401).json({
        success: false,
        message: "Session expired. Please log in again."
      });
    }

    req.user = session.user;
    req.session = session;

    next();
  } catch (error) {
    console.error("Authentication error:", error);

    return res.status(500).json({
      success: false,
      message: "Authentication failed."
    });
  }
}

async function requireAuthority(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required."
    });
  }

  if (req.user.role !== "AUTHORITY") {
    return res.status(403).json({
      success: false,
      message: "Authority access required."
    });
  }

  next();
}

module.exports = {
  requireAuth,
  requireAuthority
};