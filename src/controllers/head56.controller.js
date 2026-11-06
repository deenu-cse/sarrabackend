import * as master from '../services/head56Master.service.js';
import * as allocations from '../services/head56Allocation.service.js';
import * as reports from '../services/head56Mpr.service.js';
import * as analytics from '../services/head56Analytics.service.js';
import * as documents from '../services/head56Documents.service.js';
import { notifyHead56Allocation, notifyHead56Report, notifyHead56Review } from '../services/head56Notification.service.js';
import { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import { canManageMaster } from '../services/head56.common.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const ok = (res, data, message, status = HTTP_STATUS.OK) => res.status(status).json(new ApiResponse(status, data, message));
const text = (value) => (typeof value === 'string' ? value : '');
const pick = (query, keys) => Object.fromEntries(keys.map((key) => [key, text(query[key])]));
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const sendFile = (res, { buffer, filename }, type) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.status(HTTP_STATUS.OK).end(buffer);
};

const audit = (res, targetId, metadata) => {
  res.locals.auditTargetId = targetId;
  res.locals.auditMetadata = metadata;
};
const reportAudit = (mpr) => ({ mprNo: mpr.mprNo, unit: mpr.unitName, period: `${mpr.reportingMonth} ${mpr.financialYear}`, status: mpr.status, expenditureCurrentLakh: mpr.totals?.expenditureCurrentLakh });
const savedReport = (mpr) => ({ id: String(mpr._id), mprNo: mpr.mprNo, status: mpr.status });

// ─── Master ──────────────────────────────────────────────────────────────────

export const listMaster = asyncHandler(async (req, res) => {
  ok(res, { items: await master.listItems({ includeInactive: req.query.includeInactive === 'true' }), canManage: canManageMaster(req.user) }, 'Head 56 master fetched');
});
export const createMasterItem = asyncHandler(async (req, res) => {
  const item = await master.createItem(req.body, req.user);
  audit(res, null, { code: item.code, name: item.name });
  ok(res, item, 'Line added', HTTP_STATUS.CREATED);
});
export const updateMasterItem = asyncHandler(async (req, res) => {
  const item = await master.updateItem(req.params.code, req.body, req.user);
  audit(res, null, { code: item.code, name: item.name, isActive: item.isActive });
  ok(res, item, 'Line updated');
});

// ─── Allocations ─────────────────────────────────────────────────────────────

export const listAllocations = asyncHandler(async (req, res) => {
  ok(res, await allocations.listAllocations(req.user, pick(req.query, ['financialYear', 'level', 'district'])), 'Allocations fetched');
});
export const getAllocation = asyncHandler(async (req, res) => {
  ok(res, await allocations.getAllocation(req.params.id, req.user), 'Allocation fetched');
});
export const createAllocation = asyncHandler(async (req, res) => {
  const result = await allocations.createAllocation(req.body, req.user);
  audit(res, result.id, { financialYear: req.body?.financialYear, level: req.body?.level, district: req.body?.district });
  ok(res, result, 'Allocation created', HTTP_STATUS.CREATED);
});
export const saveAllocation = asyncHandler(async (req, res) => {
  ok(res, await allocations.saveAllocation(req.params.id, req.body, req.user), 'Allocation saved');
});
export const submitAllocation = asyncHandler(async (req, res) => {
  const allocation = await allocations.submitAllocation(req.params.id, req.body, req.user);
  audit(res, allocation._id, { unit: allocation.unitName, financialYear: allocation.financialYear });
  await notifyHead56Allocation({ allocation, actor: req.user, event: 'SUBMITTED' });
  ok(res, { id: String(allocation._id), status: allocation.status }, 'Allocation sent to the HQ Checker');
});
export const verifyAllocation = asyncHandler(async (req, res) => {
  const allocation = await allocations.verifyAllocation(req.params.id, req.body?.note, req.user);
  audit(res, allocation._id, { unit: allocation.unitName, financialYear: allocation.financialYear });
  await notifyHead56Allocation({ allocation, actor: req.user, event: 'VERIFIED' });
  ok(res, { id: String(allocation._id), status: allocation.status }, 'Allocation verified and sent to the HQ Approver');
});
export const approveAllocation = asyncHandler(async (req, res) => {
  const allocation = await allocations.approveAllocation(req.params.id, req.body?.note, req.user);
  audit(res, allocation._id, { unit: allocation.unitName, financialYear: allocation.financialYear, version: allocation.published?.version });
  await notifyHead56Allocation({ allocation, actor: req.user, event: 'PUBLISHED' });
  ok(res, { id: String(allocation._id), status: allocation.status, version: allocation.published?.version }, 'Allocation approved and published');
});
export const returnAllocation = asyncHandler(async (req, res) => {
  const allocation = await allocations.returnAllocation(req.params.id, req.body?.reason, req.user);
  audit(res, allocation._id, { unit: allocation.unitName, reason: allocation.returnReason });
  await notifyHead56Allocation({ allocation, actor: req.user, event: 'RETURNED' });
  ok(res, { id: String(allocation._id), status: allocation.status }, 'Allocation returned to the HQ Maker');
});
export const discardAllocation = asyncHandler(async (req, res) => {
  ok(res, await allocations.discardAllocation(req.params.id, req.user), 'Allocation discarded');
});

