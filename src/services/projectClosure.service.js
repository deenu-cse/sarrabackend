import mongoose from 'mongoose';
import ProjectSanction from '../models/ProjectSanction.model.js';
import ProjectMPR, { PROJECT_MPR_STATUS } from '../models/ProjectMPR.model.js';
import ProjectRevision from '../models/ProjectRevision.model.js';
import User from '../models/User.model.js';
import { ProjectCompletion, COMPLETION_STATUS } from '../models/ProjectLifecycle.model.js';
import { uploadFile, deleteFile } from './upload.service.js';
import { safeNotify } from './workflowNotification.service.js';
import { piaDepartmentsOf, reportingDepartments, reportingMakerOf } from './projectMpr.service.js';
import { historyStep } from './sanction.service.js';
import { AT_DISTRICT, AT_PIA, OPEN, WITH_MAKER } from './mprWorkflow.js';
import { runInTransaction } from '../utils/transaction.js';
import { SANCTION_STATUS } from '../constants/status.constants.js';
import USER_ROLES, { TIERS, WORKFLOW_ROLES } from '../constants/roles.constants.js';
import { ACTIVE_USER, isDistrict, isHq, sameId, tierRoleQuery } from '../utils/access.js';
import ApiError from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/http.constants.js';
import logger from '../config/logger.js';

/**
 * Project completion and closure.
 *
 *   Reporting Maker (PIA Maker or District Technical Staff)
 *                     files the department's completion report
 *   District Checker / Approver
 *                     verifies it, or returns it with a reason
 *   HQ Approver       closes the project once every department is verified
 *
 * Money figures are always worked out here from the sanctioned allocation and
 * the progress reports. Nothing the browser sends is trusted for them.
 */

const bad = (message, data) => new ApiError(HTTP_STATUS.BAD_REQUEST, message, data);
const forbidden = (message) => new ApiError(HTTP_STATUS.FORBIDDEN, message);
const conflict = (message, code) => new ApiError(HTTP_STATUS.CONFLICT, message, { code });
const notFound = (message) => new ApiError(HTTP_STATUS.NOT_FOUND, message);

const MONEY = 100000;
const toMoney = (value) => Math.round((Number(value) || 0) * MONEY);
const fromMoney = (units) => units / MONEY;
const isValidId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PENDING_REVISION = ['PENDING_CHECKER', 'PENDING_APPROVER'];
const FILED = [COMPLETION_STATUS.SUBMITTED, COMPLETION_STATUS.DISTRICT_VERIFIED];
// Reports not yet approved by the district: the completion report waits for them.
const BEFORE_DISTRICT_APPROVAL = [...WITH_MAKER, ...AT_PIA, ...AT_DISTRICT];

const withSession = (query, session) => (session ? query.session(session) : query);
// Older projects may not have the version field yet; a missing field counts as 0.
const versionIs = (field, value) => (value > 0 ? { [field]: value } : { $or: [{ [field]: 0 }, { [field]: { $exists: false } }] });

const loadProject = async (projectId, session) => {
  if (!isValidId(projectId)) throw notFound('Project not found.');
  const project = await withSession(ProjectSanction.findById(projectId).lean(), session);
  if (!project) throw notFound('Project not found.');
  return project;
};

const canRead = (project, user) => {
  if ([USER_ROLES.SUPER_ADMIN, USER_ROLES.MND_SUPER_ADMIN, USER_ROLES.MND_OFFICER].includes(user.role)) return true;
  if (user.role === USER_ROLES.DD_LEVEL) return Boolean(user.district) && user.district === project.district;
  if (user.role === USER_ROLES.PIA_OFFICER) return piaDepartmentsOf(project, user).length > 0;
  return false;
};

const projectStart = (project) => {
  const dates = [project.approvalDates?.dlec, project.approvalDates?.slec, project.approvalDates?.hpc, project.makerAt, project.createdAt]
    .filter(Boolean).map((d) => new Date(d)).filter((d) => !Number.isNaN(d.getTime()));
  return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date();
};

