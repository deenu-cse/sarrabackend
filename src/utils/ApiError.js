class ApiError extends Error {
  constructor(statusCode, message = 'Something went wrong', errors = [], stack = '') {
    super(message);
    this.statusCode = statusCode;
    this.success = false;

    // Support array validation errors OR object data payloads
    if (errors && !Array.isArray(errors) && typeof errors === 'object') {
      this.data = errors;
      this.errors = [];
      if (errors.code) this.errorCode = errors.code;
    } else {
      this.errors = errors || [];
      this.data = null;
    }

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default ApiError;
