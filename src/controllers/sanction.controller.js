import * as sanctionService from '../services/sanction.service.js';
import { uploadFile } from '../services/upload.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import { notifyProjectWorkflow } from '../services/workflowNotification.service.js';

/** POST / — Create sanction from approved DPR (State Maker) */
export const createSanction = asyncHandler(async (req, res) => {
  if (req.user.workflowRole !== 'MAKER') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only Makers can create sanctions');
  }
  const sanction = await sanctionService.createSanction(req.body, req.user);
  await notifyProjectWorkflow({ project: sanction, actor: req.user, event: 'PROJECT_SUBMITTED' });
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, sanction, 'Sanction created and sent to Checker'));
});

/** GET / — List sanctions */
export const listSanctions = asyncHandler(async (req, res) => {
  const { status, district, financialYear, isActive, page = 1, limit = 10 } = req.query;
  const result = await sanctionService.getSanctions({ status, district, financialYear, isActive }, page, limit);
  // Return paginated shape: { data: { data: [], pagination: {} } }
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { data: result.data, pagination: result.pagination }, 'Sanctions fetched'));
});

/** GET /approved-dprs — Get approved DPRs without sanctions */
export const getApprovedDPRs = asyncHandler(async (req, res) => {
  const dprs = await sanctionService.getApprovedDPRsWithoutSanction(req.query);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, dprs, 'Approved DPRs fetched'));
});

/** GET /analytics — Sanction analytics */
export const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await sanctionService.getSanctionAnalytics(req.query);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, analytics, 'Analytics fetched'));
});

/** GET /district — Sanctions for DD's district */
export const getDistrictSanctions = asyncHandler(async (req, res) => {
  const district = req.user.district;
  if (!district) throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'District not set for user');
  const { status, page = 1, limit = 10 } = req.query;
  const statusFilter = status ? status.split(',') : undefined;
  const result = await sanctionService.getSanctionsForDistrict(district, { status: statusFilter }, page, limit);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { data: result.data, pagination: result.pagination }, 'District sanctions fetched'));
});

/** GET /my-projects — Active sanctions for PIA */
export const getMyProjects = asyncHandler(async (req, res) => {
  const sanctions = await sanctionService.getActiveSanctionsForPIA(req.user._id);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanctions, 'Active projects fetched'));
});

/** GET /pending — Pending sanctions for PIA acceptance */
export const getPendingSanctions = asyncHandler(async (req, res) => {
  const sanctions = await sanctionService.getSanctions({
    status: 'FORWARDED_TO_PIA',
  }, 1, 100);
  // Filter to only those forwarded to this PIA
  const filtered = (sanctions.data || []).filter(
    s => s.forwardedToPIA?.toString() === req.user._id.toString()
  );
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, filtered, 'Pending sanctions fetched'));
});

/** GET /:id — Sanction detail */
export const getSanctionDetail = asyncHandler(async (req, res) => {
  const sanction = await sanctionService.getSanctionById(req.params.id);
  if (!sanction) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Sanction detail fetched'));
});

/** PATCH /:id/checker-verify — Checker verifies */
export const checkerVerify = asyncHandler(async (req, res) => {
  if (req.user.workflowRole !== 'CHECKER') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only Checkers can verify sanctions');
  }
  const sanction = await sanctionService.checkerVerify(req.params.id, req.user, req.body.note);
  if (!sanction) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  await notifyProjectWorkflow({ project: sanction, actor: req.user, event: 'PROJECT_CHECKED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Sanction verified by Checker'));
});

/** PATCH /:id/approve — Approver approves */
export const approveSanction = asyncHandler(async (req, res) => {
  if (req.user.workflowRole !== 'APPROVER') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only Approvers can approve sanctions');
  }

  let documents = {};
  if (req.files) {
    if (req.files.secretariatApprovalOrder) {
      documents.secretariatApprovalOrder = await uploadFile(req.files.secretariatApprovalOrder[0].buffer, 'sanctions');
    }
    if (req.files.stateSanctionOrder) {
      documents.stateSanctionOrder = await uploadFile(req.files.stateSanctionOrder[0].buffer, 'sanctions');
    }
  }

  const sanction = await sanctionService.approverApprove(req.params.id, req.user, req.body.note, documents);
  if (!sanction) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  await notifyProjectWorkflow({ project: sanction, actor: req.user, event: 'PROJECT_APPROVED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, `Sanction approved. ID: ${sanction.sanctionId}`));
});

/** PATCH /:id/reject — Reject sanction */
export const rejectSanction = asyncHandler(async (req, res) => {
  if (!req.body.reason) throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Rejection reason is required');
  const sanction = await sanctionService.rejectSanction(req.params.id, req.user, req.body.reason);
  if (!sanction) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  await notifyProjectWorkflow({ project: sanction, actor: req.user, event: 'PROJECT_REJECTED', note: req.body.reason });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, 'Sanction rejected'));
});

/** PATCH /:id/forward-district — Forward to District */
export const forwardToDistrict = asyncHandler(async (req, res) => {
  const sanction = await sanctionService.forwardToDistrict(req.params.id, req.user);
  if (!sanction) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  await notifyProjectWorkflow({ project: sanction, actor: req.user, event: 'PROJECT_FORWARDED_DISTRICT' });

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Sanction forwarded to district'));
});

/** PATCH /:id/district-accept — District accepts */
export const districtAcceptSanction = asyncHandler(async (req, res) => {
  let fundAllocationOrder = null;
  if (req.files?.fundAllocationOrder) {
    fundAllocationOrder = await uploadFile(req.files.fundAllocationOrder[0].buffer, 'sanctions');
  }
  const sanction = await sanctionService.districtAccept(req.params.id, req.user, fundAllocationOrder, req.body.allocatedAmountLakh);
  if (!sanction) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  await notifyProjectWorkflow({ project: sanction, actor: req.user, event: 'PROJECT_DISTRICT_ACCEPTED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Sanction accepted by district'));
});

/** PATCH /:id/forward-pia — Forward to PIA */
export const forwardToPIA = asyncHandler(async (req, res) => {
  if (!req.body.piaUserId) throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'PIA user ID is required');
  const sanction = await sanctionService.forwardToPIA(req.params.id, req.user, req.body.piaUserId);
  if (!sanction) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  await notifyProjectWorkflow({ project: sanction, actor: req.user, event: 'PROJECT_FORWARDED_PIA' });

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Sanction forwarded to PIA'));
});

/** PATCH /:id/pia-accept — PIA accepts */
export const piaAcceptSanction = asyncHandler(async (req, res) => {
  const sanction = await sanctionService.piaAccept(req.params.id, req.user);
  if (!sanction) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Project activated successfully'));
});
