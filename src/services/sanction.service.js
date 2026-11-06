import ProjectSanction, { REPORTING_MODE } from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import generateSanctionId from '../utils/generateSanctionId.js';
import paginate from '../utils/paginate.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import MPRPraroop1A from '../models/MPRPraroop1A.model.js';
import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import MPRPraroop1C from '../models/MPRPraroop1C.model.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';
import { countAwaitingReview } from './projectMpr.service.js';
import mongoose from 'mongoose';
import User from '../models/User.model.js';
import USER_ROLES, { TIERS, WORKFLOW_ROLES } from '../constants/roles.constants.js';
import {
  actorLabel, designationOf, escapeRegex, isDistrict, isHq, isPia, sameId, sameText, tierRoleQuery, workflowRoleOf,
} from '../utils/access.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Project workflow across the three tiers.
 *
 *   SARRA HQ        Maker creates → Checker verifies (or returns to the Maker) →
 *                   Approver sanctions (Sanction ID) → Maker forwards to the district
 *   District        Maker accepts → assigns the PIA Maker and the MPR reporting
 *                   responsibility of each department (PIA or District Technical Staff)
 *   PIA             Maker accepts the assigned department → the project becomes active
 *
 * Every transition is a conditional update on the current status, so two users
 * acting at the same moment cannot both move the project.
 */

const { MAKER, CHECKER, APPROVER } = WORKFLOW_ROLES;
const S = SANCTION_STATUS;

const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
const badRequest = (message) => new ApiError(HTTP_STATUS.BAD_REQUEST, message);
const stateConflict = (message) => new ApiError(HTTP_STATUS.CONFLICT, message);
const notFound = () => new ApiError(HTTP_STATUS.NOT_FOUND, 'Project not found');
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** One workflow-history entry with a snapshot of who acted. */
export const historyStep = (user, action, note) => ({
  action,
  performedBy: user._id,
  performedAt: new Date(),
  role: actorLabel(user),
  designation: designationOf(user),
  note,
});

/** List row with a compact view of its departments. */
const withDepartments = ({ departmentAllocations, ...row }) => ({
  ...row,
  departments: (departmentAllocations || []).filter((d) => d.departmentName).map((d) => ({
    name: d.departmentName,
    assigned: Boolean(d.piaUserId),
    accepted: Boolean(d.piaAcceptedAt),
    reportingMode: d.reportingMode || REPORTING_MODE.PIA,
    reportingReady: (d.reportingMode === REPORTING_MODE.DISTRICT ? Boolean(d.districtStaffUserId) : Boolean(d.piaAcceptedAt)),
  })),
});

/**
 * Move a project from one status to the next, only if it is still at `from`.
 * `guard` adds conditions (e.g. "not made by this user").
 */
const transition = async (projectId, from, { set = {}, unset = {}, step, guard = {} }) => {
  if (!mongoose.isValidObjectId(projectId)) throw notFound();
  const update = { $set: set, $push: { workflowHistory: step } };
  if (Object.keys(unset).length) update.$unset = unset;
  const updated = await ProjectSanction.findOneAndUpdate({ _id: projectId, status: from, ...guard }, update, { new: true });
  if (updated) return updated;
  if (!(await ProjectSanction.exists({ _id: projectId }))) return null;
  throw stateConflict('This project has moved on since the page was opened. Reload it and try again.');
};

const loadAt = async (projectId, ...statuses) => {
  if (!mongoose.isValidObjectId(projectId)) return null;
  const project = await ProjectSanction.findById(projectId);
  if (!project) return null;
  if (statuses.length && !statuses.includes(project.status)) {
    throw stateConflict('This project has moved on since the page was opened. Reload it and try again.');
  }
  return project;
};

// ─── SARRA HQ ────────────────────────────────────────────────────────────────

/** HQ Checker verifies the DPR, project details, targets and financial allocation. */
export const checkerVerify = async (projectId, checkerUser, note) => {
  if (!isHq(checkerUser, CHECKER)) throw forbidden('Only the HQ Checker can verify a project.');
  const project = await loadAt(projectId, S.PENDING_CHECKER);
  if (!project) return null;
  if (sameId(project.makerUserId, checkerUser._id)) throw forbidden('You created this project, so you cannot verify it.');
  const text = clean(note, 1000);
  return transition(projectId, S.PENDING_CHECKER, {
    set: { status: S.PENDING_APPROVER, checkerUserId: checkerUser._id, checkerNote: text, checkerAt: new Date() },
    step: historyStep(checkerUser, 'CHECKER_VERIFIED', text || 'Verified by HQ Checker'),
  });
};

