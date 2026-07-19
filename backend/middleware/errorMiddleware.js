import multer from 'multer';
import AppError from '../utils/AppError.js';
import { MAX_ATTACHMENT_SIZE_MB } from './attachmentUpload.js';

const handleCastError = (err) =>
  new AppError(`Invalid value for field '${err.path}': ${err.value}`, 400);

const handleMulterError = (err) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new AppError(`File is too large. Maximum size is ${MAX_ATTACHMENT_SIZE_MB}MB.`, 400);
  }
  return new AppError(err.message || 'File upload failed', 400);
};

// multer-storage-cloudinary rejects the promise with Cloudinary's own API
// error as-is (shape: { http_code, message }) rather than a multer.MulterError,
// so it wasn't being recognized as operational and fell through to a generic
// 500 "Something went wrong" — this surfaces Cloudinary's actual message
// (e.g. a file-size cap on the account) instead.
const isCloudinaryUploadError = (err) => typeof err.http_code === 'number' && typeof err.message === 'string';

const handleCloudinaryUploadError = (err) => new AppError(err.message, err.http_code < 500 ? err.http_code : 502);

// The AWS SDK v3 rejects with the raw service error (e.g. AccessDenied from
// a missing IAM permission/permissions-boundary) rather than anything
// operational, so — same problem as Cloudinary above — it was falling
// through to a bare 500 instead of surfacing what actually went wrong.
const isAwsError = (err) => typeof err?.$metadata?.httpStatusCode === 'number' && typeof err.message === 'string';

const handleAwsError = (err) =>
  new AppError(err.message, err.$metadata.httpStatusCode < 500 ? err.$metadata.httpStatusCode : 502);

const handleDuplicateKey = (err) => {
  const field = Object.keys(err.keyValue)[0];
  return new AppError(`'${err.keyValue[field]}' is already registered for ${field}`, 409);
};

const handleJWTError = () => new AppError('Invalid token. Please log in again.', 401);

const handleJWTExpired = () => new AppError('Token expired. Please log in again.', 401);

const errorMiddleware = (err, req, res, next) => {
  let error = err;

  if (err.name === 'CastError') error = handleCastError(err);
  if (err.code === 11000) error = handleDuplicateKey(err);
  if (err.name === 'JsonWebTokenError') error = handleJWTError();
  if (err.name === 'TokenExpiredError') error = handleJWTExpired();
  if (err instanceof multer.MulterError) error = handleMulterError(err);
  else if (isCloudinaryUploadError(err)) error = handleCloudinaryUploadError(err);
  else if (isAwsError(err)) error = handleAwsError(err);

  const statusCode = error.statusCode || 500;
  const message = error.isOperational ? error.message : 'Something went wrong';

  if (!error.isOperational) console.error(err);

  res.status(statusCode).json({ message });
};

export default errorMiddleware;
