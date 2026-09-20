/*
  Warnings:

  - You are about to drop the column `receipt` on the `Vote` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[receiptNumber]` on the table `Vote` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `receiptNumber` to the `Vote` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Vote" DROP CONSTRAINT "Vote_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "Vote" DROP CONSTRAINT "Vote_voterId_fkey";

-- DropIndex
DROP INDEX "Vote_electionId_idx";

-- DropIndex
DROP INDEX "Vote_receipt_key";

-- AlterTable
ALTER TABLE "Vote" DROP COLUMN "receipt",
ADD COLUMN     "receiptNumber" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Vote_receiptNumber_key" ON "Vote"("receiptNumber");

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
