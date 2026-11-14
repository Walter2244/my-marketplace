-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('FARM_OWNERSHIP', 'OFFER_LETTER', 'PERMIT', 'LEASE_AGREEMENT', 'AFFIDAVIT', 'DEALER_LICENCE');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VerificationApplication" (
    "id" SERIAL NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "idNumber" TEXT NOT NULL,
    "idCheckStatus" TEXT NOT NULL DEFAULT 'NOT_RUN',
    "holderName" TEXT NOT NULL,
    "relationshipNote" TEXT,
    "documentType" "DocumentType" NOT NULL,
    "documentRef" TEXT NOT NULL,
    "affidavitCommissioned" BOOLEAN NOT NULL DEFAULT false,
    "licenceNumber" TEXT,
    "farmName" TEXT,
    "province" TEXT,
    "district" TEXT,
    "saleLocation" TEXT,
    "reviewerNote" TEXT,
    "reviewedBy" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationApplication_vendorId_idx" ON "VerificationApplication"("vendorId");

-- AddForeignKey
ALTER TABLE "VerificationApplication" ADD CONSTRAINT "VerificationApplication_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
