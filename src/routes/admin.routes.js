import { Router } from 'express';
import { 
  createUser, 
  getUsers, 
  toggleUserActive, 
  getOverviewAnalytics, 
  getDistrictAnalytics, 
  getAuditLogs 
} from '../controllers/admin.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { audit } from '../middlewares/audit.middleware.js';
import { registerSchema } from '../validators/auth.validator.js';

const router = Router();

router.use(verifyAccessToken);
router.use(requireRole('SUPER_ADMIN'));

router.post('/users', validate(registerSchema), audit('USER_CREATE'), createUser);
router.get('/users', getUsers);
router.patch('/users/:id/toggle-active', audit('USER_DEACTIVATE'), toggleUserActive);

router.get('/analytics/overview', getOverviewAnalytics);
router.get('/analytics/district/:districtName', getDistrictAnalytics);

router.get('/audit-logs', getAuditLogs);

export default router;
