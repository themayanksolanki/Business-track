-- AlterEnum
-- Postgres forbids using a newly-added enum value inside the same
-- transaction that adds it, so this stays its own migration (see
-- 20260721120000_add_draft_project_status for the same pattern).
ALTER TYPE "SequenceEntity" ADD VALUE 'metric';
