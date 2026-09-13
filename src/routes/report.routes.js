import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import { uploadLimiter } from '../middlewares/rateLimiter.middleware.js';
import * as reportController from '../controllers/report.controller.js';
import * as homeDashboardController from '../controllers/homeDashboard.controller.js';

const router = Router();

router.use(verifyAccessToken);

router.get('/home', homeDashboardController.getHome);

router.get('/overview', reportController.getOverviewStats);
router.get('/district-stats', reportController.getDistrictStats);

// Super admin and DD only
router.get(
  '/department-stats',
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.DD_LEVEL),
  reportController.getDepartmentStats
);

router.get('/monthly-trend', reportController.getMonthlyTrend);
router.get('/spring-type-stats', reportController.getSpringTypeStats);

router.get(
  '/budget-stats',
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.DD_LEVEL),
  reportController.getBudgetStats
);

router.get('/forms-list', reportController.getFormsList);

// Exports
router.get(
  '/export/csv',
  uploadLimiter,
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.DD_LEVEL),
  reportController.exportCSV
);

router.get(
  '/export/excel',
  uploadLimiter,
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.DD_LEVEL),
  reportController.exportExcel
);

router.get('/export/pdf/:id', uploadLimiter, reportController.exportSingleDPRPDF);

router.get(
  '/export/summary-pdf',
  uploadLimiter,
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.DD_LEVEL),
  reportController.exportSummaryPDF
);

router.get(
  '/approval-timeline',
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.DD_LEVEL),
  reportController.getApprovalTimeline
);

// Admin Rebuild (super admin only)
router.post(
  '/rebuild-flat-summaries',
  uploadLimiter,
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN),
  reportController.rebuildFlatSummaries
);

// Sync summaries — accessible to all roles (scoped by role in controller)
router.post('/sync-summaries', reportController.syncFlatSummaries);

router.get(
  '/full-dashboard',
  requireRole(
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MND_SUPER_ADMIN,
    USER_ROLES.DD_LEVEL
  ),
  reportController.getFullDistrictDashboard
);

router.get(
  '/filtered-analytics',
  requireRole(
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.MND_SUPER_ADMIN,
    USER_ROLES.DD_LEVEL
  ),
  reportController.getFilteredAnalytics
);

export default router;

