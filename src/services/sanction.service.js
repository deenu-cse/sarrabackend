import ProjectSanction from '../models/ProjectSanction.model.js';
import generateSanctionId from '../utils/generateSanctionId.js';
import paginate from '../utils/paginate.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import MPRPraroop1A from '../models/MPRPraroop1A.model.js';
import MPRPraroop1B from '../models/MPRPraroop1B.model.js';
import MPRPraroop1C from '../models/MPRPraroop1C.model.js';
import MPRPraroop1D from '../models/MPRPraroop1D.model.js';
import { summarizeProjectBudget } from './budgetAllocation.service.js';
import { countAwaitingReview } from './projectMpr.service.js';
import mongoose from 'mongoose';
import User from '../models/User.model.js';
import USER_ROLES from '../constants/roles.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/** List row + its backend-calculated budget position (the row's department figures are only needed for that). */
const withBudget = ({ departmentAllocations, ...row }) => ({
  ...row,
  // Compact view of the departments for list screens
  departments: (departmentAllocations || []).filter((d) => d.departmentName)
    .map((d) => ({ name: d.departmentName, assigned: Boolean(d.piaUserId), accepted: Boolean(d.piaAcceptedAt) })),
  budget: summarizeProjectBudget({ ...row, departmentAllocations }),
});



/**
 * Checker verifies sanction
 */
export const checkerVerify = async (sanctionId, checkerUser, note) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.PENDING_CHECKER) {
    throw new Error('Sanction is not pending checker verification');
  }

  sanction.status = SANCTION_STATUS.PENDING_APPROVER;
  sanction.checkerUserId = checkerUser._id;
  sanction.checkerNote = note || '';
  sanction.checkerAt = new Date();
  sanction.workflowHistory.push({
    action: 'CHECKER_VERIFIED',
    performedBy: checkerUser._id,
    performedAt: new Date(),
    note: note || 'Verified by Checker',
  });

  await sanction.save();
  return sanction;
};

/**
 * Approver approves sanction — generates Sanction ID
 */
export const approverApprove = async (sanctionId, approverUser, note, documents) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.PENDING_APPROVER) {
    throw new Error('Sanction is not pending approver approval');
  }

  // Generate unique Sanction ID
  const generatedSanctionId = await generateSanctionId(sanction.district);

  sanction.sanctionId = generatedSanctionId;
  sanction.status = SANCTION_STATUS.SANCTIONED;
  sanction.approverUserId = approverUser._id;
  sanction.approverNote = note || '';
  sanction.approverAt = new Date();

  if (documents?.secretariatApprovalOrder) {
    sanction.secretariatApprovalOrder = documents.secretariatApprovalOrder;
  }
  if (documents?.stateSanctionOrder) {
    sanction.stateSanctionOrder = documents.stateSanctionOrder;
  }

  sanction.workflowHistory.push({
    action: 'APPROVED',
    performedBy: approverUser._id,
    performedAt: new Date(),
    note: note || `Approved. Sanction ID: ${generatedSanctionId}`,
  });

  await sanction.save();
  return sanction;
};

/**
 * Reject sanction at any tier
 */
export const rejectSanction = async (sanctionId, user, reason) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;

  if (![SANCTION_STATUS.PENDING_CHECKER, SANCTION_STATUS.PENDING_APPROVER].includes(sanction.status)) {
    throw new Error('Sanction cannot be rejected at this stage');
  }

  sanction.status = SANCTION_STATUS.REJECTED;
  sanction.rejectionReason = reason;
  sanction.rejectedBy = user._id;
  sanction.rejectedAt = new Date();
  sanction.workflowHistory.push({
    action: 'REJECTED',
    performedBy: user._id,
    performedAt: new Date(),
    note: `Rejected: ${reason}`,
  });

  await sanction.save();
  return sanction;
};

/**
 * Forward sanctioned project to District
 */
export const forwardToDistrict = async (sanctionId, stateUser) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.SANCTIONED) {
    throw new Error('Only sanctioned projects can be forwarded to district');
  }

  sanction.status = SANCTION_STATUS.FORWARDED_TO_DISTRICT;
  sanction.forwardedToDistrict = sanction.district;
  sanction.forwardedToDistrictAt = new Date();
  sanction.forwardedToDistrictBy = stateUser._id;
  sanction.workflowHistory.push({
    action: 'FORWARDED_TO_DISTRICT',
    performedBy: stateUser._id,
    performedAt: new Date(),
    note: `Forwarded to ${sanction.district} district`,
  });

  await sanction.save();
  return sanction;
};

