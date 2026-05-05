import jwt from 'jsonwebtoken';
import User from '../models/User.model.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import asyncHandler from '../utils/asyncHandler.js';

export const verifyAccessToken = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Not authorized to access this route');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    const user = await User.findById(decoded.id).select('+passwordChangedAt');
    if (!user) {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'The user belonging to this token no longer exists.');
    }

    if (user.changedPasswordAfter(decoded.iat)) {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'User recently changed password! Please log in again.');
    }

    if (!user.isActive) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, 'User account is deactivated.');
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Token expired. Please refresh your token.');
    }
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Not authorized to access this route');
  }
});

export const attachUser = verifyAccessToken;
