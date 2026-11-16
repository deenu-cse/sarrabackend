import * as meetings from '../services/committeeMeeting.service.js';
import * as dnss from '../services/dnss.service.js';
import * as training from '../services/training.service.js';
import * as jsa from '../services/jsa.service.js';
import * as documents from '../services/formsDocuments.service.js';
import { notifyMeeting } from '../services/formsNotification.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Field forms: committee meetings (HPC / SLEC / DLEC, approved by the HQ
 * Approver), DNSS committees, training programmes and JSA progress (Prarup-03).
 */

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

// ─── Committee meetings ──────────────────────────────────────────────────────

const MEETING_QUERY = ['type', 'status', 'district', 'year', 'page', 'limit'];
const meetingAudit = (m) => ({ refNo: m.refNo, type: m.type, district: m.district, meetingNo: m.meetingNo, status: m.status });
const savedMeeting = (m) => ({ id: String(m._id), refNo: m.refNo, status: m.status });

export const listMeetings = asyncHandler(async (req, res) => ok(res, await meetings.listMeetings(req.user, pick(req.query, MEETING_QUERY)), 'Meetings fetched'));
export const meetingPendingCount = asyncHandler(async (req, res) => ok(res, { count: await meetings.pendingCount(req.user) }, 'Pending meetings counted'));
export const getMeeting = asyncHandler(async (req, res) => ok(res, await meetings.getMeeting(req.params.id, req.user), 'Meeting fetched'));
export const createMeeting = asyncHandler(async (req, res) => {
  const meeting = await meetings.createMeeting(req.body, req.user);
  audit(res, meeting._id, meetingAudit(meeting));
  ok(res, savedMeeting(meeting), 'Meeting saved as draft', HTTP_STATUS.CREATED);
});
export const updateMeeting = asyncHandler(async (req, res) => {
  const meeting = await meetings.updateMeeting(req.params.id, req.body, req.user);
  audit(res, meeting._id, meetingAudit(meeting));
  ok(res, savedMeeting(meeting), 'Meeting saved');
});
export const deleteMeeting = asyncHandler(async (req, res) => {
  const result = await meetings.deleteMeeting(req.params.id, req.user);
  audit(res, result.id, { refNo: result.refNo });
  ok(res, result, 'Draft deleted');
});
export const addMeetingFiles = asyncHandler(async (req, res) => {
  const meeting = await meetings.addFiles(req.params.id, req.params.kind, req.files || [], req.user);
  audit(res, meeting._id, { refNo: meeting.refNo, kind: req.params.kind, files: (req.files || []).length });
  ok(res, { id: String(meeting._id), [req.params.kind]: meeting[req.params.kind].length }, 'Files uploaded');
});
export const removeMeetingFile = asyncHandler(async (req, res) => {
  const result = await meetings.removeFile(req.params.id, req.params.kind, req.params.fileId, req.user);
  audit(res, req.params.id, { kind: req.params.kind, fileId: result.id });
  ok(res, result, 'File removed');
});
export const submitMeeting = asyncHandler(async (req, res) => {
  const { doc, again } = await meetings.submitMeeting(req.params.id, req.user);
  audit(res, doc._id, meetingAudit(doc));
  await notifyMeeting({ meeting: doc, actor: req.user, event: again ? 'RESUBMITTED' : 'SUBMITTED' });
  ok(res, savedMeeting(doc), 'Sent to the HQ Approver');
});
export const approveMeeting = asyncHandler(async (req, res) => {
  const doc = await meetings.approveMeeting(req.params.id, req.body?.note, req.user);
  audit(res, doc._id, meetingAudit(doc));
  await notifyMeeting({ meeting: doc, actor: req.user, event: 'APPROVED' });
  ok(res, savedMeeting(doc), 'Meeting approved');
});
export const returnMeeting = asyncHandler(async (req, res) => {
  const doc = await meetings.returnMeeting(req.params.id, req.body?.reason, req.user);
  audit(res, doc._id, { ...meetingAudit(doc), reason: doc.returnReason });
  await notifyMeeting({ meeting: doc, actor: req.user, event: 'RETURNED' });
  ok(res, savedMeeting(doc), 'Returned to the Maker');
});
export const downloadMeetingPdf = asyncHandler(async (req, res) => sendFile(res, await documents.buildMeetingPdf(req.params.id, req.user), 'application/pdf'));
export const exportMeetings = asyncHandler(async (req, res) => sendFile(res, await documents.buildMeetingsExcel(req.user, pick(req.query, ['type', 'district', 'year'])), XLSX));