/** Sanctioned, spent and reporting position of every department of a project. */
const loadFigures = async (project, session) => {
  const reports = await withSession(ProjectMPR.find({ project: project._id, status: { $ne: PROJECT_MPR_STATUS.REJECTED } })
    .select('departmentId status periodIndex reportingMonth financialYear totals').sort({ periodIndex: 1 }).lean(), session);

  return (project.departmentAllocations || []).map((department) => {
    const mine = reports.filter((r) => sameId(r.departmentId, department.departmentId));
    const filed = mine.filter((r) => r.status !== PROJECT_MPR_STATUS.DRAFT);
    const spent = filed.reduce((sum, r) => sum + toMoney(r.totals?.financialCurrentLakh), 0);
    const last = filed[filed.length - 1] || null;
    const sanctioned = toMoney(department.totalLakh);
    return {
      department,
      sanctioned,
      spent,
      balance: Math.max(0, sanctioned - spent),
      physicalPercent: last?.totals?.physicalPercent || 0,
      financialPercent: sanctioned > 0 ? Math.min(100, Math.floor((spent * 10000) / sanctioned) / 100) : 0,
      reports: {
        total: filed.length,
        beforeDistrictApproval: mine.filter((r) => BEFORE_DISTRICT_APPROVAL.includes(r.status)).length,
        open: mine.filter((r) => OPEN.includes(r.status)).length,
        returned: mine.filter((r) => r.status === PROJECT_MPR_STATUS.RETURNED_FOR_CORRECTION).length,
        drafts: mine.filter((r) => r.status === PROJECT_MPR_STATUS.DRAFT).length,
        verified: mine.filter((r) => r.status === PROJECT_MPR_STATUS.VERIFIED_BY_STATE).length,
        lastPeriod: last ? `${last.reportingMonth} ${last.financialYear}` : null,
      },
    };
  });
};

const reportingReady = (department) => (department.reportingMode === 'DISTRICT' ? Boolean(department.districtStaffUserId) : Boolean(department.piaAcceptedAt));

/** Why this department's completion report cannot be filed right now (null = it can). */
const submitBlocker = (project, row, existing) => {
  if (project.closure?.status === 'CLOSED') return 'This project is closed.';
  if (!reportingReady(row.department)) return 'The department is not ready for reporting yet (PIA acceptance or district reporting responsibility is pending).';
  if (existing && FILED.includes(existing.status)) {
    return existing.status === COMPLETION_STATUS.DISTRICT_VERIFIED ? 'The completion report has been verified by the district.' : 'The completion report is with the district for verification.';
  }
  if (row.reports.total === 0) return 'File at least one monthly progress report before the completion report.';
  if (row.reports.drafts > 0) return 'A monthly report is still a draft. Submit or discard it first.';
  if (row.reports.returned > 0) return 'A monthly report was returned for correction. Resubmit it first.';
  if (row.reports.beforeDistrictApproval > 0) return 'A monthly report is still in PIA or district verification. The completion report can be filed after the district approves it.';
  return null;
};

const fileDto = (file) => (file?.url ? { url: file.url, name: file.name || 'Document', mimeType: file.mimeType || null, size: file.size || null } : null);

const completionDto = (doc) => (doc ? {
  id: String(doc._id),
  status: doc.status,
  completionDate: doc.completionDate,
  remarks: doc.remarks || '',
  sanctionedLakh: doc.sanctionedLakh,
  expenditureLakh: doc.expenditureLakh,
  balanceLakh: doc.balanceLakh ?? Math.max(0, (doc.sanctionedLakh || 0) - (doc.expenditureLakh || 0)),
  physicalPercent: doc.physicalPercent,
  reportsCount: doc.reportsCount,
  completionCertificate: fileDto(doc.completionCertificate),
  utilisationCertificate: fileDto(doc.utilisationCertificate),
  submittedBy: doc.submittedBy?.name || null,
  submittedAt: doc.submittedAt,
  reviewedBy: doc.reviewedBy?.name || null,
  reviewedAt: doc.reviewedAt || null,
  reviewNote: doc.reviewNote || null,
  returnReason: doc.returnReason || null,
  history: (doc.history || []).map((step) => ({ status: step.status, note: step.note || '', changedAt: step.changedAt, changedBy: step.changedBy?.name || null })),
} : null);

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const districtReviewer = (user, project) => isDistrict(user, WORKFLOW_ROLES.CHECKER, WORKFLOW_ROLES.APPROVER) && user.district === project.district;

