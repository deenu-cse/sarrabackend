import { Router } from 'express';
import * as mprPraroop1DController from '../controllers/mprPraroop1D.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyAccessToken);

router.post('/draft', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1DController.saveDraft);
router.post('/submit', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1DController.submitMPR);
router.patch('/:id/resubmit', requireRole('MND_OFFICER', 'DD_OFFICER', 'MND_ADMIN'), mprPraroop1DController.resubmitMPR);

router.get('/my-reports', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1DController.getMyReports);
router.get('/all-reports', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1DController.getMyReports);
router.get('/previous-month', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1DController.getPreviousMonthData);
router.get('/baseline', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1DController.getBaselineFromDPR);
router.get('/annual-summary', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN', 'DD_ADMIN'), mprPraroop1DController.getAnnualSummary);

router.get('/:id', requireRole('MND_OFFICER', 'MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1DController.getReportById);
router.patch('/:id/approve', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1DController.approveReport);
router.patch('/:id/reject', requireRole('MND_SUPER_ADMIN', 'MND_ADMIN'), mprPraroop1DController.rejectReport);

export default router;
