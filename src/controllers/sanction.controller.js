import * as sanctionService from '../services/sanction.service.js';
import * as projectCreation from '../services/projectCreation.service.js';
import * as revisions from '../services/projectRevision.service.js';
import { piaDepartmentsOf } from '../services/projectMpr.service.js';
import { uploadFile } from '../services/upload.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import ApiResponse from '../utils/ApiResponse.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import { WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { isHq, sameId } from '../utils/access.js';
import { notifyProjectWorkflow } from '../services/workflowNotification.service.js';
import logger from '../config/logger.js';

const requireMaker = (req) => {
  if (!isHq(req.user, WORKFLOW_ROLES.MAKER)) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only the HQ Maker can create projects');
  }
};

// The project is saved before anyone is notified; a mail failure must not turn that into an error.
const notify = async (payload) => {
  try { await notifyProjectWorkflow(payload); } catch (err) { logger.error(`Project notification failed: ${err.message}`); }
};

const found = (project) => {
  if (!project) throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Project not found');
  return project;
};

/** POST /generate-id — Reserve the permanent Project ID for a creation draft (HQ Maker) */
export const generateProjectId = asyncHandler(async (req, res) => {
  requireMaker(req);
  const reservation = await projectCreation.reserveProjectId(req.body || {}, req.user);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, reservation, 'Project ID generated'));
});

/** POST / — Create project with its DPR details, location, departments, head and activity plan (HQ Maker) */
export const createSanction = asyncHandler(async (req, res) => {
  requireMaker(req);
  const { project, alreadyCreated } = await projectCreation.createProject(req.body || {}, req.user);
  res.locals.auditTargetId = project._id;

  if (alreadyCreated) {
    return res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, project, 'Project was already created'));
  }

  await notify({ project, actor: req.user, event: 'PROJECT_SUBMITTED' });
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, project, 'Project created and sent to the HQ Checker'));
});

/** GET / — List projects */
export const listSanctions = asyncHandler(async (req, res) => {
  const { status, district, financialYear, isActive, search, headCode, page = 1, limit = 10 } = req.query;
  const statusFilter = typeof status === 'string' && status ? status.split(',') : undefined;
  const result = await sanctionService.getSanctions({ status: statusFilter, district, financialYear, isActive, search, headCode }, page, limit);
  // Return paginated shape: { data: { data: [], pagination: {} } }
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { data: result.data, pagination: result.pagination, summary: result.summary }, 'Projects fetched'));
});

/** GET /approved-dprs — Get approved DPRs without projects */
export const getApprovedDPRs = asyncHandler(async (req, res) => {
  const dprs = await sanctionService.getApprovedDPRsWithoutSanction(req.query);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, dprs, 'Approved DPRs fetched'));
});

/** GET /analytics — Project analytics */
export const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await sanctionService.getSanctionAnalytics(req.query);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, analytics, 'Analytics fetched'));
});

/** GET /district — Projects of the user's district */
export const getDistrictSanctions = asyncHandler(async (req, res) => {
  const district = req.user.district;
  if (!district) throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'District not set for user');
  const { status, search, headCode, page = 1, limit = 10 } = req.query;
  const statusFilter = typeof status === 'string' && status ? status.split(',') : undefined;
  const result = await sanctionService.getSanctionsForDistrict(district, { status: statusFilter, search, headCode }, page, limit);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, { data: result.data, pagination: result.pagination, summary: result.summary }, 'District projects fetched'));
});

/** GET /my-projects — Projects of the PIA user */
export const getMyProjects = asyncHandler(async (req, res) => {
  const sanctions = await sanctionService.getActiveSanctionsForPIA(req.user);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanctions, 'Assigned projects fetched'));
});

/** GET /pending — Projects waiting for this PIA Maker's acceptance */
export const getPendingSanctions = asyncHandler(async (req, res) => {
  const projects = await sanctionService.getActiveSanctionsForPIA(req.user);
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, projects.filter((project) => project.needsMyAcceptance), 'Pending projects fetched'));
});