const sameText = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
const badRequest = (message) => new ApiError(HTTP_STATUS.BAD_REQUEST, message);
const stateConflict = (message) => new ApiError(HTTP_STATUS.CONFLICT, message);

const assertOwnDistrict = (ddUser, sanction) => {
  if (!ddUser.district || ddUser.district !== sanction.district) {
    throw forbidden('This project belongs to another district.');
  }
};

/**
 * District accepts sanction.
 * For projects with department-wise budget the money is released by the State
 * through budget-allocation installments, so the district records no amount of
 * its own; the legacy single-amount field is kept only for older projects.
 */
export const districtAccept = async (sanctionId, ddUser, fundAllocationOrder, allocatedAmountLakh) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  if (sanction.status !== SANCTION_STATUS.FORWARDED_TO_DISTRICT) {
    throw stateConflict('This project is not waiting for district acceptance.');
  }
  assertOwnDistrict(ddUser, sanction);

  const departmentWise = (sanction.departmentAllocations || []).length > 0;
  sanction.status = SANCTION_STATUS.DISTRICT_ACCEPTED;
  sanction.districtAcceptedBy = ddUser._id;
  sanction.districtAcceptedAt = new Date();
  if (fundAllocationOrder) {
    sanction.fundAllocationOrder = fundAllocationOrder;
  }
  if (!departmentWise) {
    sanction.allocatedAmountLakh = Number(allocatedAmountLakh) > 0 ? Number(allocatedAmountLakh) : sanction.totalSanctionedBudgetLakh;
  }
  sanction.workflowHistory.push({
    action: 'DISTRICT_ACCEPTED',
    performedBy: ddUser._id,
    performedAt: new Date(),
    note: `Accepted by ${sanction.district} district`,
  });

  await sanction.save();
  return sanction;
};

const activePiaQuery = { role: USER_ROLES.PIA_OFFICER, isActive: true, accountStatus: { $nin: ['DEACTIVATED', 'SUSPENDED'] } };

/**
 * PIA officers who can be assigned to each department of a project: officers of
 * the project's district whose own department is that department.
 */
export const getPiaCandidates = async (sanctionId, ddUser) => {
  const sanction = await ProjectSanction.findById(sanctionId)
    .populate('departmentAllocations.piaUserId', 'name email')
    .lean();
  if (!sanction) return null;
  assertOwnDistrict(ddUser, sanction);

  const officers = await User.find({ ...activePiaQuery, district: sanction.district })
    .select('name email designation department')
    .sort({ name: 1 })
    .lean();

  return (sanction.departmentAllocations || []).map((department) => ({
    departmentId: String(department.departmentId),
    name: department.departmentName,
    assigned: department.piaUserId ? { id: String(department.piaUserId._id), name: department.piaUserId.name, email: department.piaUserId.email } : null,
    accepted: Boolean(department.piaAcceptedAt),
    officers: officers
      .filter((officer) => sameText(officer.department, department.departmentName))
      .map((officer) => ({ id: String(officer._id), name: officer.name, email: officer.email, designation: officer.designation || '' })),
  }));
};

/**
 * District assigns PIA officers.
 *
 * Department-wise projects: `assignments` = [{ departmentId, piaUserId }]. Each
 * department gets its own officer, who must belong to that department and to
 * the project's district. Departments can be assigned together or later; a
 * department whose officer has already accepted cannot be reassigned.
 *
 * Older projects without departments keep the single `piaUserId`.
 */