/** Everything the closure screen needs, with what the signed-in user may do. */
export const getCompletionState = async (projectId, user) => {
  const project = await loadProject(projectId);
  if (!canRead(project, user)) throw forbidden('You do not have access to this project.');

  const [rows, completions, pendingRevision, people] = await Promise.all([
    loadFigures(project),
    ProjectCompletion.find({ project: project._id })
      .populate('submittedBy', 'name').populate('reviewedBy', 'name').populate('history.changedBy', 'name').lean(),
    ProjectRevision.exists({ project: project._id, status: { $in: PENDING_REVISION } }),
    User.find({ _id: { $in: (project.departmentAllocations || []).map(reportingMakerOf).filter(Boolean) } }).select('name').lean(),
  ]);
  const nameOf = new Map(people.map((o) => [String(o._id), o.name]));
  const closed = project.closure?.status === 'CLOSED';
  const reviewer = districtReviewer(user, project);
  const isPiaUser = user.role === USER_ROLES.PIA_OFFICER;
  const reporting = reportingDepartments(project, user);
  const visibleIds = new Set(isPiaUser ? piaDepartmentsOf(project, user).map((d) => String(d.departmentId)) : rows.map((row) => String(row.department.departmentId)));

  const departments = rows.filter((row) => visibleIds.has(String(row.department.departmentId))).map((row) => {
    const doc = completions.find((c) => sameId(c.departmentId, row.department.departmentId)) || null;
    const mine = reporting.some((d) => sameId(d.departmentId, row.department.departmentId));
    const blocker = submitBlocker(project, row, doc);
    const maker = reportingMakerOf(row.department);
    return {
      departmentId: String(row.department.departmentId),
      name: row.department.departmentName,
      reportingMode: row.department.reportingMode || 'PIA',
      officer: maker ? { id: String(maker), name: nameOf.get(String(maker)) || '' } : null,
      accepted: reportingReady(row.department),
      sanctionedLakh: fromMoney(row.sanctioned),
      expenditureLakh: fromMoney(row.spent),
      balanceLakh: fromMoney(row.balance),
      physicalPercent: row.physicalPercent,
      financialPercent: row.financialPercent,
      reports: row.reports,
      completion: completionDto(doc),
      canSubmit: mine && !blocker,
      submitBlockedReason: mine ? blocker : null,
      canVerify: reviewer && !closed && doc?.status === COMPLETION_STATUS.SUBMITTED && !sameId(doc.submittedBy?._id || doc.submittedBy, user._id),
      canReturn: reviewer && !closed && Boolean(doc) && FILED.includes(doc.status),
    };
  });

  const all = rows.map((row) => completions.find((c) => sameId(c.departmentId, row.department.departmentId)) || null);
  const verified = all.filter((doc) => doc?.status === COMPLETION_STATUS.DISTRICT_VERIFIED).length;
  const filed = all.filter((doc) => doc && FILED.includes(doc.status)).length;
  const openReports = sum(rows.map((row) => ({ open: row.reports.open })), 'open');

  let closeBlockedReason = null;
  if (closed) closeBlockedReason = 'This project is already closed.';
  else if (!rows.length) closeBlockedReason = 'This project has no departments.';
  else if (verified < rows.length) closeBlockedReason = `${rows.length - verified} of ${rows.length} department${rows.length === 1 ? '' : 's'} still need a district-verified completion report.`;
  else if (openReports > 0) closeBlockedReason = `${openReports} monthly progress report${openReports === 1 ? ' is' : 's are'} still in the approval chain. Every report must be verified by the State first.`;
  else if (pendingRevision) closeBlockedReason = 'A target revision is still awaiting a decision.';

  const sanctioned = toMoney(project.totalSanctionedBudgetLakh) || sum(rows, 'sanctioned');
  const spent = sum(rows, 'spent');
  return {
    project: {
      id: String(project._id),
      code: project.projectId || project.sanctionId || '',
      name: project.projectTitle || '',
      district: project.district,
      status: project.status,
    },
    closure: closed ? {
      status: 'CLOSED',
      closedAt: project.closure.closedAt,
      closedBy: (await User.findById(project.closure.closedBy).select('name').lean())?.name || null,
      note: project.closure.note || '',
      sanctionedLakh: project.closure.sanctionedLakh,
      expenditureLakh: project.closure.expenditureLakh,
      balanceLakh: project.closure.balanceLakh ?? Math.max(0, (project.closure.sanctionedLakh || 0) - (project.closure.expenditureLakh || 0)),
    } : { status: 'OPEN' },
    totals: {
      sanctionedLakh: fromMoney(sanctioned),
      expenditureLakh: fromMoney(spent),
      balanceLakh: fromMoney(Math.max(0, sanctioned - spent)),
    },
    progress: { departments: rows.length, filed, verified },
    departments,
    canClose: isHq(user, WORKFLOW_ROLES.APPROVER) && !closeBlockedReason,
    closeBlockedReason: user.role === USER_ROLES.SUPER_ADMIN ? closeBlockedReason : null,
    closeRole: 'APPROVER',
  };
};