/** HQ Approver sanctions the project. The Sanction ID is generated here. */
export const approverApprove = async (projectId, approverUser, note, documents) => {
  if (!isHq(approverUser, APPROVER)) throw forbidden('Only the HQ Approver can sanction a project.');
  const project = await loadAt(projectId, S.PENDING_APPROVER);
  if (!project) return null;
  if (sameId(project.makerUserId, approverUser._id) || sameId(project.checkerUserId, approverUser._id)) {
    throw forbidden('You created or verified this project, so you cannot approve it.');
  }
  const sanctionId = project.sanctionId || await generateSanctionId(project.district);
  const text = clean(note, 1000);
  const set = { sanctionId, status: S.SANCTIONED, approverUserId: approverUser._id, approverNote: text, approverAt: new Date() };
  if (documents?.secretariatApprovalOrder) set.secretariatApprovalOrder = documents.secretariatApprovalOrder;
  if (documents?.stateSanctionOrder) set.stateSanctionOrder = documents.stateSanctionOrder;
  return transition(projectId, S.PENDING_APPROVER, {
    set,
    step: historyStep(approverUser, 'APPROVED', text ? `Sanctioned. Sanction ID: ${sanctionId}. ${text}` : `Sanctioned. Sanction ID: ${sanctionId}`),
  });
};

/**
 * HQ Checker or Approver returns an incorrect or incomplete project to the HQ
 * Maker with an objection. The Maker corrects it and resubmits it under the
 * same Project ID. (Stored as REJECTED for compatibility with earlier records.)
 */
export const rejectSanction = async (projectId, user, reason) => {
  const project = await loadAt(projectId);
  if (!project) return null;
  const allowed = (project.status === S.PENDING_CHECKER && isHq(user, CHECKER))
    || (project.status === S.PENDING_APPROVER && isHq(user, APPROVER));
  if (!allowed) {
    throw forbidden([S.PENDING_CHECKER, S.PENDING_APPROVER].includes(project.status)
      ? `Only the HQ ${project.status === S.PENDING_CHECKER ? 'Checker' : 'Approver'} can return this project now.`
      : 'This project cannot be returned at its current stage.');
  }
  const text = clean(reason, 1000);
  if (text.length < 5) throw badRequest('Write the objection for the Maker (at least 5 characters).');
  return transition(projectId, project.status, {
    set: { status: S.REJECTED, rejectionReason: text, rejectedBy: user._id, rejectedAt: new Date() },
    step: historyStep(user, 'RETURNED', `Returned to HQ Maker with objection: ${text}`),
  });
};

/** HQ Maker forwards the sanctioned project to the concerned District SARRA Centre. */
export const forwardToDistrict = async (projectId, stateUser) => {
  if (!isHq(stateUser, MAKER)) throw forbidden('Only the HQ Maker can forward a sanctioned project to the district.');
  const project = await loadAt(projectId, S.SANCTIONED);
  if (!project) return null;
  return transition(projectId, S.SANCTIONED, {
    set: { status: S.FORWARDED_TO_DISTRICT, forwardedToDistrict: project.district, forwardedToDistrictAt: new Date(), forwardedToDistrictBy: stateUser._id },
    step: historyStep(stateUser, 'FORWARDED_TO_DISTRICT', `Forwarded to ${project.district} District SARRA Centre`),
  });
};

// ─── District SARRA Centre ───────────────────────────────────────────────────

const assertOwnDistrict = (ddUser, sanction) => {
  if (!ddUser.district || ddUser.district !== sanction.district) {
    throw forbidden('This project belongs to another district.');
  }
};

const assertDistrictMaker = (user) => {
  if (!isDistrict(user, MAKER)) throw forbidden('Only the District Maker can do this.');
};

/** District Maker receives and accepts the sanctioned project. */
export const districtAccept = async (projectId, ddUser) => {
  assertDistrictMaker(ddUser);
  const project = await loadAt(projectId, S.FORWARDED_TO_DISTRICT);
  if (!project) return null;
  assertOwnDistrict(ddUser, project);
  return transition(projectId, S.FORWARDED_TO_DISTRICT, {
    set: { status: S.DISTRICT_ACCEPTED, districtAcceptedBy: ddUser._id, districtAcceptedAt: new Date() },
    step: historyStep(ddUser, 'DISTRICT_ACCEPTED', `Received and accepted by ${project.district} District Maker`),
  });
};

const pickOfficer = (officer) => ({ id: String(officer._id), name: officer.name, email: officer.email, designation: officer.designation || '' });

const OPEN_WITH_MAKER = [PROJECT_MPR_STATUS.DRAFT, PROJECT_MPR_STATUS.RETURNED_FOR_CORRECTION];

/** Departments whose reports are still with their Maker; their reporting responsibility cannot change. */
const departmentsWithOpenReports = async (projectId) => {
  const rows = await ProjectMPR.find({ project: projectId, status: { $in: OPEN_WITH_MAKER } }).select('departmentId status').lean();
  return new Map(rows.map((row) => [String(row.departmentId), row.status]));
};

const modeLockReason = (department, openStatus) => {
  if (['SUBMITTED', 'DISTRICT_VERIFIED'].includes(department.completion?.status)) return 'The completion report has been filed.';
  if (openStatus === PROJECT_MPR_STATUS.DRAFT) return 'A draft report is open. It must be submitted or discarded first.';
  if (openStatus === PROJECT_MPR_STATUS.RETURNED_FOR_CORRECTION) return 'A returned report is waiting for correction by its Maker.';
  return null;
};

