import { Router } from 'express';
import * as mprPraroop1CController from '../controllers/mprPraroop1C.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyAccessToken);

router.post('/draft', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1CController.saveDraft);
router.post('/submit', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1CController.submitMPR);
router.patch('/:id/resubmit', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1CController.resubmitMPR);

router.get('/my-reports', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1CController.getMyReports);
router.get('/all-reports', requireRole('MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1CController.getMyReports);
router.get('/all-district', requireRole('DD_LEVEL'), mprPraroop1CController.getDistrictReports);
router.get('/previous-month', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1CController.getPreviousMonthData);
router.get('/baseline', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1CController.getBaselineFromDPR);
router.get('/annual-summary', requireRole('MND_SUPER_ADMIN', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1CController.getAnnualSummary);

router.get('/:id', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1CController.getReportById);
router.patch('/:id/approve', requireRole('DD_LEVEL', 'MND_OFFICER', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1CController.approveReport);
router.patch('/:id/reject', requireRole('DD_LEVEL', 'MND_OFFICER', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1CController.rejectReport);
router.patch('/:id/district-approve', requireRole('DD_LEVEL'), mprPraroop1CController.districtApprove);
router.patch('/:id/return', requireRole('DD_LEVEL'), mprPraroop1CController.returnToMaker);

export default router;
