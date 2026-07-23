import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import AppError from '../utils/AppError.js';
import { s3Storage } from '../lib/s3.js';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'multipart/x-zip',
  'application/octet-stream',
];

// Cloudinary's Free-plan cap (10MB for image/raw resources) made real-world
// attachments fail outright, so these now go to S3 instead — see
// Attachment.storage / Project.planStorage. 100MB comfortably covers
// everything in ALLOWED_MIME_TYPES including video.
export const MAX_ATTACHMENT_SIZE_MB = 100;
export const MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;

const SUPPORTED_TYPES_LABEL =
  'images (JPG, PNG, WEBP, GIF), videos (MP4, WEBM, MOV, MKV), PDF, Word, Excel, PowerPoint, ZIP, and text/CSV files';

export const attachmentUpload = multer({
  storage: s3Storage('attachments'),
  limits: { fileSize: MAX_ATTACHMENT_SIZE },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          `"${file.originalname}" is not a supported file type. Supported formats: ${SUPPORTED_TYPES_LABEL}.`,
          400
        )
      );
    }
  },
}).single('file');
