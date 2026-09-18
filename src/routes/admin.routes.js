import { Router } from 'express';
import {
  createUser,
  inviteUserHandler,
  getUsers,
  toggleUserActive,
  suspendUser,
  deactivateUser,
  restoreUser,
  getOverviewAnalytics,
  getDistrictAnalytics,
  getAuditLogs,
  getBusinessAuditLogs
} from '../controllers/admin.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole, requirePureSuperAdmin } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import {
  registerSchema,
  inviteUserSchema,
  suspendUserSchema,
  deactivateUserSchema
} from '../validators/auth.validator.js';

const router = Router();

router.use(verifyAccessToken);

// User management — only SUPER_ADMIN with workflowRole = null
router.post('/users/invite', requirePureSuperAdmin, validate(inviteUserSchema), auditLog('USER_CREATE'), inviteUserHandler);
router.post('/users', requirePureSuperAdmin, validate(registerSchema), auditLog('USER_CREATE'), createUser);
router.get('/users', getUsers);
router.patch('/users/:id/toggle-active', requirePureSuperAdmin, auditLog('USER_DEACTIVATE'), toggleUserActive);
router.patch('/users/:id/suspend', requirePureSuperAdmin, validate(suspendUserSchema), auditLog('USER_SUSPEND'), suspendUser);
router.patch('/users/:id/deactivate', requirePureSuperAdmin, validate(deactivateUserSchema), auditLog('USER_DEACTIVATE'), deactivateUser);
router.patch('/users/:id/restore', requirePureSuperAdmin, auditLog('USER_RESTORE'), restoreUser);

router.get('/analytics/overview', requireRole('SUPER_ADMIN'), getOverviewAnalytics);
router.get('/analytics/district/:districtName', requireRole('SUPER_ADMIN'), getDistrictAnalytics);

router.get('/audit-logs', requireRole('SUPER_ADMIN'), getAuditLogs);
router.get('/business-audit', requireRole('SUPER_ADMIN'), getBusinessAuditLogs);

export default router;
