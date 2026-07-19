import crypto from 'crypto';
import path from 'path';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import AppError from '../utils/AppError.js';

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const S3_BUCKET = process.env.AWS_S3_BUCKET;

// Multer storage engine that streams the incoming file straight to S3 via
// multipart upload (lib-storage) instead of buffering it in memory or on
// disk first — matters now that large attachments (up to 100MB) are allowed.
class S3StorageEngine {
  constructor(folder) {
    this.folder = folder;
  }

  _handleFile(_req, file, cb) {
    const key = `${this.folder}/${crypto.randomUUID()}${path.extname(file.originalname)}`;
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: S3_BUCKET,
        Key: key,
        Body: file.stream,
        ContentType: file.mimetype,
      },
    });

    let size = 0;
    upload.on('httpUploadProgress', (progress) => {
      if (typeof progress.loaded === 'number') size = progress.loaded;
    });

    upload
      .done()
      .then(() => {
        cb(null, {
          path: `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
          filename: key,
          size,
        });
      })
      .catch((err) => cb(err));
  }

  _removeFile(_req, _file, cb) {
    cb(null);
  }
}

export const s3Storage = (folder) => new S3StorageEngine(folder);

export const streamS3Object = async (res, { key, mimeType, fileName }, next) => {
  try {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    res.setHeader('Content-Type', mimeType || response.ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    response.Body.pipe(res);
  } catch (err) {
    if (err.name === 'NoSuchKey') return next(new AppError('File not found', 404));
    next(err);
  }
};

export const deleteS3Object = (key) =>
  s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