/**
 * Who the District Maker can assign: for each department, the PIA Makers of
 * that department in the district; and the District Makers who can act as
 * District Technical Staff.
 */
export const getPiaCandidates = async (projectId, ddUser) => {
  if (!mongoose.isValidObjectId(projectId)) return null;
  const sanction = await ProjectSanction.findById(projectId)
    .populate('departmentAllocations.piaUserId', 'name email designation')
    .populate('departmentAllocations.districtStaffUserId', 'name email designation')
    .lean();
  if (!sanction) return null;
  assertOwnDistrict(ddUser, sanction);

  const [officers, staff, open] = await Promise.all([
    User.find(tierRoleQuery(TIERS.PIA, MAKER, { district: sanction.district })).select('name email designation department').sort({ name: 1 }).lean(),
    User.find(tierRoleQuery(TIERS.DISTRICT, MAKER, { district: sanction.district })).select('name email designation').sort({ name: 1 }).lean(),
    departmentsWithOpenReports(sanction._id),
  ]);

  return {
    districtStaff: staff.map(pickOfficer),
    departments: (sanction.departmentAllocations || []).map((department) => {
      const lock = modeLockReason(department, open.get(String(department.departmentId)));
      return {
        departmentId: String(department.departmentId),
        name: department.departmentName,
        reportingMode: department.reportingMode || REPORTING_MODE.PIA,
        assigned: department.piaUserId ? pickOfficer(department.piaUserId) : null,
        accepted: Boolean(department.piaAcceptedAt),
        districtStaff: department.districtStaffUserId ? pickOfficer(department.districtStaffUserId) : null,
        reportingLocked: Boolean(lock),
        reportingLockedReason: lock,
        officers: officers.filter((officer) => sameText(officer.department, department.departmentName)).map(pickOfficer),
      };
    }),
  };
};

/** A department is ready for reporting once its reporting Maker can start. */
const departmentReady = (department) => (department.reportingMode === REPORTING_MODE.DISTRICT
  ? Boolean(department.districtStaffUserId)
  : Boolean(department.piaAcceptedAt));

/** Project status from the state of its departments (once the district has started assigning). */
const settleStatus = (sanction) => {
  const departments = sanction.departmentAllocations || [];
  const started = departments.some((d) => d.piaUserId || d.districtStaffUserId);
  if (!started) return;
  const allReady = departments.length > 0 && departments.every(departmentReady);
  sanction.status = allReady ? S.PIA_ACCEPTED : S.FORWARDED_TO_PIA;
  if (departments.some(departmentReady)) sanction.isActive = true;
};

const officerFor = async (id, query) => (mongoose.isValidObjectId(id) ? User.findOne({ _id: id, ...query }).lean() : null);

/**
 * District Maker assigns the PIA Maker and the MPR reporting responsibility of
 * each department.
 *
 * `assignments` = [{ departmentId, reportingMode: 'PIA' | 'DISTRICT', piaUserId?, districtStaffUserId? }]
 *   PIA mode       a PIA Maker of that department in the district is required; they report.
 *   DISTRICT mode  a District Maker is required as District Technical Staff; they report
 *                  on behalf of the PIA, and the PIA approval chain is bypassed.
 * Departments can be assigned together or one at a time. A department whose PIA
 * Maker has accepted is handed over with Transfer Charge instead. The reporting
 * responsibility cannot change while a report is still with its Maker.
 *
 * Older projects without departments keep the single `piaUserId`.
 */
