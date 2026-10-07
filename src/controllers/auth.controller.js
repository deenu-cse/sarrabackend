import {
  registerUser,
  loginUser,
  refreshTokenService,
  logoutUser,
  changeUserPassword,
  forgotPassword,
  verifyResetOtp,
  resetPasswordWithOtp,
  verifyInviteOtp,
  acceptInvite
} from '../services/auth.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import User from '../models/User.model.js';
import USER_ROLES from '../constants/roles.constants.js';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: parseInt(process.env.JWT_REFRESH_EXPIRES_IN) * 24 * 60 * 60 * 1000
};

export const register = asyncHandler(async (req, res) => {
  const user = await registerUser(req.body);
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, user, 'User registered successfully'));
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  const { user, accessToken, refreshToken } = await loginUser(email, password, ip, userAgent);
  // The audit entry for a sign-in is written before any token exists, so tell it who signed in.
  res.locals.auditUser = { id: user?._id || user?.id, role: user?.role };

  res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, cookieOptions);

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { user, accessToken }, 'Login successful'));
});

export const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies.refreshToken;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  if (!token) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json(new ApiResponse(HTTP_STATUS.UNAUTHORIZED, null, 'Refresh token not found'));
  }

  const tokens = await refreshTokenService(token, ip, userAgent);

  res.cookie('accessToken', tokens.accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { accessToken: tokens.accessToken }, 'Token refreshed successfully'));
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies.refreshToken;
  if (token) {
    await logoutUser(token);
  }

  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, 'Logout successful'));
});
export const bootstrapAdmin = asyncHandler(async (req, res) => {
  const adminCount = await User.countDocuments({ role: USER_ROLES.SUPER_ADMIN });
  if (adminCount > 0) {
    return res.status(HTTP_STATUS.FORBIDDEN).json(new ApiResponse(HTTP_STATUS.FORBIDDEN, null, 'Super Admin already exists. Cannot bootstrap.'));
  }

  const { email, password, name, phone } = req.body;
  if (!email || !password || !name) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json(new ApiResponse(HTTP_STATUS.BAD_REQUEST, null, 'Email, password, and name are required'));
  }

  const user = await registerUser({
    ...req.body,
    role: USER_ROLES.SUPER_ADMIN
  });

  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, user, 'Initial Super Admin created successfully'));
});

export const getMe = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, req.user, 'User details fetched successfully'));
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  await changeUserPassword(req.user._id, currentPassword, newPassword);

  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, 'Password changed successfully. Please log in again.'));
});

export const forgotPasswordHandler = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await forgotPassword(email);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, result.message));
});

export const verifyResetOtpHandler = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const result = await verifyResetOtp(email, otp);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { email: result.email }, result.message));
});

export const resetPasswordHandler = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const result = await resetPasswordWithOtp(email, otp, newPassword);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, result.message));
});

export const verifyInviteOtpHandler = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const result = await verifyInviteOtp(email, otp);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { email: result.email, name: result.name }, result.message));
});

export const acceptInviteHandler = asyncHandler(async (req, res) => {
  const { email, otp, password } = req.body;
  const result = await acceptInvite(email, otp, password);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, result.message));
});
