import AppError from '../utils/AppError.js';

const handleCastError = (err) =>
  new AppError(`Invalid value for field '${err.path}': ${err.value}`, 400);

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

  const statusCode = error.statusCode || 500;
  const message = error.isOperational ? error.message : 'Something went wrong';

  res.status(statusCode).json({ message });
};

export default errorMiddleware;