export const forwardToPIA = async (projectId, ddUser, { piaUserId, assignments } = {}) => {
  assertDistrictMaker(ddUser);
  if (!mongoose.isValidObjectId(projectId)) return null;
  const sanction = await ProjectSanction.findById(projectId);
  if (!sanction) return null;
  assertOwnDistrict(ddUser, sanction);
  if (sanction.closure?.status === 'CLOSED') throw stateConflict('This project is closed.');

  const departments = sanction.departmentAllocations || [];
  const now = new Date();
  const piaMakers = tierRoleQuery(TIERS.PIA, MAKER);

  if (!departments.length) {
    if (sanction.status !== S.DISTRICT_ACCEPTED) {
      throw stateConflict('The project must be accepted by the district before it is assigned to a PIA.');
    }
    const officer = await officerFor(piaUserId, piaMakers);
    if (!officer) throw badRequest('Select an active PIA Maker.');
    if (officer.district !== sanction.district) throw badRequest(`${officer.name} does not belong to ${sanction.district} district.`);

    sanction.status = S.FORWARDED_TO_PIA;
    sanction.forwardedToPIA = officer._id;
    sanction.piaForwardedAt = now;
    sanction.piaForwardedBy = ddUser._id;
    sanction.workflowHistory.push(historyStep(ddUser, 'FORWARDED_TO_PIA', `Assigned to ${officer.name}`));
    await sanction.save();
    return { sanction, notifyUserIds: [String(officer._id)], staffUserIds: [], changed: true };
  }

  if (![S.DISTRICT_ACCEPTED, S.FORWARDED_TO_PIA, S.PIA_ACCEPTED].includes(sanction.status)) {
    throw stateConflict('The project must be accepted by the district before PIA Makers and reporting responsibility are assigned.');
  }

  const requested = Array.isArray(assignments) ? assignments : [];
  if (!requested.length) throw badRequest('Assign at least one department.');

  const seen = new Set();
  for (const item of requested) {
    const departmentId = typeof item?.departmentId === 'string' ? item.departmentId : '';
    if (!departments.some((d) => String(d.departmentId) === departmentId)) throw badRequest('One of the departments does not belong to this project.');
    if (seen.has(departmentId)) throw badRequest('A department appears more than once in the assignment.');
    seen.add(departmentId);
  }

  const open = await departmentsWithOpenReports(sanction._id);
  const ids = (key) => requested.map((item) => item?.[key]).filter((id) => typeof id === 'string' && mongoose.isValidObjectId(id));
  const [officers, staff] = await Promise.all([
    User.find({ _id: { $in: ids('piaUserId') }, ...piaMakers }).lean(),
    User.find({ _id: { $in: ids('districtStaffUserId') }, ...tierRoleQuery(TIERS.DISTRICT, MAKER) }).lean(),
  ]);
  const officerById = new Map(officers.map((officer) => [String(officer._id), officer]));
  const staffById = new Map(staff.map((member) => [String(member._id), member]));

  const notes = [];
  const notifyUserIds = new Set();
  const staffUserIds = new Set();
  for (const item of requested) {
    const department = departments.find((d) => String(d.departmentId) === item.departmentId);
    const name = department.departmentName;
    const currentMode = department.reportingMode || REPORTING_MODE.PIA;
    const mode = Object.values(REPORTING_MODE).includes(item.reportingMode) ? item.reportingMode : currentMode;

    // PIA Maker
    const wantedPia = typeof item.piaUserId === 'string' && item.piaUserId ? item.piaUserId : null;
    if (wantedPia) {
      const officer = officerById.get(wantedPia);
      if (!officer) throw badRequest(`${name}: the selected PIA Maker was not found or is not active.`);
      if (officer.district !== sanction.district) throw badRequest(`${name}: ${officer.name} does not belong to ${sanction.district} district.`);
      // The rule that keeps a Forest officer off a Minor Irrigation department.
      if (!sameText(officer.department, name)) throw badRequest(`${name}: ${officer.name} belongs to ${officer.department || 'another department'} and cannot be assigned to ${name}.`);
    }
    const piaChanges = Boolean(wantedPia) && !sameId(department.piaUserId, wantedPia);
    if (piaChanges && department.piaAcceptedAt) throw stateConflict(`${name}: its PIA Maker has already accepted. Use Transfer Charge to hand the department over.`);
    if (mode === REPORTING_MODE.PIA && !wantedPia && !department.piaUserId) throw badRequest(`${name}: select the PIA Maker who will report its progress.`);

    // District Technical Staff
    const staffValue = item.districtStaffUserId;
    const wantedStaff = typeof staffValue === 'string' && staffValue ? staffValue : null;
    if (wantedStaff) {
      const member = staffById.get(wantedStaff);
      if (!member) throw badRequest(`${name}: the selected District Technical Staff was not found or is not an active District Maker.`);
      if (member.district !== sanction.district) throw badRequest(`${name}: ${member.name} does not belong to ${sanction.district} district.`);
    }
    const clearStaff = (staffValue === null || staffValue === '') && mode === REPORTING_MODE.PIA;
    const nextStaff = wantedStaff || (clearStaff ? null : department.districtStaffUserId || null);
    if (mode === REPORTING_MODE.DISTRICT && !nextStaff) throw badRequest(`${name}: select the District Technical Staff who will report its progress.`);

    const modeChanges = mode !== currentMode;
    const staffChanges = !sameId(nextStaff, department.districtStaffUserId);
    if (modeChanges || (staffChanges && mode === REPORTING_MODE.DISTRICT)) {
      const lock = modeLockReason(department, open.get(String(department.departmentId)));
      if (lock) throw stateConflict(`${name}: the reporting responsibility cannot be changed now. ${lock}`);
    }
    if (!piaChanges && !modeChanges && !staffChanges) continue;

    if (piaChanges) {
      const officer = officerById.get(wantedPia);
      department.piaUserId = officer._id;
      department.piaAssignedAt = now;
      department.piaAssignedBy = ddUser._id;
      department.piaAcceptedAt = undefined;
      notifyUserIds.add(String(officer._id));
      notes.push(`${name}: PIA Maker ${officer.name}`);
    }
    if (modeChanges || staffChanges) {
      department.reportingMode = mode;
      department.districtStaffUserId = nextStaff || undefined;
      department.reportingAssignedAt = now;
      department.reportingAssignedBy = ddUser._id;
      if (nextStaff && staffChanges) staffUserIds.add(String(nextStaff));
      const staffName = nextStaff ? (staffById.get(String(nextStaff))?.name || 'District Technical Staff') : null;
      notes.push(`${name}: MPR by ${mode === REPORTING_MODE.DISTRICT ? `District Technical Staff (${staffName})` : 'PIA'}${mode === REPORTING_MODE.PIA && staffName ? `, District Technical Staff ${staffName}` : ''}`);
    }
  }

  if (!notes.length) return { sanction, notifyUserIds: [], staffUserIds: [], changed: false };

  if (sanction.status === S.DISTRICT_ACCEPTED) {
    sanction.piaForwardedAt = now;
    sanction.piaForwardedBy = ddUser._id;
  }
  settleStatus(sanction);
  sanction.workflowHistory.push(historyStep(ddUser, 'REPORTING_ASSIGNED', `Assigned by District Maker — ${notes.join('; ')}`));

  await sanction.save();
  return { sanction, notifyUserIds: [...notifyUserIds], staffUserIds: [...staffUserIds], changed: true };
};

