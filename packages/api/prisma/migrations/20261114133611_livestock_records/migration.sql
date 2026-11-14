-- CreateTable
CREATE TABLE "AnimalIdentification" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "tagNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnimalIdentification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthRecord" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recordedOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthDeclaration" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "statement" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnimalIdentification_productId_key" ON "AnimalIdentification"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "AnimalIdentification_tagNumber_key" ON "AnimalIdentification"("tagNumber");

-- CreateIndex
CREATE INDEX "HealthRecord_productId_idx" ON "HealthRecord"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthDeclaration_productId_key" ON "HealthDeclaration"("productId");

-- AddForeignKey
ALTER TABLE "AnimalIdentification" ADD CONSTRAINT "AnimalIdentification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthRecord" ADD CONSTRAINT "HealthRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthDeclaration" ADD CONSTRAINT "HealthDeclaration_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
