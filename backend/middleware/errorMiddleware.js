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

  const statusCode = error.statusCode || 500;
  const message = error.isOperational ? error.message : 'Something went wrong';

  if (!error.isOperational) console.error(err);

  res.status(statusCode).json({ message });
};

export default errorMiddleware;
