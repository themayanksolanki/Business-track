import mongoose from 'mongoose';

let bucket;

const getBucket = () => {
  if (!bucket) {
    bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'attachments',
    });
  }
  return bucket;
};

export const uploadBufferToGridFS = (buffer, filename, contentType) => {
  return new Promise((resolve, reject) => {
    const uploadStream = getBucket().openUploadStream(filename, { contentType });
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });
};

export const openDownloadStream = (fileId) => getBucket().openDownloadStream(fileId);