// ─── DNSS ────────────────────────────────────────────────────────────────────

const DNSS_QUERY = ['district', 'block', 'search', 'page', 'limit'];
const dnssAudit = (d) => ({ district: d.district, block: d.block?.name, gramPanchayat: d.gramPanchayat?.name });

export const listDnss = asyncHandler(async (req, res) => ok(res, await dnss.listDnss(req.user, pick(req.query, DNSS_QUERY)), 'DNSS committees fetched'));
export const getDnss = asyncHandler(async (req, res) => ok(res, await dnss.getDnss(req.params.id, req.user), 'DNSS fetched'));
export const createDnss = asyncHandler(async (req, res) => {
  const doc = await dnss.createDnss(req.body, req.user);
  audit(res, doc._id, dnssAudit(doc));
  ok(res, { id: String(doc._id) }, 'DNSS saved', HTTP_STATUS.CREATED);
});
export const updateDnss = asyncHandler(async (req, res) => {
  const doc = await dnss.updateDnss(req.params.id, req.body, req.user);
  audit(res, doc._id, dnssAudit(doc));
  ok(res, { id: String(doc._id) }, 'DNSS saved');
});
export const deleteDnss = asyncHandler(async (req, res) => {
  const result = await dnss.deleteDnss(req.params.id, req.user);
  audit(res, result.id, {});
  ok(res, result, 'DNSS deleted');
});
export const addDnssFiles = asyncHandler(async (req, res) => {
  const doc = await dnss.addFiles(req.params.id, req.params.kind, req.files || [], req.user);
  audit(res, doc._id, { ...dnssAudit(doc), kind: req.params.kind, files: (req.files || []).length });
  ok(res, { id: String(doc._id), [req.params.kind]: doc[req.params.kind].length }, 'Files uploaded');
});
export const removeDnssFile = asyncHandler(async (req, res) => {
  const result = await dnss.removeFile(req.params.id, req.params.kind, req.params.fileId, req.user);
  audit(res, req.params.id, { kind: req.params.kind, fileId: result.id });
  ok(res, result, 'File removed');
});
export const exportDnss = asyncHandler(async (req, res) => sendFile(res, await documents.buildDnssExcel(req.user, pick(req.query, ['district', 'block', 'search'])), XLSX));

// ─── Training ────────────────────────────────────────────────────────────────

const TRAINING_QUERY = ['level', 'organiser', 'district', 'from', 'to', 'search', 'page', 'limit'];
const trainingAudit = (t) => ({ refNo: t.refNo, level: t.level, district: t.district, organiser: t.organiser?.unitName });

