import { Router } from 'express';
import * as mprPraroop1DController from '../controllers/mprPraroop1D.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyAccessToken);

router.post('/draft', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1DController.saveDraft);
router.post('/submit', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1DController.submitMPR);
router.patch('/:id/resubmit', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1DController.resubmitMPR);

router.get('/my-reports', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1DController.getMyReports);
router.get('/all-reports', requireRole('MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1DController.getMyReports);
router.get('/all-district', requireRole('DD_LEVEL'), mprPraroop1DController.getDistrictReports);
router.get('/previous-month', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1DController.getPreviousMonthData);
router.get('/baseline', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1DController.getBaselineFromDPR);
router.get('/annual-summary', requireRole('MND_SUPER_ADMIN', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1DController.getAnnualSummary);

router.get('/:id', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1DController.getReportById);
router.patch('/:id/approve', requireRole('DD_LEVEL', 'MND_OFFICER', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1DController.approveReport);
router.patch('/:id/reject', requireRole('DD_LEVEL', 'MND_OFFICER', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1DController.rejectReport);
router.patch('/:id/district-approve', requireRole('DD_LEVEL'), mprPraroop1DController.districtApprove);
router.patch('/:id/return', requireRole('DD_LEVEL'), mprPraroop1DController.returnToMaker);

export default router;
