-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('cloudinary', 's3');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "storage" "StorageProvider" NOT NULL DEFAULT 'cloudinary';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "planStorage" "StorageProvider" NOT NULL DEFAULT 'cloudinary';
