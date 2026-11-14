-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('DELIVERY', 'COLLECTION');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "collectable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubOrder" ADD COLUMN     "collectionCode" TEXT,
ADD COLUMN     "fulfilment" "Fulfilment" NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN     "readyAt" TIMESTAMP(3);
