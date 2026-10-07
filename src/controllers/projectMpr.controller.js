import * as mprService from '../services/projectMpr.service.js';
import { getProjectAnalytics } from '../services/projectAnalytics.service.js';
import { notifyProjectMpr } from '../services/workflowNotification.service.js';
import * as evidence from '../services/mprEvidence.service.js';
import * as documents from '../services/mprDocuments.service.js';
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
  status: mpr.status,
  financialCurrentLakh: mpr.totals?.financialCurrentLakh,
  financialTotalLakh: mpr.totals?.financialTotalLakh,
});

/** GET /workload — projects and departments the signed-in PIA officer reports on */
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

/** POST / — final validation and save */
export const submitMpr = asyncHandler(async (req, res) => {
  const mpr = await mprService.submitMpr(req.body, req.user);
  res.locals.auditTargetId = mpr._id;
  res.locals.auditMetadata = auditOf(mpr);
  await notify({ mpr, actor: req.user, event: 'SUBMITTED' });
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, { id: String(mpr._id), mprNo: mpr.mprNo, status: mpr.status }, 'MPR submitted to district'));
});

/** GET /mine — the PIA officer's reports */
export const listMine = asyncHandler(async (req, res) => {
  const result = await mprService.listMine(req.user, { status: single(req.query.status), page: req.query.page, limit: req.query.limit });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'MPRs fetched', result.pagination));
});

/** GET /district — reports of the District Director's district */
export const listForDistrict = asyncHandler(async (req, res) => {
  const result = await mprService.listForDistrict(req.user, { status: single(req.query.status), page: req.query.page, limit: req.query.limit });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.data, 'District MPRs fetched', result.pagination));
});

/** GET /analytics — State-wide analytics over projects, budget releases and progress reports */
export const getAnalytics = asyncHandler(async (req, res) => {
  const pick = (key) => single(req.query[key]);
  ok(res, await getProjectAnalytics({
    financialYear: pick('financialYear'), month: pick('month'), district: pick('district'), department: pick('department'),
    headCode: pick('headCode'), projectStatus: pick('projectStatus'), mprStatus: pick('mprStatus'),
  }), 'Analytics fetched');
});

/** GET /all — every project MPR in the State (State admin, M&E admin) */
export const listAll = asyncHandler(async (req, res) => {
  const result = await mprService.listAll({
    status: single(req.query.status),
    financialYear: single(req.query.financialYear),
    district: single(req.query.district),
    headCode: single(req.query.headCode),
    search: single(req.query.search),
    page: req.query.page,
    limit: req.query.limit,
  });
  res.status(HTTP_STATUS.OK).json({ ...new ApiResponse(HTTP_STATUS.OK, result.data, 'MPRs fetched', result.pagination), summary: result.summary });
});

/** PATCH /:id/state-verify — M&E admin verifies a district-approved report */
export const stateVerify = asyncHandler(async (req, res) => {
  const mpr = await mprService.stateVerify(req.params.id, req.body?.note, req.user);
  res.locals.auditMetadata = auditOf(mpr);
  await notify({ mpr, actor: req.user, event: 'VERIFIED' });
  ok(res, { id: String(mpr._id), status: mpr.status }, 'MPR verified by State');
});

/** PATCH /:id/state-return — M&E admin sends a district-approved report back for correction */
export const stateReturn = asyncHandler(async (req, res) => {
  const mpr = await mprService.stateReturn(req.params.id, req.body?.reason, req.user);
  res.locals.auditMetadata = { ...auditOf(mpr), reason: mpr.returnReason, level: 'STATE' };
  await notify({ mpr, actor: req.user, event: 'RETURNED' });
  ok(res, { id: String(mpr._id), status: mpr.status }, 'MPR returned to PIA by State');
});

/** GET /project/:projectId — reports filed against one project */
export const listForProject = asyncHandler(async (req, res) => {
  ok(res, await mprService.listForProject(req.params.projectId, req.user), 'Project MPRs fetched');
});

/** GET /:id — one report */
export const getMpr = asyncHandler(async (req, res) => {
  ok(res, await mprService.getMpr(req.params.id, req.user), 'MPR fetched');
});

/** GET /:id/form — correction form for a returned report */
export const getResubmitForm = asyncHandler(async (req, res) => {
  ok(res, await mprService.getResubmitForm(req.params.id, req.user), 'MPR correction form fetched');
});

/** POST /:id/preview — validate a correction; saves nothing */
export const previewResubmit = asyncHandler(async (req, res) => {
  ok(res, await mprService.previewResubmit(req.params.id, req.body, req.user), 'MPR is valid');
});

/** PATCH /:id/resubmit — save a correction */
export const resubmitMpr = asyncHandler(async (req, res) => {
  const mpr = await mprService.resubmitMpr(req.params.id, req.body, req.user);
  res.locals.auditMetadata = auditOf(mpr);
  await notify({ mpr, actor: req.user, event: 'RESUBMITTED' });
  ok(res, { id: String(mpr._id), mprNo: mpr.mprNo, status: mpr.status }, 'MPR resubmitted to district');
});

/** PATCH /:id/district-approve */
export const districtApprove = asyncHandler(async (req, res) => {
  const mpr = await mprService.districtApprove(req.params.id, req.body?.note, req.user);
  res.locals.auditMetadata = auditOf(mpr);
  await notify({ mpr, actor: req.user, event: 'APPROVED' });
  ok(res, { id: String(mpr._id), status: mpr.status }, 'MPR approved by district');
});

/** PATCH /:id/return */
export const returnToPia = asyncHandler(async (req, res) => {
  const mpr = await mprService.returnToPia(req.params.id, req.body?.reason, req.user);
  res.locals.auditMetadata = { ...auditOf(mpr), reason: mpr.returnReason };
  await notify({ mpr, actor: req.user, event: 'RETURNED' });
  ok(res, { id: String(mpr._id), status: mpr.status }, 'MPR returned to PIA');
});

// --- Evidence (optional) ---

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