export const forwardToPIA = async (sanctionId, ddUser, { piaUserId, assignments } = {}) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  assertOwnDistrict(ddUser, sanction);

  const departments = sanction.departmentAllocations || [];
  const now = new Date();

  if (!departments.length) {
    if (sanction.status !== SANCTION_STATUS.DISTRICT_ACCEPTED) {
      throw stateConflict('The project must be accepted by the district before it is assigned to a PIA.');
    }
    const officer = mongoose.isValidObjectId(piaUserId) ? await User.findOne({ _id: piaUserId, ...activePiaQuery }).lean() : null;
    if (!officer) throw badRequest('Select an active PIA officer.');
    if (officer.district !== sanction.district) throw badRequest(`${officer.name} does not belong to ${sanction.district} district.`);

    sanction.status = SANCTION_STATUS.FORWARDED_TO_PIA;
    sanction.forwardedToPIA = officer._id;
    sanction.piaForwardedAt = now;
    sanction.piaForwardedBy = ddUser._id;
    sanction.workflowHistory.push({ action: 'FORWARDED_TO_PIA', performedBy: ddUser._id, performedAt: now, note: `Assigned to ${officer.name}` });
    await sanction.save();
    return { sanction, notifyUserIds: [String(officer._id)] };
  }

  if (![SANCTION_STATUS.DISTRICT_ACCEPTED, SANCTION_STATUS.FORWARDED_TO_PIA].includes(sanction.status)) {
    throw stateConflict(sanction.status === SANCTION_STATUS.PIA_ACCEPTED
      ? 'Every department already has an accepted PIA officer. Use Transfer Charge to hand a department over.'
      : 'The project must be accepted by the district before PIA officers are assigned.');
  }

  const requested = Array.isArray(assignments) ? assignments : [];
  if (!requested.length) throw badRequest('Select a PIA officer for at least one department.');

  const seen = new Set();
  const officerIds = [];
  for (const item of requested) {
    const departmentId = typeof item?.departmentId === 'string' ? item.departmentId : '';
    const officerId = typeof item?.piaUserId === 'string' ? item.piaUserId : '';
    if (!departments.some((d) => String(d.departmentId) === departmentId)) throw badRequest('One of the departments does not belong to this project.');
    if (seen.has(departmentId)) throw badRequest('A department appears more than once in the assignment.');
    if (!mongoose.isValidObjectId(officerId)) throw badRequest('Select a PIA officer for each department.');
    seen.add(departmentId);
    officerIds.push(officerId);
  }

  const officers = await User.find({ _id: { $in: officerIds }, ...activePiaQuery }).lean();
  const officerById = new Map(officers.map((officer) => [String(officer._id), officer]));

  const notes = [];
  const notifyUserIds = new Set();
  for (const item of requested) {
    const department = departments.find((d) => String(d.departmentId) === item.departmentId);
    const officer = officerById.get(item.piaUserId);
    const name = department.departmentName;
    if (!officer) throw badRequest(`${name}: the selected PIA officer was not found or is not active.`);
    if (officer.district !== sanction.district) throw badRequest(`${name}: ${officer.name} does not belong to ${sanction.district} district.`);
    // The rule that keeps a Forest officer off a Minor Irrigation department.
    if (!sameText(officer.department, name)) throw badRequest(`${name}: ${officer.name} belongs to ${officer.department || 'another department'} and cannot be assigned to ${name}.`);

    const unchanged = department.piaUserId && String(department.piaUserId) === String(officer._id);
    if (department.piaAcceptedAt && !unchanged) throw stateConflict(`${name}: its PIA officer has already accepted. Use Transfer Charge to hand the department over.`);
    if (unchanged) continue;

    department.piaUserId = officer._id;
    department.piaAssignedAt = now;
    department.piaAssignedBy = ddUser._id;
    department.piaAcceptedAt = undefined;
    notes.push(`${name} → ${officer.name}`);
    notifyUserIds.add(String(officer._id));
  }

  if (!notes.length) return { sanction, notifyUserIds: [] };

  if (sanction.status === SANCTION_STATUS.DISTRICT_ACCEPTED) {
    sanction.status = SANCTION_STATUS.FORWARDED_TO_PIA;
    sanction.piaForwardedAt = now;
    sanction.piaForwardedBy = ddUser._id;
  }
  sanction.workflowHistory.push({ action: 'FORWARDED_TO_PIA', performedBy: ddUser._id, performedAt: now, note: `PIA assigned: ${notes.join('; ')}` });

  await sanction.save();
  return { sanction, notifyUserIds: [...notifyUserIds] };
};

/** Move one department from its current officer to a successor, keeping the history. */
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
  const reason = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (reason.length < 5) throw badRequest('Give the reason for the transfer (for example: officer transferred, retired, on long leave).');
  return reason;
};

/**
 * District hands one department over to another PIA officer (transfer,
 * retirement, long leave). Works after acceptance too. The earlier officer is
 * kept in the department's history and loses access; the successor continues
 * the same chain of monthly reports.
 */
