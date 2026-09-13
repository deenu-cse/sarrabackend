import jwt from 'jsonwebtoken';
import RefreshToken from '../models/RefreshToken.model.js';
import crypto from 'crypto';

export const generateTokens = async (user, ip, userAgent) => {
  const payload = {
    id: user._id,
    role: user.role,
    workflowRole: user.workflowRole,
    district: user.district,
    department: user.department,
  };

  const accessToken = jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
  });

  const refreshTokenValue = crypto.randomBytes(40).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
  
  const expiresInDays = parseInt(process.env.JWT_REFRESH_EXPIRES_IN.replace('d', ''));
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    token: hashedToken,
    user: user._id,
    expiresAt,
    ip,
    userAgent
  });

  return { accessToken, refreshToken: refreshTokenValue };
};
