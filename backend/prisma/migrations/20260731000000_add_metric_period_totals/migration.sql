-- CreateEnum
CREATE TYPE "MetricFrequency" AS ENUM ('daily', 'weekly', 'monthly', 'quarterly', 'yearly');

-- CreateTable
CREATE TABLE "metric_period_totals" (
    "id" SERIAL NOT NULL,
    "metricId" INTEGER NOT NULL,
    "frequency" "MetricFrequency" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "actualTotal" DOUBLE PRECISION NOT NULL,
    "targetTotal" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_period_totals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metric_period_totals_metricId_frequency_year_month_key" ON "metric_period_totals"("metricId", "frequency", "year", "month");

-- AddForeignKey
ALTER TABLE "metric_period_totals" ADD CONSTRAINT "metric_period_totals_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
