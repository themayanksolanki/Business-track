-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('scheduled', 'live', 'ended', 'cancelled');

-- CreateEnum
CREATE TYPE "MeetingParticipantRole" AS ENUM ('host', 'coHost', 'attendee');

-- CreateEnum
CREATE TYPE "ApproverStatus" AS ENUM ('pending', 'approved', 'changesRequested', 'cancelled');

-- CreateEnum
CREATE TYPE "ApprovalHistoryAction" AS ENUM ('approverAssigned', 'approverRemoved', 'approved', 'changesRequested', 'commentAdded', 'commentEdited', 'commentDeleted', 'reRequested', 'statusChanged');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'taskApprovalRequested';
ALTER TYPE "NotificationType" ADD VALUE 'taskApproved';
ALTER TYPE "NotificationType" ADD VALUE 'taskChangesRequested';
ALTER TYPE "NotificationType" ADD VALUE 'taskApprovalReRequested';
ALTER TYPE "NotificationType" ADD VALUE 'taskFullyApproved';
ALTER TYPE "NotificationType" ADD VALUE 'taskApprovalCommentAdded';

-- AlterEnum
ALTER TYPE "SequenceEntity" ADD VALUE 'meeting';

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "metricId" INTEGER;

-- CreateTable
CREATE TABLE "meetings" (
    "id" SERIAL NOT NULL,
    "sequenceId" INTEGER,
    "roomCode" TEXT NOT NULL,
    "title" TEXT,
    "hostId" INTEGER NOT NULL,
    "organizationId" INTEGER,
    "callType" "CallType" NOT NULL DEFAULT 'video',
    "status" "MeetingStatus" NOT NULL DEFAULT 'scheduled',
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" SERIAL NOT NULL,
    "meetingId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "MeetingParticipantRole" NOT NULL DEFAULT 'attendee',
    "invited" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_settings" (
    "id" SERIAL NOT NULL,
    "meetingId" INTEGER NOT NULL,
    "waitingRoomEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowGuestJoin" BOOLEAN NOT NULL DEFAULT true,
    "muteOnEntry" BOOLEAN NOT NULL DEFAULT false,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "meeting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_approvers" (
    "id" SERIAL NOT NULL,
    "projectItemId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "ApproverStatus" NOT NULL DEFAULT 'pending',
    "assignedById" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "task_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_history" (
    "id" SERIAL NOT NULL,
    "projectItemId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" "ApprovalHistoryAction" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_comments" (
    "id" SERIAL NOT NULL,
    "projectItemId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "replyToId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meetings_roomCode_key" ON "meetings"("roomCode");

-- CreateIndex
CREATE INDEX "meetings_organizationId_idx" ON "meetings"("organizationId");

-- CreateIndex
CREATE INDEX "meetings_hostId_idx" ON "meetings"("hostId");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_organizationId_sequenceId_key" ON "meetings"("organizationId", "sequenceId");

-- CreateIndex
CREATE INDEX "meeting_participants_meetingId_idx" ON "meeting_participants"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_meetingId_userId_key" ON "meeting_participants"("meetingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_settings_meetingId_key" ON "meeting_settings"("meetingId");

-- CreateIndex
CREATE INDEX "message_reactions_messageId_idx" ON "message_reactions"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "message_reactions_messageId_userId_key" ON "message_reactions"("messageId", "userId");

-- CreateIndex
CREATE INDEX "task_approvers_projectItemId_idx" ON "task_approvers"("projectItemId");

-- CreateIndex
CREATE UNIQUE INDEX "task_approvers_projectItemId_userId_key" ON "task_approvers"("projectItemId", "userId");

-- CreateIndex
CREATE INDEX "approval_history_projectItemId_createdAt_idx" ON "approval_history"("projectItemId", "createdAt");

-- CreateIndex
CREATE INDEX "approval_comments_projectItemId_idx" ON "approval_comments"("projectItemId");

-- CreateIndex
CREATE INDEX "attachments_metricId_idx" ON "attachments"("metricId");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_settings" ADD CONSTRAINT "meeting_settings_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvers" ADD CONSTRAINT "task_approvers_projectItemId_fkey" FOREIGN KEY ("projectItemId") REFERENCES "project_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvers" ADD CONSTRAINT "task_approvers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_approvers" ADD CONSTRAINT "task_approvers_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_projectItemId_fkey" FOREIGN KEY ("projectItemId") REFERENCES "project_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_projectItemId_fkey" FOREIGN KEY ("projectItemId") REFERENCES "project_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "approval_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