export const transferPia = async (sanctionId, ddUser, { departmentId, piaUserId, reason } = {}) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;
  assertOwnDistrict(ddUser, sanction);
  if (sanction.closure?.status === 'CLOSED') throw stateConflict('This project is closed.');
  const text = transferReason(reason);

  const department = (sanction.departmentAllocations || []).find((d) => String(d.departmentId) === departmentId);
  if (!department) throw badRequest('The department does not belong to this project.');
  if (!department.piaUserId) throw stateConflict(`${department.departmentName} has no PIA officer yet. Use Assign PIA Officers.`);
  const successor = mongoose.isValidObjectId(piaUserId) ? await User.findOne({ _id: piaUserId, ...activePiaQuery }).lean() : null;
  if (!successor) throw badRequest('Select an active PIA officer to take over.');
  if (String(successor._id) === String(department.piaUserId)) throw badRequest(`${successor.name} already holds ${department.departmentName}.`);
  if (successor.district !== sanction.district) throw badRequest(`${successor.name} does not belong to ${sanction.district} district.`);
  if (!sameText(successor.department, department.departmentName)) {
    throw badRequest(`${successor.name} belongs to ${successor.department || 'another department'} and cannot take over ${department.departmentName}.`);
  }

  const previous = await User.findById(department.piaUserId).select('name').lean();
  const now = new Date();
  handOver(department, successor, ddUser, text, now);
  department.piaHistory[department.piaHistory.length - 1].name = previous?.name || '';
  sanction.workflowHistory.push({
    action: 'PIA_TRANSFERRED',
    performedBy: ddUser._id,
    performedAt: now,
    note: `${department.departmentName}: ${previous?.name || 'previous officer'} → ${successor.name}. ${text}`,
  });
  await sanction.save();
  return { sanction, notifyUserIds: [String(successor._id)] };
};

/** PIA officers of the district with the departments they currently hold, and who could take over. */
export const getPiaWorkload = async (ddUser) => {
  if (!ddUser.district) throw badRequest('District not set for user');
  const [officers, projects] = await Promise.all([
    User.find({ role: USER_ROLES.PIA_OFFICER, district: ddUser.district }).select('name email department isActive accountStatus').sort({ name: 1 }).lean(),
    ProjectSanction.find({ district: ddUser.district, 'departmentAllocations.piaUserId': { $exists: true } })
      .select('projectId sanctionId projectTitle closure departmentAllocations.departmentId departmentAllocations.departmentName departmentAllocations.piaUserId departmentAllocations.piaAcceptedAt')
      .lean(),
  ]);
  return officers.map((officer) => {
    const holdings = projects.filter((p) => p.closure?.status !== 'CLOSED').flatMap((project) => (project.departmentAllocations || [])
      .filter((d) => d.piaUserId && String(d.piaUserId) === String(officer._id))
      .map((d) => ({ projectId: String(project._id), projectCode: project.projectId || project.sanctionId || '', projectName: project.projectTitle, department: d.departmentName, accepted: Boolean(d.piaAcceptedAt) })));
    const active = officer.isActive !== false && !['DEACTIVATED', 'SUSPENDED'].includes(officer.accountStatus);
    return {
      id: String(officer._id), name: officer.name, email: officer.email, department: officer.department || '', active,
      holdings,
      successors: officers
        .filter((other) => String(other._id) !== String(officer._id) && sameText(other.department, officer.department)
          && other.isActive !== false && !['DEACTIVATED', 'SUSPENDED'].includes(other.accountStatus))
        .map((other) => ({ id: String(other._id), name: other.name, email: other.email })),
    };
  });
};

/** Hand over every department an officer holds in the district to one successor (handing over charge). */
export const handoverPiaCharge = async (ddUser, { fromUserId, toUserId, reason } = {}) => {
  if (!ddUser.district) throw badRequest('District not set for user');
  const text = transferReason(reason);
  if (!mongoose.isValidObjectId(fromUserId) || !mongoose.isValidObjectId(toUserId)) throw badRequest('Select both officers.');
  if (String(fromUserId) === String(toUserId)) throw badRequest('Select a different officer to take over.');
  const [from, successor] = await Promise.all([
    User.findOne({ _id: fromUserId, role: USER_ROLES.PIA_OFFICER }).lean(),
    User.findOne({ _id: toUserId, ...activePiaQuery }).lean(),
  ]);
  if (!from) throw badRequest('The officer handing over was not found.');
  if (!successor) throw badRequest('Select an active PIA officer to take over.');
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
    sanction.workflowHistory.push({ action: 'PIA_TRANSFERRED', performedBy: ddUser._id, performedAt: now, note: `${names.join(', ')}: ${from.name} → ${successor.name}. ${text}` });
    // eslint-disable-next-line no-await-in-loop
    await sanction.save();
    moved.push({ sanction, departments: names });
  }
  if (!moved.length) throw stateConflict(`${from.name} holds no department in ${ddUser.district}.`);
  return { moved, from, successor };
};

