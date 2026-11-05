import * as mprService from '../services/projectMpr.service.js';
import { getProjectAnalytics } from '../services/projectAnalytics.service.js';
import { notifyProjectMpr } from '../services/workflowNotification.service.js';
import * as evidence from '../services/mprEvidence.service.js';
import * as documents from '../services/mprDocuments.service.js';
import { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';

const ok = (res, data, message) => res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, message));
const single = (value) => (typeof value === 'string' ? value : '');

// The report is saved before anyone is notified; a mail failure must not look like a failed save.
const notify = async (payload) => {
  try { await notifyProjectMpr(payload); } catch (err) { logger.error(`MPR notification failed: ${err.message}`); }
};

const auditOf = (mpr) => ({
  mprNo: mpr.mprNo,
  project: mpr.projectCode,
  department: mpr.departmentName,
  head: mpr.head?.code,
  period: `${mpr.reportingMonth} ${mpr.financialYear}`,
  entryMode: mpr.entryMode,
  status: mpr.status,
  financialCurrentLakh: mpr.totals?.financialCurrentLakh,
  financialTotalLakh: mpr.totals?.financialTotalLakh,
});

const saved = (mpr) => ({ id: String(mpr._id), mprNo: mpr.mprNo, status: mpr.status, entryMode: mpr.entryMode });

/** GET /workload — projects and departments the signed-in reporting Maker reports on */
export const getWorkload = asyncHandler(async (req, res) => {
  ok(res, await mprService.getWorkload(req.user), 'Assigned projects fetched');
});

/** GET /context — selectable financial years / months for a project + department */
export const getContext = asyncHandler(async (req, res) => {
  ok(res, await mprService.getContext(single(req.query.projectId), single(req.query.departmentId), req.user), 'Reporting periods fetched');
});

/** GET /form — activities, targets and server-calculated previous progress for a period */
export const getForm = asyncHandler(async (req, res) => {
  ok(res, await mprService.getForm({
    projectId: single(req.query.projectId),
    departmentId: single(req.query.departmentId),
    financialYear: single(req.query.financialYear),
    reportingMonth: single(req.query.reportingMonth),
  }, req.user), 'MPR form fetched');
});

/** POST /preview — validate and return the figures; saves nothing */
export const previewMpr = asyncHandler(async (req, res) => {
  ok(res, await mprService.previewMpr(req.body, req.user), 'MPR is valid');
});

/** POST / — final validation and save, as a draft (`asDraft`) or submitted to the first reviewer */
export const submitMpr = asyncHandler(async (req, res) => {
  const mpr = await mprService.submitMpr(req.body, req.user);
  res.locals.auditTargetId = mpr._id;
  res.locals.auditMetadata = auditOf(mpr);
  if (mpr.status !== PROJECT_MPR_STATUS.DRAFT) await notify({ mpr, actor: req.user, event: 'SUBMITTED' });
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, saved(mpr), mpr.status === PROJECT_MPR_STATUS.DRAFT ? 'MPR saved as draft' : 'MPR submitted for verification'));
});

/** GET /mine — the reports of the signed-in PIA user or District Technical Staff */
export const listMine = asyncHandler(async (req, res) => {
  const result = await mprService.listMine(req.user, { status: single(req.query.status), page: req.query.page, limit: req.query.limit });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'MPRs fetched', result.pagination));
});

/** GET /queue — reports waiting for the signed-in user's own action */
export const listQueue = asyncHandler(async (req, res) => {
  const result = await mprService.listQueue(req.user, { limit: req.query.limit });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'Pending actions fetched', { total: result.total }));
});

/** GET /district — reports of the district */
export const listForDistrict = asyncHandler(async (req, res) => {
  const result = await mprService.listForDistrict(req.user, { status: single(req.query.status), page: req.query.page, limit: req.query.limit });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'District MPRs fetched', result.pagination));
});

/** GET /analytics — State-wide analytics over projects and progress reports */
export const getAnalytics = asyncHandler(async (req, res) => {
  const pick = (key) => single(req.query[key]);
  ok(res, await getProjectAnalytics({
    financialYear: pick('financialYear'), month: pick('month'), district: pick('district'), department: pick('department'),
    headCode: pick('headCode'), projectStatus: pick('projectStatus'), mprStatus: pick('mprStatus'),
  }), 'Analytics fetched');
});

/** GET /all — every project MPR in the State (HQ, M&E administrator) */
export const listAll = asyncHandler(async (req, res) => {
  const result = await mprService.listAll({
    status: single(req.query.status),
    financialYear: single(req.query.financialYear),
    district: single(req.query.district),
    headCode: single(req.query.headCode),
    entryMode: single(req.query.entryMode),
    search: single(req.query.search),
    page: req.query.page,
    limit: req.query.limit,
  });
  res.status(HTTP_STATUS.OK).json({ ...new ApiResponse(HTTP_STATUS.OK, result.data, 'MPRs fetched', result.pagination), summary: result.summary });
});

/** GET /project/:projectId — reports filed against one project */
export const listForProject = asyncHandler(async (req, res) => {
  ok(res, await mprService.listForProject(req.params.projectId, req.user), 'Project MPRs fetched');
});

/** GET /:id — one report, with what the signed-in user may do with it */
export const getMpr = asyncHandler(async (req, res) => {
  ok(res, await mprService.getMpr(req.params.id, req.user), 'MPR fetched');
});

