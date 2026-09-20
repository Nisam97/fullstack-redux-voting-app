function requireApprovedVoter(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required."
    });
  }

  if (req.user.role !== "VOTER") {
    return res.status(403).json({
      success: false,
      message: "Voter access required."
    });
  }

  if (!req.user.emailVerified) {
    return res.status(403).json({
      success: false,
      message: "Please verify your college email."
    });
  }

  if (req.user.verificationStatus !== "APPROVED") {
    return res.status(403).json({
      success: false,
      message: "Your voter account has not been approved by the Authority."
    });
  }

  next();
}

export {
  requireApprovedVoter
};