import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  changePassword
} from '../controllers/auth.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { loginLimiter } from '../middlewares/rateLimiter.middleware.js';
import { audit } from '../middlewares/audit.middleware.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema
} from '../validators/auth.validator.js';

const router = Router();

router.post('/login', validate(loginSchema), audit('LOGIN'), login);
router.post('/refresh-token', audit('TOKEN_REFRESH'), refreshToken);

router.post(
  '/register',
  // requireRole('SUPER_ADMIN'),
  validate(registerSchema),
  audit('USER_CREATE'),
  register
);


import { bootstrapAdmin } from '../controllers/auth.controller.js';

router.post('/bootstrap', audit('BOOTSTRAP'), bootstrapAdmin);

router.use(verifyAccessToken);

router.post('/logout', audit('LOGOUT'), logout);
router.get('/me', getMe);
router.patch('/change-password', validate(changePasswordSchema), audit('PASSWORD_CHANGE'), changePassword);



export default router;
