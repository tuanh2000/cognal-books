-- CreateTable
CREATE TABLE "saved_translations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "cfiRange" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "translatedText" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_translations_userId_bookId_idx" ON "saved_translations"("userId", "bookId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_translations_userId_bookId_cfiRange_key" ON "saved_translations"("userId", "bookId", "cfiRange");

-- AddForeignKey
ALTER TABLE "saved_translations" ADD CONSTRAINT "saved_translations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_translations" ADD CONSTRAINT "saved_translations_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