/** Move one department from its current PIA Maker to a successor, keeping the history. */
const handOver = (department, successor, ddUser, reason, now) => {
  department.piaHistory.push({
    userId: department.piaUserId,
    assignedAt: department.piaAssignedAt,
    acceptedAt: department.piaAcceptedAt,
    relievedAt: now,
    relievedBy: ddUser._id,
    reason,
  });
  const wasAccepted = Boolean(department.piaAcceptedAt);
  department.piaUserId = successor._id;
  department.piaAssignedAt = now;
  department.piaAssignedBy = ddUser._id;
  // The successor takes over a charge that was already accepted, so reporting continues without a gap.
  department.piaAcceptedAt = wasAccepted ? now : undefined;
};

const transferReason = (raw) => {
  const reason = clean(raw, 500);
  if (reason.length < 5) throw badRequest('Give the reason for the transfer (for example: officer transferred, retired, on long leave).');
  return reason;
};

/**
 * District Maker hands one department over to another PIA Maker (transfer,
 * retirement, long leave). Works after acceptance too. The earlier officer is
 * kept in the department's history and loses access; the successor continues
 * the same chain of monthly reports.
 */
export const transferPia = async (projectId, ddUser, { departmentId, piaUserId, reason } = {}) => {
  assertDistrictMaker(ddUser);
  if (!mongoose.isValidObjectId(projectId)) return null;
  const sanction = await ProjectSanction.findById(projectId);
  if (!sanction) return null;
  assertOwnDistrict(ddUser, sanction);
  if (sanction.closure?.status === 'CLOSED') throw stateConflict('This project is closed.');
  const text = transferReason(reason);

  const department = (sanction.departmentAllocations || []).find((d) => String(d.departmentId) === departmentId);
  if (!department) throw badRequest('The department does not belong to this project.');
  if (!department.piaUserId) throw stateConflict(`${department.departmentName} has no PIA Maker yet. Use Assign.`);
  const successor = await officerFor(piaUserId, tierRoleQuery(TIERS.PIA, MAKER));
  if (!successor) throw badRequest('Select an active PIA Maker to take over.');
  if (String(successor._id) === String(department.piaUserId)) throw badRequest(`${successor.name} already holds ${department.departmentName}.`);
  if (successor.district !== sanction.district) throw badRequest(`${successor.name} does not belong to ${sanction.district} district.`);
  if (!sameText(successor.department, department.departmentName)) {
    throw badRequest(`${successor.name} belongs to ${successor.department || 'another department'} and cannot take over ${department.departmentName}.`);
  }

  const previous = await User.findById(department.piaUserId).select('name').lean();
  const now = new Date();
  handOver(department, successor, ddUser, text, now);
  department.piaHistory[department.piaHistory.length - 1].name = previous?.name || '';
  sanction.workflowHistory.push(historyStep(ddUser, 'PIA_TRANSFERRED', `${department.departmentName}: ${previous?.name || 'previous officer'} → ${successor.name}. ${text}`));
  await sanction.save();
  return { sanction, notifyUserIds: [String(successor._id)] };
};

const isActiveAccount = (user) => user.isActive !== false && !['DEACTIVATED', 'SUSPENDED'].includes(user.accountStatus) && user.approval?.status !== 'PENDING';