/** GET /:id — Project detail */
export const getSanctionDetail = asyncHandler(async (req, res) => {
  const sanction = found(await sanctionService.getSanctionById(req.params.id));
  // District and PIA users can open only their own projects.
  if (req.user.role === 'DD_LEVEL' && req.user.district !== sanction.district) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'This project belongs to another district.');
  }
  if (req.user.role === 'PIA_OFFICER') {
    const legacy = sameId(sanction.forwardedToPIA, req.user._id);
    const plain = { ...sanction, departmentAllocations: (sanction.departmentAllocations || []).map((d) => ({ ...d, piaUserId: d.piaUserId?._id || d.piaUserId })) };
    if (!legacy && !piaDepartmentsOf(plain, req.user).length) throw new ApiError(HTTP_STATUS.FORBIDDEN, 'This project is not assigned to you.');
  }
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Project detail fetched'));
});

/** PATCH /:id/checker-verify — HQ Checker verifies */
export const checkerVerify = asyncHandler(async (req, res) => {
  const sanction = found(await sanctionService.checkerVerify(req.params.id, req.user, req.body.note));
  await notify({ project: sanction, actor: req.user, event: 'PROJECT_CHECKED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Project verified and sent to the HQ Approver'));
});

/** PATCH /:id/approve — HQ Approver sanctions; Sanction ID generated */
export const approveSanction = asyncHandler(async (req, res) => {
  const documents = {};
  if (req.files) {
    if (req.files.secretariatApprovalOrder) {
      documents.secretariatApprovalOrder = await uploadFile(req.files.secretariatApprovalOrder[0].buffer, 'sanctions');
    }
    if (req.files.stateSanctionOrder) {
      documents.stateSanctionOrder = await uploadFile(req.files.stateSanctionOrder[0].buffer, 'sanctions');
    }
  }

  const sanction = found(await sanctionService.approverApprove(req.params.id, req.user, req.body.note, documents));
  await notify({ project: sanction, actor: req.user, event: 'PROJECT_APPROVED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, `Project sanctioned. Sanction ID: ${sanction.sanctionId}`));
});

/** PATCH /:id/reject — HQ Checker / Approver returns the project to the Maker with an objection */
export const rejectSanction = asyncHandler(async (req, res) => {
  const sanction = found(await sanctionService.rejectSanction(req.params.id, req.user, req.body.reason));
  await notify({ project: sanction, actor: req.user, event: 'PROJECT_REJECTED', note: sanction.rejectionReason });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, null, 'Project returned to the HQ Maker'));
});

/** PATCH /:id/forward-district — HQ Maker forwards to the district */
export const forwardToDistrict = asyncHandler(async (req, res) => {
  const sanction = found(await sanctionService.forwardToDistrict(req.params.id, req.user));
  await notify({ project: sanction, actor: req.user, event: 'PROJECT_FORWARDED_DISTRICT' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Project forwarded to the district'));
});

/** PATCH /:id/district-accept — District Maker accepts */
export const districtAcceptSanction = asyncHandler(async (req, res) => {
  const sanction = found(await sanctionService.districtAccept(req.params.id, req.user));
  await notify({ project: sanction, actor: req.user, event: 'PROJECT_DISTRICT_ACCEPTED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Project accepted by the district'));
});

/** PATCH /:id/forward-pia — District Maker assigns PIA Makers and reporting responsibility */
export const forwardToPIA = asyncHandler(async (req, res) => {
  const result = found(await sanctionService.forwardToPIA(req.params.id, req.user, { piaUserId: req.body.piaUserId, assignments: req.body.assignments }));
  const { sanction, notifyUserIds, staffUserIds, changed } = result;
  if (notifyUserIds.length) await notify({ project: sanction, actor: req.user, event: 'PROJECT_FORWARDED_PIA', recipientIds: notifyUserIds });
  if (staffUserIds.length) await notify({ project: sanction, actor: req.user, event: 'REPORTING_ASSIGNED', recipientIds: staffUserIds });
  res.locals.auditMetadata = { piaAssigned: notifyUserIds.length, districtStaffAssigned: staffUserIds.length };
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, changed ? 'Assignment saved' : 'No change to the assignment'));
});

/** PATCH /:id/transfer-pia — hand one department over to another PIA Maker */
export const transferPia = asyncHandler(async (req, res) => {
  const result = found(await sanctionService.transferPia(req.params.id, req.user, { departmentId: req.body.departmentId, piaUserId: req.body.piaUserId, reason: req.body.reason }));
  await notify({ project: result.sanction, actor: req.user, event: 'PROJECT_FORWARDED_PIA', recipientIds: result.notifyUserIds });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, result.sanction, 'Department handed over'));
});

/** GET /pia-workload — district PIA Makers, what they hold, and who could take over */
export const getPiaWorkload = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, await sanctionService.getPiaWorkload(req.user), 'PIA workload fetched'));
});

