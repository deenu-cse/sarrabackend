import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import { uploadFields } from '../middlewares/upload.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import * as sanctionCtrl from '../controllers/sanction.controller.js';

const router = Router();
router.use(verifyAccessToken);

// --- State Level (SUPER_ADMIN) ---
router.post('/',
  requireRole(USER_ROLES.SUPER_ADMIN),
  auditLog('CREATE_SANCTION'),
  sanctionCtrl.createSanction
);

router.get('/approved-dprs',
  requireRole(USER_ROLES.SUPER_ADMIN),
  sanctionCtrl.getApprovedDPRs
);

router.get('/analytics',
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN),
  sanctionCtrl.getAnalytics
);

router.get('/',
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN),
  sanctionCtrl.listSanctions
);

// --- District Level (DD_LEVEL) ---
router.get('/district',
  requireRole(USER_ROLES.DD_LEVEL),
  sanctionCtrl.getDistrictSanctions
);

// --- PIA Level (PIA_OFFICER) ---
router.get('/my-projects',
  requireRole(USER_ROLES.PIA_OFFICER),
  sanctionCtrl.getMyProjects
);

router.get('/pending',
  requireRole(USER_ROLES.PIA_OFFICER),
  sanctionCtrl.getPendingSanctions
);

// --- Single sanction detail (all authenticated) ---
router.get('/:id', sanctionCtrl.getSanctionDetail);

// --- State workflow actions ---
router.patch('/:id/checker-verify',
  requireRole(USER_ROLES.SUPER_ADMIN),
  auditLog('CHECKER_VERIFY_SANCTION'),
  sanctionCtrl.checkerVerify
);

router.patch('/:id/approve',
  requireRole(USER_ROLES.SUPER_ADMIN),
  uploadFields([
    { name: 'secretariatApprovalOrder', maxCount: 1 },
    { name: 'stateSanctionOrder', maxCount: 1 },
  ]),
  auditLog('APPROVE_SANCTION'),
  sanctionCtrl.approveSanction
);

router.patch('/:id/reject',
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.DD_LEVEL),
  auditLog('REJECT_SANCTION'),
  sanctionCtrl.rejectSanction
);

router.patch('/:id/forward-district',
  requireRole(USER_ROLES.SUPER_ADMIN),
  auditLog('FORWARD_SANCTION_TO_DISTRICT'),
  sanctionCtrl.forwardToDistrict
);

// --- District workflow actions ---
router.patch('/:id/district-accept',
  requireRole(USER_ROLES.DD_LEVEL),
  uploadFields([{ name: 'fundAllocationOrder', maxCount: 1 }]),
  auditLog('DISTRICT_ACCEPT_SANCTION'),
  sanctionCtrl.districtAcceptSanction
);

router.patch('/:id/forward-pia',
  requireRole(USER_ROLES.DD_LEVEL),
  auditLog('FORWARD_SANCTION_TO_PIA'),
  sanctionCtrl.forwardToPIA
);

// --- PIA workflow actions ---
router.patch('/:id/pia-accept',
  requireRole(USER_ROLES.PIA_OFFICER),
  auditLog('PIA_ACCEPT_SANCTION'),
  sanctionCtrl.piaAcceptSanction
);

export default router;
