import * as sanctionService from '../services/sanction.service.js';
import * as projectCreation from '../services/projectCreation.service.js';
import * as revisions from '../services/projectRevision.service.js';
import { uploadFile } from '../services/upload.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import { notifyProjectWorkflow } from '../services/workflowNotification.service.js';
import logger from '../config/logger.js';

const requireMaker = (req) => {
  if (req.user.workflowRole !== 'MAKER') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only Makers can create projects');
  }
};

/** POST /generate-id — Reserve the permanent Project ID for a creation draft (State Maker) */
export const generateProjectId = asyncHandler(async (req, res) => {
  requireMaker(req);
  const reservation = await projectCreation.reserveProjectId(req.body || {}, req.user);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, reservation, 'Project ID generated'));
});

/** POST / — Create project with its location, departments, head and activity plan (State Maker) */
export const createSanction = asyncHandler(async (req, res) => {
  requireMaker(req);
  const { project, alreadyCreated } = await projectCreation.createProject(req.body || {}, req.user);
  res.locals.auditTargetId = project._id;

  if (alreadyCreated) {
    return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, project, 'Project was already created'));
  }

  // The project is saved; a notification failure must not turn that into an error.
  try {
    await notifyProjectWorkflow({ project, actor: req.user, event: 'PROJECT_SUBMITTED' });
  } catch (err) {
    logger.error(`Project ${project.projectId} created but notification failed: ${err.message}`);
  }
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, project, 'Project created and sent to Checker'));
});

/** GET / — List sanctions */
export const listSanctions = asyncHandler(async (req, res) => {
  const { status, district, financialYear, isActive, search, headCode, page = 1, limit = 10 } = req.query;
  const result = await sanctionService.getSanctions({ status, district, financialYear, isActive, search, headCode }, page, limit);
  // Return paginated shape: { data: { data: [], pagination: {} } }
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { data: result.data, pagination: result.pagination, summary: result.summary }, 'Sanctions fetched'));
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
  const { status, search, headCode, page = 1, limit = 10 } = req.query;
  const statusFilter = typeof status === 'string' && status ? status.split(',') : undefined;
  const result = await sanctionService.getSanctionsForDistrict(district, { status: statusFilter, search, headCode }, page, limit);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { data: result.data, pagination: result.pagination, summary: result.summary }, 'District sanctions fetched'));
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
  // District and PIA users can open only their own projects.
  if (req.user.role === 'DD_LEVEL' && req.user.district !== sanction.district) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'This project belongs to another district.');
  }
  if (req.user.role === 'PIA_OFFICER') {
    const userId = String(req.user._id);
    const assigned = String(sanction.forwardedToPIA?._id || '') === userId
      || (sanction.departmentAllocations || []).some((d) => String(d.piaUserId?._id || d.piaUserId || '') === userId);
    if (!assigned) throw new ApiError(HTTP_STATUS.FORBIDDEN, 'This project is not assigned to you.');
  }
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
  const result = await sanctionService.forwardToPIA(req.params.id, req.user, { piaUserId: req.body.piaUserId, assignments: req.body.assignments });
  if (!result) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  const { sanction, notifyUserIds } = result;
  if (notifyUserIds.length) {
    try {
      await notifyProjectWorkflow({ project: sanction, actor: req.user, event: 'PROJECT_FORWARDED_PIA', recipientIds: notifyUserIds });
    } catch (err) {
      logger.error(`PIA assignment saved but notification failed: ${err.message}`);
    }
  }

  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, notifyUserIds.length ? 'PIA officers assigned' : 'No change to PIA assignment'));
});

/** PATCH /:id/transfer-pia — hand one department over to another PIA officer */
export const transferPia = asyncHandler(async (req, res) => {
  const result = await sanctionService.transferPia(req.params.id, req.user, { departmentId: req.body.departmentId, piaUserId: req.body.piaUserId, reason: req.body.reason });
  if (!result) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  try {
    await notifyProjectWorkflow({ project: result.sanction, actor: req.user, event: 'PROJECT_FORWARDED_PIA', recipientIds: result.notifyUserIds });
  } catch (err) {
    logger.error(`PIA transfer saved but notification failed: ${err.message}`);
  }
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.sanction, 'Department handed over'));
});

/** GET /pia-workload — district PIA officers, what they hold, and who could take over */
export const getPiaWorkload = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, await sanctionService.getPiaWorkload(req.user), 'PIA workload fetched'));
});

