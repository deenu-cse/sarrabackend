import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import { uploadFields } from '../middlewares/upload.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import * as sanctionCtrl from '../controllers/sanction.controller.js';

/**
 * Project workflow. Which tier and workflow role (Maker / Checker / Approver)
 * may take each step is enforced in the service; the roles here only keep
 * other tiers out.
 */
const router = Router();
router.use(verifyAccessToken);

const { SUPER_ADMIN, DD_LEVEL, PIA_OFFICER, MND_SUPER_ADMIN, MND_OFFICER } = USER_ROLES;

// --- SARRA HQ ---
router.post('/generate-id',
  requireRole(SUPER_ADMIN),
  auditLog('GENERATE_PROJECT_ID'),
  sanctionCtrl.generateProjectId
);

router.post('/',
  requireRole(SUPER_ADMIN),
  auditLog('CREATE_SANCTION'),
  sanctionCtrl.createSanction
);

router.get('/approved-dprs',
  requireRole(SUPER_ADMIN),
  sanctionCtrl.getApprovedDPRs
);

router.get('/analytics',
  requireRole(SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER),
  sanctionCtrl.getAnalytics
);

router.get('/',
  requireRole(SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER),
  sanctionCtrl.listSanctions
);

// --- District SARRA Centre ---
router.get('/district',
  requireRole(DD_LEVEL),
  sanctionCtrl.getDistrictSanctions
);

// --- PIA ---
router.get('/my-projects',
  requireRole(PIA_OFFICER),
  sanctionCtrl.getMyProjects
);

router.get('/pending',
  requireRole(PIA_OFFICER),
  sanctionCtrl.getPendingSanctions
);

// --- Target revisions and correction of returned projects (HQ) ---
router.patch('/revisions/:revisionId/verify', requireRole(SUPER_ADMIN), auditLog('CHECKER_VERIFY_SANCTION'), sanctionCtrl.verifyRevision);
router.patch('/revisions/:revisionId/approve', requireRole(SUPER_ADMIN), auditLog('APPROVE_SANCTION'), sanctionCtrl.approveRevision);
router.patch('/revisions/:revisionId/reject', requireRole(SUPER_ADMIN), auditLog('REJECT_SANCTION'), sanctionCtrl.rejectRevision);
router.get('/:id/revisions', requireRole(SUPER_ADMIN, DD_LEVEL, MND_SUPER_ADMIN), sanctionCtrl.listRevisions);
router.post('/:id/revisions', requireRole(SUPER_ADMIN), auditLog('PROJECT_REVISION'), sanctionCtrl.createRevision);
router.patch('/:id/resubmit', requireRole(SUPER_ADMIN), auditLog('CREATE_SANCTION'), sanctionCtrl.resubmitRejected);

// --- PIA charge: workload and handover (District Maker) ---
router.get('/pia-workload', requireRole(DD_LEVEL), sanctionCtrl.getPiaWorkload);
router.post('/pia-handover', requireRole(DD_LEVEL), auditLog('PIA_TRANSFER'), sanctionCtrl.handoverPiaCharge);
router.patch('/:id/transfer-pia', requireRole(DD_LEVEL), auditLog('PIA_TRANSFER'), sanctionCtrl.transferPia);

// --- Single project detail (all authenticated; scoped in the controller) ---
router.get('/:id', sanctionCtrl.getSanctionDetail);

// --- HQ workflow actions ---
router.patch('/:id/checker-verify',
  requireRole(SUPER_ADMIN),
  auditLog('CHECKER_VERIFY_SANCTION'),
  sanctionCtrl.checkerVerify
);

router.patch('/:id/approve',
  requireRole(SUPER_ADMIN),
  uploadFields([
    { name: 'secretariatApprovalOrder', maxCount: 1 },
    { name: 'stateSanctionOrder', maxCount: 1 },
  ]),
  auditLog('APPROVE_SANCTION'),
  sanctionCtrl.approveSanction
);

// Return to the HQ Maker with an objection (HQ Checker or Approver)
router.patch('/:id/reject',
  requireRole(SUPER_ADMIN),
  auditLog('RETURN_SANCTION'),
  sanctionCtrl.rejectSanction
);

router.patch('/:id/forward-district',
  requireRole(SUPER_ADMIN),
  auditLog('FORWARD_SANCTION_TO_DISTRICT'),
  sanctionCtrl.forwardToDistrict
);

// --- District workflow actions (District Maker) ---
router.get('/:id/pia-candidates',
  requireRole(DD_LEVEL),
  sanctionCtrl.getPiaCandidates
);

router.patch('/:id/district-accept',
  requireRole(DD_LEVEL),
  auditLog('DISTRICT_ACCEPT_SANCTION'),
  sanctionCtrl.districtAcceptSanction
);

// Assign PIA Makers and MPR reporting responsibility
router.patch('/:id/forward-pia',
  requireRole(DD_LEVEL),
  auditLog('ASSIGN_REPORTING'),
  sanctionCtrl.forwardToPIA
);

// --- PIA workflow actions (PIA Maker) ---
router.patch('/:id/pia-accept',
  requireRole(PIA_OFFICER),
  auditLog('PIA_ACCEPT_SANCTION'),
  sanctionCtrl.piaAcceptSanction
);

export default router;
