import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  changePassword,
  forgotPasswordHandler,
  verifyResetOtpHandler,
  resetPasswordHandler,
  verifyInviteOtpHandler,
  acceptInviteHandler,
  bootstrapAdmin
} from '../controllers/auth.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  verifyInviteOtpSchema,
  acceptInviteSchema
} from '../validators/auth.validator.js';

const router = Router();

router.post('/login', validate(loginSchema), auditLog('LOGIN'), login);
router.post('/refresh-token', auditLog('TOKEN_REFRESH'), refreshToken);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPasswordHandler);
router.post('/verify-reset-otp', validate(verifyResetOtpSchema), verifyResetOtpHandler);
router.post('/reset-password', validate(resetPasswordSchema), auditLog('PASSWORD_CHANGE'), resetPasswordHandler);

// Public invite acceptance (no auth)
router.post('/verify-invite-otp', validate(verifyInviteOtpSchema), verifyInviteOtpHandler);
router.post('/accept-invite', validate(acceptInviteSchema), auditLog('PASSWORD_CHANGE'), acceptInviteHandler);

router.post('/register', validate(registerSchema), auditLog('USER_CREATE'), register);
router.post('/bootstrap', auditLog('BOOTSTRAP'), bootstrapAdmin);

router.use(verifyAccessToken);

router.post('/logout', auditLog('LOGOUT'), logout);
router.get('/me', getMe);
router.patch('/change-password', validate(changePasswordSchema), auditLog('PASSWORD_CHANGE'), changePassword);

export default router;
