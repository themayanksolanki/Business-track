-- AlterTable
ALTER TABLE "group_messages" ADD COLUMN     "callType" "CallType",
ADD COLUMN     "meetingId" INTEGER;

-- AlterTable
ALTER TABLE "metrics" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "activeStatusFormId" INTEGER,
ADD COLUMN     "statusReportRecipients" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "status_form_submissions" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "formId" INTEGER,
    "formTitle" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "answers" JSONB NOT NULL DEFAULT '[]',
    "submittedById" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "recipients" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "status_form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_form_submissions_projectId_submittedAt_idx" ON "status_form_submissions"("projectId", "submittedAt");

-- CreateIndex
CREATE INDEX "group_messages_meetingId_idx" ON "group_messages"("meetingId");

-- AddForeignKey
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_activeStatusFormId_fkey" FOREIGN KEY ("activeStatusFormId") REFERENCES "status_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_form_submissions" ADD CONSTRAINT "status_form_submissions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_form_submissions" ADD CONSTRAINT "status_form_submissions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "status_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_form_submissions" ADD CONSTRAINT "status_form_submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