/** POST /pia-handover — hand over every department one PIA Maker holds to a successor */
export const handoverPiaCharge = asyncHandler(async (req, res) => {
  const { moved, from, successor } = await sanctionService.handoverPiaCharge(req.user, { fromUserId: req.body.fromUserId, toUserId: req.body.toUserId, reason: req.body.reason });
  res.locals.auditMetadata = { from: from.name, to: successor.name, departments: moved.reduce((sum, item) => sum + item.departments.length, 0), reason: req.body.reason };
  for (const item of moved) {
    // eslint-disable-next-line no-await-in-loop
    await notify({ project: item.sanction, actor: req.user, event: 'PROJECT_FORWARDED_PIA', recipientIds: [String(successor._id)] });
  }
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, {
    projects: moved.length,
    departments: moved.reduce((sum, item) => sum + item.departments.length, 0),
    from: from.name,
    to: successor.name,
  }, 'Charge handed over'));
});

/** GET /:id/pia-candidates — who the District Maker can assign to each department */
export const getPiaCandidates = asyncHandler(async (req, res) => {
  const candidates = found(await sanctionService.getPiaCandidates(req.params.id, req.user));
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, candidates, 'Assignable officers fetched'));
});

/** PATCH /:id/pia-accept — PIA Maker accepts */
export const piaAcceptSanction = asyncHandler(async (req, res) => {
  const sanction = found(await sanctionService.piaAccept(req.params.id, req.user));
  await notify({ project: sanction, actor: req.user, event: 'PROJECT_PIA_ACCEPTED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, sanction, 'Project accepted. Implementation begins.'));
});

// ─── Returned project: correct and resubmit ──────────────────────────────────

/** PATCH /:id/resubmit — HQ Maker corrects a returned project and sends it back to the Checker */
export const resubmitRejected = asyncHandler(async (req, res) => {
  requireMaker(req);
  const project = await projectCreation.resubmitRejectedProject(req.params.id, req.body || {}, req.user);
  await notify({ project, actor: req.user, event: 'PROJECT_SUBMITTED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, project, 'Project corrected and sent to the HQ Checker'));
});

// ─── Revised estimates (target revision) ─────────────────────────────────────

/** GET /:id/revisions */
export const listRevisions = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, await revisions.listRevisions(req.params.id), 'Revisions fetched'));
});

/** POST /:id/revisions — HQ Maker proposes revised shares / targets */
export const createRevision = asyncHandler(async (req, res) => {
  const { revision, project } = await revisions.createRevision(req.params.id, req.body || {}, req.user);
  res.locals.auditMetadata = { revisionNo: revision.revisionNo, reason: revision.reason, beforeTotalLakh: revision.beforeTotalLakh, proposedTotalLakh: revision.proposedTotalLakh };
  await notify({ project, actor: req.user, event: 'REVISION_SUBMITTED' });
  res.status(HTTP_STATUS.CREATED).json(new ApiResponse(HTTP_STATUS.CREATED, revision, 'Revision sent to the HQ Checker'));
});

/** PATCH /revisions/:revisionId/verify — HQ Checker */
export const verifyRevision = asyncHandler(async (req, res) => {
  const { revision, project } = await revisions.verifyRevision(req.params.revisionId, req.body?.note, req.user);
  await notify({ project, actor: req.user, event: 'REVISION_CHECKED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, revision, 'Revision verified'));
});

/** PATCH /revisions/:revisionId/approve — HQ Approver; the project takes the revised figures */
export const approveRevision = asyncHandler(async (req, res) => {
  const { revision, project } = await revisions.approveRevision(req.params.revisionId, req.body?.note, req.user);
  res.locals.auditMetadata = { revisionNo: revision.revisionNo, beforeTotalLakh: revision.beforeTotalLakh, newTotalLakh: revision.proposedTotalLakh };
  await notify({ project, actor: req.user, event: 'REVISION_DECIDED' });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, revision, 'Revision approved and applied'));
});

/** PATCH /revisions/:revisionId/reject — HQ Checker or Approver */
export const rejectRevision = asyncHandler(async (req, res) => {
  const { revision, project } = await revisions.rejectRevision(req.params.revisionId, req.body?.reason, req.user);
  await notify({ project, actor: req.user, event: 'REVISION_DECIDED', note: revision.rejectionReason });
  res.status(HTTP_STATUS.OK).json(new ApiResponse(HTTP_STATUS.OK, revision, 'Revision rejected'));
});
