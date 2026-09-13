import User from '../models/User.model.js';
import RefreshToken from '../models/RefreshToken.model.js';
import { generateTokens } from '../utils/generateTokens.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import { sendEmail } from '../utils/email/sendEmail.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';

const OTP_EXPIRY_MINUTES = 10;
const GENERIC_RESET_MESSAGE =
  'If an account with that email exists, a password reset OTP has been sent.';

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

const generateOtp = () => String(crypto.randomInt(100000, 999999));

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

  const isPasswordMatch = await user.comparePassword(password);

  if (!isPasswordMatch) {
    await user.incrementLoginAttempts();
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid credentials');
  }

  if (user.invitePending) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      'Please accept your invitation and set a password before logging in.'
    );
  }

  const access = await user.resolveAccountAccess();

  if (access.status === 'DEACTIVATED') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Your account has been deactivated.', {
      code: 'ACCOUNT_DEACTIVATED',
      ...user.getRestrictionPayload()
    });
  }

  if (access.status === 'SUSPENDED') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Your account is temporarily suspended.', {
      code: 'ACCOUNT_SUSPENDED',
      ...user.getRestrictionPayload()
    });
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
    workflowRole: user.workflowRole,
    district: user.district,
    department: user.department,
    accountStatus: user.accountStatus || 'ACTIVE'
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

/**
 * Generate OTP, store hashed token, email user (and always log OTP for local testing).
 */
export const forgotPassword = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase().trim() });

  // Do not leak whether the email exists
  if (!user || !user.isActive) {
    return { message: GENERIC_RESET_MESSAGE };
  }

  const otp = generateOtp();
  user.passwordResetToken = hashOtp(otp);
  user.passwordResetExpires = Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000;
  await user.save({ validateBeforeSave: false });

  // Always print OTP in terminal for local testing
  console.log('\n********** PASSWORD RESET OTP **********');
  console.log(`Email: ${user.email}`);
  console.log(`OTP:   ${otp}`);
  console.log(`Valid: ${OTP_EXPIRY_MINUTES} minutes`);
  console.log('****************************************\n');

  await sendEmail({
    to: user.email,
    subject: 'SARRA CRM — Password Reset OTP',
    template: 'forgotPassword.html',
    data: {
      name: user.name || 'User',
      otp,
      expiryMinutes: OTP_EXPIRY_MINUTES,
      year: new Date().getFullYear()
    }
  });

  return { message: GENERIC_RESET_MESSAGE };
};

export const verifyResetOtp = async (email, otp) => {
  const user = await User.findOne({
    email: email.toLowerCase().trim(),
    passwordResetToken: hashOtp(otp),
    passwordResetExpires: { $gt: Date.now() }
  });

  if (!user) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid or expired OTP');
  }

  return { message: 'OTP verified successfully', email: user.email };
};

export const resetPasswordWithOtp = async (email, otp, newPassword) => {
  const user = await User.findOne({
    email: email.toLowerCase().trim(),
    passwordResetToken: hashOtp(otp),
    passwordResetExpires: { $gt: Date.now() }
  }).select('+password');

  if (!user) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid or expired OTP');
  }

  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();

  await RefreshToken.deleteMany({ user: user._id });

  return { message: 'Password reset successfully. You can now log in.' };
};

const INVITE_OTP_HOURS = 5;

const ROLE_LABELS = {
  PIA_OFFICER: 'PIA Officer',
  DD_LEVEL: 'District Officer (DD Level)',
  SUPER_ADMIN: 'Super Admin',
  MND_OFFICER: 'MND Officer',
  MND_SUPER_ADMIN: 'MND Super Admin'
};

