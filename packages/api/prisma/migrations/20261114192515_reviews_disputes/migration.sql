-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED_FOR_BUYER', 'RESOLVED_FOR_VENDOR');

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "subOrderId" INTEGER NOT NULL,
    "reviewerId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" SERIAL NOT NULL,
    "subOrderId" INTEGER NOT NULL,
    "openedById" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "decisionNote" TEXT,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_subOrderId_key" ON "Review"("subOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_subOrderId_key" ON "Dispute"("subOrderId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "SubOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "SubOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
