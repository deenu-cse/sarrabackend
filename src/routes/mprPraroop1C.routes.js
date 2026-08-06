import { Router } from 'express';
import * as mprPraroop1CController from '../controllers/mprPraroop1C.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyAccessToken);

router.post('/draft', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1CController.saveDraft);
router.post('/submit', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1CController.submitMPR);
router.patch('/:id/resubmit', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1CController.resubmitMPR);

router.get('/my-reports', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1CController.getMyReports);
router.get('/all-reports', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1CController.getMyReports);
router.get('/previous-month', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1CController.getPreviousMonthData);
router.get('/baseline', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1CController.getBaselineFromDPR);
router.get('/annual-summary', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN', 'DD_ADMIN'), mprPraroop1CController.getAnnualSummary);

router.get('/:id', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1CController.getReportById);
router.patch('/:id/approve', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1CController.approveReport);
router.patch('/:id/reject', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1CController.rejectReport);

export default router;
