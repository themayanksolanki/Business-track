-- CreateEnum
CREATE TYPE "MetricStatus" AS ENUM ('active', 'archived', 'deleted');

-- CreateTable
CREATE TABLE "metrics" (
    "id" SERIAL NOT NULL,
    "sequenceId" INTEGER,
    "organizationId" INTEGER,
    "departmentId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "MetricStatus" NOT NULL DEFAULT 'active',
    "order" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "ownerId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metrics_organizationId_idx" ON "metrics"("organizationId");

-- CreateIndex
CREATE INDEX "metrics_departmentId_idx" ON "metrics"("departmentId");

-- CreateIndex
CREATE INDEX "metrics_categoryId_idx" ON "metrics"("categoryId");

-- CreateIndex
CREATE INDEX "metrics_parentId_order_idx" ON "metrics"("parentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_organizationId_sequenceId_key" ON "metrics"("organizationId", "sequenceId");

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "metrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
