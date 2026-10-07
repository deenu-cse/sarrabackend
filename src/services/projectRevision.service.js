import mongoose from 'mongoose';
import ProjectSanction from '../models/ProjectSanction.model.js';
import ProjectRevision, { REVISION_STATUS } from '../models/ProjectRevision.model.js';
import ProjectMPR from '../models/ProjectMPR.model.js';
import { BudgetAllocationEntry } from '../models/BudgetAllocation.model.js';
import { getActiveHead } from './masterData.service.js';
import { buildAllocation, rollUpTargets, roundMoney } from './projectCreation.service.js';
import { runInTransaction } from '../utils/transaction.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';

/**
 * Revised estimates for sanctioned projects.
 *
 * A revision may change each department's shares and its activity targets.
 * It can never go below what has already happened: a department's total cannot
 * drop under the funds released to it, and an activity's targets cannot drop
 * under the progress already reported.
 */

const REVISABLE = [
  SANCTION_STATUS.SANCTIONED, SANCTION_STATUS.FORWARDED_TO_DISTRICT, SANCTION_STATUS.DISTRICT_ACCEPTED,
  SANCTION_STATUS.FORWARDED_TO_PIA, SANCTION_STATUS.PIA_ACCEPTED,
];

const MONEY = 100000;
const PHYSICAL = 1000;
const money = (v) => Math.round((Number(v) || 0) * MONEY);
const physical = (v) => Math.round((Number(v) || 0) * PHYSICAL);
const lakh = (units) => `₹ ${(units / MONEY).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 5 })} Lakh`;

const bad = (message) => new ApiError(HTTP_STATUS.BAD_REQUEST, message);
const conflict = (message) => new ApiError(HTTP_STATUS.CONFLICT, message);
const notFound = (message) => new ApiError(HTTP_STATUS.NOT_FOUND, message);
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
const isId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);

const figuresOf = (allocation) => ({
  departmentId: allocation.departmentId,
  departmentName: allocation.departmentName,
  deptShareLakh: allocation.deptShareLakh,
  sarraShareLakh: allocation.sarraShareLakh,
  totalLakh: allocation.totalLakh,
  activityFinancialTotalLakh: allocation.activityFinancialTotalLakh,
  activities: (allocation.activities || []).map((a) => ({
    activityCode: a.activityCode, activityName: a.activityName, unit: a.unit,
    physicalTarget: a.physicalTarget, financialTargetLakh: a.financialTargetLakh,
  })),
});

/** What has already happened on the project: funds released and progress reported, per department. */
const loadFloor = async (projectId, session) => {
  const entriesQuery = BudgetAllocationEntry.find({ project: projectId }).select('departmentId amountLakh').lean();
  const reportsQuery = ProjectMPR.find({ project: projectId }).select('departmentId activities.activityCode activities.activityName activities.physicalCurrent activities.financialCurrentLakh').lean();
  const [entries, reports] = await Promise.all([
    session ? entriesQuery.session(session) : entriesQuery,
    session ? reportsQuery.session(session) : reportsQuery,
  ]);
  const released = new Map();
  entries.forEach((e) => released.set(String(e.departmentId), (released.get(String(e.departmentId)) || 0) + money(e.amountLakh)));
  const reported = new Map(); // departmentId -> Map(activityCode -> { physical, financial, name })
  reports.forEach((r) => {
    const key = String(r.departmentId);
    if (!reported.has(key)) reported.set(key, new Map());
    (r.activities || []).forEach((a) => {
      const row = reported.get(key).get(a.activityCode) || { physical: 0, financial: 0, name: a.activityName };
      row.physical += physical(a.physicalCurrent);
      row.financial += money(a.financialCurrentLakh);
      reported.get(key).set(a.activityCode, row);
    });
  });
  return { released, reported };
};

/** Validate a proposal against the Head master and against what has already happened. */
const buildProposal = async (project, inputs, session) => {
  const existing = project.departmentAllocations || [];
  const list = Array.isArray(inputs) ? inputs : [];
  if (list.length !== existing.length || existing.some((d) => !list.some((i) => i?.departmentId === String(d.departmentId)))) {
    throw bad('A revision must include every department of the project. Departments cannot be added or removed by a revision.');
  }
  const head = await getActiveHead(String(project.head?.headId || ''));
  const floor = await loadFloor(project._id, session);

  return existing.map((current) => {
    const input = list.find((i) => i.departmentId === String(current.departmentId));
    const allocation = buildAllocation(input, { _id: current.departmentId, name: current.departmentName }, head);
    const name = current.departmentName;

    const releasedUnits = floor.released.get(String(current.departmentId)) || 0;
    if (money(allocation.totalLakh) < releasedUnits) {
      throw bad(`${name}: the revised total (${lakh(money(allocation.totalLakh))}) cannot be less than the funds already released (${lakh(releasedUnits)}).`);
    }
    const proposedByCode = new Map(allocation.activities.map((a) => [a.activityCode, a]));
    (floor.reported.get(String(current.departmentId)) || new Map()).forEach((done, code) => {
      if (done.physical === 0 && done.financial === 0) return;
      const proposed = proposedByCode.get(code);
      if (!proposed) throw bad(`${name}: "${done.name}" already has reported progress and cannot be removed.`);
      if (physical(proposed.physicalTarget) < done.physical) {
        throw bad(`${name} – ${done.name}: the revised physical target cannot be less than the progress already reported (${done.physical / PHYSICAL}).`);
      }
      if (money(proposed.financialTargetLakh) < done.financial) {
        throw bad(`${name} – ${done.name}: the revised financial target cannot be less than the expenditure already reported (${lakh(done.financial)}).`);
      }
    });
    return { head, allocation };
  });
};