/**
 * PIA accepts. On a department-wise project the officer accepts their own
 * department(s); the project becomes fully "PIA Accepted" once every
 * department has an accepted officer, but an accepted department can start
 * reporting straight away.
 */
export const piaAccept = async (sanctionId, piaUser) => {
  const sanction = await ProjectSanction.findById(sanctionId);
  if (!sanction) return null;

  const departments = sanction.departmentAllocations || [];
  const now = new Date();

  if (!departments.length) {
    if (sanction.status !== SANCTION_STATUS.FORWARDED_TO_PIA) throw stateConflict('This project is not waiting for PIA acceptance.');
    if (!sanction.forwardedToPIA || sanction.forwardedToPIA.toString() !== piaUser._id.toString()) {
      throw forbidden('This project is not assigned to you.');
    }
    sanction.status = SANCTION_STATUS.PIA_ACCEPTED;
    sanction.isActive = true;
    sanction.piaAcceptedBy = piaUser._id;
    sanction.piaAcceptedAt = now;
    sanction.workflowHistory.push({ action: 'PIA_ACCEPTED', performedBy: piaUser._id, performedAt: now, note: 'PIA accepted. Project activated.' });
    await sanction.save();
    return sanction;
  }

  const mine = departments.filter((d) => d.piaUserId && String(d.piaUserId) === String(piaUser._id));
  if (!mine.length) throw forbidden('This project is not assigned to you.');
  const pending = mine.filter((d) => !d.piaAcceptedAt);
  if (!pending.length) throw stateConflict('You have already accepted this project.');

  pending.forEach((department) => { department.piaAcceptedAt = now; });
  sanction.isActive = true;
  if (departments.every((d) => d.piaUserId && d.piaAcceptedAt)) {
    sanction.status = SANCTION_STATUS.PIA_ACCEPTED;
    sanction.piaAcceptedBy = piaUser._id;
    sanction.piaAcceptedAt = now;
  }
  sanction.workflowHistory.push({
    action: 'PIA_ACCEPTED',
    performedBy: piaUser._id,
    performedAt: now,
    note: `${pending.map((d) => d.departmentName).join(', ')} accepted by PIA`,
  });

  await sanction.save();
  return sanction;
};

/**
 * Projects of a PIA officer (for acceptance and MPR entry): those where the
 * officer is assigned to a department, plus older single-PIA projects.
 */
export const getActiveSanctionsForPIA = async (piaUserId) => {
  const projects = await ProjectSanction.find({
    status: { $in: [SANCTION_STATUS.FORWARDED_TO_PIA, SANCTION_STATUS.PIA_ACCEPTED] },
    $or: [{ forwardedToPIA: piaUserId }, { 'departmentAllocations.piaUserId': piaUserId }],
  }).sort({ piaForwardedAt: -1 }).lean();

  return projects.map((project) => {
    const mine = (project.departmentAllocations || []).filter((d) => d.piaUserId && String(d.piaUserId) === String(piaUserId));
    const legacy = !(project.departmentAllocations || []).length;
    return {
      ...project,
      myDepartments: mine.map((d) => ({
        departmentId: String(d.departmentId),
        name: d.departmentName,
        totalLakh: d.totalLakh,
        assignedAt: d.piaAssignedAt,
        acceptedAt: d.piaAcceptedAt || null,
      })),
      needsMyAcceptance: legacy ? project.status === SANCTION_STATUS.FORWARDED_TO_PIA : mine.some((d) => !d.piaAcceptedAt),
      canReport: legacy ? project.status === SANCTION_STATUS.PIA_ACCEPTED : mine.some((d) => d.piaAcceptedAt),
    };
  });
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/**
 * Get sanctions list with filters
 */
export const getSanctions = async (filters, page = 1, limit = 10) => {
  const matchObj = {};
  applyListFilters(matchObj, filters);
  if (filters.district) matchObj.district = filters.district;
  if (filters.financialYear) matchObj.financialYear = filters.financialYear;
  if (filters.isActive !== undefined) matchObj.isActive = filters.isActive === 'true';

  const pipeline = [
    { $match: matchObj },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users', localField: 'makerUserId', foreignField: '_id', as: 'maker'
      }
    },
    { $unwind: { path: '$maker', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        sanctionId: 1, projectId: 1, dprApplicationNo: 1, dprType: 1, projectTitle: 1,
        head: 1, numberOfPIA: 1, budgetAllocation: 1,
        'departmentAllocations.totalLakh': 1, 'departmentAllocations.sarraShareLakh': 1,
        financialYear: 1, district: 1, department: 1, status: 1, isActive: 1,
        totalSanctionedBudgetLakh: 1, sarraShareLakh: 1, deptShareLakh: 1,
        createdAt: 1, updatedAt: 1, approverAt: 1, piaAcceptedAt: 1, rejectionReason: 1,
        'closure.status': 1, 'location.block': 1, 'location.village': 1,
        'departmentAllocations.departmentName': 1, 'departmentAllocations.piaUserId': 1, 'departmentAllocations.piaAcceptedAt': 1,
        'maker.name': 1,
      }
    }
  ];

  const [result, summary] = await Promise.all([paginate(ProjectSanction, pipeline, page, limit), stageSummary(scopeOf(matchObj))]);
  result.data = result.data.map(withBudget);
  result.summary = summary;
  return result;
};

