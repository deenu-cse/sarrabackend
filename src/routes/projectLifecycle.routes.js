import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import { upload } from '../middlewares/upload.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import * as ctrl from '../controllers/projectLifecycle.controller.js';

/**
 * Completion, closure and outcome tracking of a project.
 * Mounted on /sanctions ahead of the main project routes; anything not
 * matched here falls through to them.
 */
const router = Router();
router.use(verifyAccessToken);

const { PIA_OFFICER, DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER } = USER_ROLES;

// Multer errors become plain 400s the screen can show next to the field.
const files = (handler) => (req, res, next) => handler(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'The file is too large. Maximum size is 10 MB.'));
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'Upload one file per field.'));
  return next(err instanceof ApiError ? new ApiError(HTTP_STATUS.BAD_REQUEST, 'This file type cannot be uploaded.') : err);
});
const completionFiles = files(upload.fields([{ name: 'completionCertificate', maxCount: 1 }, { name: 'utilisationCertificate', maxCount: 1 }]));
const evidenceFile = files(upload.single('evidence'));

// Outcomes across the State
router.get('/outcomes/indicators', ctrl.listIndicators);
router.get('/outcomes/summary', requireRole(SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER), ctrl.getOutcomeSummary);

// Outcomes of one project
router.get('/:id/outcomes', ctrl.getProjectOutcomes);
router.post('/:id/outcomes', requireRole(PIA_OFFICER, DD_LEVEL), evidenceFile, auditLog('OUTCOME_RECORD'), ctrl.recordOutcome);
router.patch('/:id/outcomes/:entryId/void', requireRole(PIA_OFFICER, DD_LEVEL), auditLog('OUTCOME_RECORD'), ctrl.voidOutcome);

// Completion report, district verification, State closure
router.get('/:id/completion', requireRole(PIA_OFFICER, DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN), ctrl.getCompletionState);
router.post('/:id/completion', requireRole(PIA_OFFICER), completionFiles, auditLog('PROJECT_COMPLETION'), ctrl.submitCompletion);
router.patch('/:id/completion/:departmentId/verify', requireRole(DD_LEVEL), auditLog('PROJECT_COMPLETION'), ctrl.verifyCompletion);
router.patch('/:id/completion/:departmentId/return', requireRole(DD_LEVEL), auditLog('PROJECT_COMPLETION'), ctrl.returnCompletion);
router.post('/:id/close', requireRole(SUPER_ADMIN), auditLog('PROJECT_CLOSE'), ctrl.closeProject);
router.patch('/:id/closure/refund', requireRole(SUPER_ADMIN), auditLog('PROJECT_CLOSE'), ctrl.recordRefund);

export default router;
