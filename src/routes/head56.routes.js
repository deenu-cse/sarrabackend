import { Router } from 'express';
import { verifyAccessToken } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { auditLog } from '../middlewares/audit.middleware.js';
import USER_ROLES from '../constants/roles.constants.js';
import { upload } from '../middlewares/upload.middleware.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import * as ctrl from '../controllers/head56.controller.js';

/**
 * Budget Head 56 — Non-Salary Grant.
 * Roles are checked here; which unit a user may see or act for, and which
 * workflow step they may take, is decided in the services from the database.
 */
const router = Router();
router.use(verifyAccessToken);

const { PIA_OFFICER, DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER } = USER_ROLES;
const hq = requireRole(SUPER_ADMIN);
const tiers = requireRole(PIA_OFFICER, DD_LEVEL, SUPER_ADMIN);
const readers = requireRole(PIA_OFFICER, DD_LEVEL, SUPER_ADMIN, MND_SUPER_ADMIN, MND_OFFICER);

const documentFiles = (req, res, next) => upload.array('files', 10)(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'A file is too large. Maximum size is 10 MB each.'));
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'Upload at most 10 files at a time.'));
  return next(err instanceof ApiError ? new ApiError(HTTP_STATUS.BAD_REQUEST, 'Upload PDF files or photographs (JPG, PNG, WEBP).') : err);
});

// Master (sub-heads and items), kept by SARRA HQ
router.get('/master', readers, ctrl.listMaster);
router.post('/master', hq, auditLog('H56_MASTER_UPDATE'), ctrl.createMasterItem);
router.patch('/master/:code', hq, auditLog('H56_MASTER_UPDATE'), ctrl.updateMasterItem);

// Allocations: HQ Maker → HQ Checker → HQ Approver (publish)
router.get('/allocations', readers, ctrl.listAllocations);
router.post('/allocations', hq, auditLog('H56_ALLOCATION_CREATE'), ctrl.createAllocation);
router.get('/allocations/:id', readers, ctrl.getAllocation);
router.put('/allocations/:id', hq, auditLog('H56_ALLOCATION_SAVE'), ctrl.saveAllocation);
router.patch('/allocations/:id/submit', hq, auditLog('H56_ALLOCATION_SUBMIT'), ctrl.submitAllocation);
router.patch('/allocations/:id/verify', hq, auditLog('H56_ALLOCATION_VERIFY'), ctrl.verifyAllocation);
router.patch('/allocations/:id/approve', hq, auditLog('H56_ALLOCATION_PUBLISH'), ctrl.approveAllocation);
router.patch('/allocations/:id/return', hq, auditLog('H56_ALLOCATION_RETURN'), ctrl.returnAllocation);
router.delete('/allocations/:id', hq, auditLog('H56_ALLOCATION_DISCARD'), ctrl.discardAllocation);

// Monthly reports: the unit's Maker
router.get('/context', tiers, ctrl.getContext);
router.get('/form', tiers, ctrl.getForm);
router.post('/reports', tiers, auditLog('H56_MPR_SAVE'), ctrl.createReport);
router.get('/reports', readers, ctrl.listReports);
router.get('/queue', tiers, ctrl.listQueue);
router.get('/reports/:id', readers, ctrl.getReport);
router.get('/reports/:id/pdf', readers, ctrl.downloadReportPdf);
router.get('/reports/:id/excel', readers, ctrl.downloadReportExcel);
router.get('/reports/:id/form', tiers, ctrl.getEditForm);
router.put('/reports/:id', tiers, auditLog('H56_MPR_SAVE'), ctrl.saveReport);
router.delete('/reports/:id', tiers, auditLog('H56_MPR_DISCARD'), ctrl.deleteDraft);
router.post('/reports/:id/documents', tiers, documentFiles, auditLog('H56_DOCUMENT'), ctrl.addDocuments);
router.delete('/reports/:id/documents/:documentId', tiers, auditLog('H56_DOCUMENT'), ctrl.removeDocument);

// Review chain: PIA Checker → PIA Approver → District Technical Staff → District Checker → District Approver
//               → HQ Maker → HQ Checker → HQ Approver; reopening by the HQ Approver
router.patch('/reports/:id/forward', tiers, auditLog('H56_MPR_FORWARD'), ctrl.forwardReport);
router.patch('/reports/:id/return', tiers, auditLog('H56_MPR_RETURN'), ctrl.returnReport);
router.patch('/reports/:id/reject', tiers, auditLog('H56_MPR_REJECT'), ctrl.rejectReport);
router.patch('/reports/:id/reopen', hq, auditLog('H56_MPR_REOPEN'), ctrl.reopenReport);

// Dashboard, Prarup-2 statement and the monthly CEO / ACEO / CFO review
router.get('/dashboard', readers, ctrl.getDashboard);
router.get('/statement', readers, ctrl.getStatement);
router.get('/statement/excel', readers, ctrl.downloadStatementExcel);
router.get('/statement/pdf', readers, ctrl.downloadStatementPdf);
router.get('/reviews', readers, ctrl.listReviews);
router.post('/reviews', hq, auditLog('H56_REVIEW'), ctrl.recordReview);
router.patch('/reviews/:id/withdraw', hq, auditLog('H56_REVIEW_WITHDRAW'), ctrl.withdrawReview);

export default router;
