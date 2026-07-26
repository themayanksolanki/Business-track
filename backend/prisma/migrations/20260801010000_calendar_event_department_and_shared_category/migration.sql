-- CalendarEvent.categoryId used to point at the standalone CalendarCategory
-- table; it now points at the shared Category model (same one Project/Metric
-- use), and CalendarEvent gains its own departmentId — same shared
-- Department taxonomy. No existing calendar_events row has categoryId set,
-- so there's no data to remap.

-- DropForeignKey
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_categoryId_fkey";

-- DropForeignKey (calendar_categories' own FKs, before dropping the table)
ALTER TABLE "calendar_categories" DROP CONSTRAINT "calendar_categories_createdById_fkey";
ALTER TABLE "calendar_categories" DROP CONSTRAINT "calendar_categories_organizationId_fkey";
ALTER TABLE "calendar_categories" DROP CONSTRAINT "calendar_categories_updatedById_fkey";

-- DropTable
DROP TABLE "calendar_categories";

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN "departmentId" INTEGER;

-- CreateIndex
CREATE INDEX "calendar_events_departmentId_idx" ON "calendar_events"("departmentId");
CREATE INDEX "calendar_events_categoryId_idx" ON "calendar_events"("categoryId");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
