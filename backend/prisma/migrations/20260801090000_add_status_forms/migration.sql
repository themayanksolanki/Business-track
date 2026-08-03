-- CreateEnum
CREATE TYPE "StatusFormQuestionType" AS ENUM ('shortText', 'longText', 'richText', 'singleSelect', 'multiSelect', 'attachment');

-- CreateTable
CREATE TABLE "status_forms" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_form_questions" (
    "id" SERIAL NOT NULL,
    "formId" INTEGER NOT NULL,
    "type" "StatusFormQuestionType" NOT NULL,
    "label" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "status_form_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_forms_organizationId_idx" ON "status_forms"("organizationId");

-- CreateIndex
CREATE INDEX "status_form_questions_formId_order_idx" ON "status_form_questions"("formId", "order");

-- AddForeignKey
ALTER TABLE "status_forms" ADD CONSTRAINT "status_forms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_forms" ADD CONSTRAINT "status_forms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_forms" ADD CONSTRAINT "status_forms_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_form_questions" ADD CONSTRAINT "status_form_questions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "status_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