// ─── Reports: Maker ──────────────────────────────────────────────────────────

export const getContext = asyncHandler(async (req, res) => {
  ok(res, await reports.getMakerContext(req.user), 'Reporting context fetched');
});
export const getForm = asyncHandler(async (req, res) => {
  ok(res, await reports.getForm(pick(req.query, ['financialYear', 'reportingMonth']), req.user), 'Form fetched');
});
export const createReport = asyncHandler(async (req, res) => {
  const mpr = await reports.createReport(req.body, req.user);
  audit(res, mpr._id, reportAudit(mpr));
  if (mpr.status !== PROJECT_MPR_STATUS.DRAFT) await notifyHead56Report({ mpr, actor: req.user, event: 'SUBMITTED' });
  ok(res, savedReport(mpr), mpr.status === PROJECT_MPR_STATUS.DRAFT ? 'Draft saved' : 'Report submitted', HTTP_STATUS.CREATED);
});
export const getEditForm = asyncHandler(async (req, res) => {
  ok(res, await reports.getEditForm(req.params.id, req.user), 'Form fetched');
});
export const saveReport = asyncHandler(async (req, res) => {
  const { mpr, submitted, resubmitted } = await reports.saveReport(req.params.id, req.body, req.user);
  audit(res, mpr._id, reportAudit(mpr));
  if (submitted) await notifyHead56Report({ mpr, actor: req.user, event: resubmitted ? 'RESUBMITTED' : 'SUBMITTED' });
  ok(res, savedReport(mpr), submitted ? 'Report submitted' : 'Draft saved');
});
export const deleteDraft = asyncHandler(async (req, res) => {
  const result = await reports.deleteDraft(req.params.id, req.user);
  audit(res, result.id, { mprNo: result.mprNo });
  ok(res, result, 'Draft discarded');
});
export const addDocuments = asyncHandler(async (req, res) => {
  const mpr = await reports.addDocuments(req.params.id, req.files || [], req.body, req.user);
  audit(res, mpr._id, { mprNo: mpr.mprNo, files: (req.files || []).length, code: req.body?.code || null });
  ok(res, { id: String(mpr._id), documents: mpr.documents.length }, 'Documents added');
});
export const removeDocument = asyncHandler(async (req, res) => {
  ok(res, await reports.removeDocument(req.params.id, req.params.documentId, req.user), 'Document removed');
});

// ─── Reports: reading and review chain ───────────────────────────────────────