const sameFigures = (a, b) => JSON.stringify(figuresOf(a)) === JSON.stringify(figuresOf(b));

const dto = (revision) => ({
  id: String(revision._id),
  projectId: String(revision.project),
  revisionNo: revision.revisionNo,
  reason: revision.reason,
  status: revision.status,
  before: revision.before,
  proposed: revision.proposed,
  beforeTotalLakh: revision.beforeTotalLakh,
  proposedTotalLakh: revision.proposedTotalLakh,
  maker: revision.makerUserId?.name ? { name: revision.makerUserId.name } : null,
  checker: revision.checkerUserId?.name ? { name: revision.checkerUserId.name } : null,
  checkerNote: revision.checkerNote || null,
  checkerAt: revision.checkerAt || null,
  approver: revision.approverUserId?.name ? { name: revision.approverUserId.name } : null,
  approverNote: revision.approverNote || null,
  approverAt: revision.approverAt || null,
  rejectedBy: revision.rejectedBy?.name ? { name: revision.rejectedBy.name } : null,
  rejectionReason: revision.rejectionReason || null,
  rejectedAt: revision.rejectedAt || null,
  createdAt: revision.createdAt,
});

export const listRevisions = async (projectId) => {
  if (!isId(projectId)) throw notFound('Project not found.');
  const revisions = await ProjectRevision.find({ project: projectId })
    .populate('makerUserId checkerUserId approverUserId rejectedBy', 'name')
    .sort({ revisionNo: -1 })
    .lean();
  return revisions.map(dto);
};

/** Maker proposes a revised estimate. */
export const createRevision = async (projectId, body = {}, makerUser) => {
  if (makerUser.workflowRole !== 'MAKER') throw forbidden('Only Makers can propose a revision.');
  if (!isId(projectId)) throw notFound('Project not found.');
  const project = await ProjectSanction.findById(projectId).lean();
  if (!project) throw notFound('Project not found.');
  if (!(project.departmentAllocations || []).length) throw bad('This project has no department-wise budget to revise.');
  if (project.closure?.status === 'CLOSED') throw conflict('This project is closed and can no longer be revised.');
  if (!REVISABLE.includes(project.status)) throw conflict('Only a sanctioned project can be revised. Correct and resubmit the project instead.');

  const reason = String(body.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 10) throw bad('Give the reason for the revision (at least 10 characters).');
  if (await ProjectRevision.exists({ project: project._id, status: { $in: [REVISION_STATUS.PENDING_CHECKER, REVISION_STATUS.PENDING_APPROVER] } })) {
    throw conflict('A revision of this project is already awaiting review.');
  }

  const proposal = await buildProposal(project, body.departments, null);
  const proposed = proposal.map(({ allocation }) => allocation);
  if (project.departmentAllocations.every((current, index) => sameFigures(current, proposed[index]))) {
    throw bad('Nothing has been changed. Revise at least one share or target.');
  }

  const last = await ProjectRevision.findOne({ project: project._id }).sort({ revisionNo: -1 }).select('revisionNo').lean();
  const revision = await ProjectRevision.create({
    project: project._id,
    revisionNo: (last?.revisionNo || 0) + 1,
    reason,
    before: project.departmentAllocations.map(figuresOf),
    proposed: proposed.map(figuresOf),
    beforeTotalLakh: project.totalSanctionedBudgetLakh,
    proposedTotalLakh: roundMoney(proposed.reduce((sum, a) => sum + a.totalLakh, 0)),
    makerUserId: makerUser._id,
  });
  return { revision: dto(revision), project };
};

const loadPending = async (revisionId, expectedStatus, session) => {
  if (!isId(revisionId)) throw notFound('Revision not found.');
  const query = ProjectRevision.findById(revisionId);
  const revision = await (session ? query.session(session) : query);
  if (!revision) throw notFound('Revision not found.');
  if (revision.status !== expectedStatus) throw conflict('This revision has already been reviewed.');
  return revision;
};

