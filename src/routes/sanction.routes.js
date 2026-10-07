import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import { uploadFields } from '../middlewares/upload.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import * as sanctionCtrl from '../controllers/sanction.controller.js';
import * as budgetCtrl from '../controllers/budgetAllocation.controller.js';
import { upload } from '../middlewares/upload.middleware.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const router = Router();
router.use(verifyAccessToken);

// --- State Level (SUPER_ADMIN) ---
router.post('/generate-id',
  requireRole(USER_ROLES.SUPER_ADMIN),
  auditLog('GENERATE_PROJECT_ID'),
  sanctionCtrl.generateProjectId
);

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

// --- Revised estimates and correction of rejected projects (State level) ---
router.patch('/revisions/:revisionId/verify', requireRole(USER_ROLES.SUPER_ADMIN), auditLog('CHECKER_VERIFY_SANCTION'), sanctionCtrl.verifyRevision);
router.patch('/revisions/:revisionId/approve', requireRole(USER_ROLES.SUPER_ADMIN), auditLog('APPROVE_SANCTION'), sanctionCtrl.approveRevision);
router.patch('/revisions/:revisionId/reject', requireRole(USER_ROLES.SUPER_ADMIN), auditLog('REJECT_SANCTION'), sanctionCtrl.rejectRevision);
router.get('/:id/revisions', requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.DD_LEVEL, USER_ROLES.MND_SUPER_ADMIN), sanctionCtrl.listRevisions);
router.post('/:id/revisions', requireRole(USER_ROLES.SUPER_ADMIN), auditLog('PROJECT_REVISION'), sanctionCtrl.createRevision);
router.patch('/:id/resubmit', requireRole(USER_ROLES.SUPER_ADMIN), auditLog('CREATE_SANCTION'), sanctionCtrl.resubmitRejected);

// --- PIA charge: workload and handover (District) ---
router.get('/pia-workload', requireRole(USER_ROLES.DD_LEVEL), sanctionCtrl.getPiaWorkload);
router.post('/pia-handover', requireRole(USER_ROLES.DD_LEVEL), auditLog('PIA_TRANSFER'), sanctionCtrl.handoverPiaCharge);
router.patch('/:id/transfer-pia', requireRole(USER_ROLES.DD_LEVEL), auditLog('PIA_TRANSFER'), sanctionCtrl.transferPia);

// --- Budget allocation against an existing project (State level) ---
// Reading is open to state admins; releasing budget is limited to Makers (checked in the controller).
const singlePdf = (req, res, next) => {
  upload.single('document')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'The PDF is too large. Maximum size is 10 MB.'));
    if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'Upload one PDF file at a time.'));
    return next(err instanceof ApiError ? new ApiError(HTTP_STATUS.BAD_REQUEST, 'Only PDF files can be uploaded.') : err);
  });
};

router.get('/budget-allocation/eligible',
  requireRole(USER_ROLES.SUPER_ADMIN),
  budgetCtrl.listEligibleProjects
);

router.get('/:id/budget-allocation',
  requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.DD_LEVEL, USER_ROLES.PIA_OFFICER),
  budgetCtrl.getBudgetState
);

router.post('/:id/budget-allocations/upload',
  requireRole(USER_ROLES.SUPER_ADMIN),
  singlePdf,
  auditLog('BUDGET_DOCUMENT_UPLOAD'),
  budgetCtrl.uploadDocument
);

router.delete('/:id/budget-allocations/documents/:documentId',
  requireRole(USER_ROLES.SUPER_ADMIN),
  budgetCtrl.discardDocument
);

router.post('/:id/budget-allocations/reverse',
  requireRole(USER_ROLES.SUPER_ADMIN),
  auditLog('BUDGET_REVERSE'),
  budgetCtrl.reverseInstallment
);

router.post('/:id/budget-allocations/preview',
  requireRole(USER_ROLES.SUPER_ADMIN),
  budgetCtrl.previewAllocation
);

router.post('/:id/budget-allocations',
  requireRole(USER_ROLES.SUPER_ADMIN),
  auditLog('BUDGET_ALLOCATE'),
  budgetCtrl.commitAllocation
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

router.get('/:id/pia-candidates',
  requireRole(USER_ROLES.DD_LEVEL),
  sanctionCtrl.getPiaCandidates
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
