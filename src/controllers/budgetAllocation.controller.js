import * as budget from '../services/budgetAllocation.service.js';
import { assertCanReadProject } from '../services/projectMpr.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

const ok = (res, data, message) => res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, data, message));

// Budget is released by the same state-level role that creates projects.
const requireMaker = (req) => {
  if (req.user.workflowRole !== 'MAKER') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only Makers can allocate project budget');
  }
};

/** GET /budget-allocation/eligible — approved projects whose budget is not fully allocated */
export const listEligibleProjects = asyncHandler(async (req, res) => {
  ok(res, await budget.listEligibleProjects(), 'Eligible projects fetched');
});

/** GET /:id/budget-allocation — current budget position, recalculated from stored installments */
export const getBudgetState = asyncHandler(async (req, res) => {
  // District and PIA users may see the release position of their own projects only.
  await assertCanReadProject(req.params.id, req.user);
  ok(res, await budget.getBudgetState(req.params.id), 'Budget allocation fetched');
});

/** POST /:id/budget-allocations/upload — store one release-order PDF */
export const uploadDocument = asyncHandler(async (req, res) => {
  requireMaker(req);
  const document = await budget.uploadAllocationDocument(req.params.id, req.file, req.user);
  res.locals.auditMetadata = { documentId: document.documentId, documentName: document.name, sizeBytes: document.sizeBytes };
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, document, 'PDF uploaded'));
});

/** DELETE /:id/budget-allocations/documents/:documentId — remove an unused upload */
export const discardDocument = asyncHandler(async (req, res) => {
  requireMaker(req);
  await budget.discardDocument(req.params.id, req.params.documentId, req.user);
  ok(res, null, 'Document removed');
});

/** POST /:id/budget-allocations/preview — validate and return the figures; saves nothing */
export const previewAllocation = asyncHandler(async (req, res) => {
  requireMaker(req);
  ok(res, await budget.previewAllocation(req.params.id, req.body, req.user), 'Allocation is valid');
});

/** POST /:id/budget-allocations — final validation and commit */
export const commitAllocation = asyncHandler(async (req, res) => {
  requireMaker(req);
  const { audit, ...result } = await budget.commitAllocation(req.params.id, req.body, req.user);

  if (result.alreadyProcessed) {
    // A repeat of a request that was already saved: nothing new happened, so no new audit entry.
    res.locals.auditMetadata = { duplicateOfBatch: result.batch.id };
    return ok(res, result, 'This allocation was already saved');
  }

  // Who / when come from the audit middleware; the financial detail is added here.
  res.locals.auditMetadata = audit;
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, result, 'Budget allocated successfully'));
});

/** POST /:id/budget-allocations/reverse — take back the latest installment of a department */
export const reverseInstallment = asyncHandler(async (req, res) => {
  requireMaker(req);
  const { audit, state } = await budget.reverseInstallment(req.params.id, req.body, req.user);
  res.locals.auditMetadata = audit;
  ok(res, { state }, 'Release reversed');
});
