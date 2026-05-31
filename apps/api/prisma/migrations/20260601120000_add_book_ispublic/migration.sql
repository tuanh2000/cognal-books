-- AlterTable
ALTER TABLE "books" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "books_isPublic_idx" ON "books"("isPublic");
