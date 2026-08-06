import { Router } from 'express';
import * as mprPraroop1AController from '../controllers/mprPraroop1A.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyAccessToken);

router.post('/draft', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1AController.saveDraft);
router.post('/submit', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1AController.submitMPR);
router.patch('/:id/resubmit', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1AController.resubmitMPR);

router.get('/my-reports', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1AController.getMyReports);
router.get('/all-reports', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1AController.getMyReports);
router.get('/previous-month', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1AController.getPreviousMonthData);
router.get('/baseline', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1AController.getBaselineFromDPR);
router.get('/annual-summary', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN', 'DD_ADMIN'), mprPraroop1AController.getAnnualSummary);

router.get('/:id', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1AController.getReportById);
router.patch('/:id/approve', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1AController.approveReport);
router.patch('/:id/reject', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1AController.rejectReport);

export default router;
