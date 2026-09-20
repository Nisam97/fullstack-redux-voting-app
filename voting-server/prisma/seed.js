const argon2 = require("argon2");
const prisma = require("../src/config/prisma");

async function main() {
  const authorityEmail = process.env.AUTHORITY_EMAIL;
  const authorityPassword = process.env.AUTHORITY_PASSWORD;
  const authorityName = process.env.AUTHORITY_NAME;
  const authorityStudentId = process.env.AUTHORITY_STUDENT_ID;

  if (
    !authorityEmail ||
    !authorityPassword ||
    !authorityName ||
    !authorityStudentId
  ) {
    throw new Error(
      "Missing authority environment variables."
    );
  }

  const passwordHash = await argon2.hash(authorityPassword);

  const authority = await prisma.user.upsert({
    where: {
      email: authorityEmail
    },
    update: {
      fullName: authorityName,
      studentId: authorityStudentId,
      passwordHash,
      role: "AUTHORITY",
      emailVerified: true,
      verificationStatus: "APPROVED"
    },
    create: {
      studentId: authorityStudentId,
      fullName: authorityName,
      email: authorityEmail,
      passwordHash,
      role: "AUTHORITY",
      emailVerified: true,
      verificationStatus: "APPROVED"
    }
  });

  console.log("Authority account created/updated successfully.");
  console.log("Authority ID:", authority.id);
  console.log("Authority email:", authority.email);
}

main()
  .catch((error) => {
    console.error("Authority seed error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });