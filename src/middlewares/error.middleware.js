import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';

export const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  err.message = err.message || 'Internal Server Error';

  logger.error(`${err.statusCode} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);

  if (process.env.NODE_ENV === 'development') {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errorCode: err.errorCode || 'ERROR',
      errors: err.errors || [],
      stack: err.stack,
    });
  } else {
    let error = { ...err };
    error.message = err.message;
    
    if (err.name === 'CastError') {
      const message = `Resource not found with id of ${err.value}`;
      error.statusCode = HTTP_STATUS.BAD_REQUEST;
      error.message = message;
      error.errorCode = 'INVALID_ID';
    }

    if (err.code === 11000) {
      const message = `Duplicate field value entered`;
      error.statusCode = HTTP_STATUS.CONFLICT;
      error.message = message;
      error.errorCode = 'DUPLICATE_KEY';
    }

    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map(val => val.message);
      error.statusCode = HTTP_STATUS.BAD_REQUEST;
      error.message = 'Validation Error';
      error.errors = message;
      error.errorCode = 'VALIDATION_ERROR';
    }

    if (err.name === 'JsonWebTokenError') {
      error.statusCode = HTTP_STATUS.UNAUTHORIZED;
      error.message = 'Invalid token. Please log in again!';
      error.errorCode = 'INVALID_TOKEN';
    }

    if (err.name === 'TokenExpiredError') {
      error.statusCode = HTTP_STATUS.UNAUTHORIZED;
      error.message = 'Your token has expired! Please log in again.';
      error.errorCode = 'TOKEN_EXPIRED';
    }

    res.status(error.statusCode || err.statusCode).json({
      success: false,
      message: error.message || 'Server Error',
      errorCode: error.errorCode || 'INTERNAL_ERROR',
      errors: error.errors || [],
    });
  }
};
