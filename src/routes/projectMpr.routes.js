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
 * touch is decided in the service from the database, never from the request.
 */
const router = Router();
router.use(verifyAccessToken);

const pia = requireRole(USER_ROLES.PIA_OFFICER);
const dd = requireRole(USER_ROLES.DD_LEVEL);
const readers = requireRole(USER_ROLES.PIA_OFFICER, USER_ROLES.DD_LEVEL, USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN);

// PIA officer: what can I report on, and the form for a period
router.get('/workload', pia, ctrl.getWorkload);
router.get('/context', pia, ctrl.getContext);
router.get('/form', pia, ctrl.getForm);
router.post('/preview', pia, ctrl.previewMpr);
router.post('/', pia, auditLog('MPR_SUBMIT'), ctrl.submitMpr);
router.get('/mine', pia, ctrl.listMine);

// District
router.get('/district', dd, ctrl.listForDistrict);

// State-wide (State admin and M&E admin)
router.get('/all', requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN), ctrl.listAll);
router.get('/analytics', requireRole(USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER), ctrl.getAnalytics);

// Official output. The register is scoped to the user inside the service.
const everyone = requireRole(USER_ROLES.PIA_OFFICER, USER_ROLES.DD_LEVEL, USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER);
router.get('/export/register', everyone, ctrl.downloadRegister);

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

// Optional evidence, until the district approves the report
router.post('/:id/evidence', pia, evidenceFiles, auditLog('MPR_EVIDENCE_UPLOAD'), ctrl.addEvidence);
router.delete('/:id/evidence/:evidenceId', pia, auditLog('MPR_EVIDENCE_UPLOAD'), ctrl.removeEvidence);

// Correction of a returned report
router.get('/:id/form', pia, ctrl.getResubmitForm);
router.post('/:id/preview', pia, ctrl.previewResubmit);
router.patch('/:id/resubmit', pia, auditLog('MPR_RESUBMIT'), ctrl.resubmitMpr);

// District review
router.patch('/:id/district-approve', dd, auditLog('MPR_APPROVE'), ctrl.districtApprove);
router.patch('/:id/return', dd, auditLog('MPR_RETURN'), ctrl.returnToPia);

// State verification
router.patch('/:id/state-return', requireRole(USER_ROLES.MND_SUPER_ADMIN), auditLog('MPR_RETURN'), ctrl.stateReturn);
router.patch('/:id/state-verify', requireRole(USER_ROLES.MND_SUPER_ADMIN), auditLog('MPR_APPROVE'), ctrl.stateVerify);

export default router;
