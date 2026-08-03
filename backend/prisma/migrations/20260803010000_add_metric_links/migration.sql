-- CreateTable
CREATE TABLE "metric_links" (
    "id" SERIAL NOT NULL,
    "metricId" INTEGER NOT NULL,
    "subMetricId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metric_links_metricId_idx" ON "metric_links"("metricId");

-- CreateIndex
CREATE INDEX "metric_links_subMetricId_idx" ON "metric_links"("subMetricId");

-- CreateIndex
CREATE UNIQUE INDEX "metric_links_metricId_subMetricId_key" ON "metric_links"("metricId", "subMetricId");

-- AddForeignKey
ALTER TABLE "metric_links" ADD CONSTRAINT "metric_links_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_links" ADD CONSTRAINT "metric_links_subMetricId_fkey" FOREIGN KEY ("subMetricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_links" ADD CONSTRAINT "metric_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
