import { cloudinary } from '../middleware/upload.js';
import { deleteS3Object } from '../lib/s3.js';

// Dispatches to whichever provider a given row's blob actually lives in
// (Attachment.storage / Project.planStorage) — best-effort, so a blob
// that's already gone from the provider doesn't block the DB row deletion.
export const destroyBlob = async ({ storage, publicId }) => {
  if (!publicId) return;
  if (storage === 's3') {
    await deleteS3Object(publicId).catch(() => {});
  } else {
    await cloudinary.uploader.destroy(publicId).catch(() => {});
  }
};
