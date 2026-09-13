import { Router } from 'express';
import * as mprPraroop1AController from '../controllers/mprPraroop1A.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyAccessToken);

router.post('/draft', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1AController.saveDraft);
router.post('/submit', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1AController.submitMPR);
router.patch('/:id/resubmit', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1AController.resubmitMPR);

router.get('/my-reports', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1AController.getMyReports);
router.get('/all-reports', requireRole('MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1AController.getMyReports);
router.get('/all-district', requireRole('DD_LEVEL'), mprPraroop1AController.getDistrictReports);
router.get('/previous-month', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1AController.getPreviousMonthData);
router.get('/baseline', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1AController.getBaselineFromDPR);
router.get('/annual-summary', requireRole('MND_SUPER_ADMIN', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1AController.getAnnualSummary);

router.get('/:id', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1AController.getReportById);
router.patch('/:id/approve', requireRole('DD_LEVEL', 'MND_OFFICER', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1AController.approveReport);
router.patch('/:id/reject', requireRole('DD_LEVEL', 'MND_OFFICER', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1AController.rejectReport);
router.patch('/:id/district-approve', requireRole('DD_LEVEL'), mprPraroop1AController.districtApprove);
router.patch('/:id/return', requireRole('DD_LEVEL'), mprPraroop1AController.returnToMaker);

export default router;

