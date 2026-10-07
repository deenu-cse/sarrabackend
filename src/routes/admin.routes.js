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
import Department from '../models/Department.model.js';
import { toNameKey } from '../services/masterData.service.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import {
  registerSchema,
  inviteUserSchema,
  suspendUserSchema,
  deactivateUserSchema
} from '../validators/auth.validator.js';

const router = Router();

// A PIA officer's department must be one from the Department master. The stored
// value is the master's own spelling, so it always matches project departments.
const resolveDepartment = async (req, res, next) => {
  try {
    const raw = typeof req.body?.department === 'string' ? req.body.department : '';
    if (!raw.trim()) return next();
    const department = await Department.findOne({ nameKey: toNameKey(raw), isActive: true }).lean();
    if (!department) return next(new ApiError(HTTP_STATUS.BAD_REQUEST, `Department "${raw.trim()}" does not exist. Add it under project departments first.`));
    req.body.department = department.name;
    return next();
  } catch (err) {
    return next(err);
  }
};

router.use(verifyAccessToken);

// User management — only SUPER_ADMIN with workflowRole = null
router.post('/users/invite', requirePureSuperAdmin, validate(inviteUserSchema), resolveDepartment, auditLog('USER_CREATE'), inviteUserHandler);
router.post('/users', requirePureSuperAdmin, validate(registerSchema), resolveDepartment, auditLog('USER_CREATE'), createUser);
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