const checkFile = (file, label) => {
  if (!FILE_TYPES.includes(file.mimetype)) throw bad(`${label}: upload a PDF, JPG or PNG file.`);
  if (file.size > MAX_FILE_BYTES) throw bad(`${label}: the file is too large. Maximum size is 10 MB.`);
};

const store = async (file) => {
  const saved = await uploadFile(file.buffer, 'project-completion');
  return { url: saved.url, publicId: saved.publicId, name: clean(file.originalname, 200) || 'Document', mimeType: file.mimetype, size: file.size };
};

const parseDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCDate() === Number(match[3]) ? date : null;
};

const notifyQuietly = async (recipients, payload) => {
  try { await safeNotify(recipients, payload); } catch (err) { logger.error(`Closure notification failed: ${err.message}`); }
};

const notice = (project, actor, extra) => ({
  referenceNo: project.projectId || project.sanctionId || '',
  projectTitle: project.projectTitle || '',
  actorName: actor?.name || 'SARRA CRM',
  actorRole: actor?.workflowRole || actor?.role || 'System',
  status: project.status,
  eventDate: new Date(),
  relatedResource: 'ProjectSanction',
  relatedId: project._id,
  ...extra,
});

/** The row of a department this user reports on, or null. */
const reportingRow = (rows, project, user, departmentId) => {
  const mine = reportingDepartments(project, user);
  return rows.find((item) => sameId(item.department.departmentId, departmentId) && mine.some((d) => sameId(d.departmentId, departmentId))) || null;
};

