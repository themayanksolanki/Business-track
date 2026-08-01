-- AlterTable
ALTER TABLE "_ProjectItemLinkedEvents" ADD CONSTRAINT "_ProjectItemLinkedEvents_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ProjectItemLinkedEvents_AB_unique";
