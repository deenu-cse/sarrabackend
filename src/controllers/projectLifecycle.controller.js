import * as closure from '../services/projectClosure.service.js';
import * as outcomes from '../services/projectOutcome.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const ok = (res, data, message) => res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, message));
const single = (value) => (typeof value === 'string' ? value : '');

// --- Completion and closure ---

/** GET /:id/completion */
export const getCompletionState = asyncHandler(async (req, res) => {
  ok(res, await closure.getCompletionState(req.params.id, req.user), 'Completion status fetched');
});

/** POST /:id/completion (multipart) */
export const submitCompletion = asyncHandler(async (req, res) => {
  const doc = await closure.submitCompletion(req.params.id, req.body || {}, req.files || {}, req.user);
  res.locals.auditMetadata = { stage: 'SUBMITTED', department: doc.departmentName, project: doc.projectCode, expenditureLakh: doc.expenditureLakh, unspentLakh: doc.unspentLakh };
  ok(res, { id: String(doc._id), status: doc.status }, 'Completion report filed with the district');
});

/** PATCH /:id/completion/:departmentId/verify */
export const verifyCompletion = asyncHandler(async (req, res) => {
  const doc = await closure.verifyCompletion(req.params.id, req.params.departmentId, req.body?.note, req.user);
  res.locals.auditMetadata = { stage: 'DISTRICT_VERIFIED', department: doc.departmentName, project: doc.projectCode };
  ok(res, { id: String(doc._id), status: doc.status }, 'Completion report verified');
});

/** PATCH /:id/completion/:departmentId/return */
export const returnCompletion = asyncHandler(async (req, res) => {
  const doc = await closure.returnCompletion(req.params.id, req.params.departmentId, req.body?.reason, req.user);
  res.locals.auditMetadata = { stage: 'RETURNED', department: doc.departmentName, project: doc.projectCode, reason: doc.returnReason };
  ok(res, { id: String(doc._id), status: doc.status }, 'Completion report returned');
});

/** POST /:id/close */
export const closeProject = asyncHandler(async (req, res) => {
  const result = await closure.closeProject(req.params.id, req.body || {}, req.user);
  res.locals.auditMetadata = { project: result.code, ...result.closure, closedBy: undefined };
  ok(res, result, 'Project closed');
});

/** PATCH /:id/closure/refund */
export const recordRefund = asyncHandler(async (req, res) => {
  const result = await closure.recordRefund(req.params.id, req.body || {}, req.user);
  res.locals.auditMetadata = { stage: 'REFUND_RECORDED', ...result };
  ok(res, result, 'Refund recorded');
});

// --- Outcomes ---

/** GET /outcomes/indicators */
export const listIndicators = asyncHandler(async (req, res) => {
  ok(res, await outcomes.listIndicators(), 'Outcome indicators fetched');
});

/** GET /outcomes/summary */
export const getOutcomeSummary = asyncHandler(async (req, res) => {
  ok(res, await outcomes.getOutcomeSummary({ district: single(req.query.district), headCode: single(req.query.headCode) }), 'Outcome summary fetched');
});

/** GET /:id/outcomes */
export const getProjectOutcomes = asyncHandler(async (req, res) => {
  ok(res, await outcomes.getProjectOutcomes(req.params.id, req.user), 'Project outcomes fetched');
});

/** POST /:id/outcomes (multipart, evidence optional) */
export const recordOutcome = asyncHandler(async (req, res) => {
  const reading = await outcomes.recordOutcome(req.params.id, req.body || {}, req.file || null, req.user);
  res.locals.auditMetadata = { ...reading, id: undefined };
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, reading, 'Reading recorded'));
});

/** PATCH /:id/outcomes/:entryId/void */
export const voidOutcome = asyncHandler(async (req, res) => {
  const result = await outcomes.voidOutcome(req.params.id, req.params.entryId, req.body?.reason, req.user);
  res.locals.auditMetadata = { stage: 'VOIDED', ...result, id: undefined };
  ok(res, result, 'Reading struck out');
});