/** Reporting Maker files (or, after a return, corrects) the department's completion report. */
export const submitCompletion = async (projectId, body = {}, files = {}, user) => {
  if (![USER_ROLES.PIA_OFFICER, USER_ROLES.DD_LEVEL].includes(user.role)) throw forbidden('Only the reporting Maker of the department can file its completion report.');
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId : '';
  const completionDate = parseDay(body.completionDate);
  if (!completionDate) throw bad('Enter the date the works were completed.');
  const today = new Date();
  if (completionDate.getTime() > Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) throw bad('The completion date cannot be in the future.');
  const remarks = clean(body.remarks, 2000);

  const certificate = files.completionCertificate?.[0] || null;
  const utilisation = files.utilisationCertificate?.[0] || null;
  if (certificate) checkFile(certificate, 'Completion Certificate');
  if (utilisation) checkFile(utilisation, 'Utilisation Certificate');

  // Check everything that does not need the files before uploading them.
  const before = await loadProject(projectId);
  const row = reportingRow(await loadFigures(before), before, user, departmentId);
  if (!row) throw forbidden('You are not the reporting Maker of this department.');
  const existingBefore = await ProjectCompletion.findOne({ project: before._id, departmentId: row.department.departmentId }).lean();
  const blockedBefore = submitBlocker(before, row, existingBefore);
  if (blockedBefore) throw conflict(blockedBefore, 'COMPLETION_BLOCKED');
  const start = projectStart(before);
  if (completionDate.getTime() < Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) throw bad('The completion date cannot be before the project started.');
  if (!certificate && !existingBefore?.completionCertificate?.url) throw bad('Attach the Completion Certificate.');
  if (!utilisation && !existingBefore?.utilisationCertificate?.url) throw bad('Attach the Utilisation Certificate.');

  const uploaded = [];
  try {
    const storedCertificate = certificate ? await store(certificate) : null;
    if (storedCertificate) uploaded.push(storedCertificate);
    const storedUtilisation = utilisation ? await store(utilisation) : null;
    if (storedUtilisation) uploaded.push(storedUtilisation);

    const { saved, replaced, project } = await runInTransaction(async (session) => {
      const options = session ? { session } : {};
      const current = await loadProject(projectId, session);
      const figures = reportingRow(await loadFigures(current, session), current, user, departmentId);
      if (!figures) throw forbidden('You are not the reporting Maker of this department.');
      const existing = await withSession(ProjectCompletion.findOne({ project: current._id, departmentId: figures.department.departmentId }), session);
      const blocked = submitBlocker(current, figures, existing);
      if (blocked) throw conflict(blocked, 'COMPLETION_BLOCKED');

      const now = new Date();
      const snapshot = {
        status: COMPLETION_STATUS.SUBMITTED,
        completionDate,
        remarks,
        sanctionedLakh: fromMoney(figures.sanctioned),
        expenditureLakh: fromMoney(figures.spent),
        balanceLakh: fromMoney(figures.balance),
        physicalPercent: figures.physicalPercent,
        reportsCount: figures.reports.total,
        submittedBy: user._id,
        submittedAt: now,
      };
      const old = [];
      let doc = existing;
      if (doc) {
        if (storedCertificate && doc.completionCertificate?.publicId) old.push(doc.completionCertificate.publicId);
        if (storedUtilisation && doc.utilisationCertificate?.publicId) old.push(doc.utilisationCertificate.publicId);
        Object.assign(doc, snapshot);
        if (storedCertificate) doc.completionCertificate = storedCertificate;
        if (storedUtilisation) doc.utilisationCertificate = storedUtilisation;
        doc.returnReason = undefined;
        doc.reviewedBy = undefined;
        doc.reviewedAt = undefined;
        doc.reviewNote = undefined;
        doc.history.push({ status: COMPLETION_STATUS.SUBMITTED, changedBy: user._id, changedAt: now, note: 'Corrected and resubmitted' });
        await doc.save(options);
      } else {
        try {
          [doc] = await ProjectCompletion.create([{
            ...snapshot,
            project: current._id,
            projectCode: current.projectId || current.sanctionId || '',
            district: current.district,
            departmentId: figures.department.departmentId,
            departmentName: figures.department.departmentName,
            completionCertificate: storedCertificate,
            utilisationCertificate: storedUtilisation,
            history: [{ status: COMPLETION_STATUS.SUBMITTED, changedBy: user._id, changedAt: now, note: 'Filed with the district for verification' }],
          }], options);
        } catch (err) {
          if (err?.code === 11000) throw conflict('The completion report of this department has already been filed.', 'COMPLETION_BLOCKED');
          throw err;
        }
      }

      // The report version moves too, so a monthly report being saved at this instant is validated again and refused.
      const marked = await ProjectSanction.updateOne(
        {
          _id: current._id,
          'closure.status': { $ne: 'CLOSED' },
          departmentAllocations: { $elemMatch: { departmentId: figures.department.departmentId, $or: [{ piaUserId: user._id }, { districtStaffUserId: user._id }] } },
        },
        {
          $set: { 'departmentAllocations.$.completion': { status: COMPLETION_STATUS.SUBMITTED, completionDate, submittedAt: now } },
          $inc: { mprVersion: 1 },
          $push: { workflowHistory: historyStep(user, 'COMPLETION_SUBMITTED', `${figures.department.departmentName}: completion report filed`) },
        },
        options,
      );
      if (marked.modifiedCount !== 1) throw conflict('The project changed while the report was being saved. Please try again.', 'STALE');
      return { saved: doc, replaced: old, project: current };
    });

    replaced.forEach((publicId) => { deleteFile(publicId); });
    const reviewers = await User.find({ $or: [
      tierRoleQuery(TIERS.DISTRICT, WORKFLOW_ROLES.CHECKER, { district: project.district }),
      tierRoleQuery(TIERS.DISTRICT, WORKFLOW_ROLES.APPROVER, { district: project.district }),
    ] });
    await notifyQuietly(reviewers, notice(project, user, {
      title: `${project.projectId || 'Project'}: completion report to verify`,
      message: `${saved.departmentName} filed its completion report for ${project.projectTitle || project.projectId}.`,
      emailDescription: 'A completion report has been filed and is awaiting district verification. Please check the certificates and the final expenditure, then verify it or return it for correction.',
      subject: 'Action Required: Completion Report Awaiting Verification',
      priority: 'HIGH',
      primaryLabel: 'Open Project',
      link: `/dashboard/dd/projects/${project._id}#closure`,
    }));
    return saved;
  } catch (err) {
    // Nothing was saved, so the files just uploaded are orphans.
    if (!err?.keepFiles) uploaded.forEach((file) => { deleteFile(file.publicId); });
    throw err;
  }
};