/** PIA Makers of the district with the departments they currently hold, and who could take over. */
export const getPiaWorkload = async (ddUser) => {
  if (!ddUser.district) throw badRequest('District not set for user');
  const [officers, projects] = await Promise.all([
    User.find({ role: USER_ROLES.PIA_OFFICER, district: ddUser.district }).select('name email department workflowRole isActive accountStatus approval.status').sort({ name: 1 }).lean(),
    ProjectSanction.find({ district: ddUser.district, 'departmentAllocations.piaUserId': { $exists: true } })
      .select('projectId sanctionId projectTitle closure departmentAllocations.departmentId departmentAllocations.departmentName departmentAllocations.piaUserId departmentAllocations.piaAcceptedAt')
      .lean(),
  ]);
  const makers = officers.filter((officer) => workflowRoleOf(officer) === MAKER);
  return makers.map((officer) => {
    const holdings = projects.filter((p) => p.closure?.status !== 'CLOSED').flatMap((project) => (project.departmentAllocations || [])
      .filter((d) => d.piaUserId && String(d.piaUserId) === String(officer._id))
      .map((d) => ({ projectId: String(project._id), projectCode: project.projectId || project.sanctionId || '', projectName: project.projectTitle, department: d.departmentName, accepted: Boolean(d.piaAcceptedAt) })));
    return {
      id: String(officer._id), name: officer.name, email: officer.email, department: officer.department || '', active: isActiveAccount(officer),
      holdings,
      successors: makers
        .filter((other) => String(other._id) !== String(officer._id) && sameText(other.department, officer.department) && isActiveAccount(other))
        .map((other) => ({ id: String(other._id), name: other.name, email: other.email })),
    };
  });
};

/** Hand over every department a PIA Maker holds in the district to one successor (handing over charge). */
export const handoverPiaCharge = async (ddUser, { fromUserId, toUserId, reason } = {}) => {
  assertDistrictMaker(ddUser);
  if (!ddUser.district) throw badRequest('District not set for user');
  const text = transferReason(reason);
  if (!mongoose.isValidObjectId(fromUserId) || !mongoose.isValidObjectId(toUserId)) throw badRequest('Select both officers.');
  if (String(fromUserId) === String(toUserId)) throw badRequest('Select a different officer to take over.');
  const [from, successor] = await Promise.all([
    User.findOne({ _id: fromUserId, role: USER_ROLES.PIA_OFFICER }).lean(),
    officerFor(toUserId, tierRoleQuery(TIERS.PIA, MAKER)),
  ]);
  if (!from) throw badRequest('The officer handing over was not found.');
  if (!successor) throw badRequest('Select an active PIA Maker to take over.');
  if (successor.district !== ddUser.district || from.district !== ddUser.district) throw forbidden('Both officers must belong to your district.');
  if (!sameText(successor.department, from.department)) throw badRequest(`${successor.name} belongs to ${successor.department || 'another department'}, not ${from.department}.`);

  const projects = await ProjectSanction.find({ district: ddUser.district, 'departmentAllocations.piaUserId': from._id });
  const now = new Date();
  const moved = [];
  for (const sanction of projects) {
    if (sanction.closure?.status === 'CLOSED') continue;
    const names = [];
    sanction.departmentAllocations.forEach((department) => {
      if (!department.piaUserId || String(department.piaUserId) !== String(from._id)) return;
      handOver(department, successor, ddUser, text, now);
      department.piaHistory[department.piaHistory.length - 1].name = from.name;
      names.push(department.departmentName);
    });
    if (!names.length) continue;
    sanction.workflowHistory.push(historyStep(ddUser, 'PIA_TRANSFERRED', `${names.join(', ')}: ${from.name} → ${successor.name}. ${text}`));
    // eslint-disable-next-line no-await-in-loop
    await sanction.save();
    moved.push({ sanction, departments: names });
  }
  if (!moved.length) throw stateConflict(`${from.name} holds no department in ${ddUser.district}.`);
  return { moved, from, successor };
};

// ─── PIA ─────────────────────────────────────────────────────────────────────

/**
 * PIA Maker accepts the department(s) assigned to them and starts
 * implementation. The project becomes Active once every department is ready
 * for reporting.
 */
export const piaAccept = async (projectId, piaUser) => {
  if (!isPia(piaUser, MAKER)) throw forbidden('Only the PIA Maker assigned to the project can accept it.');
  if (!mongoose.isValidObjectId(projectId)) return null;
  const sanction = await ProjectSanction.findById(projectId);
  if (!sanction) return null;

  const departments = sanction.departmentAllocations || [];
  const now = new Date();

  if (!departments.length) {
    if (sanction.status !== S.FORWARDED_TO_PIA) throw stateConflict('This project is not waiting for PIA acceptance.');
    if (!sanction.forwardedToPIA || sanction.forwardedToPIA.toString() !== piaUser._id.toString()) {
      throw forbidden('This project is not assigned to you.');
    }
    sanction.status = S.PIA_ACCEPTED;
    sanction.isActive = true;
    sanction.piaAcceptedBy = piaUser._id;
    sanction.piaAcceptedAt = now;
    sanction.workflowHistory.push(historyStep(piaUser, 'PIA_ACCEPTED', 'Accepted by PIA Maker. Project activated.'));
    await sanction.save();
    return sanction;
  }

  const mine = departments.filter((d) => sameId(d.piaUserId, piaUser._id));
  if (!mine.length) throw forbidden('This project is not assigned to you.');
  const pending = mine.filter((d) => !d.piaAcceptedAt);
  if (!pending.length) throw stateConflict('You have already accepted this project.');

  pending.forEach((department) => { department.piaAcceptedAt = now; });
  settleStatus(sanction);
  if (sanction.status === S.PIA_ACCEPTED) {
    sanction.piaAcceptedBy = piaUser._id;
    sanction.piaAcceptedAt = now;
  }
  sanction.workflowHistory.push(historyStep(piaUser, 'PIA_ACCEPTED', `${pending.map((d) => d.departmentName).join(', ')} accepted by PIA Maker. Implementation begins.`));

  await sanction.save();
  return sanction;
};