/**
 * Get sanctions for a specific district
 */
export const getSanctionsForDistrict = async (district, filters, page = 1, limit = 10) => {
  // A district sees a project only once the State has forwarded it.
  const visible = { $in: [SANCTION_STATUS.FORWARDED_TO_DISTRICT, SANCTION_STATUS.DISTRICT_ACCEPTED, SANCTION_STATUS.FORWARDED_TO_PIA, SANCTION_STATUS.PIA_ACCEPTED] };
  const matchObj = { district };
  applyListFilters(matchObj, filters);
  if (!matchObj.status) matchObj.status = visible;

  const pipeline = [
    { $match: matchObj },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        sanctionId: 1, projectId: 1, dprApplicationNo: 1, dprType: 1, projectTitle: 1,
        head: 1, numberOfPIA: 1, budgetAllocation: 1,
        'departmentAllocations.totalLakh': 1, 'departmentAllocations.sarraShareLakh': 1,
        financialYear: 1, district: 1, department: 1, status: 1, isActive: 1,
        totalSanctionedBudgetLakh: 1, allocatedAmountLakh: 1,
        forwardedToDistrictAt: 1, districtAcceptedAt: 1, piaAcceptedAt: 1,
        forwardedToPIA: 1, createdAt: 1, updatedAt: 1,
        'closure.status': 1, 'location.block': 1, 'location.village': 1,
        'departmentAllocations.departmentName': 1, 'departmentAllocations.piaUserId': 1, 'departmentAllocations.piaAcceptedAt': 1,
      }
    }
  ];

  const [result, summary] = await Promise.all([paginate(ProjectSanction, pipeline, page, limit), stageSummary({ ...scopeOf(matchObj), status: visible })]);
  result.data = result.data.map(withBudget);
  result.summary = summary;

  for (const sanction of result.data) {
    const counts = await Promise.all([
      MPRPraroop1A.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1B.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1C.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      MPRPraroop1D.countDocuments({ projectSanctionId: sanction._id, status: 'SUBMITTED' }),
      countAwaitingReview(sanction._id)
    ]);
    sanction.unreviewedMprCount = counts.reduce((a, b) => a + b, 0);
  }

  return result;
};

/**
 * Get sanction by ID with populated refs
 */
export const getSanctionById = async (id) => {
  const sanction = await ProjectSanction.findById(id)
    .populate('makerUserId', 'name email')
    .populate('checkerUserId', 'name email')
    .populate('approverUserId', 'name email')
    .populate('districtAcceptedBy', 'name email district')
    .populate('forwardedToPIA', 'name email department district')
    .populate('departmentAllocations.piaUserId', 'name email designation')
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
      countAwaitingReview(sanction._id)
    ]);
    sanction.unreviewedMprCount = counts.reduce((a, b) => a + b, 0);
    sanction.budget = summarizeProjectBudget(sanction);
  }
  
  return sanction;
};

/**
 * Get approved DPRs that don't have sanctions yet (for create sanction dropdown)
 */
export const getApprovedDPRsWithoutSanction = async (filters) => {
  return [];
};

/**
 * Get sanction analytics for dashboard
 */
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
            }
          }
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
            }
          }
        ],
      }
    }
  ]);

  return result[0];
};