export const listTrainings = asyncHandler(async (req, res) => ok(res, await training.listTrainings(req.user, pick(req.query, TRAINING_QUERY)), 'Training programmes fetched'));
export const getTraining = asyncHandler(async (req, res) => ok(res, await training.getTraining(req.params.id, req.user), 'Training programme fetched'));
export const createTraining = asyncHandler(async (req, res) => {
  const doc = await training.createTraining(req.body, req.user);
  audit(res, doc._id, trainingAudit(doc));
  ok(res, { id: String(doc._id), refNo: doc.refNo }, 'Training programme saved', HTTP_STATUS.CREATED);
});
export const updateTraining = asyncHandler(async (req, res) => {
  const doc = await training.updateTraining(req.params.id, req.body, req.user);
  audit(res, doc._id, trainingAudit(doc));
  ok(res, { id: String(doc._id), refNo: doc.refNo }, 'Training programme saved');
});
export const deleteTraining = asyncHandler(async (req, res) => {
  const result = await training.deleteTraining(req.params.id, req.user);
  audit(res, result.id, { refNo: result.refNo });
  ok(res, result, 'Training programme deleted');
});
export const addTrainingFiles = asyncHandler(async (req, res) => {
  const doc = await training.addFiles(req.params.id, req.params.kind, req.files || [], req.user);
  audit(res, doc._id, { refNo: doc.refNo, kind: req.params.kind, files: (req.files || []).length });
  ok(res, { id: String(doc._id), [req.params.kind]: doc[req.params.kind].length }, 'Files uploaded');
});
export const removeTrainingFile = asyncHandler(async (req, res) => {
  const result = await training.removeFile(req.params.id, req.params.kind, req.params.fileId, req.user);
  audit(res, req.params.id, { kind: req.params.kind, fileId: result.id });
  ok(res, result, 'File removed');
});
export const exportTrainings = asyncHandler(async (req, res) => sendFile(res, await documents.buildTrainingExcel(req.user, pick(req.query, TRAINING_QUERY)), XLSX));

// ─── JSA progress ────────────────────────────────────────────────────────────

const JSA_QUERY = ['campaign', 'asOn', 'level', 'district'];
const jsaAudit = (r) => ({ campaign: r.campaign, level: r.level, district: r.district, block: r.block?.name, village: r.village?.name });

export const listJsaReports = asyncHandler(async (req, res) => ok(res, await jsa.listReports(req.user, pick(req.query, ['campaign', 'level', 'district', 'search', 'page', 'limit'])), 'JSA reports fetched'));
export const getJsaReport = asyncHandler(async (req, res) => ok(res, await jsa.getReport(req.params.id, req.user), 'JSA report fetched'));
export const createJsaReport = asyncHandler(async (req, res) => {
  const doc = await jsa.createReport(req.body, req.user);
  audit(res, doc._id, jsaAudit(doc));
  ok(res, { id: String(doc._id) }, 'JSA report created', HTTP_STATUS.CREATED);
});
export const updateJsaReport = asyncHandler(async (req, res) => {
  const doc = await jsa.updateDetails(req.params.id, req.body, req.user);
  audit(res, doc._id, jsaAudit(doc));
  ok(res, { id: String(doc._id) }, 'JSA report saved');
});
export const deleteJsaReport = asyncHandler(async (req, res) => {
  const result = await jsa.deleteReport(req.params.id, req.user);
  audit(res, result.id, {});
  ok(res, result, 'JSA report deleted');
});
export const addJsaProgress = asyncHandler(async (req, res) => {
  const doc = await jsa.addStatement(req.params.id, req.body, req.user);
  const latest = doc.updates[doc.updates.length - 1];
  audit(res, doc._id, { ...jsaAudit(doc), asOnDate: latest?.asOnDate });
  ok(res, { id: String(doc._id), statements: doc.updates.length }, 'Progress saved');
});
export const getJsaConsolidated = asyncHandler(async (req, res) => ok(res, await jsa.buildConsolidated(req.user, pick(req.query, JSA_QUERY)), 'JSA progress fetched'));
export const exportJsaExcel = asyncHandler(async (req, res) => sendFile(res, await documents.buildJsaExcel(req.user, pick(req.query, JSA_QUERY)), XLSX));
export const exportJsaPdf = asyncHandler(async (req, res) => sendFile(res, await documents.buildJsaPdf(req.user, pick(req.query, JSA_QUERY)), 'application/pdf'));
export const getJsaSettings = asyncHandler(async (req, res) => ok(res, { factors: await jsa.getFactors(), canEdit: jsa.canEditSettings(req.user) }, 'JSA settings fetched'));
export const updateJsaSettings = asyncHandler(async (req, res) => {
  const factors = await jsa.updateSettings(req.body, req.user);
  audit(res, null, { factors });
  ok(res, { factors }, 'Recharge factors saved');
});