/**
 * Projects of a PIA user. The Maker sees the departments assigned to them; the
 * PIA Checker and Approver see their department's assignments in their district.
 */
export const getActiveSanctionsForPIA = async (piaUser) => {
  const maker = workflowRoleOf(piaUser) === MAKER;
  if (!maker && (!piaUser.district || !piaUser.department)) return [];
  const filter = maker
    ? { $or: [{ forwardedToPIA: piaUser._id }, { 'departmentAllocations.piaUserId': piaUser._id }] }
    : {
      district: piaUser.district,
      departmentAllocations: { $elemMatch: { piaUserId: { $exists: true }, departmentName: new RegExp(`^\\s*${escapeRegex(String(piaUser.department).trim())}\\s*$`, 'i') } },
    };
  const projects = await ProjectSanction.find({ status: { $in: [S.FORWARDED_TO_PIA, S.PIA_ACCEPTED] }, ...filter }).sort({ piaForwardedAt: -1 }).lean();

  return projects.map((project) => {
    const departments = project.departmentAllocations || [];
    const legacy = !departments.length;
    const mine = maker
      ? departments.filter((d) => sameId(d.piaUserId, piaUser._id))
      : departments.filter((d) => d.piaUserId && sameText(d.departmentName, piaUser.department));
    return {
      ...project,
      myDepartments: mine.map((d) => ({
        departmentId: String(d.departmentId),
        name: d.departmentName,
        totalLakh: d.totalLakh,
        reportingMode: d.reportingMode || REPORTING_MODE.PIA,
        assignedAt: d.piaAssignedAt,
        acceptedAt: d.piaAcceptedAt || null,
      })),
      needsMyAcceptance: maker && (legacy ? project.status === S.FORWARDED_TO_PIA : mine.some((d) => !d.piaAcceptedAt)),
      canReport: maker && !legacy && mine.some((d) => d.piaAcceptedAt && (d.reportingMode || REPORTING_MODE.PIA) === REPORTING_MODE.PIA),
    };
  });
};

// ─── Lists ───────────────────────────────────────────────────────────────────

/** Shared list filters: free-text search, Head, and open / closed. `status=CLOSED` means closed projects. */
const applyListFilters = (matchObj, filters = {}) => {
  const status = Array.isArray(filters.status) ? filters.status : (filters.status ? [filters.status] : []);
  if (status.includes('CLOSED')) matchObj['closure.status'] = 'CLOSED';
  else if (status.length) { matchObj.status = status.length === 1 ? status[0] : { $in: status }; matchObj['closure.status'] = { $ne: 'CLOSED' }; }
  if (filters.headCode) matchObj['head.code'] = filters.headCode;
  const term = typeof filters.search === 'string' ? filters.search.trim().slice(0, 80) : '';
  if (term) {
    const pattern = new RegExp(escapeRegex(term), 'i');
    matchObj.$or = [{ projectId: pattern }, { sanctionId: pattern }, { projectTitle: pattern }, { 'location.village': pattern }, { 'location.block': pattern }];
  }
  return matchObj;
};

/** The filters without the stage, so the stage counts stay visible while one stage is selected. */
const scopeOf = (matchObj) => {
  const { status, 'closure.status': closure, ...rest } = matchObj;
  return rest;
};

/** How many projects are at each stage within a scope (closed projects are counted as CLOSED). */
const stageSummary = async (scope) => {
  const rows = await ProjectSanction.aggregate([
    { $match: scope },
    { $group: { _id: { $cond: [{ $eq: ['$closure.status', 'CLOSED'] }, 'CLOSED', '$status'] }, count: { $sum: 1 } } },
  ]);
  const byStage = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  return { total: rows.reduce((sum, row) => sum + row.count, 0), byStage };
};

