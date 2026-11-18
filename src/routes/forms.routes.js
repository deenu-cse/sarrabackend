import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import { upload } from '../middlewares/upload.middleware.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import * as ctrl from '../controllers/forms.controller.js';

/**
 * Field forms. Roles are checked here; which committee, district or unit a user
 * may enter or approve for is decided in the services.
 *   /meetings   HPC and SLEC (HQ Maker), DLEC (District Maker) → HQ Approver
 *   /dnss       Dhara Naula Sanrakshan Samiti (District Maker)
 *   /trainings  Training and capacity development (HQ, District and PIA Makers)
 *   /jsa        Jal Sanrakshan Abhiyan progress, Prarup-03 (District Maker; HQ sees the report)
 */

const { PIA_OFFICER, DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER } = USER_ROLES;
const makers = requireRole(DD_LEVEL, SUPER_ADMIN);
const readers = requireRole(DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER);
const trainingMakers = requireRole(PIA_OFFICER, DD_LEVEL, SUPER_ADMIN);
const trainingReaders = requireRole(PIA_OFFICER, DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER);

const files = (req, res, next) => upload.array('files', 12)(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'A file is too large. Maximum size is 10 MB each.'));
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'Upload at most 12 files at a time.'));
  return next(err instanceof ApiError ? new ApiError(HTTP_STATUS.BAD_REQUEST, 'Upload PDF files or photographs (JPG, PNG, WEBP).') : err);
});

// ─── Committee meetings ──────────────────────────────────────────────────────
export const meetingRoutes = Router();
meetingRoutes.use(verifyAccessToken);
meetingRoutes.get('/', readers, ctrl.listMeetings);
meetingRoutes.post('/', makers, auditLog('MEETING_CREATE'), ctrl.createMeeting);
meetingRoutes.get('/pending-count', readers, ctrl.meetingPendingCount);
meetingRoutes.get('/export', readers, ctrl.exportMeetings);
meetingRoutes.get('/:id', readers, ctrl.getMeeting);
meetingRoutes.get('/:id/pdf', readers, ctrl.downloadMeetingPdf);
meetingRoutes.put('/:id', makers, auditLog('MEETING_UPDATE'), ctrl.updateMeeting);
meetingRoutes.delete('/:id', makers, auditLog('MEETING_DELETE'), ctrl.deleteMeeting);
meetingRoutes.post('/:id/files/:kind', makers, files, auditLog('MEETING_FILE'), ctrl.addMeetingFiles);
meetingRoutes.delete('/:id/files/:kind/:fileId', makers, auditLog('MEETING_FILE'), ctrl.removeMeetingFile);
meetingRoutes.patch('/:id/submit', makers, auditLog('MEETING_SUBMIT'), ctrl.submitMeeting);
meetingRoutes.patch('/:id/approve', requireRole(SUPER_ADMIN), auditLog('MEETING_APPROVE'), ctrl.approveMeeting);
meetingRoutes.patch('/:id/return', requireRole(SUPER_ADMIN), auditLog('MEETING_RETURN'), ctrl.returnMeeting);

// ─── DNSS ────────────────────────────────────────────────────────────────────
export const dnssRoutes = Router();
dnssRoutes.use(verifyAccessToken);
dnssRoutes.get('/', readers, ctrl.listDnss);
dnssRoutes.post('/', requireRole(DD_LEVEL), auditLog('DNSS_CREATE'), ctrl.createDnss);
dnssRoutes.get('/export', readers, ctrl.exportDnss);
dnssRoutes.get('/:id', readers, ctrl.getDnss);
dnssRoutes.put('/:id', requireRole(DD_LEVEL), auditLog('DNSS_UPDATE'), ctrl.updateDnss);
dnssRoutes.delete('/:id', requireRole(DD_LEVEL), auditLog('DNSS_DELETE'), ctrl.deleteDnss);
dnssRoutes.post('/:id/files/:kind', requireRole(DD_LEVEL), files, auditLog('DNSS_FILE'), ctrl.addDnssFiles);
dnssRoutes.delete('/:id/files/:kind/:fileId', requireRole(DD_LEVEL), auditLog('DNSS_FILE'), ctrl.removeDnssFile);

// ─── Training ────────────────────────────────────────────────────────────────
export const trainingRoutes = Router();
trainingRoutes.use(verifyAccessToken);
trainingRoutes.get('/', trainingReaders, ctrl.listTrainings);
trainingRoutes.post('/', trainingMakers, auditLog('TRAINING_CREATE'), ctrl.createTraining);
trainingRoutes.get('/export', trainingReaders, ctrl.exportTrainings);
trainingRoutes.get('/:id', trainingReaders, ctrl.getTraining);
trainingRoutes.put('/:id', trainingMakers, auditLog('TRAINING_UPDATE'), ctrl.updateTraining);
trainingRoutes.delete('/:id', trainingMakers, auditLog('TRAINING_DELETE'), ctrl.deleteTraining);
trainingRoutes.post('/:id/files/:kind', trainingMakers, files, auditLog('TRAINING_FILE'), ctrl.addTrainingFiles);
trainingRoutes.delete('/:id/files/:kind/:fileId', trainingMakers, auditLog('TRAINING_FILE'), ctrl.removeTrainingFile);

// ─── JSA progress ────────────────────────────────────────────────────────────
export const jsaRoutes = Router();
jsaRoutes.use(verifyAccessToken);
jsaRoutes.get('/reports', readers, ctrl.listJsaReports);
jsaRoutes.post('/reports', requireRole(DD_LEVEL), auditLog('JSA_REPORT_CREATE'), ctrl.createJsaReport);
jsaRoutes.get('/reports/:id', readers, ctrl.getJsaReport);
jsaRoutes.patch('/reports/:id', requireRole(DD_LEVEL), auditLog('JSA_REPORT_UPDATE'), ctrl.updateJsaReport);
jsaRoutes.delete('/reports/:id', requireRole(DD_LEVEL), auditLog('JSA_REPORT_DELETE'), ctrl.deleteJsaReport);
jsaRoutes.post('/reports/:id/updates', requireRole(DD_LEVEL), auditLog('JSA_PROGRESS'), ctrl.addJsaProgress);
jsaRoutes.get('/consolidated', readers, ctrl.getJsaConsolidated);
jsaRoutes.get('/export/excel', readers, ctrl.exportJsaExcel);
jsaRoutes.get('/export/pdf', readers, ctrl.exportJsaPdf);
jsaRoutes.get('/settings', readers, ctrl.getJsaSettings);
jsaRoutes.put('/settings', requireRole(SUPER_ADMIN), auditLog('JSA_SETTINGS'), ctrl.updateJsaSettings);
