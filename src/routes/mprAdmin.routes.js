import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import * as mprReportController from '../controllers/mprReport.controller.js';

const router = Router();

// Secure all routes within this file strictly to SUPER_ADMIN
router.use(verifyAccessToken);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

router.get('/dashboard', mprReportController.getDashboardData);
router.get('/dashboard/filtered', mprReportController.getFilteredDashboardData);
router.get('/forms-list', mprReportController.getFormsList);
router.get('/audit-logs', mprReportController.getAuditLogs);

export default router;