const LIST_FIELDS = {
  sanctionId: 1, projectId: 1, dprApplicationNo: 1, dprType: 1, projectTitle: 1,
  head: 1, numberOfPIA: 1,
  'departmentAllocations.totalLakh': 1, 'departmentAllocations.sarraShareLakh': 1,
  financialYear: 1, district: 1, department: 1, status: 1, isActive: 1,
  totalSanctionedBudgetLakh: 1, sarraShareLakh: 1, deptShareLakh: 1,
  createdAt: 1, updatedAt: 1, approverAt: 1, piaAcceptedAt: 1, rejectionReason: 1,
  forwardedToDistrictAt: 1, districtAcceptedAt: 1, forwardedToPIA: 1,
  'closure.status': 1, 'location.block': 1, 'location.village': 1,
  'departmentAllocations.departmentName': 1, 'departmentAllocations.piaUserId': 1, 'departmentAllocations.piaAcceptedAt': 1,
  'departmentAllocations.reportingMode': 1, 'departmentAllocations.districtStaffUserId': 1,
};

/** Projects across the State (HQ and M&E). */
export const getSanctions = async (filters, page = 1, limit = 10) => {
  const matchObj = {};
  applyListFilters(matchObj, filters);
  if (filters.district) matchObj.district = filters.district;
  if (filters.financialYear) matchObj.financialYear = filters.financialYear;
  if (filters.isActive !== undefined) matchObj.isActive = filters.isActive === 'true';

  const pipeline = [
    { $match: matchObj },
    { $sort: { createdAt: -1 } },
    { $lookup: { from: 'users', localField: 'makerUserId', foreignField: '_id', as: 'maker' } },
    { $unwind: { path: '$maker', preserveNullAndEmptyArrays: true } },
    { $project: { ...LIST_FIELDS, 'maker.name': 1 } },
  ];

  const [result, summary] = await Promise.all([paginate(ProjectSanction, pipeline, page, limit), stageSummary(scopeOf(matchObj))]);
  result.data = result.data.map(withDepartments);
  result.summary = summary;
  return result;
};

/** Projects of one district, once HQ has forwarded them. */
export const getSanctionsForDistrict = async (district, filters, page = 1, limit = 10) => {
  const visible = { $in: [S.FORWARDED_TO_DISTRICT, S.DISTRICT_ACCEPTED, S.FORWARDED_TO_PIA, S.PIA_ACCEPTED] };
  const matchObj = { district };
  applyListFilters(matchObj, filters);
  if (!matchObj.status) matchObj.status = visible;

  const pipeline = [
    { $match: matchObj },
    { $sort: { createdAt: -1 } },
    { $project: LIST_FIELDS },
  ];

  const [result, summary] = await Promise.all([paginate(ProjectSanction, pipeline, page, limit), stageSummary({ ...scopeOf(matchObj), status: visible })]);
  result.data = result.data.map(withDepartments);
  result.summary = summary;

  for (const sanction of result.data) {
    // eslint-disable-next-line no-await-in-loop
    const counts = await Promise.all([
      MPRPraroop1A.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1B.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1C.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1D.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      countAwaitingReview(sanction._id),
    ]);
    sanction.unreviewedMprCount = counts.reduce((a, b) => a + b, 0);
  }

  return result;
};

/** One project with its people populated. */
export const getSanctionById = async (id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const sanction = await ProjectSanction.findById(id)
    .populate('makerUserId', 'name email designation')
    .populate('checkerUserId', 'name email designation')
    .populate('approverUserId', 'name email designation')
    .populate('districtAcceptedBy', 'name email district')
    .populate('forwardedToPIA', 'name email department district')
    .populate('departmentAllocations.piaUserId', 'name email designation')
    .populate('departmentAllocations.districtStaffUserId', 'name email designation')
    .populate('departmentAllocations.piaHistory.relievedBy', 'name')
    .populate('piaAcceptedBy', 'name email')
    .populate('workflowHistory.performedBy', 'name')
    .lean();

  if (sanction) {
    const counts = await Promise.all([
      MPRPraroop1A.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1B.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1C.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1D.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      countAwaitingReview(sanction._id),
    ]);
    sanction.unreviewedMprCount = counts.reduce((a, b) => a + b, 0);
  }

  return sanction;
};

/** Approved DPRs without a project (projects are created directly now). */
export const getApprovedDPRsWithoutSanction = async () => [];

/** Project analytics for dashboards. */
export const getSanctionAnalytics = async (filters = {}) => {
  const matchObj = {};
  if (filters.financialYear) matchObj.financialYear = filters.financialYear;
  if (filters.district) matchObj.district = filters.district;

  const result = await ProjectSanction.aggregate([
    { $match: matchObj },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byDistrict: [
          {
            $group: {
              _id: '$district',
              total: { $sum: 1 },
              active: { $sum: { $cond: ['$isActive', 1, 0] } },
              totalBudget: { $sum: '$totalSanctionedBudgetLakh' },
            },
          },
        ],
        totals: [
          {
            $group: {
              _id: null,
              totalSanctions: { $sum: 1 },
              activeSanctions: { $sum: { $cond: ['$isActive', 1, 0] } },
              totalBudgetLakh: { $sum: '$totalSanctionedBudgetLakh' },
              totalSarraShareLakh: { $sum: '$sarraShareLakh' },
              totalDeptShareLakh: { $sum: '$deptShareLakh' },
            },
          },
        ],
      },
    },
  ]);

  return result[0];
};
