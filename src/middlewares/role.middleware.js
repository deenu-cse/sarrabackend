import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'User not authenticated'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to perform this action'));
    }

    next();
  };
};
