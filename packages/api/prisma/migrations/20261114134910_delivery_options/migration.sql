-- CreateEnum
CREATE TYPE "DeliveryOptionKind" AS ENUM ('COLLECTION', 'FLAT_FEE', 'QUOTE');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('NONE', 'COLLECTION', 'FLAT_FEE', 'QUOTE');

-- AlterTable
ALTER TABLE "SubOrder" ADD COLUMN     "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryMethod" "DeliveryMethod" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "deliveryQuoteRef" TEXT;

-- CreateTable
CREATE TABLE "DeliveryOption" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "kind" "DeliveryOptionKind" NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOption_productId_kind_key" ON "DeliveryOption"("productId", "kind");

-- AddForeignKey
ALTER TABLE "DeliveryOption" ADD CONSTRAINT "DeliveryOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
