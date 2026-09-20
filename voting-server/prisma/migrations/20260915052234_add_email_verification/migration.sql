-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerificationOtp" TEXT,
ADD COLUMN     "emailVerificationOtpExpires" TIMESTAMP(3);
