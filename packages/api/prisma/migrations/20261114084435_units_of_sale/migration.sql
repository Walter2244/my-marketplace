-- CreateEnum
CREATE TYPE "UnitOfSale" AS ENUM ('EACH', 'PER_HEAD', 'PER_KG', 'PER_CRATE');

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "unitOfSale" "UnitOfSale" NOT NULL DEFAULT 'EACH';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "unitOfSale" "UnitOfSale" NOT NULL DEFAULT 'EACH';