/** GET /:id/form — editing form for a draft or a returned report */
export const getEditForm = asyncHandler(async (req, res) => {
  ok(res, await mprService.getEditForm(req.params.id, req.user), 'MPR form fetched');
});

/** POST /:id/preview — validate an edit; saves nothing */
export const previewEdit = asyncHandler(async (req, res) => {
  ok(res, await mprService.previewEdit(req.params.id, req.body, req.user), 'MPR is valid');
});

/** PATCH /:id/resubmit — save an edit; submitted to the first reviewer unless `asDraft` */
export const saveMpr = asyncHandler(async (req, res) => {
  const asDraft = req.body?.asDraft === true || req.body?.asDraft === 'true';
  const mpr = await mprService.saveMpr(req.params.id, req.body, req.user);
  res.locals.auditMetadata = auditOf(mpr);
  const resubmitted = (mpr.revisionHistory || []).some((step) => step.action === 'RETURNED');
  if (!asDraft) await notify({ mpr, actor: req.user, event: resubmitted ? 'RESUBMITTED' : 'SUBMITTED' });
  ok(res, saved(mpr), asDraft ? 'Changes saved' : (resubmitted ? 'MPR corrected and resubmitted' : 'MPR submitted for verification'));
});

/** DELETE /:id — discard a draft */
export const deleteDraft = asyncHandler(async (req, res) => {
  const result = await mprService.deleteDraft(req.params.id, req.user);
  res.locals.auditMetadata = { mprNo: result.mprNo, department: result.departmentName, period: result.period, stage: 'DRAFT_DISCARDED' };
  ok(res, result, 'Draft discarded');
});

// --- Review chain ---

/** PATCH /:id/forward — take the current review step and send the report on */
export const forwardMpr = asyncHandler(async (req, res) => {
  const { mpr, from } = await mprService.forwardMpr(req.params.id, req.body?.note, req.user);
  res.locals.auditMetadata = { ...auditOf(mpr), from };
  const verified = mpr.status === PROJECT_MPR_STATUS.VERIFIED_BY_STATE;
  await notify({ mpr, actor: req.user, event: verified ? 'VERIFIED' : 'FORWARDED' });
  ok(res, { id: String(mpr._id), status: mpr.status }, verified ? 'MPR verified by State' : 'MPR forwarded');
});

/** PATCH /:id/return — back to the reporting Maker with remarks */
export const returnMpr = asyncHandler(async (req, res) => {
  const mpr = await mprService.returnMpr(req.params.id, req.body?.reason, req.user);
  res.locals.auditMetadata = { ...auditOf(mpr), reason: mpr.returnReason, level: mpr.returnedByLevel, by: mpr.returnedByRole };
  await notify({ mpr, actor: req.user, event: 'RETURNED' });
  ok(res, { id: String(mpr._id), status: mpr.status }, 'MPR returned to its Maker for correction');
});

/** PATCH /:id/reject — an Approver rejects the report with a recorded reason */
export const rejectMpr = asyncHandler(async (req, res) => {
  const mpr = await mprService.rejectMpr(req.params.id, req.body?.reason, req.user);
  res.locals.auditMetadata = { ...auditOf(mpr), reason: mpr.rejectionReason, by: mpr.rejectedByRole };
  await notify({ mpr, actor: req.user, event: 'REJECTED' });
  ok(res, { id: String(mpr._id), status: mpr.status }, 'MPR rejected');
});

// --- Evidence ---

/** POST /:id/evidence (multipart, field "files") */
export const addEvidence = asyncHandler(async (req, res) => {
  const result = await evidence.addEvidence(req.params.id, req.files || [], req.body || {}, req.user);
  res.locals.auditMetadata = { mprNo: result.mprNo, added: result.added, total: result.evidence.length };
  ok(res, result, 'Evidence attached');
});

/** DELETE /:id/evidence/:evidenceId */
export const removeEvidence = asyncHandler(async (req, res) => {
  const result = await evidence.removeEvidence(req.params.id, req.params.evidenceId, req.user);
  res.locals.auditMetadata = { mprNo: result.mprNo, removed: result.removed, total: result.evidence.length };
  ok(res, result, 'Evidence removed');
});

// --- Official output ---

const sendFile = (res, { buffer, filename }, type) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.status(HTTP_STATUS.OK).end(buffer);
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** GET /:id/pdf */
export const downloadPdf = asyncHandler(async (req, res) => {
  sendFile(res, await documents.buildMprPdf(req.params.id, req.user), 'application/pdf');
});

/** GET /:id/excel */
export const downloadExcel = asyncHandler(async (req, res) => {
  sendFile(res, await documents.buildMprExcel(req.params.id, req.user), XLSX);
});

/** GET /export/register - Excel register of the reports this user may see */
export const downloadRegister = asyncHandler(async (req, res) => {
  const pick = (key) => single(req.query[key]);
  sendFile(res, await documents.buildRegisterExcel(req.user, {
    status: pick('status'), financialYear: pick('financialYear'), month: pick('month'), district: pick('district'),
    headCode: pick('headCode'), departmentId: pick('departmentId'), projectId: pick('projectId'), search: pick('search'),
  }), XLSX);
});
