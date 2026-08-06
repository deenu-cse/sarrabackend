import { Router } from 'express';
import * as mprPraroop1BController from '../controllers/mprPraroop1B.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyAccessToken);

router.post('/draft', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1BController.saveDraft);
router.post('/submit', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1BController.submitMPR);
router.patch('/:id/resubmit', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1BController.resubmitMPR);

router.get('/my-reports', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1BController.getMyReports);
router.get('/all-reports', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1BController.getMyReports);
router.get('/previous-month', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1BController.getPreviousMonthData);
router.get('/baseline', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1BController.getBaselineFromDPR);
router.get('/annual-summary', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN', 'DD_ADMIN'), mprPraroop1BController.getAnnualSummary);

router.get('/:id', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1BController.getReportById);
router.patch('/:id/approve', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1BController.approveReport);
router.patch('/:id/reject', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1BController.rejectReport);

export default router;
