import { Router } from 'express';
import * as mprPraroop1BController from '../controllers/mprPraroop1B.controller.js';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

router.use(verifyAccessToken);

router.post('/draft', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1BController.saveDraft);
router.post('/submit', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1BController.submitMPR);
router.patch('/:id/resubmit', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1BController.resubmitMPR);

router.get('/my-reports', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1BController.getMyReports);
router.get('/all-reports', requireRole('MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1BController.getMyReports);
router.get('/all-district', requireRole('DD_LEVEL'), mprPraroop1BController.getDistrictReports);
router.get('/previous-month', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1BController.getPreviousMonthData);
router.get('/baseline', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1BController.getBaselineFromDPR);
router.get('/annual-summary', requireRole('MND_SUPER_ADMIN', 'DD_LEVEL', 'SUPER_ADMIN'), mprPraroop1BController.getAnnualSummary);

router.get('/:id', requireRole('PIA_OFFICER', 'MND_OFFICER', 'DD_LEVEL', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1BController.getReportById);
router.patch('/:id/approve', requireRole('DD_LEVEL', 'MND_OFFICER', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1BController.approveReport);
router.patch('/:id/reject', requireRole('DD_LEVEL', 'MND_OFFICER', 'MND_SUPER_ADMIN', 'SUPER_ADMIN'), mprPraroop1BController.rejectReport);
router.patch('/:id/district-approve', requireRole('DD_LEVEL'), mprPraroop1BController.districtApprove);
router.patch('/:id/return', requireRole('DD_LEVEL'), mprPraroop1BController.returnToMaker);

export default router;