export const listReports = asyncHandler(async (req, res) => {
  const result = await reports.listReports(req.user, pick(req.query, ['status', 'financialYear', 'month', 'district', 'level', 'mine', 'page', 'limit']));
  res.status(HTTP_STATUS.OK).json({ ...new ApiResponse(HTTP_STATUS.OK, result.items, 'Reports fetched'), pagination: result.pagination });
});
export const listQueue = asyncHandler(async (req, res) => {
  const result = await reports.listQueue(req.user, { limit: req.query.limit });
  res.status(HTTP_STATUS.OK).json({ ...new ApiResponse(HTTP_STATUS.OK, result.items, 'Pending actions fetched'), pagination: { total: result.total } });
});
export const getReport = asyncHandler(async (req, res) => {
  ok(res, await reports.getReport(req.params.id, req.user), 'Report fetched');
});
export const forwardReport = asyncHandler(async (req, res) => {
  const { mpr } = await reports.forwardReport(req.params.id, { note: req.body?.note, checks: req.body?.checks }, req.user);
  audit(res, mpr._id, reportAudit(mpr));
  await notifyHead56Report({ mpr, actor: req.user, event: mpr.status === PROJECT_MPR_STATUS.VERIFIED_BY_STATE ? 'VERIFIED' : 'FORWARDED' });
  ok(res, savedReport(mpr), mpr.status === PROJECT_MPR_STATUS.VERIFIED_BY_STATE ? 'Report verified by State' : 'Report forwarded');
});
export const returnReport = asyncHandler(async (req, res) => {
  const mpr = await reports.returnReport(req.params.id, req.body?.reason, req.user);
  audit(res, mpr._id, { ...reportAudit(mpr), reason: mpr.returnReason });
  await notifyHead56Report({ mpr, actor: req.user, event: 'RETURNED' });
  ok(res, savedReport(mpr), 'Report returned to its Maker');
});
export const rejectReport = asyncHandler(async (req, res) => {
  const mpr = await reports.rejectReport(req.params.id, req.body?.reason, req.user);
  audit(res, mpr._id, { ...reportAudit(mpr), reason: mpr.rejectionReason });
  await notifyHead56Report({ mpr, actor: req.user, event: 'REJECTED' });
  ok(res, savedReport(mpr), 'Report rejected');
});
export const reopenReport = asyncHandler(async (req, res) => {
  const mpr = await reports.reopenReport(req.params.id, req.body?.reason, req.user);
  audit(res, mpr._id, { ...reportAudit(mpr), reason: mpr.returnReason });
  await notifyHead56Report({ mpr, actor: req.user, event: 'REOPENED' });
  ok(res, savedReport(mpr), 'Report reopened for correction');
});
export const downloadReportPdf = asyncHandler(async (req, res) => {
  sendFile(res, await documents.buildReportPdf(req.params.id, req.user), 'application/pdf');
});
export const downloadReportExcel = asyncHandler(async (req, res) => {
  sendFile(res, await documents.buildReportExcel(req.params.id, req.user), XLSX);
});

// ─── Dashboard, statement and monthly review ─────────────────────────────────

const VIEW_KEYS = ['financialYear', 'month', 'district', 'level', 'unitKey', 'verifiedOnly'];

export const getDashboard = asyncHandler(async (req, res) => {
  ok(res, await analytics.getDashboard(req.user, pick(req.query, VIEW_KEYS)), 'Dashboard fetched');
});
export const getStatement = asyncHandler(async (req, res) => {
  ok(res, await analytics.buildStatement(req.user, pick(req.query, VIEW_KEYS)), 'Statement fetched');
});
export const downloadStatementExcel = asyncHandler(async (req, res) => {
  sendFile(res, await documents.buildStatementExcel(req.user, pick(req.query, VIEW_KEYS)), XLSX);
});
export const downloadStatementPdf = asyncHandler(async (req, res) => {
  sendFile(res, await documents.buildStatementPdf(req.user, pick(req.query, VIEW_KEYS)), 'application/pdf');
});
export const listReviews = asyncHandler(async (req, res) => {
  ok(res, await analytics.listReviews(req.user, pick(req.query, ['financialYear'])), 'Reviews fetched');
});
export const recordReview = asyncHandler(async (req, res) => {
  const review = await analytics.recordReview(req.body, req.user);
  audit(res, review._id, { period: `${review.reportingMonth} ${review.financialYear}`, authority: review.designation });
  await notifyHead56Review({ review, actor: req.user });
  ok(res, { id: String(review._id) }, 'Monthly review recorded', HTTP_STATUS.CREATED);
});
export const withdrawReview = asyncHandler(async (req, res) => {
  const review = await analytics.withdrawReview(req.params.id, req.body?.reason, req.user);
  audit(res, review._id, { period: `${review.reportingMonth} ${review.financialYear}`, reason: review.withdrawReason });
  ok(res, { id: String(review._id) }, 'Monthly review withdrawn');
});
