import crypto from 'crypto';
import path from 'path';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageEngine } from 'multer';
import type { Request } from 'express';

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const S3_BUCKET = process.env.AWS_S3_BUCKET;

// Multer storage engine that streams the incoming file straight to S3 via
// multipart upload (lib-storage) instead of buffering it in memory or on
// disk first — matters now that large attachments (up to 100MB) are allowed.
class S3StorageEngine implements StorageEngine {
  private folder: string;

  constructor(folder: string) {
    this.folder = folder;
  }

  _handleFile(
    _req: Request,
    file: Express.Multer.File,
    cb: (error?: any, info?: Partial<Express.Multer.File>) => void
  ) {
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
        } as Partial<Express.Multer.File>);
      })
      .catch((err) => cb(err));
  }

  _removeFile(_req: Request, _file: Express.Multer.File, cb: (error: Error | null) => void) {
    cb(null);
  }
}

export const s3Storage = (folder: string): StorageEngine => new S3StorageEngine(folder);

interface DownloadUrlOptions {
  key: string;
  mimeType: string;
  fileName: string;
  disposition?: 'inline' | 'attachment';
  expiresIn?: number;
}

// Relaying large files through this server (fetch from S3, then re-stream to
// the client) doubles the transfer — once into this free-tier Render
// instance, once back out — and was timing out mid-download on real-world
// PDFs. A short-lived presigned URL lets the browser fetch the bytes
// directly from S3 instead, so this server only ever handles the small JSON
// response, not the file itself.
export const getS3DownloadUrl = ({
  key,
  mimeType,
  fileName,
  disposition = 'inline',
  expiresIn = 300,
}: DownloadUrlOptions) =>
  getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ResponseContentType: mimeType,
      ResponseContentDisposition: `${disposition}; filename="${encodeURIComponent(fileName)}"`,
    }),
    { expiresIn }
  );

export const deleteS3Object = (key: string) =>
  s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