const reviewCompletion = async (projectId, departmentId, user, apply) => runInTransaction(async (session) => {
  const options = session ? { session } : {};
  const project = await loadProject(projectId, session);
  if (!districtReviewer(user, project)) throw forbidden('Only the District Checker or Approver of this project\'s district can verify completion reports.');
  if (project.closure?.status === 'CLOSED') throw conflict('This project is closed.', 'PROJECT_CLOSED');
  if (!isValidId(departmentId)) throw notFound('Completion report not found.');
  const doc = await withSession(ProjectCompletion.findOne({ project: project._id, departmentId }), session);
  if (!doc) throw notFound('Completion report not found.');
  const now = new Date();
  const result = apply(doc, now);
  await doc.save(options);
  const set = { 'departmentAllocations.$.completion.status': doc.status };
  if (doc.status === COMPLETION_STATUS.DISTRICT_VERIFIED) set['departmentAllocations.$.completion.verifiedAt'] = now;
  await ProjectSanction.updateOne(
    { _id: project._id, 'departmentAllocations.departmentId': doc.departmentId },
    { $set: set, $inc: { mprVersion: 1 }, $push: { workflowHistory: historyStep(user, result.action, `${doc.departmentName}: ${result.note}`) } },
    options,
  );
  return { doc, project };
});

/** District Checker or Approver verifies a department's completion report. */
export const verifyCompletion = async (projectId, departmentId, note, user) => {
  const text = clean(note, 1000);
  const { doc, project } = await reviewCompletion(projectId, departmentId, user, (completion, now) => {
    if (completion.status !== COMPLETION_STATUS.SUBMITTED) {
      throw conflict(completion.status === COMPLETION_STATUS.DISTRICT_VERIFIED ? 'This completion report is already verified.' : 'This completion report was returned and has not been filed again.', 'NOT_VERIFIABLE');
    }
    if (sameId(completion.submittedBy, user._id)) throw forbidden('You filed this completion report, so you cannot verify it.');
    completion.status = COMPLETION_STATUS.DISTRICT_VERIFIED;
    completion.reviewedBy = user._id;
    completion.reviewedAt = now;
    completion.reviewNote = text || undefined;
    completion.returnReason = undefined;
    completion.history.push({ status: COMPLETION_STATUS.DISTRICT_VERIFIED, changedBy: user._id, changedAt: now, note: text || 'Verified by district' });
    return { action: 'COMPLETION_VERIFIED', note: 'completion report verified by district' };
  });

  const [submitter, verifiedCount] = await Promise.all([
    User.findById(doc.submittedBy),
    ProjectCompletion.countDocuments({ project: project._id, status: COMPLETION_STATUS.DISTRICT_VERIFIED }),
  ]);
  await notifyQuietly(submitter, notice(project, user, {
    title: `${project.projectId || 'Project'}: completion report verified`,
    message: `The completion report of ${doc.departmentName} was verified by ${user.name}.`,
    subject: 'Completion Report Verified by District',
    primaryLabel: 'Open Project',
  }));
  if (verifiedCount >= (project.departmentAllocations || []).length) {
    const approvers = await User.find(tierRoleQuery(TIERS.HQ, WORKFLOW_ROLES.APPROVER));
    await notifyQuietly(approvers, notice(project, user, {
      title: `${project.projectId || 'Project'} is ready to be closed`,
      message: `Every department of ${project.projectTitle || project.projectId} has a district-verified completion report.`,
      emailDescription: 'All completion reports of this project have been verified by the district. Please review the final expenditure and close the project.',
      subject: 'Action Required: Project Ready for Closure',
      priority: 'HIGH',
      primaryLabel: 'Review and Close',
      link: `/dashboard/admin/projects/${project._id}#closure`,
    }));
  }
  return doc;
};

/** District Checker or Approver sends a completion report back. Monthly reporting opens again for the department. */
export const returnCompletion = async (projectId, departmentId, reason, user) => {
  const text = clean(reason, 1000);
  if (text.length < 5) throw bad('Give the reason for returning the completion report.');
  const { doc, project } = await reviewCompletion(projectId, departmentId, user, (completion, now) => {
    if (!FILED.includes(completion.status)) throw conflict('This completion report has already been returned.', 'NOT_RETURNABLE');
    completion.status = COMPLETION_STATUS.RETURNED;
    completion.reviewedBy = user._id;
    completion.reviewedAt = now;
    completion.returnReason = text;
    completion.history.push({ status: COMPLETION_STATUS.RETURNED, changedBy: user._id, changedAt: now, note: text });
    return { action: 'COMPLETION_RETURNED', note: `completion report returned (${text})` };
  });
  await notifyQuietly(await User.findById(doc.submittedBy), notice(project, user, {
    title: `${project.projectId || 'Project'}: completion report returned`,
    message: `The completion report of ${doc.departmentName} was returned by ${user.name}: ${text}`,
    emailDescription: 'Your completion report has been returned for correction. Please read the remarks, correct it and file it again.',
    subject: 'Completion Report Returned for Correction',
    priority: 'HIGH',
    primaryLabel: 'Open Project',
  }));
  return doc;
};