/** POST /pia-handover — hand over every department one officer holds to a successor */
export const handoverPiaCharge = asyncHandler(async (req, res) => {
  const { moved, from, successor } = await sanctionService.handoverPiaCharge(req.user, { fromUserId: req.body.fromUserId, toUserId: req.body.toUserId, reason: req.body.reason });
  res.locals.auditMetadata = { from: from.name, to: successor.name, departments: moved.reduce((sum, item) => sum + item.departments.length, 0), reason: req.body.reason };
  for (const item of moved) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await notifyProjectWorkflow({ project: item.sanction, actor: req.user, event: 'PROJECT_FORWARDED_PIA', recipientIds: [String(successor._id)] });
    } catch (err) {
      logger.error(`PIA handover saved but notification failed: ${err.message}`);
    }
  }
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, {
    projects: moved.length,
    departments: moved.reduce((sum, item) => sum + item.departments.length, 0),
    from: from.name,
    to: successor.name,
  }, 'Charge handed over'));
});

/** GET /:id/pia-candidates — officers the district can assign to each department */
export const getPiaCandidates = asyncHandler(async (req, res) => {
  const departments = await sanctionService.getPiaCandidates(req.params.id, req.user);
  if (!departments) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, departments, 'PIA officers fetched'));
});

/** PATCH /:id/pia-accept — PIA accepts */
export const piaAcceptSanction = asyncHandler(async (req, res) => {
  const sanction = await sanctionService.piaAccept(req.params.id, req.user);
  if (!sanction) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Sanction not found');
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Project activated successfully'));
});

// ─── Rejected project: correct and resubmit ──────────────────────────────────

/** PATCH /:id/resubmit — Maker corrects a rejected project and sends it back to the Checker */
export const resubmitRejected = asyncHandler(async (req, res) => {
  requireMaker(req);
  const project = await projectCreation.resubmitRejectedProject(req.params.id, req.body || {}, req.user);
  try {
    await notifyProjectWorkflow({ project, actor: req.user, event: 'PROJECT_SUBMITTED' });
  } catch (err) {
    logger.error(`Project ${project.projectId} resubmitted but notification failed: ${err.message}`);
  }
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, project, 'Project corrected and sent to Checker'));
});

// ─── Revised estimates ───────────────────────────────────────────────────────

const notifyRevision = async (project, actor, event) => {
  try { await notifyProjectWorkflow({ project, actor, event }); } catch (err) { logger.error(`Revision saved but notification failed: ${err.message}`); }
};

/** GET /:id/revisions */
export const listRevisions = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, await revisions.listRevisions(req.params.id), 'Revisions fetched'));
});

/** POST /:id/revisions — Maker proposes revised shares / targets */
export const createRevision = asyncHandler(async (req, res) => {
  const { revision, project } = await revisions.createRevision(req.params.id, req.body || {}, req.user);
  res.locals.auditMetadata = { revisionNo: revision.revisionNo, reason: revision.reason, beforeTotalLakh: revision.beforeTotalLakh, proposedTotalLakh: revision.proposedTotalLakh };
  await notifyRevision(project, req.user, 'PROJECT_SUBMITTED');
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, revision, 'Revision sent to Checker'));
});

/** PATCH /revisions/:revisionId/verify — Checker */
export const verifyRevision = asyncHandler(async (req, res) => {
  const { revision, project } = await revisions.verifyRevision(req.params.revisionId, req.body?.note, req.user);
  await notifyRevision(project, req.user, 'PROJECT_CHECKED');
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, revision, 'Revision verified'));
});

/** PATCH /revisions/:revisionId/approve — Approver; the project takes the revised figures */
export const approveRevision = asyncHandler(async (req, res) => {
  const { revision, project } = await revisions.approveRevision(req.params.revisionId, req.body?.note, req.user);
  res.locals.auditMetadata = { revisionNo: revision.revisionNo, beforeTotalLakh: revision.beforeTotalLakh, newTotalLakh: revision.proposedTotalLakh };
  await notifyRevision(project, req.user, 'PROJECT_APPROVED');
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, revision, 'Revision approved and applied'));
});

/** PATCH /revisions/:revisionId/reject — Checker or Approver */
export const rejectRevision = asyncHandler(async (req, res) => {
  const { revision, project } = await revisions.rejectRevision(req.params.revisionId, req.body?.reason, req.user);
  await notifyRevision(project, req.user, 'PROJECT_REJECTED');
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, revision, 'Revision rejected'));
});
