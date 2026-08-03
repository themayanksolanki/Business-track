-- CreateEnum
CREATE TYPE "MetricMemberRole" AS ENUM ('owner', 'editor', 'viewer');

-- CreateTable
CREATE TABLE "metric_members" (
    "id" SERIAL NOT NULL,
    "metricId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "MetricMemberRole" NOT NULL DEFAULT 'editor',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" INTEGER,

    CONSTRAINT "metric_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metric_members_metricId_idx" ON "metric_members"("metricId");

-- CreateIndex
CREATE UNIQUE INDEX "metric_members_metricId_userId_key" ON "metric_members"("metricId", "userId");

-- AddForeignKey
ALTER TABLE "metric_members" ADD CONSTRAINT "metric_members_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_members" ADD CONSTRAINT "metric_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_members" ADD CONSTRAINT "metric_members_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
