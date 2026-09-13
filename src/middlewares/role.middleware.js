import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import USER_ROLES from '../constants/roles.constants.js';

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

/**
 * Only SUPER_ADMIN with no workflow role (null/undefined) —
 * these admins manage users (invite / suspend).
 */
export const requirePureSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'User not authenticated'));
  }

  const isPureSuperAdmin =
    req.user.role === USER_ROLES.SUPER_ADMIN &&
    (req.user.workflowRole == null || req.user.workflowRole === '');

  if (!isPureSuperAdmin) {
    return next(
      new ApiError(
        HTTP_STATUS.FORBIDDEN,
        'Only Super Admin (without workflow role) can manage users'
      )
    );
  }

  next();
};
