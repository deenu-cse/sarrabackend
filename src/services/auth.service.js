import User from '../models/User.model.js';
import RefreshToken from '../models/RefreshToken.model.js';
import { generateTokens } from '../utils/generateTokens.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';

export const registerUser = async (userData) => {
  let password = userData.password;
  
  if (!password) {
    password = crypto.randomBytes(8).toString('hex');
  }

  const user = await User.create({
    ...userData,
    password
  });

  if (process.env.SMTP_HOST && !userData.password) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: user.email,
        subject: 'Your SARRA Account Details',
        text: `Your account has been created. Your password is: ${password}`
      });
    } catch (error) {
      console.error('Email could not be sent', error);
    }
  }

  const userWithoutPassword = user.toObject();
  delete userWithoutPassword.password;
  return userWithoutPassword;
};

export const loginUser = async (email, password, ip, userAgent) => {
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid credentials');
  }

  if (user.isAccountLocked()) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, `Account is locked until ${user.lockUntil}. Please try again later.`);
  }

  if (!user.isActive) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Your account has been deactivated.');
  }

  const isPasswordMatch = await user.comparePassword(password);

  if (!isPasswordMatch) {
    await user.incrementLoginAttempts();
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid credentials');
  }

  if (user.loginAttempts > 0) {
    user.loginAttempts = 0;
    user.lockUntil = undefined;
  }
  user.lastLogin = Date.now();
  await user.save({ validateBeforeSave: false });

  const tokens = await generateTokens(user, ip, userAgent);

  const userObject = {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    district: user.district,
    department: user.department
  };

  return { user: userObject, ...tokens };
};

export const refreshTokenService = async (tokenStr, ip, userAgent) => {
  const hashedToken = crypto.createHash('sha256').update(tokenStr).digest('hex');

  const tokenDoc = await RefreshToken.findOne({ token: hashedToken });

  if (!tokenDoc) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid refresh token');
  }

  if (tokenDoc.isRevoked) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Refresh token has been revoked');
  }

  if (tokenDoc.expiresAt < Date.now()) {
    await RefreshToken.deleteOne({ _id: tokenDoc._id });
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Refresh token has expired');
  }

  const user = await User.findById(tokenDoc.user);
  if (!user || !user.isActive) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'User no longer exists or is inactive');
  }

  await RefreshToken.deleteOne({ _id: tokenDoc._id });

  const tokens = await generateTokens(user, ip, userAgent);
  return tokens;
};

export const logoutUser = async (tokenStr) => {
  const hashedToken = crypto.createHash('sha256').update(tokenStr).digest('hex');
  await RefreshToken.deleteOne({ token: hashedToken });
};

export const changeUserPassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId).select('+password');

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Current password is incorrect');
  }

  user.password = newPassword;
  await user.save();

  await RefreshToken.deleteMany({ user: userId });
};
