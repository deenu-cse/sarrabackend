import { Router } from 'express';
import {
  createUser,
  inviteUserHandler,
  getUsers,
  toggleUserActive,
  suspendUser,
  deactivateUser,
  restoreUser,
  approveUserHandler,
  rejectUserHandler,
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

// User management by tier. Who may invite, approve or change an account is decided in the
// controller (userAccess.service): the HQ administrator directly; the HQ Maker and District
// Makers by request, approved by their tier's Approver.
const userManagers = requireRole('SUPER_ADMIN', 'DD_LEVEL', 'MND_SUPER_ADMIN');
router.post('/users/invite', requireRole('SUPER_ADMIN', 'DD_LEVEL'), validate(inviteUserSchema), resolveDepartment, auditLog('USER_REQUEST'), inviteUserHandler);
router.post('/users', requirePureSuperAdmin, validate(registerSchema), resolveDepartment, auditLog('USER_CREATE'), createUser);
router.get('/users', userManagers, getUsers);
router.patch('/users/:id/approve', requireRole('SUPER_ADMIN', 'DD_LEVEL'), auditLog('USER_APPROVE'), approveUserHandler);
router.patch('/users/:id/reject', requireRole('SUPER_ADMIN', 'DD_LEVEL'), auditLog('USER_REJECT'), rejectUserHandler);
router.patch('/users/:id/toggle-active', requireRole('SUPER_ADMIN', 'DD_LEVEL'), auditLog('USER_DEACTIVATE'), toggleUserActive);
router.patch('/users/:id/suspend', requireRole('SUPER_ADMIN', 'DD_LEVEL'), validate(suspendUserSchema), auditLog('USER_SUSPEND'), suspendUser);
router.patch('/users/:id/deactivate', requireRole('SUPER_ADMIN', 'DD_LEVEL'), validate(deactivateUserSchema), auditLog('USER_DEACTIVATE'), deactivateUser);
router.patch('/users/:id/restore', requireRole('SUPER_ADMIN', 'DD_LEVEL'), auditLog('USER_RESTORE'), restoreUser);

router.get('/analytics/overview', requireRole('SUPER_ADMIN'), getOverviewAnalytics);
router.get('/analytics/district/:districtName', requireRole('SUPER_ADMIN'), getDistrictAnalytics);

router.get('/audit-logs', requireRole('SUPER_ADMIN'), getAuditLogs);
router.get('/business-audit', requireRole('SUPER_ADMIN'), getBusinessAuditLogs);

export default router;
