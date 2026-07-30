-- CreateTable
CREATE TABLE "_ProjectItemLinkedEvents" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_ProjectItemLinkedEvents_AB_unique" ON "_ProjectItemLinkedEvents"("A", "B");

-- CreateIndex
CREATE INDEX "_ProjectItemLinkedEvents_B_index" ON "_ProjectItemLinkedEvents"("B");

-- AddForeignKey
ALTER TABLE "_ProjectItemLinkedEvents" ADD CONSTRAINT "_ProjectItemLinkedEvents_A_fkey" FOREIGN KEY ("A") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProjectItemLinkedEvents" ADD CONSTRAINT "_ProjectItemLinkedEvents_B_fkey" FOREIGN KEY ("B") REFERENCES "project_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
