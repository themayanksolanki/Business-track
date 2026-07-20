-- CreateEnum
CREATE TYPE "SequenceEntity" AS ENUM ('user', 'project', 'task', 'projectItem', 'projectRole');

-- DropIndex
DROP INDEX "projects_numericId_key";

-- DropIndex
DROP INDEX "project_items_numericId_key";

-- DropIndex
DROP INDEX "project_roles_numericId_key";

-- DropIndex
DROP INDEX "tasks_numericId_key";

-- DropIndex
DROP INDEX "users_numericId_key";

-- AlterTable
ALTER TABLE "projects" RENAME COLUMN "numericId" TO "sequenceId";

-- AlterTable
ALTER TABLE "project_items" RENAME COLUMN "numericId" TO "sequenceId";

-- AlterTable
ALTER TABLE "project_items" ADD COLUMN     "organizationId" INTEGER;

-- AlterTable
ALTER TABLE "project_roles" RENAME COLUMN "numericId" TO "sequenceId";

-- AlterTable
ALTER TABLE "tasks" RENAME COLUMN "numericId" TO "sequenceId";

-- AlterTable
ALTER TABLE "users" RENAME COLUMN "numericId" TO "sequenceId";

-- CreateTable
CREATE TABLE "org_sequences" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "entity" "SequenceEntity" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "org_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_sequences_organizationId_entity_key" ON "org_sequences"("organizationId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organizationId_sequenceId_key" ON "projects"("organizationId", "sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "project_items_organizationId_sequenceId_key" ON "project_items"("organizationId", "sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "project_roles_organizationId_sequenceId_key" ON "project_roles"("organizationId", "sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organizationId_sequenceId_key" ON "tasks"("organizationId", "sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_sequenceId_key" ON "users"("organizationId", "sequenceId");

-- AddForeignKey
ALTER TABLE "project_items" ADD CONSTRAINT "project_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_sequences" ADD CONSTRAINT "org_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: numericId was never populated by any application code
-- (verified — dead field since the initial migration), so there's nothing to
-- preserve from it. What follows backfills real per-organization sequence
-- numbers for existing rows instead of leaving them permanently blank.

-- Backfill: ProjectItem has no direct organization relation, only projectId
-- -> Project.organizationId, so denormalize it from the parent project.
UPDATE "project_items" pi
SET "organizationId" = p."organizationId"
FROM "projects" p
WHERE pi."projectId" = p."id";

-- Backfill: assign 1, 2, 3... per organization (ordered by creation time) to
-- every existing row that belongs to an organization. Rows with no
-- organization (e.g. a self-serve signup that never joined one) keep
-- sequenceId = NULL, matching how the dead numericId field already behaved.
UPDATE "users" u
SET "sequenceId" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS rn
  FROM "users"
  WHERE "organizationId" IS NOT NULL
) sub
WHERE u."id" = sub."id";

UPDATE "projects" p
SET "sequenceId" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS rn
  FROM "projects"
  WHERE "organizationId" IS NOT NULL
) sub
WHERE p."id" = sub."id";

UPDATE "tasks" t
SET "sequenceId" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS rn
  FROM "tasks"
  WHERE "organizationId" IS NOT NULL
) sub
WHERE t."id" = sub."id";

UPDATE "project_items" pi
SET "sequenceId" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS rn
  FROM "project_items"
  WHERE "organizationId" IS NOT NULL
) sub
WHERE pi."id" = sub."id";

UPDATE "project_roles" pr
SET "sequenceId" = sub.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") AS rn
  FROM "project_roles"
  WHERE "organizationId" IS NOT NULL
) sub
WHERE pr."id" = sub."id";

-- Seed org_sequences so the next created row per (org, entity) continues
-- from the backfilled max instead of restarting at 1.
INSERT INTO "org_sequences" ("organizationId", "entity", "value")
SELECT "organizationId", 'user', MAX("sequenceId") FROM "users" WHERE "organizationId" IS NOT NULL GROUP BY "organizationId";

INSERT INTO "org_sequences" ("organizationId", "entity", "value")
SELECT "organizationId", 'project', MAX("sequenceId") FROM "projects" WHERE "organizationId" IS NOT NULL GROUP BY "organizationId";

INSERT INTO "org_sequences" ("organizationId", "entity", "value")
SELECT "organizationId", 'task', MAX("sequenceId") FROM "tasks" WHERE "organizationId" IS NOT NULL GROUP BY "organizationId";

INSERT INTO "org_sequences" ("organizationId", "entity", "value")
SELECT "organizationId", 'projectItem', MAX("sequenceId") FROM "project_items" WHERE "organizationId" IS NOT NULL GROUP BY "organizationId";

INSERT INTO "org_sequences" ("organizationId", "entity", "value")
SELECT "organizationId", 'projectRole', MAX("sequenceId") FROM "project_roles" WHERE "organizationId" IS NOT NULL GROUP BY "organizationId";