/** Checker verifies a proposed revision. */
export const verifyRevision = async (revisionId, note, checkerUser) => {
  if (checkerUser.workflowRole !== 'CHECKER') throw forbidden('Only Checkers can verify a revision.');
  const revision = await loadPending(revisionId, REVISION_STATUS.PENDING_CHECKER);
  revision.status = REVISION_STATUS.PENDING_APPROVER;
  revision.checkerUserId = checkerUser._id;
  revision.checkerNote = String(note ?? '').trim().slice(0, 1000);
  revision.checkerAt = new Date();
  await revision.save();
  return { revision: dto(revision), project: await ProjectSanction.findById(revision.project).lean() };
};

/** Checker or Approver rejects a proposed revision; the project is left unchanged. */
export const rejectRevision = async (revisionId, reason, user) => {
  const text = String(reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!text) throw bad('A reason is required to reject the revision.');
  if (!isId(revisionId)) throw notFound('Revision not found.');
  const revision = await ProjectRevision.findById(revisionId);
  if (!revision) throw notFound('Revision not found.');
  const allowed = (revision.status === REVISION_STATUS.PENDING_CHECKER && user.workflowRole === 'CHECKER')
    || (revision.status === REVISION_STATUS.PENDING_APPROVER && user.workflowRole === 'APPROVER');
  if (!allowed) throw forbidden('You cannot reject this revision at its current stage.');
  revision.status = REVISION_STATUS.REJECTED;
  revision.rejectedBy = user._id;
  revision.rejectionReason = text;
  revision.rejectedAt = new Date();
  await revision.save();
  return { revision: dto(revision), project: await ProjectSanction.findById(revision.project).lean() };
};

/**
 * Approver approves: the project takes the revised figures. Done in one
 * transaction and re-validated first, because funds may have been released or
 * progress reported since the revision was proposed.
 */
export const approveRevision = async (revisionId, note, approverUser) => {
  if (approverUser.workflowRole !== 'APPROVER') throw forbidden('Only Approvers can approve a revision.');
  return runInTransaction(async (session) => {
    const options = session ? { session } : {};
    const revision = await loadPending(revisionId, REVISION_STATUS.PENDING_APPROVER, session);
    const projectQuery = ProjectSanction.findById(revision.project);
    const project = await (session ? projectQuery.session(session) : projectQuery);
    if (!project) throw notFound('Project not found.');
    if (project.closure?.status === 'CLOSED') throw conflict('This project is closed and can no longer be revised.');

    const inputs = revision.proposed.map((d) => ({
      departmentId: String(d.departmentId),
      deptShareLakh: d.deptShareLakh,
      sarraShareLakh: d.sarraShareLakh,
      activities: d.activities.map((a) => ({ activityCode: a.activityCode, physicalTarget: a.physicalTarget, financialTargetLakh: a.financialTargetLakh })),
    }));
    const proposal = await buildProposal(project.toObject(), inputs, session);

    // Apply figures in place so each department keeps its PIA officer and history.
    project.departmentAllocations.forEach((current, index) => {
      const { allocation } = proposal[index];
      current.deptShareLakh = allocation.deptShareLakh;
      current.sarraShareLakh = allocation.sarraShareLakh;
      current.totalLakh = allocation.totalLakh;
      current.activityFinancialTotalLakh = allocation.activityFinancialTotalLakh;
      current.activities = allocation.activities;
    });
    const { head } = proposal[0];
    const allocations = project.departmentAllocations.map((d) => d.toObject());
    project.deptShareLakh = roundMoney(allocations.reduce((s, a) => s + a.deptShareLakh, 0));
    project.sarraShareLakh = roundMoney(allocations.reduce((s, a) => s + a.sarraShareLakh, 0));
    project.totalSanctionedBudgetLakh = roundMoney(project.deptShareLakh + project.sarraShareLakh);
    project.sanctionedTargets = rollUpTargets(allocations, head);

    // Budget position against the new total.
    const releasedUnits = money(project.budgetAllocation?.releasedLakh);
    const totalUnits = money(project.totalSanctionedBudgetLakh);
    project.budgetAllocation = {
      ...(project.budgetAllocation?.toObject?.() || project.budgetAllocation || {}),
      totalLakh: totalUnits / MONEY,
      releasedLakh: releasedUnits / MONEY,
      remainingLakh: Math.max(0, totalUnits - releasedUnits) / MONEY,
      status: releasedUnits <= 0 ? 'NOT_ALLOCATED' : releasedUnits >= totalUnits ? 'FULLY_ALLOCATED' : 'PARTIALLY_ALLOCATED',
    };
    project.budgetVersion = (project.budgetVersion || 0) + 1;
    project.mprVersion = (project.mprVersion || 0) + 1;

    const now = new Date();
    project.workflowHistory.push({
      action: 'REVISED',
      performedBy: approverUser._id,
      performedAt: now,
      note: `Revision ${revision.revisionNo} approved: ${revision.reason}`,
    });
    await project.save(options);

    revision.status = REVISION_STATUS.APPROVED;
    revision.approverUserId = approverUser._id;
    revision.approverNote = String(note ?? '').trim().slice(0, 1000);
    revision.approverAt = now;
    await revision.save(options);
    return { revision: dto(revision), project: project.toObject() };
  });
};