const getFrontendUrl = () =>
  (process.env.FRONTEND_URL || process.env.CRM_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * Invite a new user (no password). Sends professional email with OTP (5h expiry).
 */
export const inviteUser = async (inviteData, invitedByUser) => {
  const email = inviteData.email.toLowerCase().trim();
  const existing = await User.findOne({ email });

  if (existing && !existing.invitePending) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'A user with this email already exists');
  }

  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const otpExpires = new Date(Date.now() + INVITE_OTP_HOURS * 60 * 60 * 1000);
  const tempPassword = crypto.randomBytes(24).toString('hex');

  const payload = {
    name: inviteData.name.trim(),
    email,
    role: inviteData.role,
    district: inviteData.district || null,
    department: inviteData.department || null,
    employeeId: inviteData.employeeId || undefined,
    phone: inviteData.phone || undefined,
    designation: inviteData.designation || undefined,
    workflowRole: inviteData.workflowRole || null,
    password: tempPassword,
    invitePending: true,
    inviteOtpHash: otpHash,
    inviteOtpExpires: otpExpires,
    invitedAt: new Date(),
    invitedBy: invitedByUser._id,
    createdBy: invitedByUser._id,
    isActive: true
  };

  let user;
  if (existing && existing.invitePending) {
    Object.assign(existing, payload);
    user = await existing.save();
  } else {
    user = await User.create(payload);
  }

  const inviteLink = `${getFrontendUrl()}/invite?email=${encodeURIComponent(email)}`;

  console.log('\n********** USER INVITE OTP **********');
  console.log(`Email:  ${email}`);
  console.log(`OTP:    ${otp}`);
  console.log(`Link:   ${inviteLink}`);
  console.log(`Valid:  ${INVITE_OTP_HOURS} hours`);
  console.log('*************************************\n');

  await sendEmail({
    to: email,
    subject: 'You are invited to SARRA CRM Portal',
    template: 'userInvite.html',
    data: {
      name: user.name,
      email,
      otp,
      inviteLink,
      roleLabel: ROLE_LABELS[user.role] || user.role,
      invitedByName: invitedByUser.name || 'SARRA Super Admin',
      expiryHours: INVITE_OTP_HOURS,
      year: new Date().getFullYear()
    }
  });

  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.inviteOtpHash;
  return userObj;
};

export const verifyInviteOtp = async (email, otp) => {
  const normalizedEmail = email.toLowerCase().trim();

  // 1) Email must match a pending invitation
  const invitedUser = await User.findOne({
    email: normalizedEmail,
    invitePending: true
  });

  if (!invitedUser) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'This email does not match any pending invitation. Use the exact email from your invite.'
    );
  }

  // 2) OTP must still be valid (time)
  if (!invitedUser.inviteOtpExpires || invitedUser.inviteOtpExpires <= Date.now()) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'Invitation OTP has expired. Please ask your Super Admin to resend the invite.'
    );
  }

  // 3) OTP must match this invitation email
  if (invitedUser.inviteOtpHash !== hashOtp(otp)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid OTP for this invitation email');
  }

  return {
    message: 'OTP verified successfully',
    email: invitedUser.email,
    name: invitedUser.name
  };
};

export const acceptInvite = async (email, otp, newPassword) => {
  const normalizedEmail = email.toLowerCase().trim();

  const invitedUser = await User.findOne({
    email: normalizedEmail,
    invitePending: true
  }).select('+password');

  if (!invitedUser) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'This email does not match any pending invitation. Use the exact email from your invite.'
    );
  }

  if (!invitedUser.inviteOtpExpires || invitedUser.inviteOtpExpires <= Date.now()) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'Invitation OTP has expired. Please ask your Super Admin to resend the invite.'
    );
  }

  if (invitedUser.inviteOtpHash !== hashOtp(otp)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid OTP for this invitation email');
  }

  invitedUser.password = newPassword;
  invitedUser.invitePending = false;
  invitedUser.inviteOtpHash = undefined;
  invitedUser.inviteOtpExpires = undefined;
  invitedUser.isActive = true;
  invitedUser.loginAttempts = 0;
  invitedUser.lockUntil = undefined;
  await invitedUser.save();

  const loginLink = `${getFrontendUrl()}/login`;

  console.log('\n********** WELCOME EMAIL **********');
  console.log(`Email: ${invitedUser.email}`);
  console.log(`Name:  ${invitedUser.name}`);
  console.log(`Link:  ${loginLink}`);
  console.log('***********************************\n');

  await sendEmail({
    to: invitedUser.email,
    subject: 'Welcome to SARRA CRM — Account Activated',
    template: 'welcomeUser.html',
    data: {
      name: invitedUser.name,
      roleLabel: ROLE_LABELS[invitedUser.role] || invitedUser.role,
      loginLink,
      year: new Date().getFullYear()
    }
  });

  return { message: 'Password set successfully. You can now log in.' };
};