/** HQ Approver closes the project. Figures are taken again from the reports at this moment. */
export const closeProject = async (projectId, body = {}, user) => {
  if (!isHq(user, WORKFLOW_ROLES.APPROVER)) throw forbidden('Only the HQ Approver can close a project.');
  const note = clean(body.note, 1000);
  if (note.length < 10) throw bad('Write a closure note (at least 10 characters).');

  const result = await runInTransaction(async (session) => {
    const options = session ? { session } : {};
    const project = await loadProject(projectId, session);
    if (project.closure?.status === 'CLOSED') throw conflict('This project is already closed.', 'PROJECT_CLOSED');
    if (project.status === SANCTION_STATUS.REJECTED) throw conflict('A project returned to the Maker cannot be closed.', 'NOT_CLOSABLE');
    const rows = await loadFigures(project, session);
    if (!rows.length) throw conflict('This project has no departments.', 'NOT_CLOSABLE');
    const completions = await withSession(ProjectCompletion.find({ project: project._id }).lean(), session);
    const verified = rows.filter((row) => completions.some((c) => sameId(c.departmentId, row.department.departmentId) && c.status === COMPLETION_STATUS.DISTRICT_VERIFIED)).length;
    if (verified < rows.length) throw conflict(`${rows.length - verified} of ${rows.length} department${rows.length === 1 ? '' : 's'} still need a district-verified completion report.`, 'NOT_CLOSABLE');
    if (rows.some((row) => row.reports.open > 0)) throw conflict('A monthly progress report of this project is still in the approval chain.', 'NOT_CLOSABLE');
    if (await withSession(ProjectRevision.exists({ project: project._id, status: { $in: PENDING_REVISION } }), session)) {
      throw conflict('A target revision is still awaiting a decision.', 'NOT_CLOSABLE');
    }

    const sanctioned = toMoney(project.totalSanctionedBudgetLakh) || sum(rows, 'sanctioned');
    const spent = sum(rows, 'spent');
    const now = new Date();
    const closure = {
      status: 'CLOSED',
      closedAt: now,
      closedBy: user._id,
      note,
      sanctionedLakh: fromMoney(sanctioned),
      expenditureLakh: fromMoney(spent),
      balanceLakh: fromMoney(Math.max(0, sanctioned - spent)),
    };
    // mprVersion moves: a report being saved at this instant fails its own check.
    const updated = await ProjectSanction.updateOne(
      { _id: project._id, 'closure.status': { $ne: 'CLOSED' }, ...versionIs('mprVersion', project.mprVersion) },
      {
        $set: { closure },
        $inc: { mprVersion: 1 },
        $push: { workflowHistory: historyStep(user, 'CLOSED', note) },
      },
      options,
    );
    if (updated.modifiedCount !== 1) throw conflict('The project changed while it was being closed. Please review the figures and try again.', 'STALE');
    return { project, closure };
  });

  const { project, closure } = result;
  const recipients = await User.find({
    ...ACTIVE_USER,
    $or: [
      { role: USER_ROLES.DD_LEVEL, district: project.district },
      { _id: { $in: (project.departmentAllocations || []).map((d) => d.piaUserId).filter(Boolean) } },
    ],
  });
  await notifyQuietly(recipients, notice(project, user, {
    title: `${project.projectId || 'Project'} closed`,
    message: `${project.projectTitle || project.projectId} was closed by ${user.name}. Expenditure Rs. ${closure.expenditureLakh} lakh of Rs. ${closure.sanctionedLakh} lakh sanctioned.`,
    subject: 'SARRA Project Closed',
    primaryLabel: 'Open Project',
  }));
  return { id: String(project._id), code: project.projectId || project.sanctionId || '', closure };
};
