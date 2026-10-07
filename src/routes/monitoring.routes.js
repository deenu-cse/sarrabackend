import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import * as ctrl from '../controllers/monitoring.controller.js';

/** Deadlines, reminders, settings and the monthly e-mail summary. */
const router = Router();
router.use(verifyAccessToken);

const { DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER } = USER_ROLES;
const admins = requireRole(SUPER_ADMIN, MND_SUPER_ADMIN);

router.get('/home', ctrl.getHome);
router.get('/deadlines', ctrl.getDeadlines);
router.get('/settings', ctrl.getSettings);
router.put('/settings', admins, auditLog('SETTINGS_UPDATE'), ctrl.updateSettings);
router.post('/reminders/run', admins, auditLog('REPORT_DISPATCH'), ctrl.runReminders);
router.get('/reports/preview', requireRole(SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER, DD_LEVEL), ctrl.previewReport);
router.get('/reports/dispatches', admins, ctrl.listDispatches);
router.post('/reports/send', admins, auditLog('REPORT_DISPATCH'), ctrl.sendReports);

export default router;
