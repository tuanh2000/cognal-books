-- AlterTable: add the book source-format discriminator (defaults existing rows to epub)
ALTER TABLE "books" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'epub';
