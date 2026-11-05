import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import { upload } from '../middlewares/upload.middleware.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import * as ctrl from '../controllers/projectMpr.controller.js';

/**
 * Project Monthly Progress Reports.
 * Roles are checked here; which project / department / district a user may
 * touch, and which review step they may take, is decided in the service from
 * the database, never from the request.
 */
const router = Router();
router.use(verifyAccessToken);

const { PIA_OFFICER, DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER } = USER_ROLES;
// Reporting Makers: the PIA Maker, or District Technical Staff (a District Maker)
const makers = requireRole(PIA_OFFICER, DD_LEVEL);
// Every tier with Maker / Checker / Approver
const tiers = requireRole(PIA_OFFICER, DD_LEVEL, SUPER_ADMIN);
const readers = requireRole(PIA_OFFICER, DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER);

// Reporting Maker: what can I report on, and the form for a period
router.get('/workload', makers, ctrl.getWorkload);
router.get('/context', makers, ctrl.getContext);
router.get('/form', makers, ctrl.getForm);
router.post('/preview', makers, ctrl.previewMpr);
router.post('/', makers, auditLog('MPR_SUBMIT'), ctrl.submitMpr);
router.get('/mine', makers, ctrl.listMine);

// What is waiting for my action, at any tier
router.get('/queue', tiers, ctrl.listQueue);

// District
router.get('/district', requireRole(DD_LEVEL), ctrl.listForDistrict);

// State-wide (HQ and M&E administrator)
router.get('/all', requireRole(SUPER_ADMIN, MND_SUPER_ADMIN), ctrl.listAll);
router.get('/analytics', requireRole(SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER), ctrl.getAnalytics);

// Official output. The register is scoped to the user inside the service.
router.get('/export/register', readers, ctrl.downloadRegister);

const evidenceFiles = (req, res, next) => upload.array('files', 6)(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'A file is too large. Maximum size is 10 MB each.'));
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'A report can carry at most 6 files.'));
  return next(err instanceof ApiError ? new ApiError(HTTP_STATUS.BAD_REQUEST, 'Upload photographs (JPG, PNG, WEBP) or PDF files.') : err);
});

// Shared reading
router.get('/project/:projectId', readers, ctrl.listForProject);
router.get('/:id', readers, ctrl.getMpr);
router.get('/:id/pdf', readers, ctrl.downloadPdf);
router.get('/:id/excel', readers, ctrl.downloadExcel);

// Evidence, while the report is with its Maker or not yet picked up by the first reviewer
router.post('/:id/evidence', makers, evidenceFiles, auditLog('MPR_EVIDENCE_UPLOAD'), ctrl.addEvidence);
router.delete('/:id/evidence/:evidenceId', makers, auditLog('MPR_EVIDENCE_UPLOAD'), ctrl.removeEvidence);

// Drafts and corrections by the reporting Maker
router.get('/:id/form', makers, ctrl.getEditForm);
router.post('/:id/preview', makers, ctrl.previewEdit);
router.patch('/:id/resubmit', makers, auditLog('MPR_RESUBMIT'), ctrl.saveMpr);
router.delete('/:id', makers, auditLog('MPR_DRAFT_DISCARD'), ctrl.deleteDraft);

// Review chain: PIA Checker → PIA Approver → District Maker → District Checker → District Approver
//               → HQ Maker → HQ Checker → HQ Approver
router.patch('/:id/forward', tiers, auditLog('MPR_FORWARD'), ctrl.forwardMpr);
router.patch('/:id/return', tiers, auditLog('MPR_RETURN'), ctrl.returnMpr);
router.patch('/:id/reject', tiers, auditLog('MPR_REJECT'), ctrl.rejectMpr);

export default router;
